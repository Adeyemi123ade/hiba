// Supabase Edge Function: Hiba's background publisher (H09-S06, H10). Called every 15 seconds by the
// database (pg_cron, see supabase/sql/publisher_cron.sql). Never called from the browser.
//
// 1. Posts that are due: claimed in the database first (so two runs never post the same one),
//    published to LinkedIn exactly like "Post now", then their approved follow-up comments are
//    queued 15 to 60 seconds apart (database function queue_post_comments, migration 0019).
// 2. Comments that are due: the next one of each post, posted as the post's owner.
// Different people's posts are sent at the same time (up to POST_PARALLEL at once), so many posts
// due at the same minute all go out within a few minutes. One post's comments always stay in order.
//
// Safety
// - Verify JWT is OFF (the caller is the database, not a person). Every request must carry the
//   shared secret PUBLISHER_SECRET in the x-publisher-secret header, or nothing happens.
// - Uses the service role, because the owner is not online. It only touches rows that are due.
// - If LinkedIn answers with an error, nothing was posted: the post is tried again later (up to
//   MAX_ATTEMPTS), then marked failed with the reason. If LinkedIn does not answer at all, Hiba
//   cannot tell whether it was posted, so it is marked failed and never retried by itself.
//
// Secrets: PUBLISHER_SECRET, TOKEN_ENCRYPTION_KEY (same as the linkedin function).
// Provided by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
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

const MAX_ATTEMPTS = 3
/** Waits before trying a post again: 5 minutes, then 15. */
const RETRY_DELAYS_MIN = [5, 15]
/** A claim older than this means a run stopped half way: Hiba cannot tell what happened. */
const STALE_CLAIM_MIN = 10
// Up to 40 posts and 100 comments per run, sent 8 and 15 at a time. Runs every 15 seconds and may
// overlap safely (claims use row locks), so about 1,000 posts due together go out in a few minutes.
const POSTS_PER_RUN = 40
const POST_PARALLEL = 8
const COMMENTS_PER_RUN = 100
const COMMENT_PARALLEL = 15
/** Stop starting new posts after this long, so a run always finishes well inside Supabase's limit. */
const RUN_BUDGET_MS = 90_000

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/** Compares secrets without leaking how much of them matched. */
function sameSecret(a: string, b: string) {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

/** Runs `work` on every item, at most `size` at a time. */
async function inParallel<T>(items: T[], size: number, work: (item: T) => Promise<void>) {
  let next = 0
  const lanes = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await work(items[next++])
  })
  await Promise.all(lanes)
}

// deno-lint-ignore no-explicit-any
type Db = any

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method' })
  const secret = Deno.env.get('PUBLISHER_SECRET') ?? ''
  if (secret.length < 24 || !sameSecret(req.headers.get('x-publisher-secret') ?? '', secret)) return json(401, { error: 'unauthorized' })
  const key = await encryptionKey()
  if (!key) return json(503, { error: 'not_configured' })

  const db: Db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  await failStaleClaims(db)
  const startedAt = Date.now()

  const summary = { posts: 0, comments: 0 }
  const { data: posts, error: postsError } = await db.rpc('claim_due_posts', { max_posts: POSTS_PER_RUN })
  if (postsError) console.error('Claiming posts failed', postsError.message)
  // deno-lint-ignore no-explicit-any
  await inParallel((posts ?? []) as any[], POST_PARALLEL, async (post) => {
    // Out of time for this run (big videos take a while): hand the post back for the next run.
    if (Date.now() - startedAt > RUN_BUDGET_MS) {
      await db.from('posts').update({ publish_lock: null, publish_attempts: Math.max(0, post.publish_attempts - 1) })
        .eq('id', post.id).eq('status', 'scheduled')
      return
    }
    try {
      await publishPost(db, key, post)
      summary.posts++
    } catch (e) {
      // Unexpected error after the claim: leave it claimed; the stale check reports it safely.
      console.error('Publishing post crashed', post.id, e instanceof Error ? e.message : e)
    }
  })

  const { data: comments, error: commentsError } = await db.rpc('claim_due_comments', { max_comments: COMMENTS_PER_RUN })
  if (commentsError) console.error('Claiming comments failed', commentsError.message)
  // Each claimed comment belongs to a different post (the claim never takes two of one post).
  // deno-lint-ignore no-explicit-any
  await inParallel((comments ?? []) as any[], COMMENT_PARALLEL, async (comment) => {
    try {
      await publishComment(db, key, comment)
      summary.comments++
    } catch (e) {
      console.error('Publishing comment crashed', comment.id, e instanceof Error ? e.message : e)
    }
  })
  return json(200, summary)
})

