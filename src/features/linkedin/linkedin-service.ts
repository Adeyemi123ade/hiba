import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

export interface LinkedInConnection {
  member_id: string
  name: string | null
  picture: string | null
  expires_at: string
  connected_at: string
}

export type LinkedInErrorCode =
  | 'offline' | 'session_expired' | 'not_configured' | 'state_invalid' | 'linkedin_failed' | 'not_connected'
  | 'linkedin_expired' | 'not_approved' | 'already_published' | 'rate_limited' | 'too_long' | 'image_failed' | 'media_failed' | 'cancelled'
  | 'post_not_published' | 'comment_not_allowed' | 'comment_unconfirmed' | 'unknown'

export class LinkedInError extends Error {
  readonly code: LinkedInErrorCode
  /** Only used for "already published", where it is the post's address. Never shown as text. */
  readonly detail?: string
  constructor(code: LinkedInErrorCode, detail?: string) {
    super(code)
    this.code = code
    this.detail = detail
  }
}

/** One plain-language message per problem, always with the next step. */
export const LINKEDIN_ERROR_TEXT: Record<LinkedInErrorCode, string> = {
  offline: 'You are offline. Reconnect to the internet, then try again.',
  session_expired: 'Your session expired. Sign in again, then connect LinkedIn.',
  not_configured: 'Posting to LinkedIn is not available right now. Please try again later.',
  state_invalid: 'That LinkedIn sign in was too old or did not start here. Please press Connect LinkedIn again.',
  linkedin_failed: 'LinkedIn did not accept this just now. Nothing was posted. Please try again in a moment.',
  not_connected: 'Connect your LinkedIn account first.',
  linkedin_expired: 'Your LinkedIn connection has expired. Reconnect LinkedIn, then try again.',
  not_approved: 'Only approved posts can be published. Approve this post first.',
  already_published: 'This post is already on LinkedIn.',
  rate_limited: 'You have posted a lot this hour. Please wait a little before posting again.',
  too_long: 'This post is over the LinkedIn limit of 300 words. Shorten it, then try again.',
  image_failed: 'Your image could not be sent to LinkedIn, so nothing was posted. Try again, or replace the image.',
  media_failed: 'Your video or document could not be sent to LinkedIn, so nothing was posted. Try again, or replace the file.',
  cancelled: 'LinkedIn was not connected because the request was cancelled. You can try again any time.',
  post_not_published: 'Post this to LinkedIn from Hiba first. Approved comments are posted under it after that.',
  comment_not_allowed: 'LinkedIn did not allow Hiba to post this comment. Copy it and post it yourself.',
  comment_unconfirmed: 'LinkedIn did not answer, so Hiba could not confirm whether this comment was posted. Check your post on LinkedIn before trying again.',
  unknown: 'Something went wrong. Please try again.',
}

const RETURN_KEY = 'hiba:linkedin-return'

async function call<T>(body: Record<string, unknown>): Promise<T> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new LinkedInError('offline')
  const { data, error } = await supabase.functions.invoke<T>('linkedin', { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const res = error.context as Response
      let payload: { error?: string; detail?: string } = {}
      try {
        payload = await res.json()
      } catch {
        // not JSON
      }
      const code = payload.error as LinkedInErrorCode | 'unauthorized' | undefined
      if (code === 'unauthorized') throw new LinkedInError('session_expired')
      if (code === 'already_published') throw new LinkedInError(code, payload.detail)
      if (code && code in LINKEDIN_ERROR_TEXT) throw new LinkedInError(code as LinkedInErrorCode)
      console.error('LinkedIn service error', res.status, code, payload.detail)
      throw new LinkedInError('unknown')
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new LinkedInError('offline')
    // The function is not deployed or could not be reached.
    throw new LinkedInError('not_configured')
  }
  return data as T
}

export async function fetchLinkedInConnection(): Promise<LinkedInConnection | null> {
  const { data, error } = await supabase
    .from('linkedin_connections')
    .select('member_id, name, picture, expires_at, connected_at')
    .maybeSingle()
  if (error) throw new LinkedInError(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'unknown')
  return data as LinkedInConnection | null
}

export const isExpired = (c: LinkedInConnection) => new Date(c.expires_at).getTime() <= Date.now()

/** Sends the person to LinkedIn's approval screen; they come back to `returnTo` afterwards. */
export async function startLinkedInConnect(returnTo: string) {
  const { url } = await call<{ url: string }>({ action: 'start', origin: window.location.origin })
  try {
    sessionStorage.setItem(RETURN_KEY, returnTo)
  } catch {
    // storage blocked: they will land on Settings instead
  }
  window.location.assign(url)
}

export function clearLinkedInReturnPath() {
  try {
    sessionStorage.removeItem(RETURN_KEY)
  } catch {
    // ignore
  }
}

export function readLinkedInReturnPath(): string {
  try {
    const path = sessionStorage.getItem(RETURN_KEY)
    // Only ever return to a page inside Hiba.
    if (path && path.startsWith('/dashboard/') && !path.startsWith('//')) return path
  } catch {
    // ignore
  }
  return '/dashboard/settings'
}

export function completeLinkedInConnect(code: string, state: string) {
  return call<{ name: string | null; picture: string | null; expires_at: string }>({ action: 'exchange', code, state })
}

export function disconnectLinkedIn() {
  return call<{ ok: true }>({ action: 'disconnect' })
}

export function publishToLinkedIn(postId: string) {
  return call<{ published: true; url: string | null; warning?: string; image?: boolean; images?: number; attachment?: boolean }>({ action: 'publish', postId })
}

/** Posts ONE approved follow-up comment under the person's published LinkedIn post. */
export async function postLinkedInComment(commentId: string): Promise<void> {
  await call<{ published: boolean }>({ action: 'comment', commentId })
}

/**
 * Checks the LinkedIn function on the server is up to date (it can send images and post comments).
 * An older copy answers "bad request" to this check: then the app must not post, because the old
 * copy would publish the text without the image and could not post comments.
 * Returns true when up to date, false when out of date. Other problems (offline, session) throw.
 */
export async function linkedInFunctionIsCurrent(imageCount = 0, hasAttachment = false): Promise<boolean> {
  try {
    const info = await call<{ version?: number; features?: string[] }>({ action: 'info' })
    const f = info?.features ?? []
    // Several images need a copy that sends them all; an older one would send only the first.
    return f.includes('images') && f.includes('comments') && (imageCount <= 1 || f.includes('multi-image')) && (!hasAttachment || f.includes('media'))
  } catch (e) {
    if (e instanceof LinkedInError && e.code === 'unknown') return false
    throw e
  }
}
