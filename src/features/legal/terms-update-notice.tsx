import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Banner } from '@/components/ui/banner'
import { useSession } from '@/features/auth/use-session'
import { useProfile } from '@/features/onboarding/use-profile'
import { acceptTerms } from '@/features/onboarding/api/onboarding-service'
import { EFFECTIVE_DATE, TERMS_VERSION } from '@/lib/legal'

/**
 * HPD-156: tells people who signed up under an older version that the Privacy Policy and Terms
 * changed (Privacy Policy section 13 promises this). Pressing Got it records the new version on
 * their profile, so it does not come back on any device.
 */
export function TermsUpdateNotice() {
  const userId = useSession().session?.user.id
  const profile = useProfile(userId)
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [hidden, setHidden] = useState(false)

  if (hidden || !userId || !profile.data || profile.data.terms_version === TERMS_VERSION) return null

  async function dismiss() {
    setBusy(true)
    try {
      await acceptTerms(userId!)
      await queryClient.invalidateQueries({ queryKey: ['profile', userId] })
    } catch {
      // Not saved: hide it for now; it shows again next time.
    } finally {
      setHidden(true)
      setBusy(false)
    }
  }

  const link = 'font-semibold underline'
  return (
    <Banner tone="info" action={
      <button type="button" onClick={dismiss} disabled={busy}
        className="rounded-[var(--radius-sm)] border border-sky-300 bg-white px-3 py-1 text-sm font-semibold text-sky-900 disabled:opacity-50">
        {busy ? 'Saving...' : 'Got it'}
      </button>
    }>
      We updated our <a href="/privacy" target="_blank" rel="noopener noreferrer" className={link}>Privacy Policy</a> and{' '}
      <a href="/terms" target="_blank" rel="noopener noreferrer" className={link}>Terms</a> on {EFFECTIVE_DATE}: images on your
      posts now stay with the post after it is published, until you delete the post.
    </Banner>
  )
}
