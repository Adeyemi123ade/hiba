import type { HTMLAttributes } from 'react'
import { clsx } from 'clsx'

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={clsx(
        'mb-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5',
        className,
      )}
      {...props}
    />
  )
}

/** Grey pulsing lines shown while content loads. */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <Card aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className="my-3 h-4 animate-pulse rounded-[var(--radius-sm)] bg-[var(--color-border)]"
          style={{ width: `${[60, 100, 80, 90][i % 4]}%` }}
        />
      ))}
    </Card>
  )
}
