import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { verifyRegistrationOtp, resendRegistrationOtp } from '@/features/auth/api/auth-service'

interface OtpFormProps {
  email: string
  onVerified: () => void
}

export function OtpForm({ email, onVerified }: OtpFormProps) {
  const [code, setCode] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isResending, setIsResending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resendMessage, setResendMessage] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      await verifyRegistrationOtp(email, code)
      onVerified()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid or expired code. Try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleResend() {
    setError(null)
    setResendMessage(null)
    setIsResending(true)
    try {
      await resendRegistrationOtp(email)
      setResendMessage('A new code was sent to your email.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resend code.')
    } finally {
      setIsResending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <p className="text-sm text-[var(--color-text-secondary)]">
        Enter the code sent to <span className="font-medium">{email}</span>
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
          onChange={(e) => setCode(e.target.value)}
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2 text-sm tracking-widest"
        />
      </div>
      {error && <p className="text-sm text-[var(--color-error)]">{error}</p>}
      {resendMessage && <p className="text-sm text-[var(--color-success)]">{resendMessage}</p>}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Verifying…' : 'Verify and continue'}
      </Button>
      <button
        type="button"
        onClick={handleResend}
        disabled={isResending}
        className="text-sm text-[var(--color-primary)] hover:underline disabled:opacity-50"
      >
        {isResending ? 'Resending…' : 'Resend code'}
      </button>
    </form>
  )
}