/** Posts or comments claimed long ago and never finished: say so, never post them again by surprise. */
async function failStaleClaims(db: Db) {
  const before = new Date(Date.now() - STALE_CLAIM_MIN * 60_000).toISOString()
  const reason = 'Hiba stopped while posting this and cannot tell whether it reached LinkedIn. Check your LinkedIn profile before trying again.'
  const { data: stuck } = await db.from('posts').update({ status: 'failed', failure_reason: reason })
    .eq('status', 'scheduled').not('publish_lock', 'is', null).lt('publish_lock', before).select('id, user_id')
  for (const p of stuck ?? []) await logAttempt(db, p.user_id, p.id, null, 'unconfirmed', reason)
  await db.from('post_comments').update({ status: 'failed', failure_reason: reason })
    .eq('status', 'publishing').not('due_at', 'is', null).lt('updated_at', before)
}

async function logAttempt(db: Db, userId: string, postId: string, commentId: string | null, outcome: string, detail?: string) {
  const { error } = await db.from('publish_attempts').insert({
    user_id: userId, post_id: postId, comment_id: commentId, outcome, finished_at: new Date().toISOString(),
    detail: detail ? detail.slice(0, 500) : null,
  })
  if (error) console.error('Logging attempt failed', error.message)
}

/** The owner's LinkedIn access, or a plain reason why there is none. */
async function accessFor(db: Db, key: CryptoKey, userId: string): Promise<{ token: string; memberId: string } | { reason: string }> {
  const { data: conn } = await db.from('linkedin_connections')
    .select('member_id, access_token_enc, expires_at').eq('user_id', userId).maybeSingle()
  if (!conn) return { reason: 'LinkedIn is not connected. Connect it in Settings, then schedule the post again.' }
  if (new Date(conn.expires_at).getTime() <= Date.now()) return { reason: 'Your LinkedIn connection expired. Reconnect it in Settings, then schedule the post again.' }
  const token = await decryptToken(key, conn.access_token_enc)
  if (!token) return { reason: 'Your LinkedIn connection needs renewing. Reconnect it in Settings, then schedule the post again.' }
  return { token, memberId: conn.member_id }
}

// deno-lint-ignore no-explicit-any
async function publishPost(db: Db, key: CryptoKey, post: any) {
  const finish = async (status: 'failed' | 'retry', reason: string) => {
    if (status === 'retry' && post.publish_attempts < MAX_ATTEMPTS) {
      const wait = RETRY_DELAYS_MIN[Math.min(post.publish_attempts - 1, RETRY_DELAYS_MIN.length - 1)]
      await db.from('posts').update({
        publish_lock: null, scheduled_for: new Date(Date.now() + wait * 60_000).toISOString(),
      }).eq('id', post.id).eq('status', 'scheduled')
      await logAttempt(db, post.user_id, post.id, null, 'retry', `${reason} Trying again in ${wait} minutes.`)
      return
    }
    const final = status === 'retry' ? `${reason} Hiba tried ${post.publish_attempts} times.` : reason
    await db.from('posts').update({ status: 'failed', failure_reason: final.slice(0, 500) }).eq('id', post.id).eq('status', 'scheduled')
    await logAttempt(db, post.user_id, post.id, null, 'failed', final)
  }

  const text = String(post.body ?? '').trim()
  if (!text) return finish('failed', 'The post is empty, so nothing was posted.')
  if (postTooLong(text)) return finish('failed', 'The post is longer than 300 words, so nothing was posted. Shorten it and schedule it again.')

  const access = await accessFor(db, key, post.user_id)
  if ('reason' in access) return finish('failed', access.reason)

  // A video or document goes out on its own (LinkedIn allows images, or one video, or one document).
  const attachment = postAttachment(post)
  const images = attachment ? [] : postImages(post)
  let media: Record<string, unknown>[] | null = null
  let mediaUrn = ''
  if (attachment) {
    const sent = await uploadAttachment(db, access.token, access.memberId, attachment)
    if ('error' in sent) {
      if (sent.error === 'linkedin_expired') return finish('failed', 'LinkedIn refused your connection. Reconnect it in Settings, then schedule the post again.')
      return finish(sent.status === 400 ? 'failed' : 'retry', `${sent.detail} Nothing was posted.`)
    }
    mediaUrn = sent.urn
  } else if (images.length) {
    const uploaded = await uploadImages(db, access.token, access.memberId, images)
    if ('error' in uploaded) {
      if (uploaded.error === 'linkedin_expired') return finish('failed', 'LinkedIn refused your connection. Reconnect it in Settings, then schedule the post again.')
      // Nothing was posted yet, so trying again later is safe.
      return finish('retry', `${uploaded.detail ?? 'An image could not be sent to LinkedIn.'} Nothing was posted.`)
    }
    media = uploaded.media
  }

  const result = attachment
    ? await createMediaPost(access.token, access.memberId, text, attachment, mediaUrn)
    : await createPost(access.token, access.memberId, text, media)
  if (result.kind === 'no_answer') {
    const reason = 'LinkedIn did not answer, so Hiba cannot tell whether your post went out. Check your LinkedIn profile before trying again.'
    await db.from('posts').update({ status: 'failed', failure_reason: reason }).eq('id', post.id).eq('status', 'scheduled')
    await logAttempt(db, post.user_id, post.id, null, 'unconfirmed', reason)
    return
  }
  if (result.kind === 'expired') return finish('failed', 'LinkedIn refused your connection. Reconnect it in Settings, then schedule the post again.')
  if (result.kind === 'forbidden') {
    console.error('LinkedIn refused post (403)', post.id, result.detail)
    return finish('failed', 'LinkedIn did not allow this post. Nothing was posted. Try reconnecting LinkedIn in Settings, then schedule it again.')
  }
  if (result.kind === 'refused') {
    console.error('LinkedIn refused post', post.id, result.status, result.detail)
    const transient = result.status === 429 || result.status >= 500
    return finish(transient ? 'retry' : 'failed', transient
      ? 'LinkedIn was busy, so nothing was posted.'
      : 'LinkedIn did not accept this post. Nothing was posted. Check the text and images, then schedule it again.')
  }

  const { error } = await db.from('posts')
    .update({ status: 'published', external_id: result.urn || null, external_url: postUrl(result.urn) }).eq('id', post.id)
  if (error) console.error('Marking post published failed', post.id, error.message)
  await logAttempt(db, post.user_id, post.id, null, 'published', images.length ? `With ${images.length} image(s).` : undefined)

  // Approved follow-up comments: due one after another, 15 to 60 seconds apart.
  const { error: queueError } = await db.rpc('queue_post_comments', { p_post_id: post.id })
  if (queueError) console.error('Queueing comments failed', post.id, queueError.message)
}

