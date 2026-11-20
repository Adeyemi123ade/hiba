import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, Sparkles, X } from 'lucide-react'
import { clsx } from 'clsx'
import {
  GenerateError, IMAGE_SHAPES, IMAGE_STYLES, generateImage, type ImageShape, type ImageStyle, type LibraryImage,
} from '@/features/content/api/image-service'
import { LIBRARY_KEY, outlineBtn, primaryBtn, useLibrary } from '@/features/images/use-library'

/**
 * HPD-58: describe an image, pick a style and shape, and Hiba creates it with AI. The new image is
 * saved to the Images library; `onCreated` decides what happens next (e.g. add it to a post).
 */
export function GenerateImagePanel({ initialDescription = '', online, onCreated, compact = false }: {
  initialDescription?: string
  online: boolean
  onCreated: (image: LibraryImage) => void | Promise<void>
  compact?: boolean
}) {
  const queryClient = useQueryClient()
  const [description, setDescription] = useState(initialDescription)
  const [style, setStyle] = useState<ImageStyle>('photo')
  const [shape, setShape] = useState<ImageShape>('landscape')
  const [busy, setBusy] = useState(false)
  const [slow, setSlow] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!busy) return
    const t = setTimeout(() => setSlow(true), 20_000)
    return () => { clearTimeout(t); setSlow(false) }
  }, [busy])

  async function create() {
    if (description.trim().length < 5) { setError('Describe the image in a few words.'); return }
    setBusy(true)
    setError(null)
    try {
      const image = await generateImage({ description: description.trim(), style, shape })
      await queryClient.invalidateQueries({ queryKey: LIBRARY_KEY })
      await onCreated(image)
    } catch (e) {
      setError(e instanceof GenerateError ? e.detail : 'The image could not be created just now. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={clsx(!compact && 'rounded-[var(--radius-md)] border border-[var(--color-border)] p-3')}>
      <label htmlFor="image-description" className="block text-sm font-semibold text-[var(--color-text-primary)]">
        What should the image show?
      </label>
      <textarea
        id="image-description"
        value={description}
        maxLength={800}
        rows={3}
        onChange={(e) => { setDescription(e.target.value); setError(null) }}
        placeholder="e.g. A calm doctor's office with morning light, a stethoscope on the desk"
        className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-cream)] px-2 py-1.5 text-sm"
      />
      <fieldset className="mt-2">
        <legend className="text-xs font-semibold text-[var(--color-text-primary)]">Style</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {IMAGE_STYLES.map((s) => (
            <button key={s.id} type="button" aria-pressed={style === s.id} onClick={() => setStyle(s.id)}
              className={clsx('rounded-full border px-3 py-1 text-sm', style === s.id
                ? 'border-[var(--color-primary-dark)] bg-[var(--color-primary-soft)] font-semibold text-[var(--color-primary-dark)]'
                : 'border-[var(--color-border)] text-[var(--color-text-primary)]')}>
              {s.label}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="mt-2 block text-xs font-semibold text-[var(--color-text-primary)]">
        Shape
        <select value={shape} onChange={(e) => setShape(e.target.value as ImageShape)}
          className="ml-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-white px-2 py-1 text-sm font-normal">
          {IMAGE_SHAPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={primaryBtn} onClick={create} disabled={busy || !online}>
          {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
          {busy ? 'Creating the image...' : 'Create image'}
        </button>
        <span className="text-xs text-[var(--color-text-secondary)]">
          {busy ? (slow ? 'Still working. Images can take up to a minute.' : 'This usually takes 10 to 40 seconds.') : 'No words or logos are put in the image. Up to 20 a day.'}
        </span>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-[var(--color-error)]">{error}</p>}
    </div>
  )
}

/** HPD-60: choose one or more images from the library to add to a post. */
export function ImagePickerDialog({ open, max, exclude, onClose, onPick }: {
  open: boolean
  /** How many more images the post can take. */
  max: number
  /** Paths already on the post. */
  exclude: string[]
  onClose: () => void
  onPick: (images: LibraryImage[]) => Promise<void>
}) {
  const { library, thumbs } = useLibrary(open)
  const [chosen, setChosen] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const closeBtn = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    setChosen([])
    closeBtn.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  const images = (library.data?.images ?? []).filter((i) => !exclude.includes(i.path))
  const toggle = (path: string) =>
    setChosen((c) => (c.includes(path) ? c.filter((p) => p !== path) : c.length < max ? [...c, path] : c))

  async function add() {
    setBusy(true)
    try {
      await onPick(images.filter((i) => chosen.includes(i.path)))
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="picker-title" onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-t-[var(--radius-lg)] bg-[var(--color-surface)] p-4 sm:rounded-[var(--radius-lg)]">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 id="picker-title" className="text-lg font-semibold text-[var(--color-text-primary)]">Choose from your Images</h2>
          <button ref={closeBtn} type="button" onClick={onClose} aria-label="Close" className="rounded p-1"><X size={20} /></button>
        </div>
        <p className="mb-3 text-sm text-[var(--color-text-secondary)]">
          {chosen.length ? `${chosen.length} chosen` : 'Tap the images you want.'} You can add up to {max} more to this post.
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {library.isLoading && <p className="text-sm text-[var(--color-text-secondary)]">Loading your images...</p>}
          {library.isError && <p role="alert" className="text-sm text-[var(--color-error)]">Your images could not be loaded. Please try again.</p>}
          {library.isSuccess && !images.length && (
            <p className="text-sm text-[var(--color-text-secondary)]">No other images yet. Upload or create some on the Images page.</p>
          )}
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {images.map((img) => {
              const on = chosen.includes(img.path)
              return (
                <li key={img.id}>
                  <button type="button" onClick={() => toggle(img.path)} aria-pressed={on}
                    className={clsx('relative block h-28 w-full overflow-hidden rounded-[var(--radius-sm)] border-2 bg-[var(--color-bg-soft-green)]',
                      on ? 'border-[var(--color-primary-dark)]' : 'border-transparent')}>
                    {thumbs[img.path]
                      ? <img src={thumbs[img.path]} alt={img.alt || 'Library image'} className="h-full w-full object-cover" />
                      : <Loader2 size={18} className="m-auto animate-spin text-[var(--color-text-secondary)]" aria-hidden="true" />}
                    {on && <span className="absolute right-1 top-1 rounded-full bg-[var(--color-primary-dark)] p-0.5 text-white"><Check size={14} /></span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={primaryBtn} disabled={!chosen.length || busy} onClick={add}>
            {busy ? 'Adding...' : `Add ${chosen.length || ''} to the post`}
          </button>
          <button type="button" className={outlineBtn} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
