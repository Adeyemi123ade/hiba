import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CalendarClock, CheckCircle2, ExternalLink } from 'lucide-react'
import { Card, SkeletonCard } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/status-badge'
import { useSession } from '@/features/auth/use-session'
import { PLATFORMS } from '@/features/content/api/content-service'
import {
  SCHEDULE_ERROR_TEXT, ScheduleError, fetchCalendarPosts, timeZoneName, type CalendarPost,
} from '@/features/content/api/schedule-service'

const platformName = (id: string) => PLATFORMS.find((p) => p.id === id)?.name ?? id
const firstLine = (text: string) => {
  const line = text.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  return line.length > 110 ? `${line.slice(0, 107)}...` : line
}
const dayKey = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}
const dayLabel = (iso: string) => {
  const d = new Date(iso)
  const today = new Date()
  const tomorrow = new Date(Date.now() + 86_400_000)
  const yesterday = new Date(Date.now() - 86_400_000)
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  if (same(d, today)) return 'Today'
  if (same(d, tomorrow)) return 'Tomorrow'
  if (same(d, yesterday)) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
}
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

function groupByDay(list: CalendarPost[], at: (p: CalendarPost) => string) {
  const groups: { key: string; label: string; posts: CalendarPost[] }[] = []
  for (const p of list) {
    const k = dayKey(at(p))
    const g = groups.find((x) => x.key === k)
    if (g) g.posts.push(p)
    else groups.push({ key: k, label: dayLabel(at(p)), posts: [p] })
  }
  return groups
}

/** H09-S02: what Hiba will post and when, what needs attention, and what went out recently. */
export function CalendarPage() {
  const { session } = useSession()
  const userId = session?.user.id
  const query = useQuery({
    queryKey: ['calendar', userId],
    queryFn: () => fetchCalendarPosts(30),
    enabled: Boolean(userId),
    // Scheduled posts change by themselves when Hiba publishes them.
    refetchInterval: 60_000,
  })

  const { upcoming, failed, recent } = useMemo(() => {
    const all = query.data ?? []
    return {
      upcoming: all.filter((p) => p.status === 'scheduled' && p.scheduled_for)
        .sort((a, b) => a.scheduled_for!.localeCompare(b.scheduled_for!)),
      failed: all.filter((p) => p.status === 'failed'),
      recent: all.filter((p) => p.status === 'published' && p.published_at)
        .sort((a, b) => b.published_at!.localeCompare(a.published_at!)),
    }
  }, [query.data])

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-[var(--color-text-primary)]">Calendar</h1>
      <p className="mb-5 text-[var(--color-text-secondary)]">
        What Hiba will post for you, and when. Times are in your time zone ({timeZoneName()}).
      </p>

      {query.isLoading && <><SkeletonCard /><SkeletonCard lines={2} /></>}
      {query.isError && (
        <Card role="alert">
          <p className="text-[var(--color-error)]">
            {SCHEDULE_ERROR_TEXT[query.error instanceof ScheduleError ? query.error.code : 'unknown']}
          </p>
          <button type="button" className="mt-2 font-semibold underline" onClick={() => query.refetch()}>Try again</button>
        </Card>
      )}

      {query.isSuccess && (
        <>
          {failed.length > 0 && (
            <Card className="border-red-200">
              <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold text-red-800">
                <AlertTriangle size={20} aria-hidden="true" /> Needs your attention
              </h2>
              <ul>
                {failed.map((p) => (
                  <Row key={p.id} post={p} when={null}>
                    <p className="mt-1 text-sm text-red-800">{p.failure_reason || 'This post could not be published.'}</p>
                  </Row>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold text-[var(--color-text-primary)]">
              <CalendarClock size={20} aria-hidden="true" /> Coming up
            </h2>
            {upcoming.length ? (
              groupByDay(upcoming, (p) => p.scheduled_for!).map((g) => (
                <div key={g.key} className="mt-3 first:mt-0">
                  <h3 className="text-sm font-semibold text-[var(--color-text-secondary)]">{g.label}</h3>
                  <ul>{g.posts.map((p) => <Row key={p.id} post={p} when={time(p.scheduled_for!)} />)}</ul>
                </div>
              ))
            ) : (
              <p className="text-sm text-[var(--color-text-secondary)]">
                Nothing scheduled. Open an approved LinkedIn post and choose <strong>Schedule for later</strong>.{' '}
                <Link to="/dashboard/library" className="font-semibold text-[var(--color-primary-dark)] underline">See your posts</Link>
              </p>
            )}
          </Card>

          <Card>
            <h2 className="mb-2 flex items-center gap-2 text-lg font-semibold text-[var(--color-text-primary)]">
              <CheckCircle2 size={20} aria-hidden="true" /> Posted in the last 30 days
            </h2>
            {recent.length ? (
              groupByDay(recent, (p) => p.published_at!).map((g) => (
                <div key={g.key} className="mt-3 first:mt-0">
                  <h3 className="text-sm font-semibold text-[var(--color-text-secondary)]">{g.label}</h3>
                  <ul>{g.posts.map((p) => <Row key={p.id} post={p} when={time(p.published_at!)} />)}</ul>
                </div>
              ))
            ) : (
              <p className="text-sm text-[var(--color-text-secondary)]">Nothing posted from Hiba in the last 30 days.</p>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

function Row({ post, when, children }: { post: CalendarPost; when: string | null; children?: React.ReactNode }) {
  return (
    <li className="border-t border-[var(--color-border)] py-2.5 first:border-t-0">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {when && <span className="w-14 shrink-0 font-semibold tabular-nums text-[var(--color-text-primary)]">{when}</span>}
        <span className="text-[var(--color-text-secondary)]">{platformName(post.platform)}</span>
        <StatusBadge status={post.status} />
      </div>
      <p className="mt-1 break-words text-sm text-[var(--color-text-primary)]">{firstLine(post.body) || '(empty post)'}</p>
      {children}
      <div className="mt-1 flex flex-wrap gap-3 text-sm">
        <Link to={`/dashboard/capture?idea=${post.idea_id}`} className="font-semibold text-[var(--color-primary-dark)] underline">
          {post.status === 'scheduled' ? 'Open, change time or cancel' : 'Open'}
        </Link>
        {post.external_url && (
          <a href={post.external_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-[var(--color-primary-dark)] underline">
            View on LinkedIn <ExternalLink size={14} aria-hidden="true" />
          </a>
        )}
      </div>
    </li>
  )
}
