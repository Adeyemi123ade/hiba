// Supabase Edge Function: connect LinkedIn and publish an approved post (H08, HPD-71 "post now").
//
// Security
// - Supabase checks the caller's login token first (Verify JWT ON).
// - The database client acts AS THE CALLER, so Row Level Security applies. No service_role key.
// - The LinkedIn client secret and the encryption key are function secrets; never sent to the browser.
// - LinkedIn access tokens are encrypted (AES-GCM) before they are stored.
// - A LinkedIn approval is only accepted with a one-time value created by the same person
//   in the last 10 minutes.
//
// Secrets: LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY, APP_ORIGINS
// Optional: LINKEDIN_REDIRECT_URI (default: <project>/functions/v1/linkedin-callback)
import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  b64, createComment, createPost, decryptToken, encryptToken, encryptionKey, linkedinFetch, postImages, postTooLong, postUrl,
  uploadImages,
} from '../_shared/linkedin.ts'

const STATE_MAX_AGE_MS = 10 * 60 * 1000
const FUNCTION_VERSION = 4
const PUBLISH_LIMIT_PER_HOUR = 10
// Follow-up comments (owner decision, 19 Nov 2026): at most 10 per post, so 30 an hour is plenty.
const COMMENT_LIMIT_PER_HOUR = 30
const SCOPES = 'openid profile w_member_social'

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
  | 'bad_request' | 'unauthorized' | 'not_found' | 'not_configured' | 'state_invalid' | 'linkedin_failed'
  | 'not_connected' | 'linkedin_expired' | 'not_approved' | 'already_published' | 'rate_limited'
  | 'too_long' | 'image_failed' | 'server_error' | 'post_not_published' | 'comment_not_allowed' | 'comment_unconfirmed'

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' },
  })
}
const fail = (status: number, code: ErrorCode, detail?: string) => reply(status, { error: code, ...(detail ? { detail } : {}) })

const ORIGINS = (Deno.env.get('APP_ORIGINS') ?? 'http://localhost:5173')
  .split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean)

