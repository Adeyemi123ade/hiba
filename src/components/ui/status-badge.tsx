import { clsx } from 'clsx'
import { STATUS_LABELS, type PostStatus } from '@/features/content/api/content-service'

const tones: Record<PostStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  needs_review: 'bg-amber-100 text-amber-800',
  approved: 'bg-[var(--color-primary-soft)] text-[var(--color-primary-dark)]',
  scheduled: 'bg-sky-100 text-sky-800',
  published: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-800',
  archived: 'bg-slate-100 text-slate-500',
}

/** HPD-54 AC1: every post shows its status. */
export function StatusBadge({ status }: { status: PostStatus }) {
  return (
    <span className={clsx('inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold', tones[status])}>
      {STATUS_LABELS[status]}
    </span>
  )
}
