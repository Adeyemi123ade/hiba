import { useState } from 'react'
import { normalizeEmail, validateEmail } from '@/lib/email'
import { requestPasswordReset } from '@/features/auth/api/auth-service'
import { friendlyAuthError } from '@/features/auth/api/auth-errors'
import { authInput, authLabel, authPrimary } from '@/features/auth/components/auth-ui'

interface ForgotPasswordFormProps {
  initialEmail?: string
  onSent: (email: string) => void
}

export function ForgotPasswordForm({ initialEmail = '', onSent }: ForgotPasswordFormProps) {
  const [email, setEmail] = useState(initialEmail)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const problem = validateEmail(email)
    if (problem) return setError(problem)
    const clean = normalizeEmail(email)
    setIsSubmitting(true)
    try {
      await requestPasswordReset(clean)
      onSent(clean)
    } catch (err) {
      setError(friendlyAuthError(err, 'Could not send the reset code. Please try again.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex w-full flex-col gap-5">
      <p className="text-sm text-[var(--color-text-secondary)]">
        Enter your account email and we will send you a code to reset your password.
      </p>
      <div className="flex flex-col gap-1">
        <label htmlFor="forgot-email" className={authLabel}>Email address</label>
        <input id="forgot-email" type="email" required autoComplete="email" value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={authInput} />
      </div>
      {error && <p role="alert" className="text-sm text-[var(--color-error)]">{error}</p>}
      <button type="submit" className={authPrimary} disabled={isSubmitting}>{isSubmitting ? 'Sending...' : 'Send reset code'}</button>
    </form>
  )
}
