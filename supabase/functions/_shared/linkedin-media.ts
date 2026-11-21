// Videos and documents on LinkedIn posts (migration 0020). Shared by the "linkedin" function
// (post now) and the "publisher" (scheduled posts), so both send attachments the same way.
//
// LinkedIn's older ugcPosts API (used for text and images) cannot carry documents, so posts with a
// video or document use the newer APIs, which work with the same w_member_social permission:
//   video:    rest/videos?action=initializeUpload -> upload each part -> finalizeUpload
//   document: rest/documents?action=initializeUpload -> upload the file
//   then:     rest/posts with content.media = the video or document
// A PDF document shows on LinkedIn as a swipeable carousel.
import { linkedinFetch, type LinkedInResult } from './linkedin.ts'

export const MEDIA_BUCKET = 'post-media'
export const MEDIA_MAX_BYTES = 50 * 1024 * 1024
/** LinkedIn API version for the newer endpoints (yyyymm). Override with the LINKEDIN_API_VERSION secret. */
const API_VERSION = Deno.env.get('LINKEDIN_API_VERSION') ?? '202608'
/** Big files take longer to send than a normal LinkedIn call. */
const UPLOAD_TIMEOUT_MS = 120_000

export interface PostAttachment {
  kind: 'video' | 'document'
  path: string
  name: string | null
  title: string | null
}

/** The post's video or document, if it has one. */
export function postAttachment(post: { attachment?: unknown }): PostAttachment | null {
  const a = post.attachment as Record<string, unknown> | null | undefined
  if (!a || typeof a !== 'object') return null
  if ((a.kind !== 'video' && a.kind !== 'document') || typeof a.path !== 'string' || !a.path) return null
  const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
  return { kind: a.kind, path: a.path, name: text(a.name, 255), title: text(a.title, 200) }
}

export type MediaFailure = { error: 'media_failed' | 'linkedin_expired'; status: number; detail: string }

/** The only part of the database client the upload needs. */
export interface MediaReader {
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
export async function uploadAttachment(db: MediaReader, accessToken: string, memberId: string, a: PostAttachment): Promise<{ urn: string } | MediaFailure> {
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
export function littleText(text: string): string {
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
export async function createMediaPost(accessToken: string, memberId: string, text: string, a: PostAttachment, urn: string): Promise<LinkedInResult> {
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
