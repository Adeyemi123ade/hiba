import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { SessionContext, type SessionState } from '@/features/auth/use-session'

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ session: null, isLoading: true })

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setState({ session: data.session, isLoading: false }))
    const { data } = supabase.auth.onAuthStateChange((_event, next) =>
      setState({ session: next, isLoading: false }),
    )
    return () => data.subscription.unsubscribe()
  }, [])

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>
}
