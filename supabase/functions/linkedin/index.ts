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

// ============================================================================================
// LinkedIn helpers, written into this file so the Supabase dashboard can deploy it on its own
// (it cannot load files from ../_shared). The same block is in linkedin/index.ts and
// publisher/index.ts: change both together, so posting by hand and on a schedule stay identical.
// ============================================================================================

// LinkedIn helpers shared by the "linkedin" function (post now, as the person) and the
// "publisher" function (scheduled posts and comments, in the background).
// Same steps in both, so a scheduled post goes out exactly like one posted by hand.

const LINKEDIN_TIMEOUT_MS = 20_000
const IMAGE_BUCKET = 'post-images'
const IMAGE_MAX_BYTES = 5 * 1024 * 1024
const IMAGE_MAX_COUNT = 9
/** Owner rule (24 Nov 2026, HPD-164): LinkedIn posts are at most 300 words (LinkedIn itself allows 3000 characters). */
const postTooLong = (text: string) => text.length > 3000 || text.trim().split(/\s+/).length > 300

// ---------- encryption (AES-GCM, key = 32 random bytes, base64) ----------
const b64 = {
  enc: (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)),
  dec: (text: string): Uint8Array<ArrayBuffer> => {
    const raw = atob(text)
    const out = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
    return out
  },
}

async function encryptionKey(): Promise<CryptoKey | null> {
  const raw = Deno.env.get('TOKEN_ENCRYPTION_KEY')
  if (!raw) return null
  let bytes: Uint8Array<ArrayBuffer>
  try {
    bytes = b64.dec(raw.trim())
  } catch {
    return null
  }
  if (bytes.length !== 32) return null
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function encryptToken(key: CryptoKey, token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token)))
  return `v1:${b64.enc(iv)}:${b64.enc(data)}`
}

async function decryptToken(key: CryptoKey, stored: string): Promise<string | null> {
  const [version, iv, data] = stored.split(':')
  if (version !== 'v1' || !iv || !data) return null
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.dec(iv) }, key, b64.dec(data))
    return new TextDecoder().decode(plain)
  } catch {
    return null
  }
}

async function linkedinFetch(url: string, init: RequestInit) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), LINKEDIN_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

const restli = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
  'Content-Type': 'application/json',
  'X-Restli-Protocol-Version': '2.0.0',
})

// ---------- images ----------
interface PostImage { path: string; alt: string | null }

/** The post's images in order: the list, or (rows from before migration 0016) the single image. */
function postImages(post: { images?: unknown; image_path?: string | null; image_alt?: string | null }): PostImage[] {
  const list = Array.isArray(post.images)
    ? post.images
      .filter((x): x is { path: string; alt?: unknown } => Boolean(x) && typeof (x as { path?: unknown }).path === 'string')
      .map((x) => ({ path: x.path, alt: typeof x.alt === 'string' && x.alt.trim() ? x.alt.trim() : null }))
    : []
  if (list.length) return list.slice(0, IMAGE_MAX_COUNT)
  return post.image_path ? [{ path: post.image_path, alt: post.image_alt ? String(post.image_alt) : null }] : []
}

/** The only part of the database client the image upload needs. */
interface StorageReader {
  storage: { from: (bucket: string) => { download: (path: string) => Promise<{ data: Blob | null; error: unknown }> } }
}

type ImageFailure = { error: 'image_failed' | 'linkedin_expired'; status: number; detail?: string }

/**
 * Sends one image to LinkedIn (register upload, then upload the bytes) and returns its asset id.
 * The image is read with the given client: as the person (RLS) or as the publisher.
 */
