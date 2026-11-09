import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { verifyRegistrationOtp, resendRegistrationOtp } from '@/features/auth/api/auth-service'
import { friendlyAuthError } from '@/features/auth/api/auth-errors'
import { useCooldown } from '@/features/auth/use-cooldown'

interface OtpFormProps {
  email: string
  onVerified: () => void
  onChangeEmail?: () => void
  onBackToSignIn?: () => void
  onForgotPassword?: () => void
}

const linkClass = 'text-[var(--color-primary-dark)] hover:underline'

export function OtpForm({ email, onVerified, onChangeEmail, onBackToSignIn, onForgotPassword }: OtpFormProps) {
  const [code, setCode] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isResending, setIsResending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const cooldown = useCooldown(30, true)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your email.')
      return
    }
    setIsSubmitting(true)
    try {
      await verifyRegistrationOtp(email, code)
      onVerified()
    } catch (err) {
      setError(friendlyAuthError(err, 'That code is invalid or has expired. Try again or request a new one.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleResend() {
    setError(null)
    setInfo(null)
    setIsResending(true)
    try {
      await resendRegistrationOtp(email)
      setInfo('A new code is on its way. Check your inbox and spam folder.')
      cooldown.start()
    } catch (err) {
      setError(friendlyAuthError(err, 'Could not resend the code. Please try again.'))
    } finally {
      setIsResending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <p className="text-sm text-[var(--color-text-secondary)]">
        We sent a 6-digit code to <span className="font-medium text-[var(--color-text-primary)]">{email}</span>. It can take a minute to arrive.
      </p>
      <div className="flex flex-col gap-1">
        <label htmlFor="otp" className="text-sm text-[var(--color-text-primary)]">
          Verification code
        </label>
        <input
          id="otp"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2 text-lg tracking-[0.4em]"
        />
      </div>
      {error && <p role="alert" className="text-sm text-[var(--color-error)]">{error}</p>}
      {info && <p role="status" className="text-sm text-[var(--color-success)]">{info}</p>}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Verifying...' : 'Verify and continue'}
      </Button>

      <div className="flex flex-col gap-2 border-t border-[var(--color-border)] pt-4 text-sm">
        <p className="text-[var(--color-text-secondary)]">Did not get the code?</p>
        <button type="button" onClick={handleResend} disabled={isResending || cooldown.left > 0}
          className={`self-start ${linkClass} disabled:text-[var(--color-text-secondary)] disabled:no-underline`}>
          {isResending ? 'Sending...' : cooldown.left > 0 ? `Resend code in ${cooldown.left}s` : 'Resend code'}
        </button>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {onChangeEmail && <button type="button" onClick={onChangeEmail} className={linkClass}>Change email address</button>}
          {onBackToSignIn && <button type="button" onClick={onBackToSignIn} className={linkClass}>Back to sign in</button>}
          {onForgotPassword && <button type="button" onClick={onForgotPassword} className={linkClass}>Forgot password?</button>}
        </div>
        <p className="text-xs text-[var(--color-text-secondary)]">
          If you already have an account with this email, no code is sent. Sign in or reset your password instead.
        </p>
      </div>
    </form>
  )
}
