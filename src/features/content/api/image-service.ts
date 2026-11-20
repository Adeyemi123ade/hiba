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

export type ImageErrorCode = 'type' | 'size' | 'count' | 'offline' | 'upload' | 'save' | 'session'

export const IMAGE_ERROR_TEXT: Record<ImageErrorCode, string> = {
  type: 'Please choose JPG, PNG or GIF images.',
  size: 'One of the images is larger than 5 MB. Please choose smaller ones.',
  count: `A post can have up to ${IMAGE_MAX_COUNT} images. Remove some first, or choose fewer.`,
  offline: 'You are offline. Reconnect, then try again.',
  upload: 'The image could not be uploaded. Please try again.',
  save: 'The change could not be saved to the post. Please try again.',
  session: 'Your session expired. Sign in again, then try again.',
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

/** Swaps one image for a new file, keeping its place. The old file is deleted afterwards. */
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
  await removeFiles([current[index].path])
  return next
}

/** Takes one image off the post, then deletes its file. */
export async function removeImage(postId: string, current: PostImageItem[], index: number): Promise<PostImageItem[]> {
  if (offline()) throw new ImageError('offline')
  const next = current.filter((_, i) => i !== index)
  await saveList(postId, next)
  await removeFiles([current[index].path])
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
