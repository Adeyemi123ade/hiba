import { supabase } from '@/lib/supabase'

/** HPD-60 / HPD-109: images live in a private bucket, in a folder only their owner can use. */
export const IMAGE_BUCKET = 'post-images'
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const IMAGE_ALT_MAX = 300
/** A LinkedIn post can carry several images, shown as a gallery. Hiba allows up to 9. */
export const IMAGE_MAX_COUNT = 9
const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' }

/** One image on a post, in the order it is shown. */
export interface PostImageItem {
  path: string
  alt: string | null
}

export type ImageErrorCode = 'type' | 'size' | 'count' | 'offline' | 'upload' | 'save' | 'session' | 'in_use'

export const IMAGE_ERROR_TEXT: Record<ImageErrorCode, string> = {
  type: 'Please choose JPG, PNG or GIF images.',
  size: 'One of the images is larger than 5 MB. Please choose smaller ones.',
  count: `A post can have up to ${IMAGE_MAX_COUNT} images. Remove some first, or choose fewer.`,
  offline: 'You are offline. Reconnect, then try again.',
  upload: 'The image could not be uploaded. Please try again.',
  save: 'The change could not be saved to the post. Please try again.',
  session: 'Your session expired. Sign in again, then try again.',
  in_use: 'This image is on a scheduled post. Change or cancel that post first.',
}

export class ImageError extends Error {
  readonly code: ImageErrorCode
  constructor(code: ImageErrorCode) {
    super(code)
    this.code = code
  }
}

/** Checks a picked file before anything is uploaded. Returns a problem, or null when it is fine. */
export function checkImage(file: File): ImageErrorCode | null {
  if (!TYPES[file.type]) return 'type'
  if (file.size > IMAGE_MAX_BYTES) return 'size'
  return null
}

/** The post's images, from the list or (older rows) the single-image columns. */
export function imagesOf(post: { images?: PostImageItem[] | null; image_path?: string | null; image_alt?: string | null }): PostImageItem[] {
  if (Array.isArray(post.images) && post.images.length) return post.images
  return post.image_path ? [{ path: post.image_path, alt: post.image_alt ?? null }] : []
}

/** What the post row looks like after its image list changes (the first image is mirrored). */
export function imageFields(images: PostImageItem[]) {
  return { images, image_path: images[0]?.path ?? null, image_alt: images[0]?.alt ?? null }
}

const offline = () => typeof navigator !== 'undefined' && !navigator.onLine

async function saveList(postId: string, images: PostImageItem[]): Promise<void> {
  const { error } = await supabase.from('posts').update({ images }).eq('id', postId)
  if (error) throw new ImageError(offline() ? 'offline' : /jwt/i.test(error.message) ? 'session' : 'save')
}

async function upload(userId: string, file: File): Promise<string> {
  const path = `${userId}/${crypto.randomUUID()}.${TYPES[file.type]}`
  const { error } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false, cacheControl: '3600' })
  if (error) throw new ImageError(offline() ? 'offline' : /jwt|unauthor/i.test(error.message) ? 'session' : 'upload')
  return path
}

const removeFiles = (paths: string[]) => (paths.length ? supabase.storage.from(IMAGE_BUCKET).remove(paths) : Promise.resolve())

/**
 * Uploads the files to the person's folder and adds them after the current images.
 * All or nothing: if any upload or the save fails, the new files are removed again.
 */
export async function addImages(userId: string, postId: string, current: PostImageItem[], files: File[]): Promise<PostImageItem[]> {
  if (!files.length) return current
  for (const f of files) {
    const problem = checkImage(f)
    if (problem) throw new ImageError(problem)
  }
  if (current.length + files.length > IMAGE_MAX_COUNT) throw new ImageError('count')
  if (offline()) throw new ImageError('offline')
  const added: string[] = []
  try {
    for (const f of files) added.push(await upload(userId, f))
    const next = [...current, ...added.map((path) => ({ path, alt: null }))]
    await saveList(postId, next)
    await recordInLibrary(userId, added.map((path, i) => ({ path, bytes: files[i].size })))
    return next
  } catch (e) {
    await removeFiles(added)
    throw e instanceof ImageError ? e : new ImageError('upload')
  }
}

/** Swaps one image for a new file, keeping its place. The old one stays in the Images library. */
export async function replaceImage(userId: string, postId: string, current: PostImageItem[], index: number, file: File): Promise<PostImageItem[]> {
  const problem = checkImage(file)
  if (problem) throw new ImageError(problem)
  if (offline()) throw new ImageError('offline')
  const path = await upload(userId, file)
  const next = current.map((img, i) => (i === index ? { path, alt: null } : img))
  try {
    await saveList(postId, next)
  } catch (e) {
    await removeFiles([path])
    throw e
  }
  await recordInLibrary(userId, [{ path, bytes: file.size }])
  return next
}

/** Takes one image off the post. It stays in the Images library. */
export async function removeImage(postId: string, current: PostImageItem[], index: number): Promise<PostImageItem[]> {
  if (offline()) throw new ImageError('offline')
  const next = current.filter((_, i) => i !== index)
  await saveList(postId, next)
  return next
}

/** Adds library images to the end of the post's images (skipping ones already on it). */
export async function attachLibraryImages(postId: string, current: PostImageItem[], picked: Pick<LibraryImage, 'path' | 'alt'>[]): Promise<PostImageItem[]> {
  const fresh = picked.filter((p) => !current.some((c) => c.path === p.path))
  if (!fresh.length) return current
  if (current.length + fresh.length > IMAGE_MAX_COUNT) throw new ImageError('count')
  if (offline()) throw new ImageError('offline')
  const next = [...current, ...fresh.map((p) => ({ path: p.path, alt: p.alt ?? null }))]
  await saveList(postId, next)
  return next
}

