import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import { clsx } from 'clsx'
import { type LibraryImage } from '@/features/content/api/image-service'
import { outlineBtn, primaryBtn, useLibrary } from '@/features/images/use-library'

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
