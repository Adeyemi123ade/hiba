// Supabase Edge Function: Hiba's background publisher (H09-S06, H10). Called every 15 seconds by the
// database (pg_cron, see supabase/sql/publisher_cron.sql). Never called from the browser.
//
// 1. Posts that are due: claimed in the database first (so two runs never post the same one),
//    published to LinkedIn exactly like "Post now", then their approved follow-up comments get due
//    times 15 to 60 seconds apart.
// 2. Comments that are due: the next one of each post, posted as the post's owner.
//
// Safety
// - Verify JWT is OFF (the caller is the database, not a person). Every request must carry the
//   shared secret PUBLISHER_SECRET in the x-publisher-secret header, or nothing happens.
// - Uses the service role, because the owner is not online. It only touches rows that are due.
// - If LinkedIn answers with an error, nothing was posted: the post is tried again later (up to
//   MAX_ATTEMPTS), then marked failed with the reason. If LinkedIn does not answer at all, Hiba
//   cannot tell whether it was posted, so it is marked failed and never retried by itself.
//
// Secrets: PUBLISHER_SECRET, TOKEN_ENCRYPTION_KEY (same as the linkedin function).
// Provided by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  createComment, createPost, decryptToken, encryptionKey, postImages, postTooLong, postUrl, uploadImages,
} from '../_shared/linkedin.ts'

const MAX_ATTEMPTS = 3
/** Waits before trying a post again: 5 minutes, then 15. */
const RETRY_DELAYS_MIN = [5, 15]
/** A claim older than this means a run stopped half way: Hiba cannot tell what happened. */
const STALE_CLAIM_MIN = 10
const POSTS_PER_RUN = 5
const COMMENTS_PER_RUN = 10

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/** Compares secrets without leaking how much of them matched. */
function sameSecret(a: string, b: string) {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

/** The owner's rule: a different random gap of 15 to 60 seconds before each comment. */
function gapsMs(count: number): number[] {
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    let g = 15_000 + Math.floor(Math.random() * 45_001)
    if (i && Math.round(g / 1000) === Math.round(out[i - 1] / 1000)) g = g >= 59_000 ? g - 2_000 : g + 2_000
    out.push(g)
  }
  return out
}

// deno-lint-ignore no-explicit-any
type Db = any

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method' })
  const secret = Deno.env.get('PUBLISHER_SECRET') ?? ''
  if (secret.length < 24 || !sameSecret(req.headers.get('x-publisher-secret') ?? '', secret)) return json(401, { error: 'unauthorized' })
  const key = await encryptionKey()
  if (!key) return json(503, { error: 'not_configured' })

  const db: Db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  await failStaleClaims(db)

  const summary = { posts: 0, comments: 0 }
  const { data: posts, error: postsError } = await db.rpc('claim_due_posts', { max_posts: POSTS_PER_RUN })
  if (postsError) console.error('Claiming posts failed', postsError.message)
  for (const post of posts ?? []) {
    try {
      await publishPost(db, key, post)
      summary.posts++
    } catch (e) {
      // Unexpected error after the claim: leave it claimed; the stale check reports it safely.
      console.error('Publishing post crashed', post.id, e instanceof Error ? e.message : e)
    }
  }

  const { data: comments, error: commentsError } = await db.rpc('claim_due_comments', { max_comments: COMMENTS_PER_RUN })
  if (commentsError) console.error('Claiming comments failed', commentsError.message)
  for (const comment of comments ?? []) {
    try {
      await publishComment(db, key, comment)
      summary.comments++
    } catch (e) {
      console.error('Publishing comment crashed', comment.id, e instanceof Error ? e.message : e)
    }
  }
  return json(200, summary)
})

