import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { FileText, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { PostImages, type PostImagesHandle } from '@/features/capture/post-image'
import type { AttachChoice } from '@/features/capture/attachment-choices'
import type { PostImageItem } from '@/features/content/api/image-service'
import {
  ACCEPT, MEDIA_ERROR_TEXT, MEDIA_TITLE_MAX, MediaError, attachMedia, kindLabel, mediaPreviewUrl, removeMedia, saveMediaTitle, sizeText,
  type AttachmentKind, type MediaErrorCode, type PostAttachment,
} from '@/features/content/api/media-service'

const outlineBtn =
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-primary)] px-3 py-1.5 text-sm font-semibold text-[var(--color-primary-dark)] disabled:cursor-not-allowed disabled:opacity-50'

/** What the paperclip menu (HPD-160) asks the post's attachments to do. */
export interface PostMediaHandle {
  choose: (choice: AttachChoice) => void
}

/**
 * Everything attached to a LinkedIn post: up to 9 images, OR one video, OR one document
 * (PDF, PowerPoint or Word; a PDF shows on LinkedIn as a swipeable carousel). That is LinkedIn's rule.
 * Things are added from the paperclip under the post text (HPD-160); this shows and manages them.
 */
export function PostMedia({ ref, userId, postId, posted = false, images, attachment, editable, online, onImagesChange, onAttachmentChange }: {
  ref?: Ref<PostMediaHandle>
  userId: string
  postId: string
  /** On LinkedIn already: Hiba may have removed its copy of the images. */
  posted?: boolean
  images: PostImageItem[]
  attachment: PostAttachment | null
  editable: boolean
  online: boolean
  onImagesChange: (images: PostImageItem[]) => void
  onAttachmentChange: (attachment: PostAttachment | null) => void
}) {
  const videoInput = useRef<HTMLInputElement>(null)
  const documentInput = useRef<HTMLInputElement>(null)
  const imagesRef = useRef<PostImagesHandle>(null)
  const [uploading, setUploading] = useState<AttachmentKind | null>(null)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<MediaErrorCode | null>(null)
  const busy = uploading !== null || removing

  // One file picker per kind, opened straight from the tap so phones allow it.
  function open(kind: AttachmentKind) {
    if (!editable || !online || busy) return
    setError(null)
    ;(kind === 'video' ? videoInput : documentInput).current?.click()
  }

  useImperativeHandle(ref, () => ({
    choose: (choice) => {
      if (choice === 'device') imagesRef.current?.fromDevice()
      else if (choice === 'library') imagesRef.current?.fromLibrary()
      else open(choice)
    },
  }))

  async function picked(kind: AttachmentKind, list: FileList | null) {
    const file = list?.[0]
    if (videoInput.current) videoInput.current.value = ''
    if (documentInput.current) documentInput.current.value = ''
    if (!file) return
    setUploading(kind)
    setError(null)
    try {
      onAttachmentChange(await attachMedia(userId, postId, file, kind, attachment))
    } catch (e) {
      setError(e instanceof MediaError ? e.code : 'upload')
    } finally {
      setUploading(null)
    }
  }

  async function remove() {
    if (!attachment) return
    setRemoving(true)
    setError(null)
    try {
      await removeMedia(postId, attachment)
      onAttachmentChange(null)
    } catch (e) {
      setError(e instanceof MediaError ? e.code : 'save')
    } finally {
      setRemoving(false)
    }
  }

  const inputs = (
    <>
      <input ref={videoInput} type="file" accept={ACCEPT.video} className="sr-only" tabIndex={-1}
        aria-label="Choose a video" onChange={(e) => picked('video', e.target.files)} />
      <input ref={documentInput} type="file" accept={ACCEPT.document} className="sr-only" tabIndex={-1}
        aria-label="Choose a document" onChange={(e) => picked('document', e.target.files)} />
    </>
  )
  const status = (
    <>
      {uploading && (
        <p role="status" className="mt-2 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          {uploading === 'video' ? 'Uploading the video...' : 'Uploading the document...'}
        </p>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-[var(--color-error)]">{MEDIA_ERROR_TEXT[error]}</p>}
    </>
  )

  if (attachment) {
    return (
      <div className="mt-4 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] p-3">
        {inputs}
        <AttachmentCard postId={postId} attachment={attachment} editable={editable && online && !busy}
          onTitleSaved={onAttachmentChange} />
        {editable && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={outlineBtn} disabled={busy || !online} onClick={() => open(attachment.kind)}>
              {uploading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
              {uploading ? 'Uploading...' : 'Replace'}
            </button>
            <button type="button" className={outlineBtn} disabled={busy || !online} onClick={remove}>
              <Trash2 size={16} aria-hidden="true" /> {removing ? 'Removing...' : 'Remove'}
            </button>
          </div>
        )}
        {status}
      </div>
    )
  }

  return (
    <>
      {inputs}
      <PostImages ref={imagesRef} userId={userId} postId={postId} posted={posted} images={images} editable={editable} online={online} onChange={onImagesChange} />
      {status}
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
