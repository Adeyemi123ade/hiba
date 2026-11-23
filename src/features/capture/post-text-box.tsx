import type { ReactNode } from 'react'

/**
 * The post text with an optional bar along its bottom for the paperclip (HPD-160, HPD-161).
 * Both sit in one bordered box, and the text ends above the bar, so text never goes under it.
 */
export function PostTextBox({ value, readOnly, onChange, describedBy, bar }: {
  value: string
  readOnly: boolean
  onChange: (value: string) => void
  describedBy?: string
  bar?: ReactNode
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-cream)] focus-within:border-[var(--color-primary)] focus-within:ring-1 focus-within:ring-[var(--color-primary)]">
      <textarea
        id="draft-text"
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={describedBy}
        className="block min-h-[240px] w-full resize-y rounded-[var(--radius-md)] bg-transparent p-3 text-[var(--color-text-primary)] focus:outline-none"
      />
      {bar && <div className="flex items-center border-t border-[var(--color-border)] px-1.5 py-1">{bar}</div>}
    </div>
  )
}
