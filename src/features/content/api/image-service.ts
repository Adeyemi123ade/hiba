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

export type ImageErrorCode = 'type' | 'size' | 'count' | 'offline' | 'upload' | 'save' | 'session' | 'in_use' | 'unreadable'

export const IMAGE_ERROR_TEXT: Record<ImageErrorCode, string> = {
  type: 'Please choose JPG, PNG or GIF images.',
  size: 'One of the images is larger than 5 MB. Please choose smaller ones.',
  count: `A post can have up to ${IMAGE_MAX_COUNT} images. Remove some first, or choose fewer.`,
  offline: 'You are offline. Reconnect, then try again.',
  upload: 'The image could not be uploaded. Please try again.',
  save: 'The change could not be saved to the post. Please try again.',
  session: 'Your session expired. Sign in again, then try again.',
  in_use: 'This image is on a scheduled post. Change or cancel that post first.',
  unreadable: 'This image could not be opened. Please choose a different one.',
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

/** HPD-165 (owner, 24 Nov 2026): every post image is portrait 1080 × 1350, so LinkedIn shows it large. */
export const POST_IMAGE_WIDTH = 1080
export const POST_IMAGE_HEIGHT = 1350

/** Where the whole w × h image sits inside the frame: as large as possible, centred, nothing cut. */
export function fitInside(w: number, h: number, outW = POST_IMAGE_WIDTH, outH = POST_IMAGE_HEIGHT) {
  const scale = Math.min(outW / w, outH / h)
  const dw = Math.round(w * scale)
  const dh = Math.round(h * scale)
  return { dx: Math.round((outW - dw) / 2), dy: Math.round((outH - dh) / 2), dw, dh }
}

/** Where a copy of the image goes so that it covers the whole frame (used blurred, behind). */
export function coverFrame(w: number, h: number, outW = POST_IMAGE_WIDTH, outH = POST_IMAGE_HEIGHT) {
  const scale = Math.max(outW / w, outH / h)
  const dw = Math.round(w * scale)
  const dh = Math.round(h * scale)
  return { dx: Math.round((outW - dw) / 2), dy: Math.round((outH - dh) / 2), dw, dh }
}

/**
 * Saves the image at exactly 1080 × 1350 as a JPEG without cutting anything off: the whole
 * picture sits in the middle, and any space around it is filled with a soft, blurred copy of
 * the same picture instead of empty bars. GIFs are kept as they are (redrawing stops the animation).
 */
export async function toPostSize(file: File): Promise<File> {
  if (file.type === 'image/gif') return file
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new ImageError('unreadable')
  }
  try {
    const W = POST_IMAGE_WIDTH
    const H = POST_IMAGE_HEIGHT
    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new ImageError('unreadable')
    ctx.fillStyle = '#ffffff' // see-through parts of a PNG become white, not black
    ctx.fillRect(0, 0, W, H)

    const fit = fitInside(bitmap.width, bitmap.height)
    if (fit.dw < W || fit.dh < H) {
      // Background: the picture shrunk to a tiny size and stretched back up, which blurs it in
      // every browser (canvas blur filters are missing in some). Slightly darkened so the photo stands out.
      const cover = coverFrame(bitmap.width, bitmap.height)
      const small = document.createElement('canvas')
      small.width = 36
      small.height = 45
      const sctx = small.getContext('2d')
      if (sctx) {
        sctx.fillStyle = '#ffffff'
        sctx.fillRect(0, 0, small.width, small.height)
        const k = small.width / W
        sctx.drawImage(bitmap, cover.dx * k, cover.dy * k, cover.dw * k, cover.dh * k)
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(small, 0, 0, W, H)
        ctx.fillStyle = 'rgba(0, 0, 0, 0.15)'
        ctx.fillRect(0, 0, W, H)
      }
    }
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, fit.dx, fit.dy, fit.dw, fit.dh)

    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.92))
    if (!blob) throw new ImageError('unreadable')
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
  } finally {
    bitmap.close()
  }
}

async function upload(userId: string, original: File): Promise<string> {
  const file = await toPostSize(original)
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

// Owner, 25 Nov 2026: a post keeps its images after it is published, so it is clear which post is which.
// They are removed only when the person removes them, deletes the post, or deletes their account.