async function uploadImage(db: StorageReader, accessToken: string, memberId: string, path: string): Promise<{ asset: string } | ImageFailure> {
  const { data: file, error } = await db.storage.from(IMAGE_BUCKET).download(path)
  if (error || !file) return { error: 'image_failed', status: 502, detail: 'Hiba could not read your image. Remove it and add it again.' }
  if (file.size > IMAGE_MAX_BYTES) return { error: 'image_failed', status: 400, detail: 'The image is larger than 5 MB.' }

  const register = await linkedinFetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
    method: 'POST',
    headers: restli(accessToken),
    body: JSON.stringify({
      registerUploadRequest: {
        recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
        owner: `urn:li:person:${memberId}`,
        serviceRelationships: [{ relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }],
      },
    }),
  }).catch(() => null)
  if (!register) return { error: 'image_failed', status: 502, detail: 'LinkedIn did not answer while preparing the image.' }
  if (register.status === 401) return { error: 'linkedin_expired', status: 401 }
  if (!register.ok) {
    console.error('LinkedIn registerUpload failed', register.status, (await register.text()).slice(0, 300))
    return { error: 'image_failed', status: 502, detail: 'LinkedIn would not accept the image. Try a different image.' }
  }
  const reg = await register.json() as {
    value?: { asset?: string; uploadMechanism?: Record<string, { uploadUrl?: string }> }
  }
  const asset = reg.value?.asset
  const uploadUrl = reg.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl
  if (!asset || !uploadUrl) return { error: 'image_failed', status: 502, detail: 'LinkedIn did not return an upload address.' }

  const upload = await linkedinFetch(uploadUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': file.type || 'application/octet-stream' },
    body: new Uint8Array(await file.arrayBuffer()),
  }).catch(() => null)
  if (!upload || !upload.ok) {
    console.error('LinkedIn image upload failed', upload?.status)
    return { error: 'image_failed', status: 502, detail: 'Uploading the image to LinkedIn did not work.' }
  }
  return { asset }
}

/** Uploads every image in order. Stops at the first failure and names the image. */
async function uploadImages(
  db: StorageReader, accessToken: string, memberId: string, images: PostImage[],
): Promise<{ media: Record<string, unknown>[] } | ImageFailure> {
  const media: Record<string, unknown>[] = []
  for (const [i, img] of images.entries()) {
    const image = await uploadImage(db, accessToken, memberId, img.path)
    if ('error' in image) {
      const which = images.length > 1 ? `Image ${i + 1}: ` : ''
      return { ...image, detail: image.detail ? `${which}${image.detail}` : undefined }
    }
    media.push({ status: 'READY', media: image.asset, ...(img.alt ? { description: { text: img.alt.slice(0, 300) } } : {}) })
  }
  return { media }
}

// ---------- posts and comments ----------
/**
 * ok: posted. expired: LinkedIn refused the token (nothing posted). refused: LinkedIn answered with
 * an error (nothing posted). no_answer: no reply, so Hiba cannot tell whether it was posted.
 */
type LinkedInResult =
  | { kind: 'ok'; urn: string }
  | { kind: 'expired' }
  | { kind: 'forbidden'; detail: string }
  | { kind: 'refused'; status: number; detail: string }
  | { kind: 'no_answer' }

const postUrl = (urn: string) => (urn ? `https://www.linkedin.com/feed/update/${urn}/` : null)

async function createPost(accessToken: string, memberId: string, text: string, media: Record<string, unknown>[] | null): Promise<LinkedInResult> {
  let res: Response
  try {
    res = await linkedinFetch('https://api.linkedin.com/v2/ugcPosts', {
      method: 'POST',
      headers: restli(accessToken),
      body: JSON.stringify({
        author: `urn:li:person:${memberId}`,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': media?.length
            ? { shareCommentary: { text }, shareMediaCategory: 'IMAGE', media }
            : { shareCommentary: { text }, shareMediaCategory: 'NONE' },
        },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
      }),
    })
  } catch {
    return { kind: 'no_answer' }
  }
  return toResult(res, 'LinkedIn publish failed')
}

async function createComment(accessToken: string, memberId: string, postUrn: string, text: string): Promise<LinkedInResult> {
  let res: Response
  try {
    res = await linkedinFetch(`https://api.linkedin.com/v2/socialActions/${encodeURIComponent(postUrn)}/comments`, {
      method: 'POST',
      headers: restli(accessToken),
      body: JSON.stringify({ actor: `urn:li:person:${memberId}`, object: postUrn, message: { text } }),
    })
  } catch {
    return { kind: 'no_answer' }
  }
  return toResult(res, 'LinkedIn comment failed')
}

