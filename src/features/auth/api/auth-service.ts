import { supabase } from '@/lib/supabase'
import { FriendlyError } from '@/features/auth/api/auth-errors'
import { TERMS_VERSION } from '@/lib/legal'

/**
 * Auth flows — per "Authentication Flow Clarification" (this project's auth spec).
 *
 * Registration: signUp() triggers Supabase to email a 6-digit OTP code, NOT a
 * magic link. This depends on the Supabase project's email template being set
 * to "OTP" (Auth > Email Templates > Confirm signup) rather than the default
 * link template — that's a dashboard config, not something this code controls.
 * Do not swap verifyOtp for a magic-link session callback.
 */

export async function registerWithEmail(
  email: string,
  password: string,
  names: { firstName: string; lastName: string },
) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    // The database copies the names into the profile when the account is created (migration 0012).
    options: { data: { terms_version: TERMS_VERSION, first_name: names.firstName, last_name: names.lastName } },
  })
  if (error) throw error
  // A session straight after sign-up means the server skipped email verification
  // (Supabase "Confirm email" is off). Never let an unverified address through.
  if (data.session) {
    await supabase.auth.signOut()
    // For the owner: turn on "Confirm email" in Supabase Auth settings.
    console.error('Sign-up stopped: email confirmation is switched off in Supabase Auth settings')
    throw new FriendlyError('Sign-up is not available right now. Please try again later.')
  }
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

export async function requestPasswordReset(email: string) {
  // Always succeeds for unknown emails too, so account existence is never revealed.
  const { error } = await supabase.auth.resetPasswordForEmail(email)
  if (error) throw error
}

export async function verifyRecoveryCode(email: string, token: string) {
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'recovery' })
  if (error) throw error
  return data
}

export async function setNewPassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw error
}

export async function signOutUser() {
  await supabase.auth.signOut()
}

export async function signInWithPassword(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

/**
 * Google Sign-In: standard OAuth redirect. Google proves the email, so there is no extra
 * email step (HPD-167, owner 25 Nov 2026). The person lands on /auth/callback and goes in.
 */
export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  })
  if (error) throw error
  return data
}
