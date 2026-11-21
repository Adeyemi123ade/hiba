import { whenAvailable, type LimitedAction } from '@/features/content/api/content-service'
import { useAllowances } from '@/features/content/use-allowances'

const WHAT: Record<LimitedAction, [string, string]> = {
  draft: ['new draft', 'new drafts'],
  rewrite: ['rewrite', 'rewrites'],
  angles: ['angle request', 'angle requests'],
  comments: ['comment set', 'comment sets'],
  comment_rewrite: ['comment rewrite', 'comment rewrites'],
  voice: ['voice recording', 'voice recordings'],
}

/** "3 of 5 new drafts left today", or when none are left, the time more become available. */
export function LeftToday({ action, className = '' }: { action: LimitedAction; className?: string }) {
  const { data } = useAllowances()
  const a = data?.[action]
  if (!a) return null
  const left = Math.max(0, a.per_day - a.used)
  const [one, many] = WHAT[action]
  return (
    <p className={`text-xs ${left ? 'text-[var(--color-text-secondary)]' : 'text-amber-800'} ${className}`}>
      {left
        ? `${left} of ${a.per_day} ${a.per_day === 1 ? one : many} left today`
        : `No ${many} left today. You can do more ${whenAvailable(a.next_at)}.`}
    </p>
  )
}
