import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, X } from 'lucide-react'
import { clsx } from 'clsx'
import { Modal } from '@/components/ui/modal'
import { getLocalFile, type LocalImage } from '@/lib/local-images'

const LONG_PRESS_MS = 450
const MOVE_TOLERANCE_PX = 10

/** Tap or long press on one tile. Scrolling (moving the finger) cancels both. */
function usePress(onTap: () => void, onLongPress?: () => void) {
  const timer = useRef<number | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const longFired = useRef(false)
  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => clear, [])
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return
      longFired.current = false
      start.current = { x: e.clientX, y: e.clientY }
      if (onLongPress) {
        timer.current = window.setTimeout(() => {
          longFired.current = true
          timer.current = null
          navigator.vibrate?.(15)
          onLongPress()
        }, LONG_PRESS_MS)
      }
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_TOLERANCE_PX) {
        clear()
        start.current = null
      }
    },
    onPointerUp: clear,
    onPointerCancel: () => { clear(); start.current = null },
    onPointerLeave: clear,
    // Click also comes from the keyboard (Enter/Space), so taps are handled here.
    onClick: () => {
      if (longFired.current) { longFired.current = false; return }
      onTap()
    },
    // Stop the phone's "save image" menu on long press.
    onContextMenu: (e: React.MouseEvent) => { if (onLongPress) e.preventDefault() },
  }
}

function Tile({ url, selected, selecting, onTap, onLongPress, label }: {
  url: string | undefined
  selected: boolean
  selecting: boolean
  onTap: () => void
  onLongPress?: () => void
  label: string
}) {
  const press = usePress(onTap, onLongPress)
  return (
    <li className="relative aspect-square">
      <button type="button" {...press} aria-label={label} aria-pressed={selecting ? selected : undefined}
        className={clsx('block h-full w-full select-none overflow-hidden bg-[var(--color-bg-soft-green)] [-webkit-touch-callout:none] [-webkit-tap-highlight-color:transparent]',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-dark)]')}>
        {url
          ? <img src={url} alt="" draggable={false} className={clsx('h-full w-full object-cover transition-transform', selected && 'scale-90 rounded-[var(--radius-sm)]')} />
          : <Loader2 size={18} className="m-auto animate-spin text-[var(--color-text-secondary)]" aria-hidden="true" />}
        {selecting && (
          <span aria-hidden="true" className={clsx('absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white shadow',
            selected ? 'bg-[var(--color-primary-dark)] text-white' : 'bg-black/25')}>
            {selected && <Check size={14} strokeWidth={3} />}
          </span>
        )}
      </button>
    </li>
  )
}

/** A photo grid: newest first, no titles, no buttons under the pictures. */
export function Gallery({ images, urls, selectedIds, selecting, onTap, onLongPress }: {
  images: LocalImage[]
  urls: Record<string, string>
  selectedIds: string[]
  selecting: boolean
  onTap: (id: string) => void
  onLongPress?: (id: string) => void
}) {
  return (
    <ul className="grid grid-cols-3 gap-0.5 sm:grid-cols-4 sm:gap-1 lg:grid-cols-5">
      {images.map((img, i) => {
        const selected = selectedIds.includes(img.id)
        return (
          <Tile key={img.id} url={urls[img.id]} selected={selected} selecting={selecting}
            onTap={() => onTap(img.id)} onLongPress={onLongPress ? () => onLongPress(img.id) : undefined}
            label={selecting ? `Image ${i + 1}${selected ? ', selected' : ''}` : `Open image ${i + 1}`} />
        )
      })}
    </ul>
  )
}

/** Full-size view of one image from the device. */
export function ImagePreview({ image, onClose }: { image: LocalImage; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const closeBtn = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let made: string | null = null
    let cancelled = false
    getLocalFile(image.id)
      .then((f) => { if (!cancelled) { made = URL.createObjectURL(f); setUrl(made) } })
      .catch(() => !cancelled && setFailed(true))
    return () => { cancelled = true; if (made) URL.revokeObjectURL(made) }
  }, [image.id])

  useEffect(() => closeBtn.current?.focus(), [])

  return (
    <Modal label="Image" onClose={onClose} closeOnBackdrop backdrop="dark" className="contents">
      <button ref={closeBtn} type="button" onClick={onClose} aria-label="Close"
        className="absolute right-3 top-3 rounded-full bg-black/50 p-2 text-white"><X size={22} /></button>
      {url ? (
        <img src={url} alt="" className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
      ) : failed ? (
        <p className="text-white">This image could not be opened. It may no longer be on this device.</p>
      ) : (
        <Loader2 size={28} className="animate-spin text-white" aria-label="Loading image" />
      )}
    </Modal>
  )
}
