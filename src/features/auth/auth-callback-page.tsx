import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import {
  isHibaVerified,
  signedInByEmail,
  sendPostGoogleOtp,
  verifyPostGoogleOtp,
  markUserVerified,
} from '@/features/auth/api/auth-service'

type Status = 'loading' | 'needs-otp' | 'error'

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
 * Google Sign-In → Select Account → Verification Code (first-time only) → Dashboard.
 *
 * Supabase's OAuth redirect lands here with a session already established.
 * A first-time Google user (no `hiba_verified` flag on their user_metadata)
 * is emailed a one-time code and must verify it before reaching the dashboard.
 * A returning, already-verified Google user is sent straight through.
 */
export function AuthCallbackPage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<Status>('loading')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Runs once per visit: a second run would email a second code.
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    // Read before the session check: Supabase may clear the address while signing in.
    const addressError = errorFromAddress()
    async function run() {
      const { data, error } = await supabase.auth.getSession()
      if (addressError || error || !data.session) {
        setError(addressError ?? 'Sign-in did not complete. Please try again.')
        setStatus('error')
        return
      }

      const user = data.session.user

      if (isHibaVerified(user)) {
        navigate('/dashboard/home', { replace: true })
        return
      }

      // Came back from the emailed link (not Google): the email is proven, so record it and continue.
      if (signedInByEmail(data.session.access_token)) {
        try {
          await markUserVerified()
        } catch {
          // Not fatal: they are signed in; the code step simply appears again next time.
        }
        navigate('/dashboard/home', { replace: true })
        return
      }

      if (!user.email) {
        setError('No email associated with this Google account.')
        setStatus('error')
        return
      }

      try {
        await sendPostGoogleOtp(user.email)
        setEmail(user.email)
        setStatus('needs-otp')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not send verification code.')
        setStatus('error')
      }
    }

    run()
  }, [navigate])

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-bg-cream)]">
        <p className="text-[var(--color-text-secondary)]">Signing you in…</p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--color-bg-cream)] px-4 text-center">
        <p role="alert" className="max-w-sm text-red-700">{error}</p>
        <Link to="/auth" replace className="rounded-[var(--radius-sm)] bg-[var(--color-primary-dark)] px-4 py-2 text-sm font-semibold text-white">
          Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[var(--color-bg-cream)] px-4">
      <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Verify your email</h1>
      <GoogleOtpForm
        email={email}
        onVerified={() => navigate('/dashboard/home', { replace: true })}
      />
    </div>
  )
}

/**
 * Same shape as the registration OtpForm, but calls the 'email'-type verify
 * path and marks the user as verified afterward so future Google sign-ins skip this step.
 */
function GoogleOtpForm({ email, onVerified }: { email: string; onVerified: () => void }) {
  const [code, setCode] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      await verifyPostGoogleOtp(email, code)
      await markUserVerified()
      onVerified()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid or expired code. Try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <p className="text-sm text-[var(--color-text-secondary)]">
        Enter the code sent to <span className="font-medium">{email}</span>
      </p>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        required
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2 text-sm tracking-widest"
      />
      {error && <p className="text-sm text-[var(--color-error)]">{error}</p>}
      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-[var(--radius-sm)] bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {isSubmitting ? 'Verifying…' : 'Verify and continue'}
      </button>
    </form>
  )
}
