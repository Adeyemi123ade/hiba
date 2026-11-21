import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { PLATFORMS, type LimitedAction, type Platform } from '@/features/content/api/content-service'

/** What the person has left today for one action (rolling 24 hours, migration 0019). */
export interface Allowance {
  operation: LimitedAction
  used: number
  per_day: number
  next_at: string | null
}

export const ALLOWANCES_KEY = ['allowances'] as const

/** Today's limits. Empty if they cannot be read (for example before migration 0019): nothing is blocked here. */
export async function fetchAllowances(): Promise<Partial<Record<LimitedAction, Allowance>>> {
  const { data, error } = await supabase.rpc('my_allowances')
  if (error || !Array.isArray(data)) return {}
  const out: Partial<Record<LimitedAction, Allowance>> = {}
  for (const row of data as Allowance[]) out[row.operation] = row
  return out
}

export function useAllowances(enabled = true) {
  return useQuery({ queryKey: ALLOWANCES_KEY, queryFn: fetchAllowances, enabled, staleTime: 30_000 })
}

export const DRAFT_PLATFORMS_KEY = ['draft-platforms'] as const
const ALL: Platform[] = PLATFORMS.map((p) => p.id)

/** The platforms the person writes for by default (Settings). LinkedIn only unless they chose more. */
export async function fetchDraftPlatforms(): Promise<Platform[]> {
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return ['linkedin']
  const { data, error } = await supabase.from('profiles').select('draft_platforms').eq('id', auth.user.id).maybeSingle()
  const saved = !error && Array.isArray(data?.draft_platforms) ? ALL.filter((p) => data.draft_platforms.includes(p)) : []
  return saved.length ? saved : ['linkedin']
}

export async function saveDraftPlatforms(list: Platform[]): Promise<void> {
  const clean = ALL.filter((p) => list.includes(p))
  if (!clean.length) throw new Error('empty')
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) throw new Error('session')
  const { error } = await supabase.from('profiles').update({ draft_platforms: clean }).eq('id', auth.user.id)
  if (error) throw error
}

export function useDraftPlatforms(enabled = true) {
  return useQuery({ queryKey: DRAFT_PLATFORMS_KEY, queryFn: fetchDraftPlatforms, enabled, staleTime: 5 * 60_000 })
}
