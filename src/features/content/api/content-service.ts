import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { IMAGE_BUCKET, imagesOf, type PostImageItem } from '@/features/content/api/image-service'

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
  external_url?: string | null
  image_path?: string | null
  image_alt?: string | null
  /** Every image on the post, in order (the first is also in image_path / image_alt). */
  images?: PostImageItem[] | null
  /** What the post was before it was archived (HPD-57). Only on the Posts page. */
  archived_from?: PostStatus | null
  archived_at?: string | null
  updated_at: string
}

export interface IdeaWithPosts {
  id: string
  body: string
  created_at: string
  posts: Post[]
}

export const IDEA_MAX = 2000
export const PLATFORMS: { id: Platform; name: string; limit: number; maxWords: number }[] = [
  { id: 'linkedin', name: 'LinkedIn', limit: 3000, maxWords: 200 },
  { id: 'x', name: 'X thread', limit: 280, maxWords: 100 },
  { id: 'substack', name: 'Substack', limit: 20000, maxWords: 1500 },
]

export const countWords = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0)

/**
 * Length rules (owner, 17 Nov 2026): LinkedIn at most 200 words, X at most 100 words in total and
 * 280 characters per post (X's own rule), Substack at most 1500 words. `warning` is set when the
 * draft breaks a rule; such a draft cannot be approved until it is shortened.
 */
export function lengthCheck(platform: Platform, body: string): { text: string; warning: string | null } {
  const max = PLATFORMS.find((p) => p.id === platform)?.maxWords ?? Infinity
  const words = countWords(body)
  if (platform === 'x') {
    const parts = body.split(/\n\s*\n/).filter((p) => p.trim())
    const tooLong = parts.filter((p) => p.length > 280).length
    const problems = [
      words > max ? `The thread is ${words} words; the limit is ${max}.` : '',
      tooLong ? `${tooLong} ${tooLong === 1 ? 'post is' : 'posts are'} over 280 characters, which X does not allow.` : '',
    ].filter(Boolean)
    return {
      text: `${parts.length} ${parts.length === 1 ? 'post' : 'posts'} in this thread · ${words} of ${max} words`,
      warning: problems.length ? `${problems.join(' ')} Shorten it before approving.` : null,
    }
  }
  const name = platform === 'linkedin' ? 'LinkedIn' : 'Substack'
  const chars = platform === 'linkedin' ? ` · ${body.length} of 3000 characters` : ''
  return {
    text: `${words} of ${max} words${chars}`,
    warning:
      words > max || (platform === 'linkedin' && body.length > 3000)
        ? `This ${name} post is over the limit of ${max} words. Shorten it before approving.`
        : null,
  }
}

const POST_COLUMNS =
  'id, idea_id, platform, title, body, status, scheduled_for, failure_reason, external_url, image_path, image_alt, images, updated_at'

/** Plain-language reasons the UI can show. Each maps to one message on screen. */
export type ContentErrorCode =
  | 'offline' | 'session_expired' | 'not_found' | 'rate_limited' | 'not_configured' | 'ai_failed' | 'unknown'
  | 'nothing_to_change' | 'needs_clarification' | 'image_delete_failed' | 'outdated' | 'daily_limit' | 'ai_busy'

/** The actions that have a daily limit (migration 0019). */
export type LimitedAction = 'draft' | 'rewrite' | 'angles' | 'comments' | 'comment_rewrite' | 'voice'

export class ContentError extends Error {
  readonly code: ContentErrorCode
  /** Only ever the AI's clarifying question. Technical reasons are never shown to the person. */
  readonly detail: string | null
  /** For daily_limit: which action, and when the next one becomes available. */
  readonly limit: { action: LimitedAction | null; nextAt: string | null } | null
  constructor(code: ContentErrorCode, detail: string | null = null, limit: ContentError['limit'] = null) {
    super(code)
    this.code = code
    this.detail = detail
    this.limit = limit
  }
}

