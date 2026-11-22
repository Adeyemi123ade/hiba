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
    return next
  } catch (e) {
    await removeFiles(added)
    throw e instanceof ImageError ? e : new ImageError('upload')
  }
}

/**
 * Deletes a post's copy of an image it no longer uses, unless another post or the old online
 * library still uses it. Best effort: a leftover file only costs a little space.
 */
async function dropIfUnused(path: string, postId: string): Promise<void> {
  try {
    const [others, library] = await Promise.all([
      supabase.from('posts').select('images, image_path').neq('id', postId).not('image_path', 'is', null).limit(5000),
      supabase.from('images').select('path').eq('path', path).limit(1),
    ])
    if (others.error) return
    if (!library.error && library.data?.length) return
    if ((others.data ?? []).some((o) => imagesOf(o as { images: PostImageItem[] | null; image_path: string | null }).some((i) => i.path === path))) return
    await supabase.storage.from(IMAGE_BUCKET).remove([path])
  } catch { /* leave it */ }
}

/** Swaps one image for a new file, keeping its place. */
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
  void dropIfUnused(current[index].path, postId)
  return next
}

/** Takes one image off the post. */
export async function removeImage(postId: string, current: PostImageItem[], index: number): Promise<PostImageItem[]> {
  if (offline()) throw new ImageError('offline')
  const next = current.filter((_, i) => i !== index)
  await saveList(postId, next)
  void dropIfUnused(current[index].path, postId)
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

// ---------- Images library: now on the device (src/lib/local-images.ts) ----------

/** Images in the old online library (migration 0018), to copy to this device once. Empty if none. */
export async function onlineLibraryPaths(): Promise<string[]> {
  const { data, error } = await supabase.from('images').select('path').order('created_at', { ascending: true }).limit(1000)
  if (error) return []
  return (data ?? []).map((r) => r.path as string)
}

/** Reads one of the person's uploaded images (for copying it to the device library). */
export async function downloadImage(path: string): Promise<Blob | null> {
  const { data, error } = await supabase.storage.from(IMAGE_BUCKET).download(path)
  return error ? null : data
}

const SWEEP_KEY = (userId: string) => `hiba-posted-images-cleaned-${userId}`
const SWEEP_EVERY_MS = 6 * 60 * 60 * 1000

/**
 * Once a post is on LinkedIn, Hiba no longer needs its copy of the images: LinkedIn has its own,
 * and the original stays in the person's library on their device. This removes those copies,
 * keeping any image another unsent post still uses, and the old online library (kept until the
 * owner decides). Runs quietly at most every few hours; failures are retried next time.
 */
export async function cleanUpPostedImages(userId: string): Promise<void> {
  let last = 0
  try {
    last = Number(localStorage.getItem(SWEEP_KEY(userId)) ?? 0)
  } catch { /* storage blocked: just run */ }
  const startedAt = Date.now()
  if (startedAt - last < SWEEP_EVERY_MS || offline()) return
  // A day of overlap, so a post published while a sweep ran is never missed.
  const since = new Date(Math.max(0, last - 24 * 60 * 60 * 1000)).toISOString()

  const [posted, pending, library] = await Promise.all([
    supabase.from('posts').select('images, image_path').eq('status', 'published').gte('published_at', since)
      .not('image_path', 'is', null).limit(1000),
    supabase.from('posts').select('images, image_path').neq('status', 'published').not('image_path', 'is', null).limit(5000),
    supabase.from('images').select('path').limit(5000),
  ])
  if (posted.error || pending.error) return
  const pathsOf = (rows: unknown[] | null) =>
    (rows ?? []).flatMap((r) => imagesOf(r as { images: PostImageItem[] | null; image_path: string | null }).map((i) => i.path))
  const keep = new Set([...pathsOf(pending.data), ...(library.error ? [] : (library.data ?? []).map((r) => r.path as string))])
  const remove = [...new Set(pathsOf(posted.data))].filter((p) => !keep.has(p))
  for (let i = 0; i < remove.length; i += 100) {
    const { error } = await supabase.storage.from(IMAGE_BUCKET).remove(remove.slice(i, i + 100))
    if (error) return
  }
  try {
    localStorage.setItem(SWEEP_KEY(userId), String(startedAt))
  } catch { /* fine: it runs again next time */ }
}
