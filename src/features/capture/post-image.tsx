import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import {
  IMAGE_ALT_MAX, IMAGE_ERROR_TEXT, ImageError, attachImage, checkImage, imagePreviewUrl, removeImage, saveImageAlt,
  type ImageErrorCode,
} from '@/features/content/api/image-service'

const outlineBtn =
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-primary)] px-3 py-1.5 text-sm font-semibold text-[var(--color-primary-dark)] disabled:cursor-not-allowed disabled:opacity-50'

const codeOf = (e: unknown): ImageErrorCode => (e instanceof ImageError ? e.code : 'upload')

/** HPD-60: add, preview, describe, replace or remove the image on a LinkedIn post. */
export function PostImage({ userId, postId, path, alt, editable, online, onChange }: {
  userId: string
  postId: string
  path: string | null
  alt: string | null
  editable: boolean
  online: boolean
  onChange: (change: { image_path?: string | null; image_alt?: string | null }) => void
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'uploading' | 'removing' | null>(null)
  const [error, setError] = useState<ImageErrorCode | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [altText, setAltText] = useState(alt ?? '')
  const [altSaved, setAltSaved] = useState<'idle' | 'saved' | 'failed'>('idle')

  useEffect(() => setAltText(alt ?? ''), [alt, postId])

  // Load a private preview link whenever the image changes.
  useEffect(() => {
    let cancelled = false
    setPreview(null)
    setPreviewFailed(false)
    if (!path) return
    imagePreviewUrl(path)
      .then((url) => !cancelled && setPreview(url))
      .catch(() => !cancelled && setPreviewFailed(true))
    return () => {
      cancelled = true
    }
  }, [path, attempt])

  async function pick(file: File | undefined) {
    if (!file) return
    setError(null)
    setConfirmRemove(false)
    const problem = checkImage(file)
    if (problem) {
      setError(problem)
      return
    }
    setBusy('uploading')
    try {
      const newPath = await attachImage(userId, postId, file, path)
      onChange({ image_path: newPath })
    } catch (e) {
      setError(codeOf(e))
    } finally {
      setBusy(null)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function remove() {
    if (!path) return
    setBusy('removing')
    setError(null)
    try {
      await removeImage(postId, path)
      onChange({ image_path: null, image_alt: null })
      setConfirmRemove(false)
    } catch (e) {
      setError(codeOf(e))
    } finally {
      setBusy(null)
    }
  }

  async function saveAlt() {
    if ((alt ?? '') === altText.trim()) return
    try {
      await saveImageAlt(postId, altText)
      onChange({ image_alt: altText.trim() || null })
      setAltSaved('saved')
    } catch {
      setAltSaved('failed')
    }
  }

  const input = (
    <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/gif" className="sr-only"
      aria-label="Choose an image" tabIndex={-1} onChange={(e) => pick(e.target.files?.[0])} />
  )

  return (
    <div className="mt-4 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] p-3">
      <p className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">Image</p>
      {input}

      {!path && (
        <div className="flex flex-col items-start gap-1">
          {editable ? (
            <button type="button" className={outlineBtn} disabled={busy !== null || !online} onClick={() => fileInput.current?.click()}>
              {busy === 'uploading' ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <ImagePlus size={16} aria-hidden="true" />}
              {busy === 'uploading' ? 'Uploading...' : 'Add an image'}
            </button>
          ) : (
            <p className="text-sm text-[var(--color-text-secondary)]">No image on this post.</p>
          )}
          {editable && <p className="text-xs text-[var(--color-text-secondary)]">JPG, PNG or GIF, up to 5 MB. It is posted together with your text on LinkedIn.</p>}
        </div>
      )}

      {path && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex h-40 w-full shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-bg-soft-green)] sm:w-56">
            {preview ? (
              <img src={preview} alt={altText || 'Image attached to this post'} className="h-full w-full object-cover" />
            ) : previewFailed ? (
              <span className="px-2 text-center text-xs text-[var(--color-text-secondary)]">
                Preview not available.{' '}
                <button type="button" className="font-semibold underline" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
              </span>
            ) : (
              <Loader2 size={20} className="animate-spin text-[var(--color-text-secondary)]" aria-label="Loading preview" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <label htmlFor={`alt-${postId}`} className="block text-xs font-semibold text-[var(--color-text-primary)]">
              Describe the image <span className="font-normal text-[var(--color-text-secondary)]">(optional, helps people using screen readers)</span>
            </label>
            <input
              id={`alt-${postId}`}
              value={altText}
              maxLength={IMAGE_ALT_MAX}
              readOnly={!editable}
              onChange={(e) => { setAltText(e.target.value); setAltSaved('idle') }}
              onBlur={saveAlt}
              placeholder="e.g. Our team at the whiteboard during planning"
              className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-cream)] px-2 py-1.5 text-sm"
            />
            <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]" aria-live="polite">
              {altSaved === 'saved' && 'Description saved.'}
              {altSaved === 'failed' && <span className="text-[var(--color-error)]">Description not saved. Check your connection.</span>}
            </p>
            {editable && (
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className={outlineBtn} disabled={busy !== null || !online} onClick={() => fileInput.current?.click()}>
                  {busy === 'uploading' ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
                  {busy === 'uploading' ? 'Uploading...' : 'Replace'}
                </button>
                {!confirmRemove ? (
                  <button type="button" className={outlineBtn} disabled={busy !== null || !online} onClick={() => setConfirmRemove(true)}>
                    <Trash2 size={16} aria-hidden="true" /> Remove
                  </button>
                ) : (
                  <span className="flex flex-wrap items-center gap-2 text-sm">
                    Remove this image?
                    <button type="button" className={outlineBtn} onClick={remove} disabled={busy !== null}>
                      {busy === 'removing' ? 'Removing...' : 'Yes, remove'}
                    </button>
                    <button type="button" className="font-semibold underline" onClick={() => setConfirmRemove(false)}>Keep it</button>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {error && <p role="alert" className="mt-2 text-sm text-[var(--color-error)]">{IMAGE_ERROR_TEXT[error]}</p>}
    </div>
  )
}
