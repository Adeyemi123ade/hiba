import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { signOutUser } from '@/features/auth/api/auth-service'

/** An error Supabase sent back in the address (query or #fragment), in plain words. */
function errorFromAddress(): string | null {
  const params = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const code = params.get('error') ?? hash.get('error')
  if (!code) return null
  const detail = (params.get('error_description') ?? hash.get('error_description') ?? '').replace(/\+/g, ' ')
  if (/expired|invalid/i.test(detail)) return 'That sign-in link has expired or was already used. Please sign in again.'
  if (code === 'access_denied') return 'Google sign-in was cancelled. You can try again or use your email and password.'
  return 'Sign-in did not complete. Please try again.'
}

/**
 * Google Sign-In → choose account → Hiba (HPD-167, owner 25 Nov 2026).
 *
 * Google already proves the person owns the email address, so there is no extra email step:
 * a signed-in person goes straight in (onboarding on the first visit, handled by the dashboard guard).
 * Email + password sign-up keeps its own 6-digit code (auth-page.tsx).
 */
export function AuthCallbackPage() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    // Read before the session check: Supabase may clear the address while signing in.
    const addressError = errorFromAddress()
    async function run() {
      const { data } = await supabase.auth.getSession()
      // Signed in: go in, even if an old link in the address failed.
      if (data.session) {
        navigate('/dashboard/home', { replace: true })
        return
      }
      setError(addressError ?? 'Sign-in did not complete. Please try again.')
    }
    void run()
  }, [navigate])

  async function backToSignIn() {
    // Sign out first, so the sign-in page shows the form instead of sending the person back here.
    try { await signOutUser() } catch { /* signed out locally anyway */ }
    navigate('/auth', { replace: true })
  }

  if (!error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg-cream)]">
        <p className="text-[var(--color-text-secondary)]">Signing you in…</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--color-bg-cream)] px-4 text-center">
      <p role="alert" className="max-w-sm text-red-700">{error}</p>
      <button type="button" onClick={() => void backToSignIn()}
        className="rounded-[var(--radius-sm)] bg-[var(--color-primary-dark)] px-4 py-2 text-sm font-semibold text-white">
        Back to sign in
      </button>
    </div>
  )
}
