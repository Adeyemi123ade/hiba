import { supabase } from '@/lib/supabase'
import { ContentError, invokeDrafting } from '@/features/content/api/content-service'

/** Phase 2: follow-up comments for a LinkedIn post (owner's master prompt, section 10). */
export interface PostComment {
  id: string
  post_id: string
  position: number
  body: string
  included: boolean
  /** draft -> approved -> publishing -> published, or failed. */
  status: 'draft' | 'approved' | 'publishing' | 'published' | 'failed'
  failure_reason?: string | null
  published_at?: string | null
  /** When Hiba's background publisher posts this comment (set once the post is live). */
  due_at?: string | null
  updated_at?: string
}

export const COMMENTS_MIN = 5
export const COMMENTS_MAX = 10
export const COMMENT_MAX_CHARS = 1250

const STATUSES: PostComment['status'][] = ['draft', 'approved', 'publishing', 'published', 'failed']

/**
 * Always shown in the saved order, whatever order the server sends. A comment with no known status
 * (an older drafting function sends none) is treated as a draft, so it can still be approved.
 */
const byPosition = (list: PostComment[]) => [...list]
  .map((c) => ({ ...c, status: STATUSES.includes(c.status) ? c.status : 'draft' as const, included: c.included !== false }))
  .sort((a, b) => a.position - b.position)

function dbError(error: { code?: string; message?: string } | null): ContentError {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return new ContentError('offline')
  const msg = error?.message?.toLowerCase() ?? ''
  if (error?.code === 'PGRST301' || msg.includes('jwt')) return new ContentError('session_expired')
  if (msg.includes('failed to fetch') || msg.includes('network')) return new ContentError('offline')
  return new ContentError('unknown')
}

export async function fetchComments(postId: string): Promise<PostComment[]> {
  const { data, error } = await supabase
    .from('post_comments').select('id, post_id, position, body, included, status, failure_reason, published_at, due_at, updated_at')
    .eq('post_id', postId).order('position', { ascending: true })
  if (error) throw dbError(error)
  return byPosition((data ?? []) as PostComment[])
}

/** After writing, the saved rows are the truth. If reading them fails, what the function sent is used. */
async function savedOr(postId: string, sent: PostComment[]): Promise<PostComment[]> {
  try {
    const saved = await fetchComments(postId)
    return saved.length ? saved : byPosition(sent)
  } catch {
    return byPosition(sent)
  }
}

/**
 * Asks the deployed drafting function what it can do. An out-of-date copy does not know "info"
 * and refuses it, which reads as "not current". Offline and expired sessions still throw.
 * A "yes" is remembered for this visit.
 */
let currentConfirmed = false
export async function draftingFunctionIsCurrent(): Promise<boolean> {
  if (currentConfirmed) return true
  try {
    const info = await invokeDrafting<{ features?: unknown }>({ mode: 'info' })
    const features = Array.isArray(info?.features) ? info.features : []
    currentConfirmed = features.includes('comments') && features.includes('comment-status')
    return currentConfirmed
  } catch (e) {
    if (e instanceof ContentError && (e.code === 'ai_failed' || e.code === 'not_found')) return false
    throw e
  }
}

/** A reply with no list of comments means the server copy does not know how to write them. */
function listFrom(data: { comments?: unknown }): PostComment[] {
  if (!Array.isArray(data?.comments)) throw new ContentError('outdated')
  return data.comments as PostComment[]
}

/** Writes `count` comments for the post. Replaces any earlier comments for it. */
export async function generateComments(ideaId: string, postId: string, count: number): Promise<PostComment[]> {
  const data = await invokeDrafting<{ comments?: unknown }>({ ideaId, mode: 'comments', postId, count: String(count) })
  return savedOr(postId, listFrom(data))
}

/** Writes one comment again, keeping the others. */
export async function rewriteComment(ideaId: string, commentId: string): Promise<PostComment[]> {
  const data = await invokeDrafting<{ comments?: unknown }>({ ideaId, mode: 'comment', commentId })
  const sent = listFrom(data)
  return sent[0]?.post_id ? savedOr(sent[0].post_id, sent) : byPosition(sent)
}

export async function updateComment(id: string, change: Partial<Pick<PostComment, 'body' | 'included' | 'status'>>): Promise<void> {
  const { data, error } = await supabase.from('post_comments').update(change).eq('id', id).select('id')
  if (error) throw dbError(error)
  if (!data?.length) throw new ContentError('not_found')
}

export async function deleteComment(id: string): Promise<void> {
  const { data, error } = await supabase.from('post_comments').delete().eq('id', id).select('id')
  if (error) throw dbError(error)
  if (!data?.length) throw new ContentError('not_found')
}

/** Saves a new order: position 1, 2, 3... in the order given. */
export async function saveOrder(ordered: PostComment[]): Promise<void> {
  for (let i = 0; i < ordered.length; i++) {
    if (ordered[i].position === i + 1) continue
    const { error } = await supabase.from('post_comments').update({ position: i + 1 }).eq('id', ordered[i].id)
    if (error) throw dbError(error)
  }
}

/** Approves comments for posting (or retries failed ones). Only draft or failed comments move. */
export async function approveComments(ids: string[]): Promise<void> {
  if (!ids.length) return
  const { error } = await supabase.from('post_comments').update({ status: 'approved' }).in('id', ids).in('status', ['draft', 'failed'])
  if (error) throw dbError(error)
}

/** Takes approval back from comments that are not posted yet. */
export async function withdrawApproval(ids: string[]): Promise<void> {
  if (!ids.length) return
  const { error } = await supabase.from('post_comments').update({ status: 'draft' }).in('id', ids).eq('status', 'approved')
  if (error) throw dbError(error)
}

/**
 * Hands the approved comments of a live post to Hiba's background publisher, 15 to 60 seconds apart.
 * They are then posted by the server, even if this page, the browser or the laptop is closed.
 */
export async function queueComments(postId: string): Promise<number> {
  const { data, error } = await supabase.rpc('queue_post_comments', { p_post_id: postId })
  if (error) throw dbError(error)
  return Number(data) || 0
}
