import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

export type Platform = 'linkedin' | 'x' | 'substack'
export type PostStatus =
  | 'draft' | 'needs_review' | 'approved' | 'scheduled' | 'published' | 'failed' | 'archived'

/** HPD-54: what each status is called on screen. */
export const STATUS_LABELS: Record<PostStatus, string> = {
  draft: 'Draft',
  needs_review: 'Needs review',
  approved: 'Approved',
  scheduled: 'Scheduled',
  published: 'Published',
  failed: 'Failed',
  archived: 'Archived',
}

/** Statuses that still need the person to look at them before anything else happens. */
export const AWAITING_REVIEW: PostStatus[] = ['draft', 'needs_review']

export interface Post {
  id: string
  idea_id: string
  platform: Platform
  title: string | null
  body: string
  status: PostStatus
  scheduled_for: string | null
  failure_reason?: string | null
  updated_at: string
}

export interface IdeaWithPosts {
  id: string
  body: string
  created_at: string
  posts: Post[]
}

export const IDEA_MAX = 2000
export const PLATFORMS: { id: Platform; name: string; limit: number }[] = [
  { id: 'linkedin', name: 'LinkedIn', limit: 3000 },
  { id: 'x', name: 'X thread', limit: 280 },
  { id: 'substack', name: 'Substack', limit: 20000 },
]

const POST_COLUMNS = 'id, idea_id, platform, title, body, status, scheduled_for, failure_reason, updated_at'

/** Plain-language reasons the UI can show. Each maps to one message on screen. */
export type ContentErrorCode =
  | 'offline' | 'session_expired' | 'not_found' | 'rate_limited' | 'not_configured' | 'ai_failed' | 'unknown'

export class ContentError extends Error {
  readonly code: ContentErrorCode
  constructor(code: ContentErrorCode) {
    super(code)
    this.code = code
  }
}

function toContentError(error: { code?: string; status?: number; message?: string } | null): ContentError {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return new ContentError('offline')
  const msg = error?.message?.toLowerCase() ?? ''
  if (error?.status === 401 || error?.code === 'PGRST301' || msg.includes('jwt')) {
    return new ContentError('session_expired')
  }
  if (msg.includes('failed to fetch') || msg.includes('network')) return new ContentError('offline')
  return new ContentError('unknown')
}

/** Clean user text: drop control characters (keep new lines), trim. React escapes output too. */
export function cleanIdea(raw: string): string {
  let out = ''
  for (const ch of raw) {
    const code = ch.charCodeAt(0)
    out += (code < 32 && code !== 10) || code === 127 ? ' ' : ch
  }
  return out.trim()
}

export async function saveIdea(body: string, source: 'typed' | 'voice'): Promise<string> {
  const { data, error } = await supabase.from('ideas').insert({ body, source }).select('id').single()
  if (error || !data) throw toContentError(error)
  return data.id as string
}

export async function generateDrafts(ideaId: string): Promise<Post[]> {
  const { data, error } = await supabase.functions.invoke<{ posts: Post[] }>('generate-drafts', {
    body: { ideaId },
  })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const res = error.context as Response
      let code = ''
      try {
        code = ((await res.json()) as { error?: string }).error ?? ''
      } catch {
        // Body was not JSON; fall through to the status code.
      }
      if (res.status === 401 || code === 'unauthorized') throw new ContentError('session_expired')
      if (code === 'rate_limited') throw new ContentError('rate_limited')
      if (code === 'not_configured') throw new ContentError('not_configured')
      if (code === 'not_found') throw new ContentError('not_found')
      throw new ContentError('ai_failed')
    }
    // Function not deployed yet, network down, or blocked: treat by connectivity.
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new ContentError('offline')
    throw new ContentError('not_configured')
  }
  return data?.posts ?? []
}

export async function fetchIdea(ideaId: string): Promise<IdeaWithPosts> {
  const { data, error } = await supabase
    .from('ideas')
    .select(`id, body, created_at, posts (${POST_COLUMNS})`)
    .eq('id', ideaId)
    .maybeSingle()
  if (error) throw toContentError(error)
  if (!data) throw new ContentError('not_found')
  return data as unknown as IdeaWithPosts
}

/** Posts for the Home screen: everything except archived, newest first. */
export async function fetchHomePosts(): Promise<Post[]> {
  const { data, error } = await supabase
    .from('posts')
    .select(POST_COLUMNS)
    .neq('status', 'archived')
    .order('updated_at', { ascending: false })
    .limit(50)
  if (error) throw toContentError(error)
  return (data ?? []) as Post[]
}

export async function savePostBody(postId: string, title: string | null, body: string): Promise<void> {
  const { error } = await supabase.from('posts').update({ title, body }).eq('id', postId)
  if (error) throw toContentError(error)
}

export async function approvePost(postId: string, title: string | null, body: string): Promise<void> {
  const { error } = await supabase.from('posts').update({ title, body, status: 'approved' }).eq('id', postId)
  if (error) throw toContentError(error)
}

/** One message per error code, in plain words, always saying what to do next. */
export const ERROR_TEXT: Record<ContentErrorCode, string> = {
  offline: 'You are offline. Your idea is kept on this page. Reconnect, then try again.',
  session_expired: 'Your session expired. Your idea is kept on this device. Sign in again to continue.',
  not_found: 'We could not find that idea. It may have been removed.',
  rate_limited: 'You have made a lot of drafts this hour. Please wait a little, then try again.',
  not_configured: 'Drafting is not switched on yet. Your idea is saved. Try again once it is set up.',
  ai_failed: 'We could not write your posts just now. Your idea is saved. Please try again.',
  unknown: 'Something went wrong. Your idea is kept on this page. Please try again.',
}