/** Moves an image one place earlier (-1) or later (+1). The first image leads the post. */
export async function moveImage(postId: string, current: PostImageItem[], index: number, by: -1 | 1): Promise<PostImageItem[]> {
  const to = index + by
  if (to < 0 || to >= current.length) return current
  const next = [...current]
  ;[next[index], next[to]] = [next[to], next[index]]
  await saveList(postId, next)
  return next
}

export async function saveImageAlt(postId: string, current: PostImageItem[], index: number, alt: string): Promise<PostImageItem[]> {
  const next = current.map((img, i) => (i === index ? { ...img, alt: alt.trim().slice(0, IMAGE_ALT_MAX) || null } : img))
  await saveList(postId, next)
  return next
}

/** A short-lived private link for showing the preview. */
export async function imagePreviewUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(IMAGE_BUCKET).createSignedUrl(path, 60 * 60)
  if (error || !data?.signedUrl) throw new ImageError('upload')
  return data.signedUrl
}

// ---------- Images library (H07: HPD-59, 61, 62, 109) ----------

export interface LibraryImage {
  id: string
  path: string
  source: 'upload' | 'generated'
  prompt: string | null
  alt: string | null
  width: number | null
  height: number | null
  bytes: number | null
  created_at: string
}

/** A post that uses a library image. */
export interface ImageUse {
  postId: string
  ideaId: string
  status: string
  platform: string
}

/** Every new file goes into the library. Before migration 0018 there is no library: skip quietly. */
async function recordInLibrary(userId: string, files: { path: string; bytes: number }[]) {
  if (!files.length) return
  const { error } = await supabase.from('images').insert(files.map((f) => ({ user_id: userId, path: f.path, source: 'upload', bytes: f.bytes })))
  if (error) console.warn('Image not added to the library', error.message)
}

export async function fetchLibrary(): Promise<{ images: LibraryImage[]; uses: Record<string, ImageUse[]> }> {
  const [imgs, posts] = await Promise.all([
    supabase.from('images').select('id, path, source, prompt, alt, width, height, bytes, created_at').order('created_at', { ascending: false }).limit(500),
    supabase.from('posts').select('id, idea_id, platform, status, images').not('image_path', 'is', null).limit(1000),
  ])
  if (imgs.error) throw new ImageError(offline() ? 'offline' : /jwt/i.test(imgs.error.message) ? 'session' : 'save')
  const uses: Record<string, ImageUse[]> = {}
  for (const p of (posts.data ?? []) as { id: string; idea_id: string; platform: string; status: string; images: PostImageItem[] | null }[]) {
    for (const img of p.images ?? []) {
      ;(uses[img.path] ??= []).push({ postId: p.id, ideaId: p.idea_id, status: p.status, platform: p.platform })
    }
  }
  return { images: (imgs.data ?? []) as LibraryImage[], uses }
}

/** Uploads files straight to the library (not onto a post). All or nothing. */
export async function uploadToLibrary(userId: string, files: File[]): Promise<void> {
  for (const f of files) {
    const problem = checkImage(f)
    if (problem) throw new ImageError(problem)
  }
  if (offline()) throw new ImageError('offline')
  const added: string[] = []
  try {
    for (const f of files) added.push(await upload(userId, f))
    const { error } = await supabase.from('images').insert(added.map((path, i) => ({ user_id: userId, path, source: 'upload', bytes: files[i].size })))
    if (error) throw new ImageError('save')
  } catch (e) {
    await removeFiles(added)
    throw e instanceof ImageError ? e : new ImageError('upload')
  }
}

export async function saveLibraryAlt(id: string, alt: string): Promise<void> {
  const { error } = await supabase.from('images').update({ alt: alt.trim().slice(0, IMAGE_ALT_MAX) || null }).eq('id', id)
  if (error) throw new ImageError(offline() ? 'offline' : 'save')
}

/** Statuses where Hiba is about to post the image: it must not disappear from under it. */
const LOCKED = ['scheduled']

/**
 * Deletes an image for good: takes it off every post that uses it (never a scheduled one), then
 * removes the file and the library entry. Published posts keep their copy on LinkedIn.
 */
export async function deleteFromLibrary(image: LibraryImage, uses: ImageUse[]): Promise<void> {
  if (uses.some((u) => LOCKED.includes(u.status))) throw new ImageError('in_use')
  if (offline()) throw new ImageError('offline')
  for (const u of uses) {
    const { data, error } = await supabase.from('posts').select('images').eq('id', u.postId).maybeSingle()
    if (error) throw new ImageError('save')
    const list = ((data?.images ?? []) as PostImageItem[]).filter((i) => i.path !== image.path)
    await saveList(u.postId, list)
  }
  const { error: fileError } = await supabase.storage.from(IMAGE_BUCKET).remove([image.path])
  if (fileError) throw new ImageError(offline() ? 'offline' : 'save')
  const { error } = await supabase.from('images').delete().eq('id', image.id)
  if (error) throw new ImageError('save')
}

/** Short-lived private links for many images at once (one request). */
export async function previewUrls(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {}
  const { data, error } = await supabase.storage.from(IMAGE_BUCKET).createSignedUrls(paths, 60 * 60)
  if (error) throw new ImageError('upload')
  const out: Record<string, string> = {}
  for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl
  return out
}
