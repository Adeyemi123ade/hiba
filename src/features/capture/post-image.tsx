import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ImagePlus, Images, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import {
  IMAGE_ALT_MAX, IMAGE_ERROR_TEXT, IMAGE_MAX_COUNT, ImageError, addImages, attachLibraryImages,
  imagePreviewUrl, moveImage, removeImage, replaceImage, saveImageAlt, type ImageErrorCode, type PostImageItem,
} from '@/features/content/api/image-service'
import { ImagePickerDialog } from '@/features/images/image-components'

const outlineBtn =
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-primary)] px-3 py-1.5 text-sm font-semibold text-[var(--color-primary-dark)] disabled:cursor-not-allowed disabled:opacity-50'
const iconBtn =
  'inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-40'

const codeOf = (e: unknown): ImageErrorCode => (e instanceof ImageError ? e.code : 'upload')

/** HPD-60: add up to 9 images to a LinkedIn post, describe, reorder, replace or remove each one. */
export function PostImages({ userId, postId, images, editable, online, onChange }: {
  userId: string
  postId: string
  images: PostImageItem[]
  editable: boolean
  online: boolean
  onChange: (images: PostImageItem[]) => void
}) {
  const addInput = useRef<HTMLInputElement>(null)
  const replaceInput = useRef<HTMLInputElement>(null)
  const replaceIndex = useRef<number | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<ImageErrorCode | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null)
  const [picking, setPicking] = useState(false)
  const room = IMAGE_MAX_COUNT - images.length

  async function run(label: string, task: () => Promise<PostImageItem[]>) {
    setBusy(label)
    setError(null)
    setConfirmRemove(null)
    try {
      onChange(await task())
    } catch (e) {
      setError(codeOf(e))
    } finally {
      setBusy(null)
      if (addInput.current) addInput.current.value = ''
      if (replaceInput.current) replaceInput.current.value = ''
    }
  }

  function pickMany(list: FileList | null) {
    const files = Array.from(list ?? [])
    if (!files.length) return
    if (files.length > room) {
      setError('count')
      if (addInput.current) addInput.current.value = ''
      return
    }
    void run('adding', () => addImages(userId, postId, images, files))
  }

  function pickReplacement(list: FileList | null) {
    const file = list?.[0]
    const index = replaceIndex.current
    if (!file || index === null) return
    void run(`replacing-${index}`, () => replaceImage(userId, postId, images, index, file))
  }

  return (
    <div className="mt-4 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] p-3">
      <p className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
        Images
        {images.length > 0 && (
          <span className="font-normal text-[var(--color-text-secondary)]">{images.length} of {IMAGE_MAX_COUNT}</span>
        )}
        {!images.length && editable && (
          <span className="rounded-full bg-[var(--color-primary-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--color-primary-dark)]">Recommended</span>
        )}
      </p>
      <input ref={addInput} type="file" multiple accept="image/jpeg,image/png,image/gif" className="sr-only"
        aria-label="Choose images" tabIndex={-1} onChange={(e) => pickMany(e.target.files)} />
      <input ref={replaceInput} type="file" accept="image/jpeg,image/png,image/gif" className="sr-only"
        aria-label="Choose a replacement image" tabIndex={-1} onChange={(e) => pickReplacement(e.target.files)} />

      {!images.length && !editable && <p className="text-sm text-[var(--color-text-secondary)]">No images on this post.</p>}

      {images.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {images.map((img, i) => (
            <ImageCard
              key={img.path}
              image={img}
              index={i}
              count={images.length}
              postId={postId}
              editable={editable}
              disabled={busy !== null || !online}
              busy={busy}
              confirming={confirmRemove === i}
              onAskRemove={() => setConfirmRemove(i)}
              onCancelRemove={() => setConfirmRemove(null)}
              onRemove={() => run(`removing-${i}`, () => removeImage(postId, images, i))}
              onMove={(by) => run(`moving-${i}`, () => moveImage(postId, images, i, by))}
              onReplace={() => { replaceIndex.current = i; replaceInput.current?.click() }}
              onSaveAlt={(alt) => saveImageAlt(postId, images, i, alt).then(onChange)}
            />
          ))}
        </ul>
      )}

      {editable && room > 0 && (
        <div className="mt-3 flex flex-col items-start gap-1">
          <div className="flex flex-wrap gap-2">
            <button type="button" className={outlineBtn} disabled={busy !== null || !online} onClick={() => addInput.current?.click()}>
              {busy === 'adding' ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <ImagePlus size={16} aria-hidden="true" />}
              {busy === 'adding' ? 'Uploading...' : 'Upload'}
            </button>
            <button type="button" className={outlineBtn} disabled={busy !== null || !online} onClick={() => setPicking(true)}>
              <Images size={16} aria-hidden="true" /> Choose from Images
            </button>
          </div>
          <p className="text-xs text-[var(--color-text-secondary)]">
            Optional, but posts with images usually get much more attention. Up to {IMAGE_MAX_COUNT} JPG, PNG or GIF images,
            5 MB each, posted together with your text. The first image leads the post.
          </p>
        </div>
      )}

      {error && <p role="alert" className="mt-2 text-sm text-[var(--color-error)]">{IMAGE_ERROR_TEXT[error]}</p>}
      {images.length > 0 && editable && (
        <p className="mt-2 text-xs text-[var(--color-text-secondary)]">Removing an image from this post keeps it in your Images.</p>
      )}
      <ImagePickerDialog
        open={picking}
        max={room}
        exclude={images.map((i) => i.path)}
        onClose={() => setPicking(false)}
        onPick={(picked) => run('adding', () => attachLibraryImages(postId, images, picked))}
      />
    </div>
  )
}