/** Posts or comments claimed long ago and never finished: say so, never post them again by surprise. */
async function failStaleClaims(db: Db) {
  const before = new Date(Date.now() - STALE_CLAIM_MIN * 60_000).toISOString()
  const reason = 'Hiba stopped while posting this and cannot tell whether it reached LinkedIn. Check your LinkedIn profile before trying again.'
  const { data: stuck } = await db.from('posts').update({ status: 'failed', failure_reason: reason })
    .eq('status', 'scheduled').not('publish_lock', 'is', null).lt('publish_lock', before).select('id, user_id')
  for (const p of stuck ?? []) await logAttempt(db, p.user_id, p.id, null, 'unconfirmed', reason)
  await db.from('post_comments').update({ status: 'failed', failure_reason: reason })
    .eq('status', 'publishing').not('due_at', 'is', null).lt('updated_at', before)
}

async function logAttempt(db: Db, userId: string, postId: string, commentId: string | null, outcome: string, detail?: string) {
  const { error } = await db.from('publish_attempts').insert({
    user_id: userId, post_id: postId, comment_id: commentId, outcome, finished_at: new Date().toISOString(),
    detail: detail ? detail.slice(0, 500) : null,
  })
  if (error) console.error('Logging attempt failed', error.message)
}

/** The owner's LinkedIn access, or a plain reason why there is none. */
async function accessFor(db: Db, key: CryptoKey, userId: string): Promise<{ token: string; memberId: string } | { reason: string }> {
  const { data: conn } = await db.from('linkedin_connections')
    .select('member_id, access_token_enc, expires_at').eq('user_id', userId).maybeSingle()
  if (!conn) return { reason: 'LinkedIn is not connected. Connect it in Settings, then schedule the post again.' }
  if (new Date(conn.expires_at).getTime() <= Date.now()) return { reason: 'Your LinkedIn connection expired. Reconnect it in Settings, then schedule the post again.' }
  const token = await decryptToken(key, conn.access_token_enc)
  if (!token) return { reason: 'Your LinkedIn connection needs renewing. Reconnect it in Settings, then schedule the post again.' }
  return { token, memberId: conn.member_id }
}

// deno-lint-ignore no-explicit-any
async function publishPost(db: Db, key: CryptoKey, post: any) {
  const finish = async (status: 'failed' | 'retry', reason: string) => {
    if (status === 'retry' && post.publish_attempts < MAX_ATTEMPTS) {
      const wait = RETRY_DELAYS_MIN[Math.min(post.publish_attempts - 1, RETRY_DELAYS_MIN.length - 1)]
      await db.from('posts').update({
        publish_lock: null, scheduled_for: new Date(Date.now() + wait * 60_000).toISOString(),
      }).eq('id', post.id).eq('status', 'scheduled')
      await logAttempt(db, post.user_id, post.id, null, 'retry', `${reason} Trying again in ${wait} minutes.`)
      return
    }
    const final = status === 'retry' ? `${reason} Hiba tried ${post.publish_attempts} times.` : reason
    await db.from('posts').update({ status: 'failed', failure_reason: final.slice(0, 500) }).eq('id', post.id).eq('status', 'scheduled')
    await logAttempt(db, post.user_id, post.id, null, 'failed', final)
  }

  const text = String(post.body ?? '').trim()
  if (!text) return finish('failed', 'The post is empty, so nothing was posted.')
  if (postTooLong(text)) return finish('failed', 'The post is longer than 200 words, so nothing was posted. Shorten it and schedule it again.')

  const access = await accessFor(db, key, post.user_id)
  if ('reason' in access) return finish('failed', access.reason)

  const images = postImages(post)
  let media: Record<string, unknown>[] | null = null
  if (images.length) {
    const uploaded = await uploadImages(db, access.token, access.memberId, images)
    if ('error' in uploaded) {
      if (uploaded.error === 'linkedin_expired') return finish('failed', 'LinkedIn refused your connection. Reconnect it in Settings, then schedule the post again.')
      // Nothing was posted yet, so trying again later is safe.
      return finish('retry', `${uploaded.detail ?? 'An image could not be sent to LinkedIn.'} Nothing was posted.`)
    }
    media = uploaded.media
  }

  const result = await createPost(access.token, access.memberId, text, media)
  if (result.kind === 'no_answer') {
    const reason = 'LinkedIn did not answer, so Hiba cannot tell whether your post went out. Check your LinkedIn profile before trying again.'
    await db.from('posts').update({ status: 'failed', failure_reason: reason }).eq('id', post.id).eq('status', 'scheduled')
    await logAttempt(db, post.user_id, post.id, null, 'unconfirmed', reason)
    return
  }
  if (result.kind === 'expired') return finish('failed', 'LinkedIn refused your connection. Reconnect it in Settings, then schedule the post again.')
  if (result.kind === 'forbidden') return finish('failed', 'LinkedIn did not allow this post (403). Nothing was posted.')
  if (result.kind === 'refused') {
    const transient = result.status === 429 || result.status >= 500
    return finish(transient ? 'retry' : 'failed', `LinkedIn did not accept the post (${result.status}). Nothing was posted.`)
  }

  const { error } = await db.from('posts')
    .update({ status: 'published', external_id: result.urn || null, external_url: postUrl(result.urn) }).eq('id', post.id)
  if (error) console.error('Marking post published failed', post.id, error.message)
  await logAttempt(db, post.user_id, post.id, null, 'published', images.length ? `With ${images.length} image(s).` : undefined)

  // Approved follow-up comments: due one after another, 15 to 60 seconds apart.
  const { data: queue } = await db.from('post_comments')
    .select('id').eq('post_id', post.id).eq('status', 'approved').eq('included', true).order('position')
  if (queue?.length) {
    let at = Date.now()
    const gaps = gapsMs(queue.length)
    for (const [i, c] of queue.entries()) {
      at += gaps[i]
      await db.from('post_comments').update({ due_at: new Date(at).toISOString() }).eq('id', c.id).eq('status', 'approved')
    }
  }
}

