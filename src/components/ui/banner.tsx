import type { ReactNode } from 'react'
import { clsx } from 'clsx'

type Tone = 'warning' | 'error' | 'success' | 'info'

const tones: Record<Tone, string> = {
  warning: 'bg-amber-50 text-amber-900 border-amber-200',
  error: 'bg-red-50 text-red-800 border-red-200',
  success: 'bg-[var(--color-primary-soft)] text-[var(--color-primary-dark)] border-[var(--color-primary-light)]',
  info: 'bg-sky-50 text-sky-900 border-sky-200',
}

/** A message strip. Errors and warnings are announced to screen readers. */
export function Banner({ tone, children, action }: { tone: Tone; children: ReactNode; action?: ReactNode }) {
  return (
    <div
      role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}
      className={clsx(
        'mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border px-4 py-3 text-sm',
        tones[tone],
      )}
    >
      <span>{children}</span>
      {action}
    </div>
  )
}
