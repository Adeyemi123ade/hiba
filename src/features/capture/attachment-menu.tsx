import { useEffect, useRef, useState } from 'react'
import { FileText, Film, ImagePlus, Images, Paperclip } from 'lucide-react'
import { clsx } from 'clsx'

import type { AttachChoice } from '@/features/capture/attachment-choices'

export type { AttachChoice }

const ITEMS: { id: AttachChoice; label: string; icon: typeof ImagePlus }[] = [
  { id: 'device', label: 'From device', icon: ImagePlus },
  { id: 'library', label: 'From library', icon: Images },
  { id: 'video', label: 'Video', icon: Film },
  { id: 'document', label: 'Document', icon: FileText },
]

/**
 * HPD-160 (owner, 23 Nov 2026): a paperclip at the bottom of the post text opens four choices.
 * Choices LinkedIn would not accept right now are greyed out, with no explanation.
 * onChoose runs inside the tap itself, so the phone allows it to open the file picker.
 */
export function AttachmentMenu({ enabled, disabled, onChoose }: {
  enabled: Record<AttachChoice, boolean>
  disabled?: boolean
  onChoose: (choice: AttachChoice) => void
}) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const items = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    if (!open) return
    items.current.find((b) => b && !b.disabled)?.focus()
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); button.current?.focus() }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function move(e: React.KeyboardEvent, from: number) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const live = items.current.map((b, i) => (b && !b.disabled ? i : -1)).filter((i) => i >= 0)
    const at = live.indexOf(from)
    const next = live[(at + (e.key === 'ArrowDown' ? 1 : live.length - 1)) % live.length]
    items.current[next]?.focus()
  }

  return (
    <div ref={wrap} className="relative">
      {/* HPD-166 (owner, 24 Nov 2026): the words show next to the paperclip, so it is clear what it does. */}
      <button ref={button} type="button" aria-haspopup="menu" aria-expanded={open}
        disabled={disabled} onClick={() => setOpen((o) => !o)}
        className={clsx('flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-light-green)] hover:text-[var(--color-primary-dark)]',
          'disabled:cursor-not-allowed disabled:opacity-40', open && 'bg-[var(--color-bg-light-green)] text-[var(--color-primary-dark)]')}>
        <Paperclip size={18} aria-hidden="true" />
        Add attachment
      </button>
      {open && (
        <div role="menu" aria-label="Add attachment"
          className="absolute bottom-full left-0 z-20 mb-1 w-48 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-lg">
          {ITEMS.map(({ id, label, icon: Icon }, i) => (
            <button key={id} ref={(b) => { items.current[i] = b }} type="button" role="menuitem" disabled={!enabled[id]}
              onKeyDown={(e) => move(e, i)}
              onClick={() => { setOpen(false); onChoose(id) }}
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-light-green)] focus:bg-[var(--color-bg-light-green)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent">
              <Icon size={18} aria-hidden="true" className="text-[var(--color-primary-dark)]" />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
