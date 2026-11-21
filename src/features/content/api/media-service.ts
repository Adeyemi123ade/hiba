import { supabase } from '@/lib/supabase'

/**
 * Video and document attachments on LinkedIn posts (migration 0020). LinkedIn allows images, OR one
 * video, OR one document per post. A PDF shows on LinkedIn as a swipeable carousel.
 */
export const MEDIA_BUCKET = 'post-media'
/** The largest file the Supabase free plan accepts. */
export const MEDIA_MAX_BYTES = 50 * 1024 * 1024
export const MEDIA_TITLE_MAX = 200

export type AttachmentKind = 'video' | 'document'

export interface PostAttachment {
  kind: AttachmentKind
  path: string
  name: string | null
  title: string | null
  mime: string | null
  bytes: number | null
}

const TYPES: Record<AttachmentKind, Record<string, string>> = {
  video: { 'video/mp4': 'mp4', 'video/quicktime': 'mov' },
  document: {
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/msword': 'doc',
  },
}
/** What the file picker accepts, per kind. */
export const ACCEPT: Record<AttachmentKind, string> = {
  video: 'video/mp4,video/quicktime',
  document: '.pdf,.ppt,.pptx,.doc,.docx,application/pdf',
}

export type MediaErrorCode = 'type' | 'size' | 'offline' | 'upload' | 'save' | 'session' | 'has_images'

export const MEDIA_ERROR_TEXT: Record<MediaErrorCode, string> = {
  type: 'This file type is not supported. Choose an MP4 or MOV video, or a PDF, PowerPoint or Word document.',
  size: 'This file is larger than 50 MB. Please choose a smaller one.',
  offline: 'You are offline. Reconnect, then try again.',
  upload: 'We could not upload your file. Please check it and try again.',
  save: 'The change could not be saved to the post. Please try again.',
  session: 'Your session expired. Sign in again, then try again.',
  has_images: 'A LinkedIn post can have images, or one video, or one document. Remove the images first.',
}

export class MediaError extends Error {
  readonly code: MediaErrorCode
  constructor(code: MediaErrorCode) {
    super(code)
    this.code = code
  }
}

const offline = () => typeof navigator !== 'undefined' && !navigator.onLine

/** Some browsers give Office files no type: fall back to the file name. */
function typeOf(file: File, kind: AttachmentKind): string | null {
  if (TYPES[kind][file.type]) return file.type
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return Object.entries(TYPES[kind]).find(([, e]) => e === ext)?.[0] ?? null
}

export function checkMedia(file: File, kind: AttachmentKind): MediaErrorCode | null {
  if (!typeOf(file, kind)) return 'type'
  if (file.size > MEDIA_MAX_BYTES) return 'size'
  return null
}

function asMediaError(error: { message?: string } | null, fallback: MediaErrorCode): MediaError {
  if (offline()) return new MediaError('offline')
  const msg = error?.message ?? ''
  if (/jwt|unauthor/i.test(msg)) return new MediaError('session')
  if (/images, or one video/i.test(msg)) return new MediaError('has_images')
  return new MediaError(fallback)
}

/** A readable title from the file name, used as the document's title on LinkedIn until changed. */
export const titleFromName = (name: string) =>
  name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MEDIA_TITLE_MAX)

/** Uploads the file and puts it on the post, replacing any earlier attachment (whose file is removed). */
export async function attachMedia(userId: string, postId: string, file: File, kind: AttachmentKind, previous: PostAttachment | null): Promise<PostAttachment> {
  const problem = checkMedia(file, kind)
  if (problem) throw new MediaError(problem)
  if (offline()) throw new MediaError('offline')
  const mime = typeOf(file, kind)!
  const path = `${userId}/${crypto.randomUUID()}.${TYPES[kind][mime]}`
  const { error: upError } = await supabase.storage.from(MEDIA_BUCKET).upload(path, file, { contentType: mime, upsert: false })
  if (upError) throw asMediaError(upError, 'upload')
  const attachment: PostAttachment = {
    kind, path, name: file.name.slice(0, 255), title: kind === 'document' ? titleFromName(file.name) || 'Document' : null,
    mime, bytes: file.size,
  }
  const { error } = await supabase.from('posts').update({ attachment }).eq('id', postId)
  if (error) {
    await supabase.storage.from(MEDIA_BUCKET).remove([path])
    throw asMediaError(error, 'save')
  }
  if (previous) await supabase.storage.from(MEDIA_BUCKET).remove([previous.path])
  return attachment
}

export async function removeMedia(postId: string, current: PostAttachment): Promise<void> {
  if (offline()) throw new MediaError('offline')
  const { error } = await supabase.from('posts').update({ attachment: null }).eq('id', postId)
  if (error) throw asMediaError(error, 'save')
  // The file is not needed any more. If removing it fails, the post is still right.
  const { error: rmError } = await supabase.storage.from(MEDIA_BUCKET).remove([current.path])
  if (rmError) console.warn('Attachment file not removed', rmError.message)
}

export async function saveMediaTitle(postId: string, current: PostAttachment, title: string): Promise<PostAttachment> {
  const next = { ...current, title: title.trim().slice(0, MEDIA_TITLE_MAX) || null }
  const { error } = await supabase.from('posts').update({ attachment: next }).eq('id', postId)
  if (error) throw asMediaError(error, 'save')
  return next
}

/** A short-lived private link, to show the video or open the document on screen. */
export async function mediaPreviewUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(path, 60 * 60)
  if (error || !data?.signedUrl) throw asMediaError(error, 'upload')
  return data.signedUrl
}

export const sizeText = (bytes: number | null) =>
  !bytes ? '' : bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

/** "PDF", "PowerPoint", "Word" or "Video", for labels. */
export function kindLabel(a: Pick<PostAttachment, 'kind' | 'mime'>): string {
  if (a.kind === 'video') return 'Video'
  if (a.mime === 'application/pdf') return 'PDF'
  if (a.mime?.includes('presentation') || a.mime === 'application/vnd.ms-powerpoint') return 'PowerPoint'
  return 'Word document'
}
