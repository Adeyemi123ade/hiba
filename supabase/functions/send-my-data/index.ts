// Supabase Edge Function: emails a person a private link to the copy of their data (HPD-159).
//
// Owner decisions, 24 Nov 2026:
// - The copy goes to the person's own sign-in email only. The typed address must match it.
// - The email holds a private link that works for 7 days. Then the file is deleted.
//
// How it works: the app builds the ZIP and uploads it to the private bucket data-exports, in the
// person's own folder (migration 0024). This function checks the login, the email and the file,
// makes a 7-day link, sends the email with Resend and records it. Each run also deletes files
// whose link has expired.
//
// Security
// - Supabase checks the caller's login before this runs (Verify JWT on).
// - The file must be in the caller's own folder; the email goes only to the caller's own address.
// - One copy per person every WAIT_HOURS (owner, 24 Nov 2026: once in 3 days). A send that fails
//   does not count. The app asks first ({ check: true }) so people hear about the wait before anything is built.
// - The service role key is used only for the link, the record and the clean-up. It never leaves here.
//
// Secrets (Supabase > Edge Functions > Secrets):
//   RESEND_API_KEY     the Resend API key
//   EXPORT_FROM_EMAIL  the sender, for example: Hiba <no-reply@yourdomain.com> (a domain verified in Resend)
//   APP_ORIGINS        already set for LinkedIn: Hiba's web addresses
//
// Deploy: paste this file into the dashboard as a function named send-my-data, or
//   npx supabase functions deploy send-my-data --project-ref dyqmzgebcbalboecncjv
import { createClient } from 'npm:@supabase/supabase-js@2'

const BUCKET = 'data-exports'
const LINK_DAYS = 7
const WAIT_HOURS = 72
const SEND_TIMEOUT_MS = 20_000

const cors = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const CORS_ORIGINS = (Deno.env.get('APP_ORIGINS') ?? Deno.env.get('ALLOWED_ORIGIN') ?? '')
  .split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean)
function withOrigin(res: Response, origin: string | null): Response {
  const headers = new Headers(res.headers)
  headers.set('Access-Control-Allow-Origin',
    !CORS_ORIGINS.length ? '*' : origin && CORS_ORIGINS.includes(origin) ? origin : CORS_ORIGINS[0])
  headers.set('Vary', 'Origin')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

type ErrorCode = 'bad_request' | 'unauthorized' | 'email_mismatch' | 'rate_limited' | 'not_found'
  | 'not_configured' | 'send_failed' | 'server_error'

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' },
  })
}
const fail = (status: number, code: ErrorCode) => reply(status, { error: code })

export const sameEmail = (a: unknown, b: unknown) =>
  typeof a === 'string' && typeof b === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase() && a.trim() !== ''

