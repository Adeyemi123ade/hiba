import { RouterProvider } from 'react-router-dom'
import { QueryProvider } from '@/app/providers/query-provider'
import { router } from '@/app/router'
import { AppErrorBoundary, ConfigErrorScreen } from '@/app/components/app-error-boundary'
import { SessionProvider } from '@/features/auth/session-provider'
import { configProblem } from '@/lib/supabase'

export function App() {
  if (configProblem) return <ConfigErrorScreen message={configProblem} />
  return (
    <AppErrorBoundary>
      <QueryProvider>
        <SessionProvider>
          <RouterProvider router={router} />
        </SessionProvider>
      </QueryProvider>
    </AppErrorBoundary>
  )
}