async function toResult(res: Response, label: string): Promise<LinkedInResult> {
  if (res.status === 401) return { kind: 'expired' }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300)
    console.error(label, res.status, detail)
    return res.status === 403 ? { kind: 'forbidden', detail } : { kind: 'refused', status: res.status, detail }
  }
  let urn = res.headers.get('x-restli-id') ?? ''
  if (!urn) {
    const body = (await res.json().catch(() => ({}))) as { id?: string; $URN?: string }
    urn = body.id ?? body.$URN ?? ''
  }
  return { kind: 'ok', urn }
}

// Videos and documents on LinkedIn posts (migration 0020). Shared by the "linkedin" function
// (post now) and the "publisher" (scheduled posts), so both send attachments the same way.
//
// LinkedIn's older ugcPosts API (used for text and images) cannot carry documents, so posts with a
// video or document use the newer APIs, which work with the same w_member_social permission:
//   video:    rest/videos?action=initializeUpload -> upload each part -> finalizeUpload
//   document: rest/documents?action=initializeUpload -> upload the file
//   then:     rest/posts with content.media = the video or document
// A PDF document shows on LinkedIn as a swipeable carousel.

const MEDIA_BUCKET = 'post-media'
const MEDIA_MAX_BYTES = 50 * 1024 * 1024
/** LinkedIn API version for the newer endpoints (yyyymm). Override with the LINKEDIN_API_VERSION secret. */
const API_VERSION = Deno.env.get('LINKEDIN_API_VERSION') ?? '202608'
/** Big files take longer to send than a normal LinkedIn call. */
const UPLOAD_TIMEOUT_MS = 120_000

interface PostAttachment {
  kind: 'video' | 'document'
  path: string
  name: string | null
  title: string | null
}

/** The post's video or document, if it has one. */
function postAttachment(post: { attachment?: unknown }): PostAttachment | null {
  const a = post.attachment as Record<string, unknown> | null | undefined
  if (!a || typeof a !== 'object') return null
  if ((a.kind !== 'video' && a.kind !== 'document') || typeof a.path !== 'string' || !a.path) return null
  const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
  return { kind: a.kind, path: a.path, name: text(a.name, 255), title: text(a.title, 200) }
}

type MediaFailure = { error: 'media_failed' | 'linkedin_expired'; status: number; detail: string }

/** The only part of the database client the upload needs. */
interface MediaReader {
  storage: { from: (bucket: string) => { download: (path: string) => Promise<{ data: Blob | null; error: unknown }> } }
}

const rest = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
  'Content-Type': 'application/json',
  'X-Restli-Protocol-Version': '2.0.0',
  'LinkedIn-Version': API_VERSION,
})

async function withTimeout(url: string, init: RequestInit, ms: number) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

const failed = (detail: string, status = 502): MediaFailure => ({ error: 'media_failed', status, detail })

