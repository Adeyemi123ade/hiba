// LinkedIn helpers shared by the "linkedin" function (post now, as the person) and the
// "publisher" function (scheduled posts and comments, in the background).
// Same steps in both, so a scheduled post goes out exactly like one posted by hand.

export const LINKEDIN_TIMEOUT_MS = 20_000
export const IMAGE_BUCKET = 'post-images'
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const IMAGE_MAX_COUNT = 9
/** Owner rule: LinkedIn posts are at most 200 words (LinkedIn itself allows 3000 characters). */
export const postTooLong = (text: string) => text.length > 3000 || text.split(/\s+/).length > 200

// ---------- encryption (AES-GCM, key = 32 random bytes, base64) ----------
export const b64 = {
  enc: (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)),
  dec: (text: string): Uint8Array<ArrayBuffer> => {
    const raw = atob(text)
    const out = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
    return out
  },
}

export async function encryptionKey(): Promise<CryptoKey | null> {
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

export async function encryptToken(key: CryptoKey, token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token)))
  return `v1:${b64.enc(iv)}:${b64.enc(data)}`
}

export async function decryptToken(key: CryptoKey, stored: string): Promise<string | null> {
  const [version, iv, data] = stored.split(':')
  if (version !== 'v1' || !iv || !data) return null
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.dec(iv) }, key, b64.dec(data))
    return new TextDecoder().decode(plain)
  } catch {
    return null
  }
}

export async function linkedinFetch(url: string, init: RequestInit) {
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
export interface PostImage { path: string; alt: string | null }

/** The post's images in order: the list, or (rows from before migration 0016) the single image. */
export function postImages(post: { images?: unknown; image_path?: string | null; image_alt?: string | null }): PostImage[] {
  const list = Array.isArray(post.images)
    ? post.images
      .filter((x): x is { path: string; alt?: unknown } => Boolean(x) && typeof (x as { path?: unknown }).path === 'string')
      .map((x) => ({ path: x.path, alt: typeof x.alt === 'string' && x.alt.trim() ? x.alt.trim() : null }))
    : []
  if (list.length) return list.slice(0, IMAGE_MAX_COUNT)
  return post.image_path ? [{ path: post.image_path, alt: post.image_alt ? String(post.image_alt) : null }] : []
}

/** The only part of the database client the image upload needs. */
export interface StorageReader {
  storage: { from: (bucket: string) => { download: (path: string) => Promise<{ data: Blob | null; error: unknown }> } }
}

export type ImageFailure = { error: 'image_failed' | 'linkedin_expired'; status: number; detail?: string }

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
export async function uploadImages(
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
export type LinkedInResult =
  | { kind: 'ok'; urn: string }
  | { kind: 'expired' }
  | { kind: 'forbidden'; detail: string }
  | { kind: 'refused'; status: number; detail: string }
  | { kind: 'no_answer' }

export const postUrl = (urn: string) => (urn ? `https://www.linkedin.com/feed/update/${urn}/` : null)

export async function createPost(accessToken: string, memberId: string, text: string, media: Record<string, unknown>[] | null): Promise<LinkedInResult> {
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

export async function createComment(accessToken: string, memberId: string, postUrn: string, text: string): Promise<LinkedInResult> {
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
