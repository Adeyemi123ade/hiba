import { createClient } from '@supabase/supabase-js'

const rawUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const rawKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

function findConfigProblem(): string | null {
  // Name exactly which setting is missing, and where to set it on this computer or on the host.
  if (!rawUrl || !rawKey) {
    const missing = [!rawUrl && 'VITE_SUPABASE_URL', !rawKey && 'VITE_SUPABASE_ANON_KEY'].filter(Boolean).join(' and ')
    return import.meta.env.DEV
      ? `${missing} is missing. Put it in the file .env.local in the project root, then stop and restart "npm run dev".`
      : `${missing} is missing from this deployment. On Vercel: Settings, Environment Variables, add it for Production, then Redeploy.`
  }
  try {
    new URL(rawUrl)
  } catch {
    return 'VITE_SUPABASE_URL is not a valid URL. It must look like https://xxxx.supabase.co with no quotes or spaces.'
  }
  return null
}

export const configProblem = findConfigProblem()
export const isSupabaseConfigured = configProblem === null

// Only the public anon key belongs in the browser. Access control is enforced by
// Row Level Security in Postgres. NEVER put the service_role key in a VITE_ variable.
// Placeholder values keep the module from crashing when config is bad; App shows the problem.
export const supabase = createClient(
  isSupabaseConfigured ? (rawUrl as string) : 'https://placeholder.supabase.co',
  isSupabaseConfigured ? (rawKey as string) : 'placeholder-anon-key',
)
