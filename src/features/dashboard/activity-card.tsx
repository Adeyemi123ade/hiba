import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { fetchActivity } from '@/features/dashboard/activity-service'

/** Real numbers from the person's own posting with Hiba. No sample or example figures. */
export function ActivityCard({ userId }: { userId: string | undefined }) {
  const activity = useQuery({ queryKey: ['activity', userId], queryFn: fetchActivity, enabled: Boolean(userId), staleTime: 60_000 })
  const a = activity.data
  const max = Math.max(1, ...(a?.weeks.map((w) => w.count) ?? [0]))
  const weekLabel = (d: Date) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

  return (
    <Card>
      <h2 className="mb-3 text-lg font-semibold text-[var(--color-text-primary)]">Your posting</h2>
      {activity.isLoading && <div className="h-24 animate-pulse rounded-[var(--radius-md)] bg-[var(--color-border)]" role="status" aria-label="Loading your numbers" />}
      {activity.isError && (
        <p role="alert" className="text-sm text-[var(--color-error)]">
          Your numbers could not be loaded just now.{' '}
          <button type="button" className="font-semibold underline" onClick={() => activity.refetch()}>Try again</button>
        </p>
      )}
      {a && (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { value: a.postsPublished, label: 'LinkedIn posts in the last 30 days' },
              { value: a.commentsPosted, label: 'follow-up comments posted' },
              { value: a.ideas, label: 'ideas captured' },
              { value: a.scheduled, label: a.scheduled === 1 ? 'post scheduled' : 'posts scheduled' },
            ].map((s) => (
              <div key={s.label} className="rounded-[var(--radius-md)] bg-[var(--color-bg-soft-green)] p-3">
                <dt className="sr-only">{s.label}</dt>
                <dd className="text-xl font-bold tabular-nums text-[var(--color-ink)]">{s.value}</dd>
                <dd className="text-sm text-[var(--color-text-secondary)]">{s.label}</dd>
              </div>
            ))}
          </dl>

          <figure className="mt-4">
            <figcaption className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">Posts per week, last 8 weeks</figcaption>
            <ol className="flex h-28 items-end gap-1.5" aria-label="Posts per week">
              {a.weeks.map((w, i) => (
                <li key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1"
                  aria-label={`Week of ${weekLabel(w.start)}: ${w.count} post${w.count === 1 ? '' : 's'}`}>
                  <span className="text-xs tabular-nums text-[var(--color-text-secondary)]">{w.count || ''}</span>
                  <span className="w-full rounded-t-[4px] bg-[var(--color-primary)]"
                    style={{ height: w.count ? `${Math.max(8, (w.count / max) * 80)}%` : '2px', opacity: w.count ? 1 : 0.35 }} />
                  <span className="text-[10px] text-[var(--color-text-secondary)]">{i === a.weeks.length - 1 ? 'This week' : weekLabel(w.start)}</span>
                </li>
              ))}
            </ol>
          </figure>

          <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
            {a.lastPost ? (
              <>
                Your last post went out on {new Date(a.lastPost.publishedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}.{' '}
                {a.lastPost.url && (
                  <a href={a.lastPost.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold underline">
                    See it on LinkedIn <ExternalLink size={12} aria-hidden="true" />
                  </a>
                )}
              </>
            ) : (
              <>Nothing has gone out from Hiba yet. <Link to="/dashboard/capture" className="font-semibold underline">Capture an idea</Link> to make your first post.</>
            )}
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
            Views, reactions and comments from other people are shown on LinkedIn itself. LinkedIn does not share them with Hiba yet.
          </p>
        </>
      )}
    </Card>
  )
}