/** Only a ZIP directly in the caller's own folder, with a name the app makes. */
export const ownExportPath = (path: unknown, userId: string) =>
  typeof path === 'string' && path.length <= 300 && new RegExp(`^${userId}/[A-Za-z0-9-]{8,80}\\.zip$`).test(path)

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export function emailBody(name: string, link: string, expires: Date) {
  const until = expires.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  const hi = name ? `Hi ${name},` : 'Hi,'
  const text = [
    hi, '',
    'Here is the copy of your Hiba data you asked for.', '',
    `Download it here: ${link}`, '',
    `This link works until ${until}. After that the file is deleted.`,
    'Open read-me-first.html inside the ZIP file to see your data.', '',
    'If you did not ask for this, change your password and contact us.', '',
    'Hiba',
  ].join('\n')
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1.5;color:#1a202c;max-width:520px">
<p>${esc(hi)}</p>
<p>Here is the copy of your Hiba data you asked for.</p>
<p><a href="${esc(link)}" style="display:inline-block;background:#166534;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">Download my data</a></p>
<p>This link works until ${esc(until)}. After that the file is deleted.<br>Open <strong>read-me-first.html</strong> inside the ZIP file to see your data.</p>
<p style="color:#4a5568;font-size:14px">If you did not ask for this, change your password and contact us.</p>
<p>Hiba</p>
</div>`
  return { subject: 'Your Hiba data', text, html }
}

Deno.serve(async (req) => withOrigin(await handle(req), req.headers.get('origin')))

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail(405, 'bad_request')
  const auth = req.headers.get('Authorization')
  if (!auth) return fail(401, 'unauthorized')

  let body: { path?: unknown; email?: unknown; check?: unknown }
  try {
    body = await req.json()
  } catch {
    return fail(400, 'bad_request')
  }

  const url = Deno.env.get('SUPABASE_URL')!
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  })
  const { data: userData, error: userError } = await asCaller.auth.getUser()
  if (userError || !userData.user) return fail(401, 'unauthorized')
  const user = userData.user

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  // When the person may ask again, or null if they may ask now.
  const since = new Date(Date.now() - WAIT_HOURS * 60 * 60 * 1000).toISOString()
  const { data: recent, error: recentError } = await admin.from('data_exports')
    .select('created_at').eq('user_id', user.id).gte('created_at', since).order('created_at', { ascending: false }).limit(1)
  if (recentError) {
    console.error('send-my-data: limit check failed', recentError.message)
    return fail(500, 'server_error')
  }
  const last = recent?.[0]?.created_at as string | undefined
  const nextAt = last ? new Date(new Date(last).getTime() + WAIT_HOURS * 60 * 60 * 1000).toISOString() : null

  if (body.check === true) return reply(200, { allowed: !nextAt, nextAt })

  if (!ownExportPath(body.path, user.id)) return fail(400, 'bad_request')
  const path = body.path as string
  const dropFile = () => admin.storage.from(BUCKET).remove([path]).catch(() => undefined)

  // The address must be the person's own sign-in email (owner decision).
  if (!sameEmail(body.email, user.email)) {
    await dropFile()
    return fail(400, 'email_mismatch')
  }

  const key = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('EXPORT_FROM_EMAIL')
  if (!key || !from) {
    console.error('send-my-data: RESEND_API_KEY or EXPORT_FROM_EMAIL is not set')
    await dropFile()
    return fail(503, 'not_configured')
  }

  if (nextAt) {
    await dropFile()
    return reply(429, { error: 'rate_limited', nextAt })
  }

  const expires = new Date(Date.now() + LINK_DAYS * 24 * 60 * 60 * 1000)
  const fileName = `hiba-my-data-${new Date().toISOString().slice(0, 10)}.zip`
  const { data: signed, error: signError } = await admin.storage.from(BUCKET)
    .createSignedUrl(path, LINK_DAYS * 24 * 60 * 60, { download: fileName })
  if (signError || !signed?.signedUrl) return fail(404, 'not_found')

  const { error: recordError } = await admin.from('data_exports')
    .insert({ user_id: user.id, path, expires_at: expires.toISOString() })
  if (recordError) {
    console.error('send-my-data: record failed', recordError.message)
    await dropFile()
    return fail(500, 'server_error')
  }

  const { data: profile } = await admin.from('profiles').select('first_name, preferred_name').eq('id', user.id).maybeSingle()
  const name = String(profile?.first_name || profile?.preferred_name || '').trim().slice(0, 60)
  const mail = emailBody(name, signed.signedUrl, expires)

  let sent = false
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), SEND_TIMEOUT_MS)
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [user.email], subject: mail.subject, text: mail.text, html: mail.html }),
    }).finally(() => clearTimeout(timer))
    sent = res.ok
    if (!res.ok) console.error('send-my-data: Resend refused', res.status, (await res.text()).slice(0, 300))
  } catch (e) {
    console.error('send-my-data: Resend did not answer', String(e).slice(0, 200))
  }
  if (!sent) {
    await admin.from('data_exports').delete().eq('path', path)
    await dropFile()
    return fail(502, 'send_failed')
  }

  await removeExpired(admin)
  return reply(200, { sent: true, expiresAt: expires.toISOString() })
}

/** Deletes files whose 7-day link has run out. Best effort: anything left is tried next time. */
// deno-lint-ignore no-explicit-any
async function removeExpired(admin: any) {
  try {
    const { data } = await admin.from('data_exports').select('id, path')
      .is('removed_at', null).lt('expires_at', new Date().toISOString()).limit(100)
    const rows = (data ?? []) as { id: string; path: string }[]
    if (!rows.length) return
    const { error } = await admin.storage.from(BUCKET).remove(rows.map((r) => r.path))
    if (error) return
    await admin.from('data_exports').update({ removed_at: new Date().toISOString() }).in('id', rows.map((r) => r.id))
  } catch { /* next time */ }
}