/** The last daily-limit answer, so every screen's message can say when more is available. */
let lastLimit: ContentError['limit'] = null
export const rememberLimit = (limit: ContentError['limit']) => { lastLimit = limit }

const LIMIT_WHAT: Record<LimitedAction, string> = {
  draft: 'new drafts',
  rewrite: 'rewrites',
  angles: 'new angles',
  comments: 'comment sets',
  comment_rewrite: 'comment rewrites',
  voice: 'voice recordings',
}

/** When the next one is available, in the person's own time: "at 14:05" or "tomorrow at 09:10". */
export function whenAvailable(nextAt: string | null | undefined): string {
  const when = nextAt ? new Date(nextAt) : null
  if (!when || Number.isNaN(when.getTime())) return 'tomorrow'
  const time = when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return when.toDateString() === new Date().toDateString() ? `at ${time}` : `tomorrow at ${time}`
}

/** "You have used all of today's new drafts. You can do more at 14:05. Everything you have is saved." */
export function limitMessage(limit: ContentError['limit']): string {
  const what = limit?.action ? LIMIT_WHAT[limit.action] : 'requests for this'
  return `You have used all of today's ${what}. You can do more ${whenAvailable(limit?.nextAt)}. Everything you have is saved.`
}

/** The message for any drafting error: the daily limit one names the time it frees up. */
export function errorMessage(e: ContentError | ContentErrorCode): string {
  if (typeof e !== 'string' && e.code === 'daily_limit') return limitMessage(e.limit)
  return ERROR_TEXT[typeof e === 'string' ? e : e.code]
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

export const GUIDANCE_MAX = 300

/** Calls the drafting function and turns its errors into plain-language codes. */
export async function invokeDrafting<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>('generate-drafts', { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const res = error.context as Response
      let code = ''
      let question = ''
      let limit: ContentError['limit'] = null
      try {
        const payload = (await res.json()) as { error?: string; question?: string; operation?: LimitedAction; nextAt?: string }
        code = payload.error ?? ''
        question = typeof payload.question === 'string' ? payload.question.slice(0, 300) : ''
        if (code === 'daily_limit') limit = { action: payload.operation ?? null, nextAt: payload.nextAt ?? null }
      } catch {
        // Body was not JSON; fall through to the status code.
      }
      if (res.status === 401 || code === 'unauthorized') throw new ContentError('session_expired')
      if (code === 'needs_clarification' && question) throw new ContentError('needs_clarification', question)
      if (code === 'daily_limit') { lastLimit = limit; throw new ContentError('daily_limit', null, limit) }
      if (code === 'rate_limited') throw new ContentError('rate_limited')
      if (code === 'ai_busy') throw new ContentError('ai_busy')
      if (code === 'not_configured') throw new ContentError('not_configured')
      if (code === 'not_found') throw new ContentError('not_found')
      if (code === 'nothing_to_change') throw new ContentError('nothing_to_change')
      // For the developer console only; the person sees a plain sentence.
      console.error('Drafting service error', res.status, code)
      throw new ContentError('ai_failed')
    }
    // Network down, blocked, or the service not reachable.
    console.error('Drafting service not reachable', error)
    if (typeof navigator !== 'undefined' && !navigator.onLine) throw new ContentError('offline')
    throw new ContentError('not_configured')
  }
  if (!data) throw new ContentError('ai_failed')
  return data
}

/**
 * Writes drafts for an idea. With `platform`, only that draft is rewritten (HPD-50),
 * optionally following the person's guidance. With `angleId`, every draft that is not
 * approved yet is written again from that angle (HPD-49). Earlier text is kept as a version.
 */
