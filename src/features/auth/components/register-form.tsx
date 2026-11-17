import { useState } from 'react'
import { normalizeEmail, validateEmail } from '@/lib/email'
import { validatePassword } from '@/lib/password'
import { useOnline } from '@/features/onboarding/use-online'
import { registerWithEmail } from '@/features/auth/api/auth-service'
import { friendlyAuthError } from '@/features/auth/api/auth-errors'
import { TermsCheckbox } from '@/features/legal/terms-checkbox'
import { PasswordField } from '@/features/auth/components/password-field'
import { PasswordHint } from '@/features/auth/components/password-hint'
import { authFieldError, authInput, authLabel, authLink, authPrimary } from '@/features/auth/components/auth-ui'

interface RegisterFormProps {
  initialEmail?: string
  onRegistered: (email: string) => void
}

type Field = 'email' | 'password' | 'confirm'

/** HPD-26: registration, following the owner's design. Each problem is shown beside its field. */
export function RegisterForm({ initialEmail = '', onRegistered }: RegisterFormProps) {
  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [termsError, setTermsError] = useState<string | null>(null)
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const online = useOnline()

  const clear = (field: Field) => setErrors((e) => ({ ...e, [field]: undefined }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const passwordProblem = validatePassword(password)
    const next: Partial<Record<Field, string>> = {
      email: validateEmail(email) ?? undefined,
      // The hint above lists what is missing; only the "too long" case needs its own words.
      password: passwordProblem
        ? passwordProblem.includes('too long') ? passwordProblem : 'Your password needs everything listed above.'
        : undefined,
      confirm: !confirm ? 'Please type your password again.' : confirm !== password ? 'The two passwords do not match.' : undefined,
    }
    setErrors(next)
    const first = (['email', 'password', 'confirm'] as Field[]).find((f) => next[f])
    if (!accepted) setTermsError('Please accept the Terms of Service and Privacy Policy to create an account.')
    if (first) {
      document.getElementById(first === 'confirm' ? 'confirm-password' : first)?.focus()
      return
    }
    if (!accepted) return
    if (!navigator.onLine) {
      setError('You are offline. Your details are kept on this page. Reconnect, then press Create account again.')
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
    <form noValidate onSubmit={handleSubmit} className="flex w-full flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor="email" className={authLabel}>Email address</label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          value={email}
          aria-invalid={Boolean(errors.email) || undefined}
          aria-describedby={errors.email ? 'email-error' : undefined}
          onChange={(e) => { setEmail(e.target.value); clear('email') }}
          className={authInput}
        />
        {errors.email && <p id="email-error" role="alert" className={authFieldError}>{errors.email}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <PasswordField id="password" label="Password" value={password}
          onChange={(v) => { setPassword(v); clear('password') }}
          autoComplete="new-password" describedBy={errors.password ? 'password-rules password-error' : 'password-rules'}
          invalid={Boolean(errors.password)} />
        <PasswordHint id="password-rules" password={password} />
        {errors.password && <p id="password-error" role="alert" className={authFieldError}>{errors.password}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <PasswordField id="confirm-password" label="Confirm password" value={confirm}
          onChange={(v) => { setConfirm(v); clear('confirm') }}
          autoComplete="new-password" describedBy={errors.confirm ? 'confirm-error' : undefined}
          invalid={Boolean(errors.confirm)} />
        {errors.confirm ? (
          <p id="confirm-error" role="alert" className={authFieldError}>{errors.confirm}</p>
        ) : confirm.length > 0 && confirm !== password ? (
          <p className="text-sm text-[var(--color-text-secondary)]">Passwords do not match yet.</p>
        ) : null}
      </div>

      <TermsCheckbox id="accept-terms" checked={accepted} error={termsError} linkClassName={authLink}
        onChange={(v) => { setAccepted(v); if (v) setTermsError(null) }} />

      {error && <p role="alert" className={`${authFieldError} rounded-lg bg-red-50 px-3 py-2`}>{error}</p>}

      <button type="submit" className={authPrimary} disabled={isSubmitting || !online}>
        {isSubmitting ? 'Creating account...' : 'Create account'}
      </button>
    </form>
  )
}
