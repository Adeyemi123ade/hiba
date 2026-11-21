import { useEffect, useRef, useState } from 'react'
import { FileText, Film, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { PostImages } from '@/features/capture/post-image'
import type { PostImageItem } from '@/features/content/api/image-service'
import {
  ACCEPT, MEDIA_ERROR_TEXT, MEDIA_TITLE_MAX, MediaError, attachMedia, kindLabel, mediaPreviewUrl, removeMedia, saveMediaTitle, sizeText,
  type AttachmentKind, type MediaErrorCode, type PostAttachment,
} from '@/features/content/api/media-service'

const outlineBtn =
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-primary)] px-3 py-1.5 text-sm font-semibold text-[var(--color-primary-dark)] disabled:cursor-not-allowed disabled:opacity-50'

/**
 * Everything attached to a LinkedIn post: up to 9 images, OR one video, OR one document
 * (PDF, PowerPoint or Word; a PDF shows on LinkedIn as a swipeable carousel). That is LinkedIn's rule.
 */
export function PostMedia({ userId, postId, images, attachment, editable, online, onImagesChange, onAttachmentChange }: {
  userId: string
  postId: string
  images: PostImageItem[]
  attachment: PostAttachment | null
  editable: boolean
  online: boolean
  onImagesChange: (images: PostImageItem[]) => void
  onAttachmentChange: (attachment: PostAttachment | null) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [picking, setPicking] = useState<AttachmentKind | null>(null)
  const [busy, setBusy] = useState<'uploading' | 'removing' | null>(null)
  const [error, setError] = useState<MediaErrorCode | null>(null)

  function choose(kind: AttachmentKind) {
    setPicking(kind)
    setError(null)
    // The input's accepted types change with the kind; open it on the next tick.
    setTimeout(() => input.current?.click(), 0)
  }

  async function picked(list: FileList | null) {
    const file = list?.[0]
    if (input.current) input.current.value = ''
    if (!file || !picking) return
    setBusy('uploading')
    setError(null)
    try {
      onAttachmentChange(await attachMedia(userId, postId, file, picking, attachment))
    } catch (e) {
      setError(e instanceof MediaError ? e.code : 'upload')
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (!attachment) return
    setBusy('removing')
    setError(null)
    try {
      await removeMedia(postId, attachment)
      onAttachmentChange(null)
    } catch (e) {
      setError(e instanceof MediaError ? e.code : 'save')
    } finally {
      setBusy(null)
    }
  }

  const fileInput = (
    <input ref={input} type="file" accept={picking ? ACCEPT[picking] : undefined} className="sr-only" tabIndex={-1}
      aria-label={picking === 'video' ? 'Choose a video' : 'Choose a document'} onChange={(e) => picked(e.target.files)} />
  )

  if (attachment) {
    return (
      <div className="mt-4 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] p-3">
        {fileInput}
        <AttachmentCard postId={postId} attachment={attachment} editable={editable && online && busy === null}
          onTitleSaved={onAttachmentChange} />
        {editable && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={outlineBtn} disabled={busy !== null || !online} onClick={() => choose(attachment.kind)}>
              {busy === 'uploading' ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
              {busy === 'uploading' ? 'Uploading...' : 'Replace'}
            </button>
            <button type="button" className={outlineBtn} disabled={busy !== null || !online} onClick={remove}>
              <Trash2 size={16} aria-hidden="true" /> {busy === 'removing' ? 'Removing...' : 'Remove'}
            </button>
          </div>
        )}
        <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
          LinkedIn allows images, or one video, or one document on a post. Remove this to add images instead.
        </p>
        {error && <p role="alert" className="mt-2 text-sm text-[var(--color-error)]">{MEDIA_ERROR_TEXT[error]}</p>}
      </div>
    )
  }

  return (
    <>
      <PostImages userId={userId} postId={postId} images={images} editable={editable} online={online} onChange={onImagesChange} />
      {editable && (
        <div className="mt-2 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] p-3">
          {fileInput}
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">Or attach a video or document</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={outlineBtn} disabled={busy !== null || !online || images.length > 0} onClick={() => choose('video')}>
              {busy === 'uploading' && picking === 'video' ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Film size={16} aria-hidden="true" />}
              {busy === 'uploading' && picking === 'video' ? 'Uploading the video...' : 'Video'}
            </button>
            <button type="button" className={outlineBtn} disabled={busy !== null || !online || images.length > 0} onClick={() => choose('document')}>
              {busy === 'uploading' && picking === 'document' ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}
              {busy === 'uploading' && picking === 'document' ? 'Uploading the document...' : 'Document or carousel (PDF)'}
            </button>
          </div>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
            {images.length > 0
              ? 'LinkedIn allows images, or one video, or one document on a post. Remove the images to attach a video or document.'
              : 'One MP4 or MOV video, or one PDF, PowerPoint or Word document, up to 50 MB. A PDF shows on LinkedIn as a carousel people swipe through.'}
          </p>
          {error && <p role="alert" className="mt-2 text-sm text-[var(--color-error)]">{MEDIA_ERROR_TEXT[error]}</p>}
        </div>
      )}
    </>
  )
}

/** Shows the video (playable) or the document (with its LinkedIn title, which can be changed). */
export function AttachmentCard({ postId, attachment, editable, onTitleSaved }: {
  postId: string
  attachment: PostAttachment
  editable: boolean
  onTitleSaved?: (next: PostAttachment) => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [title, setTitle] = useState(attachment.title ?? '')
  const [titleState, setTitleState] = useState<'idle' | 'saved' | 'failed'>('idle')

  useEffect(() => {
    let live = true
    setUrl(null)
    mediaPreviewUrl(attachment.path).then((u) => { if (live) setUrl(u) }).catch(() => {})
    return () => { live = false }
  }, [attachment.path])
  useEffect(() => { setTitle(attachment.title ?? '') }, [attachment.title])

  async function saveTitle() {
    if ((attachment.title ?? '') === title.trim() || !onTitleSaved) return
    try {
      onTitleSaved(await saveMediaTitle(postId, attachment, title))
      setTitleState('saved')
    } catch {
      setTitleState('failed')
    }
  }

  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">
        {kindLabel(attachment)} <span className="font-normal text-[var(--color-text-secondary)]">{sizeText(attachment.bytes)}</span>
      </p>
      {attachment.kind === 'video' ? (
        url ? <video src={url} controls preload="metadata" className="max-h-72 w-full rounded-[var(--radius-sm)] bg-black" aria-label="Video attached to this post" />
          : <div className="flex h-40 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-bg-soft-green)]"><Loader2 size={20} className="animate-spin text-[var(--color-text-secondary)]" aria-label="Loading the video" /></div>
      ) : (
        <div className="flex items-center gap-3 rounded-[var(--radius-sm)] bg-[var(--color-bg-soft-green)] p-3">
          <FileText size={28} className="shrink-0 text-[var(--color-primary-dark)]" aria-hidden="true" />
          <div className="min-w-0">
            <p className="truncate text-sm text-[var(--color-text-primary)]">{attachment.name ?? 'Document'}</p>
            {url && <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold underline">Open to check it</a>}
          </div>
        </div>
      )}
      {attachment.kind === 'document' && (
        <label className="mt-2 block text-xs font-semibold text-[var(--color-text-primary)]">
          Title shown on LinkedIn
          <input value={title} maxLength={MEDIA_TITLE_MAX} readOnly={!editable}
            onChange={(e) => { setTitle(e.target.value); setTitleState('idle') }} onBlur={saveTitle}
            className="mt-1 block w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-cream)] px-2 py-1.5 text-sm font-normal" />
          <span className="mt-0.5 block font-normal" aria-live="polite">
            {titleState === 'saved' && <span className="text-[var(--color-text-secondary)]">Saved.</span>}
            {titleState === 'failed' && <span className="text-[var(--color-error)]">Not saved. Check your connection.</span>}
          </span>
        </label>
      )}
    </div>
  )
}
