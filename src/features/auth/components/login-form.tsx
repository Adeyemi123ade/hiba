import { useState } from 'react'
import { normalizeEmail } from '@/lib/email'
import { signInWithPassword } from '@/features/auth/api/auth-service'
import { PasswordField } from '@/features/auth/components/password-field'
import { authInput, authLabel, authPrimary } from '@/features/auth/components/auth-ui'

interface LoginFormProps {
  onSignedIn: () => void
  onForgotPassword: (email: string) => void
  onNeedsVerification: (email: string) => void
}

export function LoginForm({ onSignedIn, onForgotPassword, onNeedsVerification }: LoginFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)
    const cleanEmail = normalizeEmail(email)
    try {
      await signInWithPassword(cleanEmail, password)
      onSignedIn()
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === 'email_not_confirmed') {
        onNeedsVerification(cleanEmail)
      } else if (code === 'over_request_rate_limit') {
        setError('Too many attempts. Please wait a minute and try again.')
      } else {
        // Same message for every other failure so we never reveal which emails have accounts.
        setError('Email or password is incorrect.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-5">
      <div className="flex flex-col gap-1">
        <label htmlFor="login-email" className={authLabel}>
          Email address
        </label>
        <input id="login-email" type="email" required autoComplete="email" value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={authInput} />
      </div>
      <PasswordField id="login-password" label="Password" value={password} onChange={setPassword}
        autoComplete="current-password" />
      <button type="button" onClick={() => onForgotPassword(normalizeEmail(email))}
        className="self-end text-sm text-[var(--color-primary-dark)] hover:underline">
        Forgot password?
      </button>
      {error && <p role="alert" className="text-sm text-[var(--color-error)]">{error}</p>}
      <button type="submit" className={authPrimary} disabled={isSubmitting}>{isSubmitting ? 'Signing in...' : 'Sign in'}</button>
    </form>
  )
}