export async function generateDrafts(
  ideaId: string,
  options?: { platform: Platform; guidance?: string } | { angleId: string } | { platforms: Platform[] },
): Promise<Post[]> {
  const body: Record<string, unknown> = { ideaId }
  if (options && 'angleId' in options) {
    body.angleId = options.angleId
  } else if (options && 'platforms' in options) {
    // New drafts (or adding a platform): only the platforms the person ticked.
    body.platforms = PLATFORMS.map((p) => p.id).filter((id) => options.platforms.includes(id))
  } else if (options) {
    body.platform = options.platform
    const guidance = options.guidance ? cleanIdea(options.guidance).slice(0, GUIDANCE_MAX) : ''
    if (guidance) body.guidance = guidance
  }
  const data = await invokeDrafting<{ posts: Post[] }>(body)
  return data.posts ?? []
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
  rate_limited: 'You have made a lot of requests in the last hour. Please wait a little, then try again. Your idea is saved.',
  not_configured: 'Writing is not available right now. Your idea is saved. Please try again later.',
  ai_failed: 'We could not write your posts this time. Your idea is saved. Please try again.',
  ai_busy: 'Hiba is very busy right now. Your idea is saved. Please try again in a minute.',
  // Names what ran out and when the next one frees up (from the last daily-limit answer).
  get daily_limit() { return limitMessage(lastLimit) },
  unknown: 'Something went wrong. Your idea is kept on this page. Please try again.',
  needs_clarification: 'Before I write, I need to understand your main point a little better. Add a sentence to your idea, then try again.',
  nothing_to_change: 'Every post for this idea is already approved, so there is nothing left to rewrite.',
  image_delete_failed: 'We could not delete the image, so nothing was deleted. Please try again.',
  outdated: 'This part of Hiba is being updated, so nothing was changed. Please try again later.',
}

export interface PostVersion {
  id: string
  post_id: string
  title: string | null
  body: string
  source: 'ai' | 'edit'
  guidance: string | null
  created_at: string
}

/** Every saved version of a post, newest first (HPD-50). */
export async function fetchVersions(postId: string): Promise<PostVersion[]> {
  const { data, error } = await supabase
    .from('post_versions')
    .select('id, post_id, title, body, source, guidance, created_at')
    .eq('post_id', postId)
    .order('created_at', { ascending: false })
    .limit(30)
  if (error) throw toContentError(error)
  return (data ?? []) as PostVersion[]
}

/**
 * Makes an earlier version the current text. If the current text is not already saved as a
 * version (for example the person edited it), it is saved first, so switching never loses work.
 */
export async function restoreVersion(post: Post, version: PostVersion, versions: PostVersion[]): Promise<void> {
  const alreadyKept = versions.some((v) => v.body === post.body && (v.title ?? null) === (post.title ?? null))
  if (post.body.trim() && !alreadyKept) {
    const { error } = await supabase
      .from('post_versions')
      .insert({ post_id: post.id, title: post.title, body: post.body, source: 'edit' })
    if (error) throw toContentError(error)
  }
  await savePostBody(post.id, version.title, version.body)
}

/** HPD-49: the starting angle types, with the name shown on screen. */
export const ANGLE_KINDS = {
  personal_story: 'Personal story',
  practical_lesson: 'Practical lesson',
  common_mistake: 'Common mistake',
  opinion: 'Opinion',
  beginners_guide: "Beginner's guide",
  professional_insight: 'Professional insight',
  audience_question: 'Question for your audience',
  motivational: 'Short motivational post',
} as const
export type AngleKind = keyof typeof ANGLE_KINDS
export type AngleStatus = 'suggested' | 'saved' | 'chosen' | 'discarded'

export interface Angle {
  id: string
  idea_id: string
  kind: AngleKind
  title: string
  summary: string
  status: AngleStatus
  created_at: string
}

const ANGLE_COLUMNS = 'id, idea_id, kind, title, summary, status, created_at'

/** Every angle for one idea, oldest first, including discarded ones (the screen hides those). */
export async function fetchAngles(ideaId: string): Promise<Angle[]> {
  const { data, error } = await supabase
    .from('angles')
    .select(ANGLE_COLUMNS)
    .eq('idea_id', ideaId)
    .order('created_at', { ascending: true })
  if (error) throw toContentError(error)
  return (data ?? []) as Angle[]
}

