import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { ArrowLeft, ArrowRight, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import {
  IMAGE_ALT_MAX, IMAGE_ERROR_TEXT, IMAGE_MAX_COUNT, ImageError, addImages,
  imagePreviewUrl, moveImage, removeImage, replaceImage, saveImageAlt, type ImageErrorCode, type PostImageItem,
} from '@/features/content/api/image-service'
import { ImagePickerDialog } from '@/features/images/image-components'

const outlineBtn =
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-primary)] px-3 py-1.5 text-sm font-semibold text-[var(--color-primary-dark)] disabled:cursor-not-allowed disabled:opacity-50'
const iconBtn =
  'inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-40'

const codeOf = (e: unknown): ImageErrorCode => (e instanceof ImageError ? e.code : 'upload')

/** What the paperclip menu (HPD-160) asks the image section to do. */
export interface PostImagesHandle {
  fromDevice: () => void
  fromLibrary: () => void
}

/**
 * HPD-60: up to 9 images on a LinkedIn post, each described, reordered, replaced or removed.
 * Images are added from the paperclip menu (HPD-160). From device never saves to the library.
 */
export function PostImages({ ref, userId, postId, posted = false, images, editable, online, onChange }: {
  ref?: Ref<PostImagesHandle>
  userId: string
  postId: string
  posted?: boolean
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
  const canAdd = editable && online && busy === null && room > 0

  // Called straight from the menu tap, so the phone lets the file picker open.
  useImperativeHandle(ref, () => ({
    fromDevice: () => { if (canAdd) { setError(null); addInput.current?.click() } },
    fromLibrary: () => { if (canAdd) { setError(null); setPicking(true) } },
  }), [canAdd])

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

  const showBox = images.length > 0 || busy === 'adding' || error !== null
  return (
    <div className={showBox ? 'mt-4 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] p-3' : undefined}>
      {images.length > 0 && (
        <p className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
          Images <span className="font-normal text-[var(--color-text-secondary)]">{images.length} of {IMAGE_MAX_COUNT}</span>
        </p>
      )}
      <input ref={addInput} type="file" multiple accept="image/jpeg,image/png,image/gif" className="sr-only"
        aria-label="Choose images" tabIndex={-1} onChange={(e) => pickMany(e.target.files)} />
      <input ref={replaceInput} type="file" accept="image/jpeg,image/png,image/gif" className="sr-only"
        aria-label="Choose a replacement image" tabIndex={-1} onChange={(e) => pickReplacement(e.target.files)} />

      {images.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {images.map((img, i) => (
            <ImageCard
              key={img.path}
              image={img}
              index={i}
              count={images.length}
              postId={postId}
              posted={posted}
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

      {busy === 'adding' && (
        <p role="status" className="mt-2 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Uploading...
        </p>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-[var(--color-error)]">{IMAGE_ERROR_TEXT[error]}</p>}
      {images.length > 0 && editable && (
        <p className="mt-2 text-xs text-[var(--color-text-secondary)]">Removing an image from this post does not remove it from your library.</p>
      )}
      <ImagePickerDialog
        userId={userId}
        open={picking}
        max={room}
        onClose={() => setPicking(false)}
        onPick={async (files) => {
          setError(null)
          try {
            onChange(await addImages(userId, postId, images, files))
          } catch (e) {
            // Shown in the picker and, after it closes, here.
            setError(codeOf(e))
            throw e
          }
        }}
      />
    </div>
  )
}

function ImageCard({ image, index, count, postId, posted, editable, disabled, busy, confirming, onAskRemove, onCancelRemove, onRemove, onMove, onReplace, onSaveAlt }: {
  image: PostImageItem
  index: number
  count: number
  postId: string
  posted: boolean
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
      {/* The whole image at its own shape, never cropped (HPD-161). The fixed height is only for the placeholder. */}
      <div className={`relative flex w-full items-center justify-center overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-bg-soft-green)] ${preview ? '' : 'h-40'}`}>
        {preview ? (
          <img src={preview} alt={altText || `Image ${n} attached to this post`} className="block max-h-[28rem] w-full object-contain" />
        ) : previewFailed && posted ? (
          <span className="px-2 text-center text-xs text-[var(--color-text-secondary)]">
            Posted to LinkedIn. Hiba no longer keeps a copy of this image.
          </span>
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