function base64url(text: string) {
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function fromBase64url(text: string) {
  const s = text.replace(/-/g, '+').replace(/_/g, '/')
  return atob(s + '='.repeat((4 - (s.length % 4)) % 4))
}

Deno.serve(async (req) => withOrigin(await handle(req), req.headers.get('origin')))

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail(405, 'bad_request')
  const auth = req.headers.get('Authorization')
  if (!auth) return fail(401, 'unauthorized')

  let input: Record<string, unknown>
  try {
    input = await req.json()
  } catch {
    return fail(400, 'bad_request')
  }
  const action = typeof input.action === 'string' ? input.action : ''

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const db = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  })
  const { data: userData, error: userError } = await db.auth.getUser()
  if (userError || !userData.user) return fail(401, 'unauthorized')
  const userId = userData.user.id

  const clientId = Deno.env.get('LINKEDIN_CLIENT_ID')
  const clientSecret = Deno.env.get('LINKEDIN_CLIENT_SECRET')
  const redirectUri = Deno.env.get('LINKEDIN_REDIRECT_URI') ?? `${supabaseUrl}/functions/v1/linkedin-callback`
  const key = await encryptionKey()

  // ---------- info: lets the app check this function is up to date before posting ----------
  // An out-of-date copy would post without the image and could not post comments, so the app
  // refuses to post unless this answers with both features. Bump FUNCTION_VERSION on changes.
  if (action === 'info') return reply(200, { version: FUNCTION_VERSION, features: ['images', 'comments', 'multi-image'] })

  // ---------- start: build the LinkedIn approval link ----------
  if (action === 'start') {
    if (!clientId || !clientSecret || !key) return fail(503, 'not_configured')
    const origin = typeof input.origin === 'string' ? input.origin.replace(/\/+$/, '') : ''
    if (!ORIGINS.includes(origin)) return fail(400, 'bad_request', 'This address is not in APP_ORIGINS.')
    const nonce = b64.enc(crypto.getRandomValues(new Uint8Array(24))).replace(/[^A-Za-z0-9]/g, '').slice(0, 32)
    // Clear this person's old unfinished attempts, then record the new one.
    await db.from('linkedin_oauth_states').delete().eq('user_id', userId)
    const { error } = await db.from('linkedin_oauth_states').insert({ nonce, user_id: userId, origin })
    if (error) return fail(500, 'server_error')
    const state = base64url(JSON.stringify({ n: nonce, o: origin }))
    const url = new URL('https://www.linkedin.com/oauth/v2/authorization')
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('state', state)
    url.searchParams.set('scope', SCOPES)
    return reply(200, { url: url.toString() })
  }

  // ---------- exchange: finish connecting after LinkedIn sends the person back ----------
  if (action === 'exchange') {
    if (!clientId || !clientSecret || !key) return fail(503, 'not_configured')
    const code = typeof input.code === 'string' ? input.code.slice(0, 2000) : ''
    const state = typeof input.state === 'string' ? input.state.slice(0, 2000) : ''
    if (!code || !state) return fail(400, 'bad_request')
    let nonce = ''
    try {
      nonce = String(JSON.parse(fromBase64url(state)).n ?? '')
    } catch {
      return fail(400, 'state_invalid')
    }
    // RLS: only finds the value if THIS person created it.
    const { data: saved } = await db.from('linkedin_oauth_states').select('nonce, created_at').eq('nonce', nonce).maybeSingle()
    // One use only, whatever happens next.
    await db.from('linkedin_oauth_states').delete().eq('user_id', userId)
    if (!saved || Date.now() - new Date(saved.created_at).getTime() > STATE_MAX_AGE_MS) return fail(400, 'state_invalid')

    let tokenRes: Response
    try {
      tokenRes = await linkedinFetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret,
        }),
      })
    } catch {
      return fail(502, 'linkedin_failed', 'LinkedIn did not answer.')
    }
    if (!tokenRes.ok) {
      console.error('LinkedIn token exchange failed', tokenRes.status, (await tokenRes.text()).slice(0, 300))
      return fail(502, 'linkedin_failed', `LinkedIn refused the sign in (${tokenRes.status}).`)
    }
    const token = await tokenRes.json() as { access_token?: string; expires_in?: number; scope?: string }
    if (!token.access_token) return fail(502, 'linkedin_failed')

    const meRes = await linkedinFetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    }).catch(() => null)
    if (!meRes || !meRes.ok) return fail(502, 'linkedin_failed', 'Could not read your LinkedIn profile.')
    const me = await meRes.json() as { sub?: string; name?: string; picture?: string }
    if (!me.sub) return fail(502, 'linkedin_failed')

    const expiresAt = new Date(Date.now() + Math.max(60, Number(token.expires_in) || 0) * 1000).toISOString()
    const row = {
      user_id: userId,
      member_id: String(me.sub).slice(0, 100),
      name: me.name ? String(me.name).slice(0, 200) : null,
      picture: me.picture ? String(me.picture).slice(0, 2000) : null,
      access_token_enc: await encryptToken(key, token.access_token),
      scope: token.scope ? String(token.scope).slice(0, 500) : SCOPES,
      expires_at: expiresAt,
      connected_at: new Date().toISOString(),
    }
    const { error } = await db.from('linkedin_connections').upsert(row, { onConflict: 'user_id' })
    if (error) return fail(500, 'server_error')
    return reply(200, { name: row.name, picture: row.picture, expires_at: expiresAt })
  }

  // ---------- disconnect ----------
  if (action === 'disconnect') {
    const { error } = await db.from('linkedin_connections').delete().eq('user_id', userId)
    if (error) return fail(500, 'server_error')
    return reply(200, { ok: true })
  }

  // ---------- publish: post an approved LinkedIn draft now ----------
  if (action === 'publish') {
    if (!key) return fail(503, 'not_configured')
    const postId = typeof input.postId === 'string' ? input.postId : ''
    if (!/^[0-9a-f-]{36}$/i.test(postId)) return fail(400, 'bad_request')

    const { data: post } = await db.from('posts')
      .select('id, platform, status, body, external_id, external_url, image_path, image_alt, images').eq('id', postId).maybeSingle()
    if (!post || post.platform !== 'linkedin') return fail(404, 'not_found')
    if (post.status === 'published') return fail(409, 'already_published', post.external_url ?? undefined)
    if (post.status !== 'approved') return fail(409, 'not_approved')
    const text = String(post.body ?? '').trim()
    if (!text) return fail(400, 'bad_request')
    if (postTooLong(text)) return fail(400, 'too_long')

    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count } = await db.from('posts').select('id', { count: 'exact', head: true })
      .eq('platform', 'linkedin').gte('published_at', since)
    if ((count ?? 0) >= PUBLISH_LIMIT_PER_HOUR) return fail(429, 'rate_limited')

    const { data: conn } = await db.from('linkedin_connections')
      .select('member_id, access_token_enc, expires_at').eq('user_id', userId).maybeSingle()
    if (!conn) return fail(409, 'not_connected')
    if (new Date(conn.expires_at).getTime() <= Date.now()) return fail(401, 'linkedin_expired')
    const accessToken = await decryptToken(key, conn.access_token_enc)
    if (!accessToken) return fail(401, 'linkedin_expired')

    // Claim the post so a double click or a second tab cannot publish it twice.
    // Only one request can move it from approved; the database rules allow approved -> scheduled.
    const { data: claimed } = await db.from('posts')
      .update({ status: 'scheduled' }).eq('id', postId).eq('status', 'approved').select('id')
    if (!claimed || claimed.length === 0) return fail(409, 'not_approved')
    const release = () => db.from('posts').update({ status: 'approved' }).eq('id', postId).eq('status', 'scheduled')

    // Images first, in order: if any one cannot be sent, nothing is posted and the post goes back
    // to approved. Several images go out as one multi-image post.
    const images = postImages(post)
    let media: Record<string, unknown>[] | null = null
    if (images.length) {
      const uploaded = await uploadImages(db, accessToken, conn.member_id, images)
      if ('error' in uploaded) {
        await release()
        return fail(uploaded.status, uploaded.error, uploaded.detail)
      }
      media = uploaded.media
    }

    const result = await createPost(accessToken, conn.member_id, text, media)
    if (result.kind === 'no_answer') {
      await release()
      return fail(502, 'linkedin_failed', 'LinkedIn did not answer. Please check your LinkedIn profile before trying again.')
    }
    if (result.kind === 'expired') {
      await release()
      return fail(401, 'linkedin_expired')
    }
    if (result.kind !== 'ok') {
      await release()
      return fail(502, 'linkedin_failed', `LinkedIn did not accept the post (${result.kind === 'refused' ? result.status : 403}).`)
    }
    const urn = result.urn
    const externalUrl = postUrl(urn)

    const { error } = await db.from('posts')
      .update({ status: 'published', external_id: urn || null, external_url: externalUrl }).eq('id', postId)
    if (error) {
      // The post IS live on LinkedIn; say so rather than inviting a duplicate.
      console.error('Marking post published failed', error.message)
      return reply(200, { published: true, url: externalUrl, image: Boolean(media), images: media?.length ?? 0, warning: 'saved_status_failed' })
    }
    return reply(200, { published: true, url: externalUrl, image: Boolean(media), images: media?.length ?? 0 })
  }

  // ---------- comment: post ONE approved follow-up comment under the person's published post ----------
  // The app calls this once per comment, with the owner's random 15 to 60 second gaps between calls.
  // Duplicate protection: the comment is claimed (approved -> publishing) before LinkedIn is called,
  // so a second tab or a double click cannot post it twice. If LinkedIn does not answer, the comment
  // is marked failed with a warning to check LinkedIn first, and it is never retried automatically.
  if (action === 'comment') {
    if (!key) return fail(503, 'not_configured')
    const commentId = typeof input.commentId === 'string' ? input.commentId : ''
    if (!/^[0-9a-f-]{36}$/i.test(commentId)) return fail(400, 'bad_request')

    const { data: comment } = await db.from('post_comments')
      .select('id, post_id, body, status, included').eq('id', commentId).maybeSingle()
    if (!comment) return fail(404, 'not_found')
    if (comment.status === 'published') return fail(409, 'already_published')
    if (comment.status !== 'approved' || !comment.included) return fail(409, 'not_approved')
    const text = String(comment.body ?? '').trim()
    if (!text || text.length > 1250) return fail(400, 'bad_request')

    const { data: post } = await db.from('posts')
      .select('id, platform, status, external_id').eq('id', comment.post_id).maybeSingle()
    if (!post || post.platform !== 'linkedin') return fail(404, 'not_found')
    if (post.status !== 'published' || !post.external_id) return fail(409, 'post_not_published')

    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { count } = await db.from('post_comments').select('id', { count: 'exact', head: true }).gte('published_at', since)
    if ((count ?? 0) >= COMMENT_LIMIT_PER_HOUR) return fail(429, 'rate_limited')

    const { data: conn } = await db.from('linkedin_connections')
      .select('member_id, access_token_enc, expires_at').eq('user_id', userId).maybeSingle()
    if (!conn) return fail(409, 'not_connected')
    if (new Date(conn.expires_at).getTime() <= Date.now()) return fail(401, 'linkedin_expired')
    const accessToken = await decryptToken(key, conn.access_token_enc)
    if (!accessToken) return fail(401, 'linkedin_expired')

    const { data: claimed } = await db.from('post_comments')
      .update({ status: 'publishing' }).eq('id', commentId).eq('status', 'approved').select('id')
    if (!claimed || claimed.length === 0) return fail(409, 'not_approved')
    const markFailed = (reason: string) =>
      db.from('post_comments').update({ status: 'failed', failure_reason: reason.slice(0, 500) }).eq('id', commentId).eq('status', 'publishing')

    const result = await createComment(accessToken, conn.member_id, String(post.external_id), text)
    if (result.kind === 'no_answer') {
      const reason = 'LinkedIn did not answer, so Hiba could not confirm whether this comment was posted. Check your post on LinkedIn before trying again.'
      await markFailed(reason)
      return fail(502, 'comment_unconfirmed', reason)
    }
    if (result.kind === 'expired') {
      await db.from('post_comments').update({ status: 'approved' }).eq('id', commentId).eq('status', 'publishing')
      return fail(401, 'linkedin_expired')
    }
    if (result.kind === 'forbidden') {
      const reason = 'LinkedIn did not allow Hiba to post comments with your LinkedIn app\'s current permissions (403). Copy this comment and post it yourself.'
      await markFailed(reason)
      return fail(403, 'comment_not_allowed', reason)
    }
    if (result.kind === 'refused') {
      const reason = `LinkedIn did not accept this comment (${result.status}). Nothing was posted.`
      await markFailed(reason)
      return fail(502, 'linkedin_failed', reason)
    }
    const commentUrn = result.urn
    const { error } = await db.from('post_comments')
      .update({ status: 'published', external_id: commentUrn ? commentUrn.slice(0, 300) : null }).eq('id', commentId)
    if (error) {
      // The comment IS on LinkedIn; say so rather than inviting a duplicate.
      console.error('Marking comment published failed', error.message)
      return reply(200, { published: true, warning: 'saved_status_failed' })
    }
    return reply(200, { published: true })
  }

  return fail(400, 'bad_request')
}
