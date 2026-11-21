import { useEffect, useRef, useState } from 'react'
import { Clock, Smile } from 'lucide-react'
import { clsx } from 'clsx'
import { EMOJI_GROUPS, recentEmoji, rememberEmoji } from '@/lib/emoji'

/**
 * A smiley button that opens an emoji panel, like WhatsApp. Picking an emoji calls `onPick`; the
 * panel stays open so several can be added. Esc, the button again, or a click outside closes it.
 */
export function EmojiButton({ onPick, disabled = false, label = 'Add an emoji' }: {
  onPick: (emoji: string) => void
  disabled?: boolean
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const [recent, setRecent] = useState<string[]>([])
  const [group, setGroup] = useState(EMOJI_GROUPS[0].id)
  const box = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const list = recentEmoji()
    setRecent(list)
    setGroup(list.length ? 'recent' : EMOJI_GROUPS[0].id)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onClick = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onClick)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onClick) }
  }, [open])

  const shown = group === 'recent' ? recent : EMOJI_GROUPS.find((g) => g.id === group)?.emoji ?? []
  const groupLabel = group === 'recent' ? 'Recently used' : EMOJI_GROUPS.find((g) => g.id === group)?.label

  function pick(emoji: string) {
    rememberEmoji(emoji)
    onPick(emoji)
  }

  return (
    <span ref={box} className="relative inline-block">
      <button type="button" onClick={() => setOpen((o) => !o)} disabled={disabled} aria-expanded={open} aria-label={label} title={label}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-soft-green)] hover:text-[var(--color-text-primary)] disabled:opacity-40">
        <Smile size={20} aria-hidden="true" />
      </button>
      {open && (
        <span role="dialog" aria-label="Emoji"
          className="absolute block bottom-full left-0 z-30 mb-1 w-[min(20rem,calc(100vw-2rem))] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-xl">
          <span className="mb-1 flex gap-1 border-b border-[var(--color-border)] pb-1" role="tablist" aria-label="Emoji groups">
            {recent.length > 0 && (
              <button type="button" role="tab" aria-selected={group === 'recent'} aria-label="Recently used" title="Recently used"
                onClick={() => setGroup('recent')}
                className={clsx('flex h-8 w-8 items-center justify-center rounded', group === 'recent' && 'bg-[var(--color-primary-soft)]')}>
                <Clock size={16} aria-hidden="true" />
              </button>
            )}
            {EMOJI_GROUPS.map((g) => (
              <button key={g.id} type="button" role="tab" aria-selected={group === g.id} aria-label={g.label} title={g.label}
                onClick={() => setGroup(g.id)}
                className={clsx('flex h-8 w-8 items-center justify-center rounded text-lg', group === g.id && 'bg-[var(--color-primary-soft)]')}>
                {g.icon}
              </button>
            ))}
          </span>
          <span className="block px-1 pb-1 text-xs font-semibold text-[var(--color-text-secondary)]">{groupLabel}</span>
          <span className="grid max-h-52 grid-cols-8 gap-0.5 overflow-y-auto">
            {shown.map((e) => (
              <button key={e} type="button" onClick={() => pick(e)} aria-label={`Add ${e}`}
                className="flex h-9 items-center justify-center rounded text-xl hover:bg-[var(--color-bg-soft-green)]">
                {e}
              </button>
            ))}
          </span>
        </span>
      )}
    </span>
  )
}
