import { supabase } from '@/lib/supabase'
import type { Answers } from '@/features/onboarding/steps'

export interface Profile {
  id: string
  preferred_name: string | null
  onboarding: Answers
  onboarding_completed: boolean
}

// Row Level Security guarantees these only ever touch the signed-in user's own row.
export async function fetchMyProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, preferred_name, onboarding, onboarding_completed')
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
