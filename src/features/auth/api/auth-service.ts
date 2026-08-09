import { supabase } from '@/lib/supabase'

/**
 * Auth flows — per "Authentication Flow Clarification" (this project's auth spec).
 *
 * Registration: signUp() triggers Supabase to email a 6-digit OTP code, NOT a
 * magic link. This depends on the Supabase project's email template being set
 * to "OTP" (Auth > Email Templates > Confirm signup) rather than the default
 * link template — that's a dashboard config, not something this code controls.
 * Do not swap verifyOtp for a magic-link session callback.
 */

export async function registerWithEmail(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw error
  return data
}

export async function verifyRegistrationOtp(email: string, token: string) {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'signup',
  })
  if (error) throw error
  return data
}

export async function resendRegistrationOtp(email: string) {
  const { error } = await supabase.auth.resend({ type: 'signup', email })
  if (error) throw error
}

export async function signInWithPassword(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

/**
 * Google Sign-In — standard OAuth redirect, no code step in Supabase itself.
 * The "verification code" step for Google users is layered on top here:
 * a brand-new Google sign-in gets emailed a one-time code (same OTP path
 * as email registration) before reaching the dashboard; a returning,
 * already-verified Google user goes straight through. See auth-callback-page.tsx.
 */
export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  })
  if (error) throw error
  return data
}

export function isHibaVerified(user: { user_metadata?: Record<string, unknown> } | null) {
  return Boolean(user?.user_metadata?.hiba_verified)
}

export async function sendPostGoogleOtp(email: string) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  })
  if (error) throw error
}

export async function verifyPostGoogleOtp(email: string, token: string) {
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'email' })
  if (error) throw error
  return data
}

export async function markUserVerified() {
  const { error } = await supabase.auth.updateUser({ data: { hiba_verified: true } })
  if (error) throw error
}
