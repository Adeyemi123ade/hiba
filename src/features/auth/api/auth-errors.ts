interface AuthLikeError {
  __isAuthError?: boolean
  code?: string
  status?: number
  message?: string
}

/** Turns Supabase auth errors into short, safe messages. Our own Errors pass through. */
export function friendlyAuthError(err: unknown, fallback: string): string {
  const e = (err ?? {}) as AuthLikeError
  if (!e.__isAuthError) return err instanceof Error && err.message ? err.message : fallback

  switch (e.code) {
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Too many attempts. Please wait a minute and try again.'
    case 'otp_expired':
      return 'That code has expired. Request a new one.'
    case 'weak_password':
      return 'That password is too weak. Use at least 8 characters with an uppercase letter, a lowercase letter and a number.'
    case 'same_password':
      return 'Choose a password different from your current one.'
    case 'email_address_invalid':
      return 'That email address is not valid.'
    case 'unexpected_failure':
    case 'smtp_error':
      return 'We could not send the email right now. Please try again shortly.'
  }
  if (e.status === 429) return 'Too many attempts. Please wait a minute and try again.'
  if (e.status && e.status >= 500) return 'The server had a problem. Please try again shortly.'
  return fallback
}
