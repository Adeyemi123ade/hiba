import { Navigate, Outlet } from 'react-router-dom'
import { useSession } from '@/features/auth/use-session'
import { useProfile } from '@/features/onboarding/use-profile'
import { Button } from '@/components/ui/button'

function FullScreenMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[var(--color-bg-cream)] px-4 text-center text-[var(--color-text-secondary)]">
      {children}
    </div>
  )
}

// Client-side guard for UX only. Real protection is Row Level Security on the database.
export function RequireAuth() {
  const { session, isLoading } = useSession()
  if (isLoading) return <FullScreenMessage>Loading…</FullScreenMessage>
  if (!session) return <Navigate to="/auth" replace />
  return <Outlet />
}

export function RequireOnboarded() {
  const { session, isLoading: sessionLoading } = useSession()
  const { data, isLoading, isError, refetch } = useProfile(session?.user.id)
  if (sessionLoading || isLoading) return <FullScreenMessage>Loading your workspace…</FullScreenMessage>
  if (isError) {
    return (
      <FullScreenMessage>
        <p>We could not load your profile.</p>
        <Button onClick={() => refetch()}>Try again</Button>
      </FullScreenMessage>
    )
  }
  if (!data?.onboarding_completed) return <Navigate to="/onboarding" replace />
  return <Outlet />
}