/** Sends the video or document to LinkedIn and returns its id (urn), ready to attach to a post. */
async function uploadAttachment(db: MediaReader, accessToken: string, memberId: string, a: PostAttachment): Promise<{ urn: string } | MediaFailure> {
  const { data: file, error } = await db.storage.from(MEDIA_BUCKET).download(a.path)
  if (error || !file) return failed('Hiba could not read your file. Remove it and add it again.')
  if (file.size > MEDIA_MAX_BYTES) return failed('The file is larger than 50 MB.', 400)
  const owner = `urn:li:person:${memberId}`

  try {
    if (a.kind === 'document') {
      const init = await linkedinFetch('https://api.linkedin.com/rest/documents?action=initializeUpload', {
        method: 'POST', headers: rest(accessToken), body: JSON.stringify({ initializeUploadRequest: { owner } }),
      })
      if (init.status === 401) return { error: 'linkedin_expired', status: 401, detail: '' }
      if (!init.ok) {
        console.error('LinkedIn document initializeUpload failed', init.status, (await init.text()).slice(0, 300))
        return failed('LinkedIn would not accept the document.')
      }
      const value = ((await init.json()) as { value?: { uploadUrl?: string; document?: string } }).value
      if (!value?.uploadUrl || !value.document) return failed('LinkedIn did not return an upload address.')
      const put = await withTimeout(value.uploadUrl, {
        method: 'PUT', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/octet-stream' }, body: file,
      }, UPLOAD_TIMEOUT_MS)
      if (!put.ok) {
        console.error('LinkedIn document upload failed', put.status)
        return failed('Uploading the document to LinkedIn did not work.')
      }
      return { urn: value.document }
    }

    // Video: LinkedIn says which byte ranges to send to which address, then the upload is finalised.
    const init = await linkedinFetch('https://api.linkedin.com/rest/videos?action=initializeUpload', {
      method: 'POST', headers: rest(accessToken),
      body: JSON.stringify({ initializeUploadRequest: { owner, fileSizeBytes: file.size, uploadCaptions: false, uploadThumbnail: false } }),
    })
    if (init.status === 401) return { error: 'linkedin_expired', status: 401, detail: '' }
    if (!init.ok) {
      console.error('LinkedIn video initializeUpload failed', init.status, (await init.text()).slice(0, 300))
      return failed('LinkedIn would not accept the video.')
    }
    const value = ((await init.json()) as {
      value?: { video?: string; uploadToken?: string; uploadInstructions?: { uploadUrl: string; firstByte: number; lastByte: number }[] }
    }).value
    if (!value?.video || !value.uploadInstructions?.length) return failed('LinkedIn did not return an upload address.')
    const etags: string[] = []
    for (const part of value.uploadInstructions) {
      const put = await withTimeout(part.uploadUrl, {
        method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: file.slice(part.firstByte, part.lastByte + 1),
      }, UPLOAD_TIMEOUT_MS)
      const etag = put.headers.get('etag')
      if (!put.ok || !etag) {
        console.error('LinkedIn video part upload failed', put.status)
        return failed('Uploading the video to LinkedIn did not work.')
      }
      etags.push(etag)
    }
    const fin = await linkedinFetch('https://api.linkedin.com/rest/videos?action=finalizeUpload', {
      method: 'POST', headers: rest(accessToken),
      body: JSON.stringify({ finalizeUploadRequest: { video: value.video, uploadToken: value.uploadToken ?? '', uploadedPartIds: etags } }),
    })
    if (!fin.ok) {
      console.error('LinkedIn video finalizeUpload failed', fin.status, (await fin.text()).slice(0, 300))
      return failed('LinkedIn could not finish receiving the video.')
    }
    return { urn: value.video }
  } catch (e) {
    console.error('LinkedIn media upload error', e instanceof Error ? e.name : e)
    return failed('LinkedIn did not answer while receiving the file.')
  }
}

/**
 * The newer Posts API reads some characters as formatting, so they are escaped, and #hashtags are
 * written in its hashtag form so they stay clickable.
 */
