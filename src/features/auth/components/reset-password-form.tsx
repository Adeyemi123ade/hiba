import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { validatePassword } from '@/lib/password'
import {
  requestPasswordReset,
  setNewPassword,
  signOutUser,
  verifyRecoveryCode,
} from '@/features/auth/api/auth-service'
import { friendlyAuthError } from '@/features/auth/api/auth-errors'
import { useCooldown } from '@/features/auth/use-cooldown'
import { PasswordField } from '@/features/auth/components/password-field'
import { PasswordRequirements } from '@/features/auth/components/password-requirements'

interface ResetPasswordFormProps {
  email: string
  onDone: () => void
  onChangeEmail: () => void
  onBackToSignIn: () => void
}

const linkClass = 'text-[var(--color-primary-dark)] hover:underline'

export function ResetPasswordForm({ email, onDone, onChangeEmail, onBackToSignIn }: ResetPasswordFormProps) {
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [codeAccepted, setCodeAccepted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isResending, setIsResending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const cooldown = useCooldown(30, true)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    const problem =
      (!codeAccepted && !/^\d{6}$/.test(code) ? 'Enter the 6-digit code from your email.' : null) ??
      validatePassword(password) ??
      (confirm !== password ? 'The two passwords do not match.' : null)
    if (problem) return setError(problem)

    setIsSubmitting(true)
    try {
      if (!codeAccepted) {
        await verifyRecoveryCode(email, code)
        setCodeAccepted(true)
      }
      await setNewPassword(password)
      await signOutUser()
      onDone()
    } catch (err) {
      setError(friendlyAuthError(err, 'Could not reset the password. Check the code and try again.'))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleResend() {
    setError(null)
    setInfo(null)
    setIsResending(true)
    try {
      await requestPasswordReset(email)
      setInfo('A new code is on its way. Check your inbox and spam folder.')
      cooldown.start()
    } catch (err) {
      setError(friendlyAuthError(err, 'Could not resend the code. Please try again.'))
    } finally {
      setIsResending(false)
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <p className="text-sm text-[var(--color-text-secondary)]">
        If an account exists for <span className="font-medium text-[var(--color-text-primary)]">{email}</span>, we sent it a 6-digit code.
      </p>
      {!codeAccepted && (
        <div className="flex flex-col gap-1">
          <label htmlFor="reset-code" className="text-sm text-[var(--color-text-primary)]">Reset code</label>
          <input id="reset-code" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2 text-lg tracking-[0.4em]" />
        </div>
      )}
      <PasswordField id="new-password" label="New password" value={password} onChange={setPassword}
        autoComplete="new-password" describedBy="new-password-rules" />
      <PasswordRequirements id="new-password-rules" password={password} />
      <PasswordField id="confirm-new-password" label="Confirm new password" value={confirm}
        onChange={setConfirm} autoComplete="new-password" />
      {error && <p role="alert" className="text-sm text-[var(--color-error)]">{error}</p>}
      {info && <p role="status" className="text-sm text-[var(--color-success)]">{info}</p>}
      <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving...' : 'Reset password'}</Button>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--color-border)] pt-4 text-sm">
        <button type="button" onClick={handleResend} disabled={isResending || cooldown.left > 0}
          className={`${linkClass} disabled:text-[var(--color-text-secondary)] disabled:no-underline`}>
          {cooldown.left > 0 ? `Resend code in ${cooldown.left}s` : isResending ? 'Sending...' : 'Resend code'}
        </button>
        <button type="button" onClick={onChangeEmail} className={linkClass}>Change email address</button>
        <button type="button" onClick={onBackToSignIn} className={linkClass}>Back to sign in</button>
      </div>
    </form>
  )
}
