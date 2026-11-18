import { supabase } from '@/lib/supabase'
import { ContentError, type Platform, type Post, type PostStatus } from '@/features/content/api/content-service'
import { IMAGE_BUCKET } from '@/features/content/api/image-service'

export const PAGE_SIZE = 20
export const SEARCH_MAX = 200

/** One row in the Posts library: a post plus the idea it came from. */
export interface LibraryPost extends Post {
  created_at: string
  idea_body: string
}

export type StatusFilter = 'all' | 'review' | 'approved' | 'scheduled' | 'published' | 'failed' | 'archived'

/** HPD-55: status filters. "All" leaves out archived posts; they have their own filter. */
export const STATUS_FILTERS: { id: StatusFilter; label: string; statuses: PostStatus[] }[] = [
  { id: 'all', label: 'All', statuses: ['draft', 'needs_review', 'approved', 'scheduled', 'published', 'failed'] },
  { id: 'review', label: 'Waiting for review', statuses: ['draft', 'needs_review'] },
  { id: 'approved', label: 'Approved', statuses: ['approved'] },
  { id: 'scheduled', label: 'Scheduled', statuses: ['scheduled'] },
  { id: 'published', label: 'Published', statuses: ['published'] },
  { id: 'failed', label: 'Failed', statuses: ['failed'] },
  { id: 'archived', label: 'Archived', statuses: ['archived'] },
]

export const isStatusFilter = (v: string | null): v is StatusFilter => STATUS_FILTERS.some((f) => f.id === v)
export const isPlatform = (v: string | null): v is Platform => v === 'linkedin' || v === 'x' || v === 'substack'

export interface LibraryQuery {
  search: string
  status: StatusFilter
  platform: Platform | null
}

export interface LibraryPage {
  posts: LibraryPost[]
  /** Where the next page starts, or null when there is nothing more. */
  next: { updated: string; id: string } | null
}

/** One page of the person's posts, newest change first. The database only returns their own. */
export async function fetchLibraryPage(q: LibraryQuery, after: LibraryPage['next']): Promise<LibraryPage> {
  const filter = STATUS_FILTERS.find((f) => f.id === q.status) ?? STATUS_FILTERS[0]
  const { data, error } = await supabase.rpc('search_posts', {
    p_query: q.search.trim().slice(0, SEARCH_MAX) || null,
    p_statuses: filter.statuses,
    p_platform: q.platform,
    p_before_updated: after?.updated ?? null,
    p_before_id: after?.id ?? null,
    p_limit: PAGE_SIZE,
  })
  if (error) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new ContentError('offline')
    const msg = error.message?.toLowerCase() ?? ''
    if (error.code === 'PGRST301' || msg.includes('jwt')) throw new ContentError('session_expired')
    if (msg.includes('failed to fetch') || msg.includes('network')) throw new ContentError('offline')
    throw new ContentError('unknown')
  }
  const posts = (data ?? []) as LibraryPost[]
  const last = posts.at(-1)
  return { posts, next: posts.length === PAGE_SIZE && last ? { updated: last.updated_at, id: last.id } : null }
}

/** Private preview links for the images on one page, in a single request. Missing ones are left out. */
export async function imageThumbnails(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {}
  const { data, error } = await supabase.storage.from(IMAGE_BUCKET).createSignedUrls(paths, 60 * 60)
  if (error || !data) return {}
  const out: Record<string, string> = {}
  for (const item of data) if (item.path && item.signedUrl && !item.error) out[item.path] = item.signedUrl
  return out
}
