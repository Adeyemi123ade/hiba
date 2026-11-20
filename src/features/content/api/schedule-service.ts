import { supabase } from '@/lib/supabase'
import type { Platform, PostStatus } from '@/features/content/api/content-service'

/** H09: schedule, move and cancel LinkedIn posts. Hiba's publisher posts them when due. */
export const SCHEDULE_MIN_LEAD_MIN = 5
export const SCHEDULE_MAX_DAYS = 365

export type ScheduleErrorCode = 'too_soon' | 'too_far' | 'invalid' | 'posting_now' | 'changed' | 'offline' | 'session' | 'unknown'

export const SCHEDULE_ERROR_TEXT: Record<ScheduleErrorCode, string> = {
  too_soon: `Choose a time at least ${SCHEDULE_MIN_LEAD_MIN} minutes from now.`,
  too_far: 'Choose a time within the next year.',
  invalid: 'Choose a date and a time.',
  posting_now: 'Hiba is posting this right now, so it cannot be changed. Refresh in a minute to see the result.',
  changed: 'This post changed somewhere else. Refresh the page and try again.',
  offline: 'You are offline. Reconnect, then try again.',
  session: 'Your session expired. Sign in again, then try again.',
  unknown: 'That did not work. Please try again.',
}

export class ScheduleError extends Error {
  readonly code: ScheduleErrorCode
  constructor(code: ScheduleErrorCode) {
    super(code)
    this.code = code
  }
}

const offline = () => typeof navigator !== 'undefined' && !navigator.onLine

function toError(error: { message?: string; code?: string } | null): ScheduleError {
  if (offline()) return new ScheduleError('offline')
  const msg = error?.message?.toLowerCase() ?? ''
  if (msg.includes('posting this right now')) return new ScheduleError('posting_now')
  if (msg.includes('few minutes')) return new ScheduleError('too_soon')
  if (msg.includes('next year')) return new ScheduleError('too_far')
  if (error?.code === 'PGRST301' || msg.includes('jwt')) return new ScheduleError('session')
  if (msg.includes('failed to fetch') || msg.includes('network')) return new ScheduleError('offline')
  return new ScheduleError('unknown')
}

/** A problem with the chosen time, or null when it is fine. */
export function checkScheduleTime(when: Date | null): ScheduleErrorCode | null {
  if (!when || Number.isNaN(when.getTime())) return 'invalid'
  if (when.getTime() < Date.now() + SCHEDULE_MIN_LEAD_MIN * 60_000) return 'too_soon'
  if (when.getTime() > Date.now() + SCHEDULE_MAX_DAYS * 86_400_000) return 'too_far'
  return null
}

/** The next full hour that is at least an hour away: a sensible first suggestion. */
export function suggestedTime(): Date {
  const d = new Date(Date.now() + 60 * 60_000)
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  return d
}

const pad = (n: number) => String(n).padStart(2, '0')
/** For <input type="datetime-local">, in the person's own time zone. */
export const toLocalInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
export const fromLocalInput = (s: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return null
  const d = new Date(s) // read as local time
  return Number.isNaN(d.getTime()) ? null : d
}

export const timeZoneName = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'your time zone'
  } catch {
    return 'your time zone'
  }
}

export const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/**
 * Schedules an approved (or failed) post, or moves an already scheduled one.
 * Returns the saved time. Only LinkedIn posts can be scheduled.
 */
export async function schedulePost(postId: string, when: Date): Promise<string> {
  const problem = checkScheduleTime(when)
  if (problem) throw new ScheduleError(problem)
  if (offline()) throw new ScheduleError('offline')
  const { data, error } = await supabase.from('posts')
    .update({ status: 'scheduled', scheduled_for: when.toISOString() })
    .eq('id', postId).in('status', ['approved', 'failed', 'scheduled'])
    .select('scheduled_for')
  if (error) throw toError(error)
  if (!data?.length || !data[0].scheduled_for) throw new ScheduleError('changed')
  return data[0].scheduled_for as string
}

/** Cancels the scheduled time. The post goes back to Approved, ready to schedule or post again. */
export async function cancelSchedule(postId: string): Promise<void> {
  if (offline()) throw new ScheduleError('offline')
  const { data, error } = await supabase.from('posts')
    .update({ status: 'approved' }).eq('id', postId).eq('status', 'scheduled').select('id')
  if (error) throw toError(error)
  if (!data?.length) throw new ScheduleError('changed')
}

/** A failed post goes back to Approved, so it can be posted or scheduled again. */
export async function backToApproved(postId: string): Promise<void> {
  if (offline()) throw new ScheduleError('offline')
  const { data, error } = await supabase.from('posts')
    .update({ status: 'approved' }).eq('id', postId).eq('status', 'failed').select('id')
  if (error) throw toError(error)
  if (!data?.length) throw new ScheduleError('changed')
}

export interface CalendarPost {
  id: string
  idea_id: string
  platform: Platform
  body: string
  status: PostStatus
  scheduled_for: string | null
  published_at: string | null
  failure_reason: string | null
  external_url: string | null
  updated_at: string
}

/** Scheduled posts (any time ahead), failed ones, and what went out in the last `pastDays` days. */
export async function fetchCalendarPosts(pastDays = 30): Promise<CalendarPost[]> {
  const since = new Date(Date.now() - pastDays * 86_400_000).toISOString()
  const cols = 'id, idea_id, platform, body, status, scheduled_for, published_at, failure_reason, external_url, updated_at'
  const [ahead, done] = await Promise.all([
    supabase.from('posts').select(cols).in('status', ['scheduled', 'failed']).order('scheduled_for', { ascending: true }).limit(200),
    supabase.from('posts').select(cols).eq('status', 'published').gte('published_at', since).order('published_at', { ascending: false }).limit(200),
  ])
  if (ahead.error) throw toError(ahead.error)
  if (done.error) throw toError(done.error)
  return [...(ahead.data ?? []), ...(done.data ?? [])] as CalendarPost[]
}

/** Posts that went out between two times (for the month view). */
export async function fetchPublishedBetween(from: Date, to: Date): Promise<CalendarPost[]> {
  const cols = 'id, idea_id, platform, body, status, scheduled_for, published_at, failure_reason, external_url, updated_at'
  const { data, error } = await supabase.from('posts').select(cols).eq('status', 'published')
    .gte('published_at', from.toISOString()).lt('published_at', to.toISOString()).order('published_at').limit(500)
  if (error) throw toError(error)
  return (data ?? []) as CalendarPost[]
}

/** Approved LinkedIn posts waiting for a time: what can be put on the calendar. */
export async function fetchReadyToSchedule(): Promise<CalendarPost[]> {
  const cols = 'id, idea_id, platform, body, status, scheduled_for, published_at, failure_reason, external_url, updated_at'
  const { data, error } = await supabase.from('posts').select(cols).eq('status', 'approved').eq('platform', 'linkedin')
    .order('updated_at', { ascending: false }).limit(50)
  if (error) throw toError(error)
  return (data ?? []) as CalendarPost[]
}
