import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Bell, CheckCircle2, FileText, Link2Off } from 'lucide-react'
import { clsx } from 'clsx'
import {
  NOTIFICATIONS_KEY, fetchNotifications, linkFor, markAllRead, markRead, timeAgo, type AppNotification, type NotificationKind,
} from '@/features/notifications/notifications-service'

const ICON: Record<NotificationKind, typeof Bell> = { review: FileText, published: CheckCircle2, failed: AlertTriangle, reconnect: Link2Off }
const TONE: Record<NotificationKind, string> = {
  review: 'text-[var(--color-primary-dark)]', published: 'text-[var(--color-primary-dark)]', failed: 'text-red-700', reconnect: 'text-amber-700',
}

/**
 * HPD-137: the bell with an unread count, and the list it opens. Refreshes every minute and when
 * the app comes back into view. `where` picks how the list opens: beside the side menu, or under the phone's top bar.
 */
export function NotificationBell({ where }: { where: 'sidebar' | 'header' }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const list = useQuery({
    queryKey: NOTIFICATIONS_KEY, queryFn: fetchNotifications,
    refetchInterval: 60_000, refetchOnWindowFocus: true, staleTime: 30_000,
  })
  const items = list.data ?? []
  const unread = items.filter((n) => !n.read_at).length

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const refresh = () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY })

  function openOne(n: AppNotification) {
    setOpen(false)
    if (!n.read_at) void markRead(n.id).then(refresh).catch(() => undefined)
    navigate(linkFor(n))
  }

  return (
    <div ref={wrap} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-[var(--color-text-primary)] hover:bg-[var(--color-bg-light-green)]">
        <Bell size={20} aria-hidden="true" />
        {unread > 0 && (
          <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications"
          className={clsx('z-50 overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg',
            where === 'header' ? 'fixed inset-x-2 top-14' : 'absolute left-0 top-full mt-2 w-80')}>
          <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2">
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Notifications</h2>
            {unread > 0 && (
              <button type="button" className="text-xs font-semibold text-[var(--color-primary-dark)] underline"
                onClick={() => void markAllRead().then(refresh).catch(() => undefined)}>
                Mark all as read
              </button>
            )}
          </div>
          <ul className="max-h-[60vh] overflow-y-auto">
            {list.isError && <li className="px-3 py-4 text-sm text-[var(--color-error)]">Your notifications could not be loaded.</li>}
            {list.isSuccess && !items.length && <li className="px-3 py-4 text-sm text-[var(--color-text-secondary)]">No notifications.</li>}
            {items.map((n) => {
              const Icon = ICON[n.kind]
              return (
                <li key={n.id} className="border-b border-[var(--color-border)] last:border-b-0">
                  <button type="button" onClick={() => openOne(n)}
                    className={clsx('flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-[var(--color-bg-light-green)]', !n.read_at && 'bg-[var(--color-primary-soft)]/40')}>
                    <Icon size={18} aria-hidden="true" className={clsx('mt-0.5 shrink-0', TONE[n.kind])} />
                    <span className="min-w-0 flex-1">
                      <span className={clsx('block text-sm text-[var(--color-text-primary)]', !n.read_at && 'font-semibold')}>{n.message}</span>
                      <span className="block text-xs text-[var(--color-text-secondary)]">{timeAgo(n.created_at)}</span>
                    </span>
                    {!n.read_at && <span aria-label="Unread" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-red-600" />}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
