import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { getLocalFile } from '@/lib/local-images'
import { Gallery } from '@/features/images/gallery'
import { NO_SELECTION, tap, type Selection } from '@/features/images/selection'
import { outlineBtn, primaryBtn, thumbsOf, useBlobUrls, useLibrary } from '@/features/images/use-library'

/**
 * Choose images from the library on this device for a post. Here a tap always selects (never
 * opens), and nothing can be deleted, so no library image is lost by accident.
 */
export function ImagePickerDialog({ userId, open, max, onClose, onPick }: {
  userId: string
  open: boolean
  /** How many more images the post can take. */
  max: number
  onClose: () => void
  /** Gets the original files; uploads them to the post. */
  onPick: (files: File[]) => Promise<void>
}) {
  const library = useLibrary(userId, open)
  const urls = useBlobUrls(open ? thumbsOf(library.data) : [])
  const [selection, setSelection] = useState<Selection>(NO_SELECTION)
  const [full, setFull] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const closeBtn = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    setSelection(NO_SELECTION)
    setFull(false)
    setFailed(false)
    closeBtn.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  const images = library.data ?? []
  const count = selection.ids.length
  const choose = (id: string) => {
    const r = tap(selection, id, 'pick', max)
    setSelection(r.selection)
    setFull(Boolean(r.full))
  }

  async function use() {
    setBusy(true)
    setFailed(false)
    try {
      // In the order they were tapped: the first one tapped leads the post.
      const files = await Promise.all(selection.ids.map((id) => getLocalFile(id)))
      await onPick(files)
      onClose()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="picker-title" onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90dvh] w-full max-w-2xl flex-col rounded-t-[var(--radius-lg)] bg-[var(--color-surface)] p-4 sm:rounded-[var(--radius-lg)]">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 id="picker-title" className="text-lg font-semibold text-[var(--color-text-primary)]">Choose from library</h2>
          <button ref={closeBtn} type="button" onClick={onClose} aria-label="Close" className="rounded p-1"><X size={20} /></button>
        </div>
        <p className="mb-3 text-sm text-[var(--color-text-secondary)]" aria-live="polite">
          {full ? `This post can take ${max} more image${max === 1 ? '' : 's'}.` : count ? `${count} selected` : 'Tap the images you want.'}
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {library.isLoading && <p className="text-sm text-[var(--color-text-secondary)]">Loading your images...</p>}
          {library.isError && <p role="alert" className="text-sm text-[var(--color-error)]">Your images could not be loaded on this device.</p>}
          {library.isSuccess && !images.length && (
            <p className="text-sm text-[var(--color-text-secondary)]">
              Your library on this device is empty. Close this and use Choose from device instead.
            </p>
          )}
          <Gallery images={images} urls={urls} selectedIds={selection.ids} selecting
            onTap={choose}
            // A long press here selects too (and stops the phone's own "save image" menu).
            onLongPress={choose} />
        </div>
        {failed && <p role="alert" className="mt-2 text-sm text-[var(--color-error)]">The images could not be added to the post. Please try again.</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={primaryBtn} disabled={!count || busy} onClick={use}>
            {busy ? 'Adding...' : count ? `Use selected (${count})` : 'Use selected'}
          </button>
          <button type="button" className={outlineBtn} onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
