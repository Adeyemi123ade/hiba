import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarPlus, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import { Card } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/status-badge'
import {
  SCHEDULE_ERROR_TEXT, ScheduleError, checkScheduleTime, fetchPublishedBetween, fetchReadyToSchedule, schedulePost,
  type CalendarPost, type ScheduleErrorCode,
} from '@/features/content/api/schedule-service'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
const firstLine = (text: string, max = 90) => {
  const line = text.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  return line.length > max ? `${line.slice(0, max - 3)}...` : line
}
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

/** When a post sits on the calendar: its scheduled time, when it went out, or (failed) its last change. */
function whenOf(p: CalendarPost): string {
  if (p.status === 'published' && p.published_at) return p.published_at
  return p.scheduled_for ?? p.updated_at
}

/** The 6 weeks (Monday first) that cover the month. */
function gridFor(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const offset = (first.getDay() + 6) % 7
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset)
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
}

const DOT: Record<string, string> = {
  scheduled: 'bg-sky-500',
  published: 'bg-emerald-600',
  failed: 'bg-red-600',
}

/** H09-S02: a month calendar. Tap a day to see its posts, or put an approved post on it. */
export function MonthView({ ahead, userId }: {
  /** Scheduled and failed posts (any date), from the page's query. */
  ahead: CalendarPost[]
  userId: string
}) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [selected, setSelected] = useState<Date>(() => startOfDay(new Date()))
  const days = useMemo(() => gridFor(month), [month])
  const from = days[0]
  const to = new Date(days[41].getFullYear(), days[41].getMonth(), days[41].getDate() + 1)

  const published = useQuery({
    queryKey: ['calendar-month', userId, from.toISOString()],
    queryFn: () => fetchPublishedBetween(from, to),
  })
  const all = useMemo(() => [...ahead.filter((p) => p.status !== 'published'), ...(published.data ?? [])], [ahead, published.data])
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarPost[]>()
    for (const p of all) {
      const k = startOfDay(new Date(whenOf(p))).toDateString()
      map.set(k, [...(map.get(k) ?? []), p])
    }
    for (const list of map.values()) list.sort((a, b) => whenOf(a).localeCompare(whenOf(b)))
    return map
  }, [all])

  const today = startOfDay(new Date())
  const move = (by: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + by, 1))
  const dayPosts = byDay.get(selected.toDateString()) ?? []

  return (
    <>
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
            {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </h2>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => move(-1)} aria-label="Previous month" className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-1.5"><ChevronLeft size={18} /></button>
            <button type="button" onClick={() => { setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setSelected(today) }}
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-1 text-sm font-semibold">Today</button>
            <button type="button" onClick={() => move(1)} aria-label="Next month" className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-1.5"><ChevronRight size={18} /></button>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-[var(--color-text-secondary)]" aria-hidden="true">
          {WEEKDAYS.map((d) => <div key={d}>{d}</div>)}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1" role="grid" aria-label="Days">
          {days.map((d) => {
            const list = byDay.get(d.toDateString()) ?? []
            const inMonth = d.getMonth() === month.getMonth()
            const isSel = sameDay(d, selected)
            const label = `${d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}${list.length ? `, ${list.length} post${list.length === 1 ? '' : 's'}` : ''}`
            return (
              <button key={d.toISOString()} type="button" role="gridcell" aria-selected={isSel} aria-label={label}
                onClick={() => setSelected(d)}
                className={clsx('flex min-h-14 flex-col items-start rounded-[var(--radius-sm)] border p-1 text-left sm:min-h-20',
                  isSel ? 'border-[var(--color-primary-dark)] bg-[var(--color-primary-soft)]' : 'border-[var(--color-border)]',
                  !inMonth && 'opacity-40')}>
                <span className={clsx('text-xs tabular-nums', sameDay(d, today) ? 'rounded-full bg-[var(--color-primary-dark)] px-1.5 font-bold text-white' : 'text-[var(--color-text-primary)]')}>
                  {d.getDate()}
                </span>
                {/* Small screens: dots. Larger: the first lines. */}
                <span className="mt-1 flex flex-wrap gap-0.5 sm:hidden">
                  {list.slice(0, 4).map((p) => <span key={p.id} className={clsx('h-1.5 w-1.5 rounded-full', DOT[p.status] ?? 'bg-slate-400')} />)}
                </span>
                <span className="mt-1 hidden w-full flex-col gap-0.5 sm:flex">
                  {list.slice(0, 2).map((p) => (
                    <span key={p.id} className="flex w-full items-center gap-1 truncate text-[11px] text-[var(--color-text-primary)]">
                      <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', DOT[p.status] ?? 'bg-slate-400')} />
                      <span className="truncate">{timeOf(whenOf(p))} {firstLine(p.body, 30)}</span>
                    </span>
                  ))}
                  {list.length > 2 && <span className="text-[11px] text-[var(--color-text-secondary)]">+{list.length - 2} more</span>}
                </span>
              </button>
            )
          })}
        </div>
        <p className="mt-2 flex flex-wrap gap-3 text-xs text-[var(--color-text-secondary)]">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-500" /> Scheduled</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-600" /> Posted</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-600" /> Needs attention</span>
          {published.isFetching && <span className="flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Updating</span>}
        </p>
      </Card>

      <Card>
        <h2 className="mb-2 text-lg font-semibold text-[var(--color-text-primary)]">
          {selected.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
        </h2>
        {dayPosts.length ? (
          <ul>
            {dayPosts.map((p) => (
              <li key={p.id} className="border-t border-[var(--color-border)] py-2.5 first:border-t-0">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="w-14 font-semibold tabular-nums">{timeOf(whenOf(p))}</span>
                  <StatusBadge status={p.status} />
                </div>
                <p className="mt-1 break-words text-sm text-[var(--color-text-primary)]">{firstLine(p.body, 140) || '(empty post)'}</p>
                {p.status === 'failed' && p.failure_reason && <p className="mt-1 text-sm text-red-800">{p.failure_reason}</p>}
                <div className="mt-1 flex flex-wrap gap-3 text-sm">
                  <Link to={`/dashboard/capture?idea=${p.idea_id}`} className="font-semibold text-[var(--color-primary-dark)] underline">
                    {p.status === 'scheduled' ? 'Open, change time or cancel' : 'Open'}
                  </Link>
                  {p.external_url && <a href={p.external_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-[var(--color-primary-dark)] underline">View on LinkedIn</a>}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--color-text-secondary)]">Nothing on this day.</p>
        )}
        {selected >= today && <ScheduleOnDay day={selected} userId={userId} />}
      </Card>
    </>
  )
}

/** Put an approved LinkedIn post on the chosen day at a chosen time. */
function ScheduleOnDay({ day, userId }: { day: Date; userId: string }) {
  const queryClient = useQueryClient()
  const ready = useQuery({ queryKey: ['calendar-ready', userId], queryFn: fetchReadyToSchedule })
  const [postId, setPostId] = useState('')
  const [time, setTime] = useState('09:00')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ScheduleErrorCode | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function schedule() {
    const [h, m] = time.split(':').map(Number)
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h || 0, m || 0)
    const problem = checkScheduleTime(at)
    if (problem) { setError(problem); return }
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      await schedulePost(postId, at)
      setPostId('')
      setDone(`Scheduled for ${at.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.`)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['calendar'] }),
        queryClient.invalidateQueries({ queryKey: ['calendar-ready'] }),
        queryClient.invalidateQueries({ queryKey: ['home-posts'] }),
      ])
    } catch (e) {
      setError(e instanceof ScheduleError ? e.code : 'unknown')
    } finally {
      setBusy(false)
    }
  }

  const list = ready.data ?? []
  return (
    <div className="mt-4 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] p-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
        <CalendarPlus size={18} aria-hidden="true" /> Schedule an approved LinkedIn post on this day
      </p>
      {ready.isLoading && <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Loading your approved posts...</p>}
      {ready.isSuccess && !list.length && (
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          No approved LinkedIn posts waiting. <Link to="/dashboard/capture" className="font-semibold underline">Capture an idea</Link> and approve its LinkedIn draft first.
        </p>
      )}
      {list.length > 0 && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 text-xs font-semibold text-[var(--color-text-primary)]">
            Post
            <select value={postId} onChange={(e) => { setPostId(e.target.value); setError(null); setDone(null) }}
              className="mt-1 block w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-white px-2 py-1.5 text-sm font-normal">
              <option value="">Choose a post</option>
              {list.map((p) => <option key={p.id} value={p.id}>{firstLine(p.body, 70) || '(empty post)'}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-[var(--color-text-primary)]">
            Time
            <input type="time" value={time} onChange={(e) => { setTime(e.target.value); setError(null) }}
              className="mt-1 block rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-white px-2 py-1.5 text-sm font-normal" />
          </label>
          <button type="button" disabled={!postId || busy} onClick={schedule}
            className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-primary-dark)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? 'Scheduling...' : 'Schedule'}
          </button>
        </div>
      )}
      <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Hiba posts it then, with its images and approved comments, even if you are offline. Check the post first if you have not previewed it.</p>
      {done && <p role="status" className="mt-1 text-sm text-emerald-800">{done}</p>}
      {error && <p role="alert" className="mt-1 text-sm text-[var(--color-error)]">{SCHEDULE_ERROR_TEXT[error]}</p>}
    </div>
  )
}