function ImageCard({ image, index, count, postId, editable, disabled, busy, confirming, onAskRemove, onCancelRemove, onRemove, onMove, onReplace, onSaveAlt }: {
  image: PostImageItem
  index: number
  count: number
  postId: string
  editable: boolean
  disabled: boolean
  busy: string | null
  confirming: boolean
  onAskRemove: () => void
  onCancelRemove: () => void
  onRemove: () => void
  onMove: (by: -1 | 1) => void
  onReplace: () => void
  onSaveAlt: (alt: string) => Promise<void>
}) {
  const [preview, setPreview] = useState<string | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [altText, setAltText] = useState(image.alt ?? '')
  const [altSaved, setAltSaved] = useState<'idle' | 'saved' | 'failed'>('idle')
  const n = index + 1

  useEffect(() => setAltText(image.alt ?? ''), [image.alt])

  // Load a private preview link whenever the image changes.
  useEffect(() => {
    let cancelled = false
    setPreview(null)
    setPreviewFailed(false)
    imagePreviewUrl(image.path)
      .then((url) => !cancelled && setPreview(url))
      .catch(() => !cancelled && setPreviewFailed(true))
    return () => {
      cancelled = true
    }
  }, [image.path, attempt])

  async function saveAlt() {
    if ((image.alt ?? '') === altText.trim()) return
    try {
      await onSaveAlt(altText)
      setAltSaved('saved')
    } catch {
      setAltSaved('failed')
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] p-2">
      <div className="relative flex h-40 w-full items-center justify-center overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-bg-soft-green)]">
        {preview ? (
          <img src={preview} alt={altText || `Image ${n} attached to this post`} className="h-full w-full object-cover" />
        ) : previewFailed ? (
          <span className="px-2 text-center text-xs text-[var(--color-text-secondary)]">
            Preview not available.{' '}
            <button type="button" className="font-semibold underline" onClick={() => setAttempt((a) => a + 1)}>Try again</button>
          </span>
        ) : (
          <Loader2 size={20} className="animate-spin text-[var(--color-text-secondary)]" aria-label="Loading preview" />
        )}
        <span className="absolute left-1.5 top-1.5 rounded-full bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">{n}</span>
      </div>
      <label htmlFor={`alt-${postId}-${index}`} className="block text-xs font-semibold text-[var(--color-text-primary)]">
        Describe image {n} <span className="font-normal text-[var(--color-text-secondary)]">(optional, helps people using screen readers)</span>
      </label>
      <input
        id={`alt-${postId}-${index}`}
        value={altText}
        maxLength={IMAGE_ALT_MAX}
        readOnly={!editable}
        onChange={(e) => { setAltText(e.target.value); setAltSaved('idle') }}
        onBlur={saveAlt}
        placeholder="e.g. Our team at the whiteboard during planning"
        className="w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-cream)] px-2 py-1.5 text-sm"
      />
      <p className="text-xs text-[var(--color-text-secondary)]" aria-live="polite">
        {altSaved === 'saved' && 'Description saved.'}
        {altSaved === 'failed' && <span className="text-[var(--color-error)]">Description not saved. Check your connection.</span>}
      </p>
      {editable && (
        confirming ? (
          <span className="flex flex-wrap items-center gap-2 text-sm">
            Remove image {n}?
            <button type="button" className={outlineBtn} onClick={onRemove} disabled={busy !== null}>
              {busy === `removing-${index}` ? 'Removing...' : 'Yes, remove'}
            </button>
            <button type="button" className="font-semibold underline" onClick={onCancelRemove}>Keep it</button>
          </span>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={iconBtn} disabled={disabled || index === 0} onClick={() => onMove(-1)} aria-label={`Move image ${n} earlier`}>
              <ArrowLeft size={16} aria-hidden="true" />
            </button>
            <button type="button" className={iconBtn} disabled={disabled || index === count - 1} onClick={() => onMove(1)} aria-label={`Move image ${n} later`}>
              <ArrowRight size={16} aria-hidden="true" />
            </button>
            <button type="button" className={outlineBtn} disabled={disabled} onClick={onReplace}>
              {busy === `replacing-${index}` ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
              {busy === `replacing-${index}` ? 'Uploading...' : 'Replace'}
            </button>
            <button type="button" className={outlineBtn} disabled={disabled} onClick={onAskRemove} aria-label={`Remove image ${n}`}>
              <Trash2 size={16} aria-hidden="true" /> Remove
            </button>
          </div>
        )
      )}
    </li>
  )
}
