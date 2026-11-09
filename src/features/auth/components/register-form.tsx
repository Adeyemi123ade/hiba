import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { normalizeEmail, validateEmail } from '@/lib/email'
import { validatePassword } from '@/lib/password'
import { registerWithEmail } from '@/features/auth/api/auth-service'
import { friendlyAuthError } from '@/features/auth/api/auth-errors'
import { TermsCheckbox } from '@/features/legal/terms-checkbox'
import { PasswordField } from '@/features/auth/components/password-field'
import { PasswordRequirements } from '@/features/auth/components/password-requirements'

interface RegisterFormProps {
  initialEmail?: string
  onRegistered: (email: string) => void
}

export function RegisterForm({ initialEmail = '', onRegistered }: RegisterFormProps) {
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [termsError, setTermsError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const problem =
      validateEmail(email) ??
      validatePassword(password) ??
      (confirm !== password ? 'The two passwords do not match.' : null)
    if (problem) {
      setError(problem)
      return
    }
    if (!accepted) {
      setTermsError('Please accept the Terms of Service and Privacy Policy to create an account.')
      return
    }
    const cleanEmail = normalizeEmail(email)
    setIsSubmitting(true)
    try {
      await registerWithEmail(cleanEmail, password)
      onRegistered(cleanEmail)
    } catch (err) {
      setError(friendlyAuthError(err, 'Registration failed. Please try again.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm text-[var(--color-text-primary)]">
          Email address
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2 text-sm"
        />
      </div>
      <PasswordField id="password" label="Password" value={password} onChange={setPassword}
        autoComplete="new-password" describedBy="password-rules" />
      <PasswordRequirements id="password-rules" password={password} />
      <PasswordField id="confirm-password" label="Confirm password" value={confirm} onChange={setConfirm}
        autoComplete="new-password" />
      {confirm.length > 0 && confirm !== password && (
        <p className="-mt-2 text-xs text-[var(--color-error)]">Passwords do not match yet.</p>
      )}
      <TermsCheckbox id="accept-terms" checked={accepted} error={termsError}
        onChange={(v) => { setAccepted(v); if (v) setTermsError(null) }} />
      {error && <p role="alert" className="text-sm text-[var(--color-error)]">{error}</p>}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Creating account...' : 'Create account'}
      </Button>
    </form>
  )
}
