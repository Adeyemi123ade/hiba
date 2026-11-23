import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { useSession } from '@/features/auth/use-session'
import { useOnline } from '@/features/onboarding/use-online'
import { fetchNotifyPrefs, saveNotifyPrefs, type NotifyPrefs } from '@/features/notifications/notifications-service'

const CHOICES: { key: keyof NotifyPrefs; label: string }[] = [
  { key: 'review', label: 'Drafts ready for review' },
  { key: 'published', label: 'Post published' },
]

/** HPD-79: which notifications to get. Publishing problems are always shown (owner, 23 Nov 2026). */
export function NotificationSettings() {
  const userId = useSession().session?.user.id
  const online = useOnline()
  const queryClient = useQueryClient()
  const key = ['notify-prefs', userId]
  const prefs = useQuery({ queryKey: key, queryFn: () => fetchNotifyPrefs(userId!), enabled: Boolean(userId) })
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  async function flip(k: keyof NotifyPrefs) {
    if (!userId || !prefs.data) return
    const next = { ...prefs.data, [k]: !prefs.data[k] }
    setSaving(true)
    setProblem(null)
    queryClient.setQueryData(key, next)
    try {
      await saveNotifyPrefs(userId, next)
    } catch {
      queryClient.setQueryData(key, prefs.data)
      setProblem(navigator.onLine ? 'We could not save that.' : 'You are offline. Check your network connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <h2 id="notifications-title" className="text-lg font-semibold text-[var(--color-text-primary)]">Notifications</h2>
      <p className="text-sm text-[var(--color-text-secondary)]">Shown under the bell. Publishing problems are always shown.</p>
      {prefs.isSuccess && !prefs.data && (
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">This cannot be shown just now. Please try again later.</p>
      )}
      {prefs.data && (
        <ul className="mt-3 flex flex-col gap-3">
          {CHOICES.map(({ key: k, label }) => {
            const on = prefs.data![k]
            return (
              <li key={k} className="flex items-center justify-between gap-3">
                <span id={`notify-${k}`} className="text-sm text-[var(--color-text-primary)]">{label}</span>
                <button type="button" role="switch" aria-checked={on} aria-labelledby={`notify-${k}`} onClick={() => flip(k)} disabled={saving || !online}
                  className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-[var(--color-primary-dark)]' : 'bg-slate-300'}`}>
                  <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-6' : 'left-1'}`} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {problem && <p role="alert" className="mt-2 text-sm text-red-700">{problem}</p>}
    </Card>
  )
}
