// Supabase Edge Function: turns a voice recording into text with OpenAI's transcription service.
// Replaces the browser's own voice typing, which mishears many accents.
//
// Security
// - Supabase checks the caller's login before this runs (verify_jwt = true in config.toml).
// - The database client acts AS THE CALLER, so Row Level Security applies. No service_role key.
// - The OpenAI key is the existing function secret OPENAI_API_KEY. It never reaches the browser.
// - Per-user limit: RATE_LIMIT_PER_HOUR recordings per hour. Recordings over MAX_BYTES are refused.
// - The recording is passed straight to OpenAI and is never stored or written to logs.
//
// Deploy:  npx supabase functions deploy transcribe --project-ref dyqmzgebcbalboecncjv
// Optional secret TRANSCRIBE_MODEL picks the model (default below). If OpenAI says that model is
// not available to the account, the function tries FALLBACK_MODEL once.
import { createClient } from 'npm:@supabase/supabase-js@2'

const RATE_LIMIT_PER_HOUR = 30
export const MAX_BYTES = 10 * 1024 * 1024
const TIMEOUT_MS = 60_000
const MODEL = Deno.env.get('TRANSCRIBE_MODEL') ?? 'gpt-4o-transcribe'
const FALLBACK_MODEL = 'whisper-1'

const cors = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Only Hiba's own addresses may call this from a browser (secret APP_ORIGINS, comma-separated,
// the same one LinkedIn sign-in uses). If it is not set, any address is allowed, as before.
// Every request also needs the person's login token, so this is an extra layer, not the only one.
const CORS_ORIGINS = (Deno.env.get('APP_ORIGINS') ?? Deno.env.get('ALLOWED_ORIGIN') ?? '')
  .split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean)
function withOrigin(res: Response, origin: string | null): Response {
  const headers = new Headers(res.headers)
  headers.set('Access-Control-Allow-Origin',
    !CORS_ORIGINS.length ? '*' : origin && CORS_ORIGINS.includes(origin) ? origin : CORS_ORIGINS[0])
  headers.set('Vary', 'Origin')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

type ErrorCode =
  | 'bad_request' | 'unauthorized' | 'too_large' | 'rate_limited' | 'not_configured' | 'failed' | 'server_error'

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' },
  })
}
const fail = (status: number, code: ErrorCode) => reply(status, { error: code })

/** Audio types browsers record in (Chrome/Edge/Firefox: webm or ogg; Safari: mp4). */
const TYPES: Record<string, string> = {
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
}
export const extensionFor = (type: string) => TYPES[type.split(';')[0].trim().toLowerCase()] ?? null

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const plain = (v: string) => (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(v) ? v.replace(/-/g, ' ') : v)
const list = (v: unknown) =>
  Array.isArray(v) ? v.filter((x) => typeof x === 'string').map(plain).join(', ') : plain(str(v, 200))

/**
 * A short hint so names and work terms are spelled correctly. It only guides spelling;
 * it never adds words to the transcript.
 */
export function vocabularyHint(profile: Record<string, unknown> | null): string {
  const a = (profile?.onboarding ?? {}) as Record<string, unknown>
  const parts = [
    'A professional sharing an idea for a social media post, in English.',
    str(profile?.preferred_name, 60) ? `Speaker: ${str(profile?.preferred_name, 60)}.` : '',
    list(a.craft) ? `Work: ${list(a.craft)}.` : '',
    list(a.topics) ? `Topics: ${list(a.topics)}.` : '',
    'Terms may include: product manager, product discovery, user research, stakeholders, roadmap, MVP, LinkedIn, Substack, API.',
  ]
  return parts.filter(Boolean).join(' ').slice(0, 800)
}

async function callOpenAI(key: string, model: string, audio: Blob, filename: string, prompt: string) {
  const form = new FormData()
  form.append('file', audio, filename)
  form.append('model', model)
  form.append('language', 'en')
  form.append('response_format', 'json')
  if (prompt) form.append('prompt', prompt)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST', signal: ctrl.signal, headers: { Authorization: `Bearer ${key}` }, body: form,
    })
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300)
      // Only the status and OpenAI's own message are logged, never the audio or the transcript.
      console.error('OpenAI transcription error', model, res.status, detail)
      const modelProblem = (res.status === 400 || res.status === 404) && /model/i.test(detail)
      return { ok: false as const, modelProblem }
    }
    const data = await res.json()
    return { ok: true as const, text: typeof data?.text === 'string' ? data.text.trim() : '' }
  } catch (e) {
    console.error('OpenAI transcription request failed', e instanceof Error ? e.name : 'unknown')
    return { ok: false as const, modelProblem: false }
  } finally {
    clearTimeout(timer)
  }
}

Deno.serve(async (req) => withOrigin(await handle(req), req.headers.get('origin')))

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail(405, 'bad_request')

  const auth = req.headers.get('Authorization')
  if (!auth) return fail(401, 'unauthorized')

  const length = Number(req.headers.get('content-length') ?? '0')
  if (length > MAX_BYTES + 64 * 1024) return fail(413, 'too_large')

  let audio: File
  try {
    const form = await req.formData()
    const file = form.get('audio')
    if (!(file instanceof File)) return fail(400, 'bad_request')
    audio = file
  } catch {
    return fail(400, 'bad_request')
  }
  if (audio.size === 0) return fail(400, 'bad_request')
  if (audio.size > MAX_BYTES) return fail(413, 'too_large')
  const ext = extensionFor(audio.type)
  if (!ext) return fail(400, 'bad_request')

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  })
  const { data: userData, error: userError } = await db.auth.getUser()
  if (userError || !userData.user) return fail(401, 'unauthorized')
  const userId = userData.user.id

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count, error: countError } = await db
    .from('transcription_requests').select('id', { count: 'exact', head: true }).gte('created_at', since)
  if (countError) return fail(500, 'server_error')
  if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) return fail(429, 'rate_limited')

  const key = Deno.env.get('OPENAI_API_KEY')
  if (!key) return fail(503, 'not_configured')

  const { error: logError } = await db.from('transcription_requests').insert({ user_id: userId })
  if (logError) return fail(500, 'server_error')

  const { data: profile } = await db
    .from('profiles').select('preferred_name, onboarding').eq('id', userId).maybeSingle()
  const prompt = vocabularyHint(profile)
  const filename = `recording.${ext}`

  let result = await callOpenAI(key, MODEL, audio, filename, prompt)
  if (!result.ok && result.modelProblem && MODEL !== FALLBACK_MODEL) {
    result = await callOpenAI(key, FALLBACK_MODEL, audio, filename, prompt)
  }
  if (!result.ok) return fail(502, 'failed')
  return reply(200, { text: result.text })
}
