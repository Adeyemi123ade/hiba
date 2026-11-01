import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { signInWithPassword } from '@/features/auth/api/auth-service'

interface LoginFormProps {
  onSignedIn: () => void
}

export function LoginForm({ onSignedIn }: LoginFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)
    try {
      await signInWithPassword(email.trim(), password)
      onSignedIn()
    } catch {
      // Same message for every failure so we never reveal which emails have accounts.
      setError('Email or password is incorrect.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const inputClass =
    'rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-2 text-sm'

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="login-email" className="text-sm text-[var(--color-text-primary)]">
          Email address
        </label>
        <input id="login-email" type="email" required autoComplete="email" value={email}
          onChange={(e) => setEmail(e.target.value)} className={inputClass} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="login-password" className="text-sm text-[var(--color-text-primary)]">
          Password
        </label>
        <input id="login-password" type="password" required autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
      </div>
      {error && <p role="alert" className="text-sm text-[var(--color-error)]">{error}</p>}
      <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Signing in…' : 'Sign in'}</Button>
    </form>
  )
}
