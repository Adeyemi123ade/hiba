import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'

export interface SessionState {
  session: Session | null
  isLoading: boolean
}

export const SessionContext = createContext<SessionState>({ session: null, isLoading: true })

/** One shared session for the whole app, so every screen agrees on who is signed in. */
export function useSession() {
  return useContext(SessionContext)
}