/** Asks Hiba for new angles (three at a time). Returns every angle for the idea. */
export async function suggestAngles(ideaId: string): Promise<Angle[]> {
  const data = await invokeDrafting<{ angles: Angle[] }>({ ideaId, mode: 'angles' })
  return data.angles ?? []
}

/** Save for later, discard, or bring back an angle. Only the status can change. */
export async function setAngleStatus(angleId: string, status: Exclude<AngleStatus, 'chosen'>): Promise<void> {
  const { error } = await supabase.from('angles').update({ status }).eq('id', angleId)
  if (error) throw toContentError(error)
}

const offlineNow = () => typeof navigator !== 'undefined' && !navigator.onLine

/** HPD-57: hide a post from normal views. It can be restored at any time. */
export async function archivePost(postId: string): Promise<void> {
  if (offlineNow()) throw new ContentError('offline')
  const { data, error } = await supabase.from('posts').update({ status: 'archived' }).eq('id', postId).select('id')
  if (error) throw toContentError(error)
  if (!data?.length) throw new ContentError('not_found')
}

/**
 * Brings an archived post back. The database puts it back to exactly what it was before
 * (for example Published stays Published), whatever is sent. Returns that status.
 */
export async function restorePost(postId: string): Promise<PostStatus> {
  if (offlineNow()) throw new ContentError('offline')
  const { data, error } = await supabase
    .from('posts').update({ status: 'draft' }).eq('id', postId).eq('status', 'archived').select('status')
  if (error) throw toContentError(error)
  if (!data?.length) throw new ContentError('not_found')
  return (data[0] as { status: PostStatus }).status
}

/** Words the person types to confirm a permanent delete. */
export const DELETE_WORD = 'DELETE'

/**
 * HPD-57: deletes an archived post for good, with its versions and image. The image file is
 * removed first: if that fails, nothing is deleted, so no stray copy is ever left behind.
 * If it was the last post from its idea, the database deletes the idea (and its angles) too.
 * Hiba cannot delete anything on LinkedIn: a published post stays there.
 */
export async function deletePostForever(post: Pick<Post, 'id' | 'image_path'>): Promise<void> {
  if (offlineNow()) throw new ContentError('offline')
  // Every image on the post, not only the first one the Posts page knows about.
  const { data: row } = await supabase.from('posts').select('images').eq('id', post.id).maybeSingle()
  const mine = [...new Set([...imagesOf({ images: row?.images as PostImageItem[] | null }).map((i) => i.path), ...(post.image_path ? [post.image_path] : [])])]
  // An image another post also uses stays, so that post keeps it.
  const { data: others } = mine.length
    ? await supabase.from('posts').select('images').neq('id', post.id).not('image_path', 'is', null)
    : { data: [] }
  const shared = new Set(((others ?? []) as { images: PostImageItem[] | null }[]).flatMap((o) => (o.images ?? []).map((i) => i.path)))
  const paths = mine.filter((p) => !shared.has(p))
  if (paths.length) {
    const { error } = await supabase.storage.from(IMAGE_BUCKET).remove(paths)
    if (error) throw offlineNow() ? new ContentError('offline') : new ContentError('image_delete_failed')
    // Their Images library entries go too (before migration 0018 there are none).
    await supabase.from('images').delete().in('path', paths)
  }
  const { data, error } = await supabase.from('posts').delete().eq('id', post.id).eq('status', 'archived').select('id')
  if (error) throw toContentError(error)
  if (!data?.length) throw new ContentError('not_found')
}

/** True when the post was published, so the person can be reassured it stays on LinkedIn. */
export const wasPublished = (post: Pick<Post, 'status' | 'archived_from' | 'external_url'>) =>
  post.status === 'published' || post.archived_from === 'published' || Boolean(post.external_url)
