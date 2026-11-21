interface AuthLikeError {
  __isAuthError?: boolean
  code?: string
  status?: number
  message?: string
}

/** An error whose message was written for the person to read. Only these are shown as they are. */
export class FriendlyError extends Error {}

/** Turns auth errors into short, plain messages. Technical messages are never shown. */
export function friendlyAuthError(err: unknown, fallback: string): string {
  const e = (err ?? {}) as AuthLikeError
  if (!e.__isAuthError) {
    if (err instanceof FriendlyError) return err.message
    if (typeof navigator !== 'undefined' && !navigator.onLine) return 'You are offline. Check your internet connection and try again.'
    if (/failed to fetch|network|load failed/i.test(e.message ?? '')) return 'We could not connect. Check your internet connection and try again.'
    console.error('Auth error', err)
    return fallback
  }

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
  if (e.status && e.status >= 500) return 'This is not available right now. Please try again shortly.'
  return fallback
}