function littleText(text: string): string {
  const escaped = text.replace(/[\\|{}@[\]()<>#*_~]/g, (ch) => `\\${ch}`)
  return escaped.replace(/\\#((?:[\p{L}\p{N}]|\\_)+)/gu, (_m, tag: string) => `{hashtag|\\#|${tag}}`)
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Publishes the post with its video or document. LinkedIn may need a little while to process a new
 * file; while it says no (an error, so nothing was posted), Hiba waits and asks again, for up to
 * about 50 seconds. If it is still processing after that, the answer is marked as temporary
 * (status 503) so a scheduled post is tried again later.
 */
async function createMediaPost(accessToken: string, memberId: string, text: string, a: PostAttachment, urn: string): Promise<LinkedInResult> {
  const body = JSON.stringify({
    author: `urn:li:person:${memberId}`,
    commentary: littleText(text),
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    content: { media: { id: urn, ...(a.kind === 'document' ? { title: a.title || a.name || 'Document' } : a.title ? { title: a.title } : {}) } },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  })
  let lastDetail = ''
  for (const delay of [4000, 6000, 8000, 10000, 10000, 12000]) {
    await wait(delay)
    let res: Response
    try {
      res = await linkedinFetch('https://api.linkedin.com/rest/posts', { method: 'POST', headers: rest(accessToken), body })
    } catch {
      return { kind: 'no_answer' }
    }
    if (res.status === 401) return { kind: 'expired' }
    if (res.ok) {
      const id = res.headers.get('x-restli-id') ?? res.headers.get('x-linkedin-id') ?? ''
      return { kind: 'ok', urn: id }
    }
    lastDetail = (await res.text()).slice(0, 300)
    console.error('LinkedIn media post refused', res.status, lastDetail)
    if (res.status === 403) return { kind: 'forbidden', detail: lastDetail }
    if (res.status >= 500 || res.status === 429) return { kind: 'refused', status: res.status, detail: lastDetail }
    // 4xx: usually "the file is still being processed". Nothing was posted, so asking again is safe.
    if (!/process|ready|available|status|asset|media/i.test(lastDetail)) return { kind: 'refused', status: res.status, detail: lastDetail }
  }
  return { kind: 'refused', status: 503, detail: `Still processing: ${lastDetail}` }
}

// ============================== end of LinkedIn helpers ==============================

const STATE_MAX_AGE_MS = 10 * 60 * 1000
const FUNCTION_VERSION = 5
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
  | 'too_long' | 'image_failed' | 'media_failed' | 'server_error' | 'post_not_published' | 'comment_not_allowed' | 'comment_unconfirmed'

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
  if (action === 'info') return reply(200, { version: FUNCTION_VERSION, features: ['images', 'comments', 'multi-image', 'media'] })

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
      return fail(502, 'linkedin_failed')
    }
    if (!tokenRes.ok) {
      console.error('LinkedIn token exchange failed', tokenRes.status, (await tokenRes.text()).slice(0, 300))
      return fail(502, 'linkedin_failed')
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

    const cols = 'id, platform, status, body, external_id, external_url, image_path, image_alt'
    // deno-lint-ignore no-explicit-any
    let { data: post, error: postError }: { data: any; error: unknown } = await db.from('posts').select(`${cols}, images, attachment`).eq('id', postId).maybeSingle()
    // Before migration 0020 there is no attachment yet; before 0016 no image list either.
    if (postError) ({ data: post, error: postError } = await db.from('posts').select(`${cols}, images`).eq('id', postId).maybeSingle())
    if (postError) ({ data: post } = await db.from('posts').select(cols).eq('id', postId).maybeSingle())
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
    // A video or document goes out on its own (LinkedIn allows images, or one video, or one document).
    const attachment = postAttachment(post)
    const images = attachment ? [] : postImages(post)
    let media: Record<string, unknown>[] | null = null
    let result
    if (attachment) {
      const sent = await uploadAttachment(db, accessToken, conn.member_id, attachment)
      if ('error' in sent) {
        await release()
        if (sent.detail) console.error('Attachment not sent', sent.detail)
        return fail(sent.status, sent.error)
      }
      result = await createMediaPost(accessToken, conn.member_id, text, attachment, sent.urn)
    } else {
      if (images.length) {
        const uploaded = await uploadImages(db, accessToken, conn.member_id, images)
        if ('error' in uploaded) {
          await release()
          return fail(uploaded.status, uploaded.error)
        }
        media = uploaded.media
      }
      result = await createPost(accessToken, conn.member_id, text, media)
    }
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
      console.error('LinkedIn refused post', result.kind === 'refused' ? result.status : 403, result.detail)
      return fail(502, 'linkedin_failed')
    }
    const urn = result.urn
    const externalUrl = postUrl(urn)

    const { error } = await db.from('posts')
      .update({ status: 'published', external_id: urn || null, external_url: externalUrl }).eq('id', postId)
    if (error) {
      // The post IS live on LinkedIn; say so rather than inviting a duplicate.
      console.error('Marking post published failed', error.message)
      return reply(200, { published: true, url: externalUrl, image: Boolean(media), images: media?.length ?? 0, attachment: Boolean(attachment), warning: 'saved_status_failed' })
    }
    // Approved follow-up comments are posted by the background publisher from here on, so they
    // still go out if the person closes the page or the laptop.
    const { error: queueError } = await db.rpc('queue_post_comments', { p_post_id: postId })
    if (queueError) console.error('Queueing comments failed (is migration 0019 run?)', queueError.message)
    return reply(200, { published: true, url: externalUrl, image: Boolean(media), images: media?.length ?? 0, attachment: Boolean(attachment), commentsQueued: !queueError })
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
      console.error('LinkedIn refused comment (403)', result.detail)
      const reason = 'LinkedIn did not allow Hiba to post this comment. Copy it and post it yourself.'
      await markFailed(reason)
      return fail(403, 'comment_not_allowed', reason)
    }
    if (result.kind === 'refused') {
      console.error('LinkedIn refused comment', result.status, result.detail)
      const reason = 'LinkedIn did not accept this comment. Nothing was posted.'
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
