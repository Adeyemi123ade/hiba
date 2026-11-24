import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import {
  isHibaVerified,
  signedInByEmail,
  sendPostGoogleOtp,
  verifyPostGoogleOtp,
  markUserVerified,
  signOutUser,
} from '@/features/auth/api/auth-service'
import { friendlyAuthError } from '@/features/auth/api/auth-errors'
import { useCooldown } from '@/features/auth/use-cooldown'
import { authInput, authLabel, authPrimary } from '@/features/auth/components/auth-ui'

const RESEND_SECONDS = 60

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
 * Google Sign-In → Select Account → Email check (first-time only: code or link) → Dashboard.
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
  const [sendError, setSendError] = useState<string | null>(null)

  // Runs once per visit: a second run would email a second code.
  const started = useRef(false)

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

      // A failed send (for example, the one-a-minute limit) is not a dead end: the page shows
      // the problem and "Send a new email" works once the timer ends.
      try {
        await sendPostGoogleOtp(user.email)
      } catch (err) {
        setSendError(friendlyAuthError(err, 'We could not send the email. Wait for the timer, then send a new one.'))
      }
      setEmail(user.email)
      setStatus('needs-otp')
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
      <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Check your email</h1>
      <GoogleOtpForm
        email={email}
        sendError={sendError}
        onVerified={() => navigate('/dashboard/home', { replace: true })}
        onUseAnotherAccount={async () => {
          try { await signOutUser() } catch { /* signed out locally anyway */ }
          navigate('/auth', { replace: true })
        }}
      />
    </div>
  )
}

const linkClass = 'self-start font-medium text-[var(--color-primary-dark)] hover:underline disabled:cursor-not-allowed disabled:text-[var(--color-text-secondary)] disabled:no-underline'

/**
 * One step after Google, first time only: prove the email by typing the 6-digit code,
 * or by tapping the link in the same email (opening it in another tab also works: this page notices).
 * "Send a new email" is spaced out by a 60-second timer (Supabase allows one email a minute per address).
 */
function GoogleOtpForm({ email, sendError, onVerified, onUseAnotherAccount }: {
  email: string
  sendError: string | null
  onVerified: () => void
  onUseAnotherAccount: () => void
}) {
  const [code, setCode] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isResending, setIsResending] = useState(false)
  const [error, setError] = useState<string | null>(sendError)
  const [info, setInfo] = useState<string | null>(null)
  const cooldown = useCooldown(RESEND_SECONDS, true)
  // While this tab checks a typed code it finishes the job itself (and saves "verified" first).
  const checkingCode = useRef(false)

  // The link was opened in another tab of this browser: that tab signs in by email and this one follows.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (checkingCode.current) return
      if (session && (isHibaVerified(session.user) || signedInByEmail(session.access_token))) onVerified()
    })
    return () => data.subscription.unsubscribe()
  }, [onVerified])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from the email, or tap the link in it.')
      return
    }
    setIsSubmitting(true)
    checkingCode.current = true
    try {
      await verifyPostGoogleOtp(email, code)
      try { await markUserVerified() } catch { /* not fatal: the step shows again next time */ }
      onVerified()
    } catch (err) {
      checkingCode.current = false
      setError(friendlyAuthError(err, 'That code is wrong or has expired. Try again or send a new email.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleResend() {
    setError(null)
    setInfo(null)
    setIsResending(true)
    try {
      await sendPostGoogleOtp(email)
      setInfo('A new email is on its way. Check your inbox, and your spam and Promotions folders.')
      cooldown.start()
    } catch (err) {
      setError(friendlyAuthError(err, 'We could not send the email. Please try again.'))
      cooldown.start()
    } finally {
      setIsResending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex w-full max-w-sm flex-col gap-3">
      <p className="text-sm text-[var(--color-text-secondary)]">
        This is a one-time check. We sent an email to{' '}
        <span className="font-medium text-[var(--color-text-primary)]">{email}</span>. Tap the link in it, or type the
        6-digit code below. It can take a minute to arrive.
      </p>
      <div className="flex flex-col gap-1">
        <label htmlFor="google-otp" className={authLabel}>Code from the email</label>
        <input
          id="google-otp"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          aria-invalid={Boolean(error) || undefined}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          className={`${authInput} text-center text-xl tracking-[0.4em]`}
        />
      </div>
      {error && <p role="alert" className="text-sm text-[var(--color-error)]">{error}</p>}
      {info && <p role="status" className="text-sm text-[var(--color-success)]">{info}</p>}
      <button type="submit" className={authPrimary} disabled={isSubmitting}>
        {isSubmitting ? 'Checking...' : 'Continue'}
      </button>

      <div className="flex flex-col gap-2 border-t border-[var(--color-border)] pt-4 text-sm">
        <p className="text-[var(--color-text-secondary)]">No email yet?</p>
        <button type="button" onClick={handleResend} disabled={isResending || cooldown.left > 0} className={linkClass}>
          {isResending ? 'Sending...' : cooldown.left > 0 ? `Send a new email in ${cooldown.left}s` : 'Send a new email'}
        </button>
        <button type="button" onClick={onUseAnotherAccount} className={linkClass}>
          Use a different account
        </button>
      </div>
    </form>
  )
}
