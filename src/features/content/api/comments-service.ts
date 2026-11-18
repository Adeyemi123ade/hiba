import { supabase } from '@/lib/supabase'
import { ContentError, invokeDrafting } from '@/features/content/api/content-service'

/** Phase 2: follow-up comments for a LinkedIn post (owner's master prompt, section 10). */
export interface PostComment {
  id: string
  post_id: string
  position: number
  body: string
  included: boolean
  updated_at?: string
}

export const COMMENTS_MIN = 5
export const COMMENTS_MAX = 10
export const COMMENT_MAX_CHARS = 1250

/** Always shown in the saved order, whatever order the server sends. */
const byPosition = (list: PostComment[]) => [...list].sort((a, b) => a.position - b.position)

function dbError(error: { code?: string; message?: string } | null): ContentError {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return new ContentError('offline')
  const msg = error?.message?.toLowerCase() ?? ''
  if (error?.code === 'PGRST301' || msg.includes('jwt')) return new ContentError('session_expired')
  if (msg.includes('failed to fetch') || msg.includes('network')) return new ContentError('offline')
  return new ContentError('unknown')
}

export async function fetchComments(postId: string): Promise<PostComment[]> {
  const { data, error } = await supabase
    .from('post_comments').select('id, post_id, position, body, included, updated_at')
    .eq('post_id', postId).order('position', { ascending: true })
  if (error) throw dbError(error)
  return (data ?? []) as PostComment[]
}

/** Writes `count` comments for the post. Replaces any earlier comments for it. */
export async function generateComments(ideaId: string, postId: string, count: number): Promise<PostComment[]> {
  const data = await invokeDrafting<{ comments: PostComment[] }>({ ideaId, mode: 'comments', postId, count: String(count) })
  return byPosition(data.comments ?? [])
}

/** Writes one comment again, keeping the others. */
export async function rewriteComment(ideaId: string, commentId: string): Promise<PostComment[]> {
  const data = await invokeDrafting<{ comments: PostComment[] }>({ ideaId, mode: 'comment', commentId })
  return byPosition(data.comments ?? [])
}

export async function updateComment(id: string, change: Partial<Pick<PostComment, 'body' | 'included'>>): Promise<void> {
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
