import { supabase } from '@/lib/supabase'

/** HPD-60 / HPD-109: images live in a private bucket, in a folder only their owner can use. */
export const IMAGE_BUCKET = 'post-images'
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const IMAGE_ALT_MAX = 300
const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' }

export type ImageErrorCode = 'type' | 'size' | 'offline' | 'upload' | 'save' | 'session'

export const IMAGE_ERROR_TEXT: Record<ImageErrorCode, string> = {
  type: 'Please choose a JPG, PNG or GIF image.',
  size: 'That image is larger than 5 MB. Please choose a smaller one.',
  offline: 'You are offline. Reconnect, then add the image again.',
  upload: 'The image could not be uploaded. Please try again.',
  save: 'The image was uploaded but could not be added to the post. Please try again.',
  session: 'Your session expired. Sign in again, then add the image.',
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

const offline = () => typeof navigator !== 'undefined' && !navigator.onLine

/**
 * Uploads the image to the person's folder, points the post at it, then removes the image it
 * replaced (if any). Returns the new storage path.
 */
export async function attachImage(userId: string, postId: string, file: File, previousPath: string | null): Promise<string> {
  const problem = checkImage(file)
  if (problem) throw new ImageError(problem)
  if (offline()) throw new ImageError('offline')
  const path = `${userId}/${crypto.randomUUID()}.${TYPES[file.type]}`
  const { error: uploadError } = await supabase.storage
    .from(IMAGE_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false, cacheControl: '3600' })
  if (uploadError) throw new ImageError(offline() ? 'offline' : /jwt|unauthor/i.test(uploadError.message) ? 'session' : 'upload')
  const { error: saveError } = await supabase.from('posts').update({ image_path: path }).eq('id', postId)
  if (saveError) {
    await supabase.storage.from(IMAGE_BUCKET).remove([path])
    throw new ImageError('save')
  }
  if (previousPath) await supabase.storage.from(IMAGE_BUCKET).remove([previousPath])
  return path
}

/** Takes the image off the post, then deletes the file. */
export async function removeImage(postId: string, path: string): Promise<void> {
  if (offline()) throw new ImageError('offline')
  const { error } = await supabase.from('posts').update({ image_path: null, image_alt: null }).eq('id', postId)
  if (error) throw new ImageError('save')
  await supabase.storage.from(IMAGE_BUCKET).remove([path])
}

export async function saveImageAlt(postId: string, alt: string): Promise<void> {
  const { error } = await supabase.from('posts').update({ image_alt: alt.trim().slice(0, IMAGE_ALT_MAX) || null }).eq('id', postId)
  if (error) throw new ImageError(offline() ? 'offline' : 'save')
}

/** A short-lived private link for showing the preview. */
export async function imagePreviewUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(IMAGE_BUCKET).createSignedUrl(path, 60 * 60)
  if (error || !data?.signedUrl) throw new ImageError('upload')
  return data.signedUrl
}
