import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { signInWithGoogle } from '@/features/auth/api/auth-service'

export function GoogleSignInButton() {
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setError(null)
    try {
      await signInWithGoogle()
      // Supabase redirects to Google here; execution resumes at /auth/callback.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed.')
    }
  }

  return (
    <div className="flex w-full max-w-sm flex-col gap-2">
      <Button type="button" variant="ghost" onClick={handleClick}>
        Continue with Google
      </Button>
      {error && <p className="text-sm text-[var(--color-error)]">{error}</p>}
    </div>
  )
}
