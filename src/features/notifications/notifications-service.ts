import { supabase } from '@/lib/supabase'

/**
 * In-app notifications (HPD-73, HPD-114). The database creates them (migration 0022);
 * the app only reads them and marks them read.
 */
export type NotificationKind = 'review' | 'published' | 'failed' | 'reconnect'

export interface AppNotification {
  id: string
  kind: NotificationKind
  idea_id: string | null
  post_id: string | null
  message: string
  created_at: string
  read_at: string | null
}

export const NOTIFICATIONS_KEY = ['notifications'] as const

/** The latest 30. Empty (not an error) if migration 0022 has not been run yet. */
export async function fetchNotifications(): Promise<AppNotification[]> {
  const { data, error } = await supabase.from('notifications')
    .select('id, kind, idea_id, post_id, message, created_at, read_at')
    .order('created_at', { ascending: false }).limit(30)
  if (error) {
    if (error.code === 'PGRST205' || error.code === '42P01') return []
    throw error
  }
  return (data ?? []) as AppNotification[]
}

export async function markRead(id: string): Promise<void> {
  const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id).is('read_at', null)
  if (error) throw error
}

export async function markAllRead(): Promise<void> {
  const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null)
  if (error) throw error
}

/** Where a notification takes the person. */
export function linkFor(n: AppNotification): string {
  if (n.kind === 'reconnect') return '/dashboard/settings#settings-accounts'
  if (n.idea_id) return `/dashboard/capture?idea=${n.idea_id}`
  return '/dashboard/library'
}

/** "2 min ago", "3 h ago", "Yesterday", or a date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000))
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} h ago`
  if (hours < 48) return 'Yesterday'
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

// ---------- preferences (HPD-79) ----------

export interface NotifyPrefs {
  review: boolean
  published: boolean
}

export async function fetchNotifyPrefs(userId: string): Promise<NotifyPrefs | null> {
  const { data, error } = await supabase.from('profiles').select('notify').eq('id', userId).maybeSingle()
  if (error) return null // column missing until migration 0022 runs
  const n = (data?.notify ?? {}) as Partial<NotifyPrefs>
  return { review: n.review !== false, published: n.published !== false }
}

export async function saveNotifyPrefs(userId: string, prefs: NotifyPrefs): Promise<void> {
  const { error } = await supabase.from('profiles').update({ notify: prefs }).eq('id', userId)
  if (error) throw error
}
