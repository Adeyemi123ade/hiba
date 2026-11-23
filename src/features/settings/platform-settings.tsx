import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { useSession } from '@/features/auth/use-session'
import { useOnline } from '@/features/onboarding/use-online'
import { PLATFORMS, type Platform } from '@/features/content/api/content-service'
import { DRAFT_PLATFORMS_KEY, saveDraftPlatforms, useDraftPlatforms } from '@/features/content/use-allowances'

/**
 * Owner decision (21 Nov 2026): drafts are written for LinkedIn only unless the person chooses more.
 * This sets which platforms are ticked when they make posts. They can still change the ticks each time.
 */
export function PlatformSettings() {
  const { session } = useSession()
  const online = useOnline()
  const queryClient = useQueryClient()
  const saved = useDraftPlatforms(Boolean(session))
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const current = saved.data ?? ['linkedin']

  async function toggle(p: Platform) {
    const next = current.includes(p) ? current.filter((x) => x !== p) : [...current, p]
    if (!next.length) return
    setState('saving')
    queryClient.setQueryData(DRAFT_PLATFORMS_KEY, next)
    try {
      await saveDraftPlatforms(next)
      setState('saved')
    } catch {
      setState('failed')
      void queryClient.invalidateQueries({ queryKey: DRAFT_PLATFORMS_KEY })
    }
  }

  return (
    <Card>
      <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">Platforms to write for</h3>
      <p className="text-sm text-[var(--color-text-secondary)]">
        When you make posts, Hiba writes only for the platforms ticked here. You can still change the ticks each time,
        and add another platform to an idea later.
      </p>
      <fieldset className="mt-3" disabled={!online || saved.isLoading || state === 'saving'}>
        <legend className="sr-only">Platforms to write for</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {PLATFORMS.map((p) => {
            const on = current.includes(p.id)
            return (
              <label key={p.id} className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
                <input type="checkbox" checked={on} onChange={() => toggle(p.id)} disabled={on && current.length === 1}
                  className="h-4 w-4 accent-[var(--color-primary-dark)]" />
                {p.name}
              </label>
            )
          })}
        </div>
      </fieldset>
      <p className="mt-2 text-xs" aria-live="polite">
        {state === 'saved' && <span className="text-[var(--color-text-secondary)]">Saved.</span>}
        {state === 'failed' && <span className="text-[var(--color-error)]">We could not save that.</span>}
        {!online && <span className="text-[var(--color-text-secondary)]">You are offline. Check your network connection and try again.</span>}
      </p>
    </Card>
  )
}