// deno-lint-ignore no-explicit-any
async function publishComment(db: Db, key: CryptoKey, comment: any) {
  const fail = async (reason: string, outcome: 'failed' | 'unconfirmed' = 'failed') => {
    await db.from('post_comments').update({ status: 'failed', failure_reason: reason.slice(0, 500) }).eq('id', comment.id).eq('status', 'publishing')
    await logAttempt(db, comment.user_id, comment.post_id, comment.id, outcome, reason)
  }
  const { data: post } = await db.from('posts').select('id, status, external_id').eq('id', comment.post_id).maybeSingle()
  if (!post || post.status !== 'published' || !post.external_id) return fail('The post is not live on LinkedIn, so the comment was not posted.')
  const text = String(comment.body ?? '').trim()
  if (!text) return fail('The comment is empty.')

  const access = await accessFor(db, key, comment.user_id)
  if ('reason' in access) return fail(access.reason.replace('schedule the post again', 'approve the comment again'))

  const result = await createComment(access.token, access.memberId, String(post.external_id), text)
  if (result.kind === 'no_answer') return fail('LinkedIn did not answer, so Hiba cannot tell whether this comment was posted. Check your post on LinkedIn before trying again.', 'unconfirmed')
  if (result.kind === 'expired') return fail('LinkedIn refused your connection. Reconnect it in Settings, then approve the comment again.')
  if (result.kind === 'forbidden') {
    console.error('LinkedIn refused comment (403)', comment.id, result.detail)
    return fail('LinkedIn did not allow Hiba to post this comment. Copy it and post it yourself.')
  }
  if (result.kind === 'refused') {
    console.error('LinkedIn refused comment', comment.id, result.status, result.detail)
    return fail(result.status === 429 || result.status >= 500
      ? 'LinkedIn was busy, so this comment was not posted. Press Try posting again in a minute.'
      : 'LinkedIn did not accept this comment. Nothing was posted.')
  }

  const { error } = await db.from('post_comments')
    .update({ status: 'published', external_id: result.urn ? result.urn.slice(0, 300) : null }).eq('id', comment.id)
  if (error) console.error('Marking comment published failed', comment.id, error.message)
  await logAttempt(db, comment.user_id, comment.post_id, comment.id, 'published')
}
