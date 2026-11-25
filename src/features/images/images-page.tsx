import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ImagePlus, Loader2, Trash2, X } from 'lucide-react'
import { Card, SkeletonCard } from '@/components/ui/card'
import { useSession } from '@/features/auth/use-session'
import {
  LOCAL_IMAGE_ERROR_TEXT, LocalImageError, addLocalImages, deleteLocalImages, type LocalImageErrorCode,
} from '@/lib/local-images'
import { Gallery, ImagePreview } from '@/features/images/gallery'
import { NO_SELECTION, longPress, startSelecting, tap, type Selection } from '@/features/images/selection'
import { libraryKey, outlineBtn, primaryBtn, thumbsOf, useBlobUrls, useLibrary } from '@/features/images/use-library'
import { showSuccess } from '@/components/ui/show-success'

const codeOf = (e: unknown): LocalImageErrorCode => (e instanceof LocalImageError ? e.code : 'unavailable')

/** The person's photo library, kept on this device. Tap to open; long press (or Select) to choose and delete. */
export function ImagesPage() {
  const { session } = useSession()
  const userId = session?.user.id
  const queryClient = useQueryClient()
  const library = useLibrary(userId)
  const images = library.data ?? []
  const urls = useBlobUrls(thumbsOf(library.data))
  const fileInput = useRef<HTMLInputElement>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<LocalImageErrorCode | null>(null)
  const [selection, setSelection] = useState<Selection>(NO_SELECTION)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [open, setOpen] = useState<string | null>(null)

  const refresh = () => queryClient.invalidateQueries({ queryKey: libraryKey(userId) })
  const cancel = useCallback(() => { setSelection(NO_SELECTION); setConfirming(false) }, [])

  useEffect(() => {
    if (!selection.active) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !open) cancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection.active, open, cancel])

  async function add(list: FileList | null) {
    const files = Array.from(list ?? [])
    if (!files.length || !userId) return
    setAdding(true)
    setError(null)
    try {
      await addLocalImages(userId, files)
      await refresh()
      showSuccess(files.length === 1 ? 'Image added.' : `${files.length} images added.`)
    } catch (e) {
      setError(codeOf(e))
    } finally {
      setAdding(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  async function removeSelected() {
    setDeleting(true)
    setError(null)
    try {
      const n = selection.ids.length
      await deleteLocalImages(selection.ids)
      await refresh()
      cancel()
      showSuccess(n === 1 ? 'Image deleted.' : `${n} images deleted.`)
    } catch (e) {
      setError(codeOf(e))
    } finally {
      setDeleting(false)
    }
  }

  const count = selection.ids.length
  const openImage = open ? images.find((i) => i.id === open) : undefined

  return (
    <div className={selection.active ? 'pb-24' : undefined}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Images</h1>
        <div className="flex gap-2">
          {images.length > 0 && !selection.active && (
            <button type="button" className={outlineBtn} onClick={() => { setSelection(startSelecting()); setError(null) }}>Select</button>
          )}
          <button type="button" className={primaryBtn} onClick={() => fileInput.current?.click()} disabled={adding || !userId}>
            {adding ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <ImagePlus size={16} aria-hidden="true" />}
            {adding ? 'Adding...' : 'Upload image'}
          </button>
        </div>
        <input ref={fileInput} type="file" multiple accept="image/jpeg,image/png,image/gif" className="sr-only"
          aria-label="Choose images to upload" tabIndex={-1} onChange={(e) => add(e.target.files)} />
      </div>

      <p className="mb-3 text-sm text-[var(--color-text-secondary)]">
        Your images are kept on this device only. They do not appear on your other devices, and clearing this
        browser's data, uninstalling it or losing the device removes them. Images already posted stay on LinkedIn.
      </p>
      {error && <p role="alert" className="mb-2 text-sm text-[var(--color-error)]">{LOCAL_IMAGE_ERROR_TEXT[error]}</p>}

      {library.isLoading && <SkeletonCard />}
      {library.isError && (
        <Card role="alert">
          <p className="text-[var(--color-error)]">{LOCAL_IMAGE_ERROR_TEXT[codeOf(library.error)]}</p>
          <button type="button" className="mt-2 font-semibold underline" onClick={() => library.refetch()}>Try again</button>
        </Card>
      )}
      {library.isSuccess && !images.length && (
        <Card>
          <p className="text-sm text-[var(--color-text-secondary)]">No images yet. Press Upload image to add your own.</p>
        </Card>
      )}
      {images.length > 0 && (
        <Gallery images={images} urls={urls} selectedIds={selection.ids} selecting={selection.active}
          onTap={(id) => {
            const r = tap(selection, id, 'browse')
            setSelection(r.selection)
            setConfirming(false)
            if (r.open) setOpen(r.open)
          }}
          onLongPress={(id) => { setSelection((s) => longPress(s, id)); setConfirming(false); setError(null) }} />
      )}

      {selection.active && (
        <div role="toolbar" aria-label="Selected images"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lg lg:left-56">
          {confirming ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="mr-auto">
                Delete {count === 1 ? 'this image' : `these ${count} images`} from this device? This cannot be undone.
                Posts already on LinkedIn keep their images.
              </span>
              <button type="button" onClick={removeSelected} disabled={deleting}
                className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] bg-red-700 px-3 py-1.5 font-semibold text-white disabled:opacity-50">
                {deleting ? 'Deleting...' : 'Yes, delete'}
              </button>
              <button type="button" className={outlineBtn} onClick={() => setConfirming(false)} disabled={deleting}>Keep</button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span aria-live="polite" className="mr-auto text-sm font-semibold text-[var(--color-text-primary)]">
                {count ? `${count} selected` : 'Tap images to select them'}
              </span>
              {count > 0 && (
                <button type="button" onClick={() => setConfirming(true)}
                  className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-red-700 px-3 py-1.5 text-sm font-semibold text-red-700">
                  <Trash2 size={16} aria-hidden="true" /> Delete
                </button>
              )}
              <button type="button" className={outlineBtn} onClick={cancel}>
                <X size={16} aria-hidden="true" /> Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {openImage && <ImagePreview image={openImage} onClose={() => setOpen(null)} />}
    </div>
  )
}
