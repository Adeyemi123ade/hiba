import { supabase } from '@/lib/supabase'
import { TERMS_VERSION } from '@/lib/legal'
import type { Answers } from '@/features/onboarding/steps'

export interface Profile {
  id: string
  preferred_name: string | null
  onboarding: Answers
  onboarding_completed: boolean
  terms_accepted_at: string | null
}

// Row Level Security guarantees these only ever touch the signed-in user's own row.
export async function fetchMyProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, preferred_name, onboarding, onboarding_completed, terms_accepted_at')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  return data as Profile | null
}

export async function saveOnboarding(userId: string, answers: Answers, completed: boolean) {
  const name = typeof answers.preferredName === 'string' ? answers.preferredName : null
  const { error } = await supabase.from('profiles').upsert({
    id: userId,
    preferred_name: name,
    onboarding: answers,
    onboarding_completed: completed,
  })
  if (error) throw error
}

export async function acceptTerms(userId: string) {
  const { error } = await supabase
    .from('profiles')
    .update({ terms_accepted_at: new Date().toISOString(), terms_version: TERMS_VERSION })
    .eq('id', userId)
  if (error) throw error
}