// deno-lint-ignore no-explicit-any
async function publishComment(db: Db, key: CryptoKey, comment: any) {
  const fail = async (reason: string, outcome: 'failed' | 'unconfirmed' = 'failed') => {
    await db.from('post_comments').update({ status: 'failed', failure_reason: reason.slice(0, 500) }).eq('id', comment.id).eq('status', 'publishing')
    await logAttempt(db, comment.user_id, comment.post_id, comment.id, outcome, reason)
  }
  const { data: post } = await db.from('posts').select('id, status, external_id').eq('id', comment.post_id).maybeSingle()
  if (!post || post.status !== 'published' || !post.external_id) return fail('The post is not live on LinkedIn, so the comment was not posted.')
  const text = String(comment.body ?? '').trim()
  if (!text) return fail('The comment is empty.')

  const access = await accessFor(db, key, comment.user_id)
  if ('reason' in access) return fail(access.reason.replace('schedule the post again', 'approve the comment again'))

  const result = await createComment(access.token, access.memberId, String(post.external_id), text)
  if (result.kind === 'no_answer') return fail('LinkedIn did not answer, so Hiba cannot tell whether this comment was posted. Check your post on LinkedIn before trying again.', 'unconfirmed')
  if (result.kind === 'expired') return fail('LinkedIn refused your connection. Reconnect it in Settings, then approve the comment again.')
  if (result.kind === 'forbidden') return fail('LinkedIn did not allow Hiba to post this comment (403). Copy it and post it yourself.')
  if (result.kind === 'refused') return fail(`LinkedIn did not accept this comment (${result.status}). Nothing was posted.`)

  const { error } = await db.from('post_comments')
    .update({ status: 'published', external_id: result.urn ? result.urn.slice(0, 300) : null }).eq('id', comment.id)
  if (error) console.error('Marking comment published failed', comment.id, error.message)
  await logAttempt(db, comment.user_id, comment.post_id, comment.id, 'published')
}
