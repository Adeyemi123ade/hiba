import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown, ArrowUp, CheckCircle2, Copy, Loader2, MessagesSquare, Pause, Pencil, Play, RefreshCw, Square, Trash2,
} from 'lucide-react'
import { clsx } from 'clsx'
import { Card } from '@/components/ui/card'
import { SignInAgainButton } from '@/features/auth/components/sign-in-again-button'
import { ContentError, ERROR_TEXT, type ContentErrorCode, type PostStatus } from '@/features/content/api/content-service'
import {
  COMMENTS_MAX, COMMENTS_MIN, COMMENT_MAX_CHARS, approveComments, draftingFunctionIsCurrent, deleteComment, fetchComments, generateComments,
  randomGapMs, rewriteComment, saveOrder, updateComment, withdrawApproval, type PostComment,
} from '@/features/content/api/comments-service'
import { LINKEDIN_ERROR_TEXT, LinkedInError, postLinkedInComment } from '@/features/linkedin/linkedin-service'

const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-primary-dark)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50'
const outlineBtn =
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-primary)] px-3 py-1.5 text-sm font-semibold text-[var(--color-primary-dark)] disabled:cursor-not-allowed disabled:opacity-50'
const iconBtn =
  'inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-sm font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-40'

const codeOf = (e: unknown): ContentErrorCode => (e instanceof ContentError ? e.code : 'unknown')
function message(code: ContentErrorCode) {
  if (code === 'ai_failed') return 'We could not write the comments just now. Anything you already had is unchanged. Please try again.'
  if (code === 'not_found') return 'That comment or post has changed. Reload the page to see the latest.'
  return ERROR_TEXT[code].replace('Your idea is kept on this page.', 'Your comments are unchanged.')
}

const STATUS_TEXT: Record<PostComment['status'], string> = {
  draft: 'Draft', approved: 'Approved', publishing: 'Posting...', published: 'Posted', failed: 'Failed',
}
const STATUS_TONE: Record<PostComment['status'], string> = {
  draft: 'bg-slate-100 text-slate-700',
  approved: 'bg-[var(--color-primary-soft)] text-[var(--color-primary-dark)]',
  publishing: 'bg-sky-100 text-sky-800',
  published: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-800',
}

const isLocked = (c: PostComment) => c.status === 'publishing' || c.status === 'published'

type Runner = 'idle' | 'waiting' | 'posting' | 'paused' | 'stopped' | 'done'

/**
 * Follow-up comments (owner's master prompt, sections 10 and 11; owner decisions of 19 Nov 2026).
 * Hiba writes 5 to 10 comments of 20 to 50 words. The person edits, deletes, reorders, rewrites,
 * chooses and approves them. Once the post is live on LinkedIn, Hiba posts each approved comment
 * after a different random gap of 15 to 60 seconds. The person can pause, resume or stop at any time,
 * sees the next comment and its countdown, and sees what was posted and what failed. A failed comment
 * stops the sequence (never skipped silently) and can be retried. Posting runs while this page is open.
 */
export function CommentsPanel({ ideaId, postId, online, enabled, postStatus, postUrl }: {
  ideaId: string
  postId: string
  online: boolean
  enabled: boolean
  postStatus: PostStatus
  postUrl?: string | null
}) {
  const queryClient = useQueryClient()
  const key = ['comments', postId]
  const query = useQuery({ queryKey: key, queryFn: () => fetchComments(postId), enabled, retry: 1 })
  // Is the writing service on the server new enough to write comments? Asked once per visit.
  const fnCheck = useQuery({ queryKey: ['drafting-function-current'], queryFn: draftingFunctionIsCurrent, enabled, retry: false, staleTime: Infinity })
  const outdated = fnCheck.data === false
  const [count, setCount] = useState(COMMENTS_MIN)
  const [working, setWorking] = useState<'all' | string | null>(null)
  const [slow, setSlow] = useState(false)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [confirmStop, setConfirmStop] = useState(false)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [error, setError] = useState<ContentErrorCode | null>(null)
  // The server's plain reason for the last failure, shown under the message.
  const [errorDetail, setErrorDetail] = useState<string | null>(null)
  const [postError, setPostError] = useState<{ text: string; session?: boolean } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [runner, setRunner] = useState<Runner>('idle')
  const [nextAt, setNextAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const lastGap = useRef<number | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevStatus = useRef(postStatus)
  const resumedOnLoad = useRef(false)

  const comments = query.data ?? []
  // Comments with a due time belong to Hiba's background publisher (scheduled posts); this page leaves them alone.
  const browserQueued = (c: PostComment) => c.included && c.status === 'approved' && !c.due_at
  const queue = comments.filter(browserQueued)
  const serverQueued = comments.filter((c) => c.included && c.status === 'approved' && c.due_at).length
  const published = postStatus === 'published'
  const anyLocked = comments.some(isLocked)

  const refresh = useCallback(async () => {
    const fresh = await fetchComments(postId)
    queryClient.setQueryData(key, fresh)
    return fresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, queryClient])

  const schedule = useCallback(() => {
    const gap = randomGapMs(lastGap.current)
    lastGap.current = gap
    const start = Date.now()
    // Refresh the clock used by the countdown, so it never shows a stale number of seconds.
    setNow(start)
    setNextAt(start + gap)
    setRunner('waiting')
  }, [])

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  // Countdown display.
  useEffect(() => {
    if (runner !== 'waiting') return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [runner])

  // Leaving with the sequence running: the browser asks first (posting needs this page open).
  useEffect(() => {
    if (runner !== 'waiting' && runner !== 'posting') return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [runner])

  useEffect(() => () => clearTimer(), [])

  // The post was just published from this page and comments are approved: start automatically.
  useEffect(() => {
    if (prevStatus.current !== 'published' && postStatus === 'published' && queue.length && runner === 'idle') {
      setNotice('Your post is live. Approved comments will now be posted under it, one by one.')
      schedule()
    }
    prevStatus.current = postStatus
  }, [postStatus, queue.length, runner, schedule])

  // Opening the page later with approved comments still waiting: offer to resume, never start by surprise.
  useEffect(() => {
    if (resumedOnLoad.current || !query.isSuccess) return
    resumedOnLoad.current = true
    if (published && queue.length && runner === 'idle') setRunner('paused')
  }, [query.isSuccess, published, queue.length, runner])

  const postNext = useCallback(async () => {
    const current = (queryClient.getQueryData<PostComment[]>(key) ?? []).filter(browserQueued)
    const next = current[0]
    if (!next) { setRunner('done'); setNextAt(null); return }
    setRunner('posting')
    setNextAt(null)
    setPostError(null)
    try {
      await postLinkedInComment(next.id)
      const fresh = await refresh()
      if (fresh.some(browserQueued)) schedule()
      else { setRunner('done'); setNotice('All approved comments are posted on LinkedIn.') }
    } catch (e) {
      // Never skip a failed comment: stop here and say exactly what happened.
      const err = e instanceof LinkedInError ? e : null
      setNotice(null)
      setPostError({
        text: err?.detail || (err ? LINKEDIN_ERROR_TEXT[err.code] : 'Something went wrong while posting the comment.'),
        session: err?.code === 'session_expired',
      })
      setRunner('paused')
      await refresh().catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, refresh, schedule])

  // When the countdown ends, post the next comment.
  useEffect(() => {
    clearTimer()
    if (runner !== 'waiting' || nextAt === null) return
    timer.current = setTimeout(() => { void postNext() }, Math.max(0, nextAt - Date.now()))
    return clearTimer
  }, [runner, nextAt, postNext])

  useEffect(() => {
    setSlow(false)
    if (!working) return
    const t = setTimeout(() => setSlow(true), 10_000)
    return () => clearTimeout(t)
  }, [working])

  if (!enabled) {
    return (
      <Card>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-[var(--color-text-primary)]">
          <MessagesSquare size={20} aria-hidden="true" /> Follow-up comments
        </h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Follow-up comments are switched off. You can switch them on in <Link to="/dashboard/settings" className="font-semibold underline">Settings</Link>.
        </p>
      </Card>
    )
  }

  const sequenceActive = runner === 'waiting' || runner === 'posting'
  const busy = working !== null || editing !== null || sequenceActive

  async function run(task: () => Promise<void>, id: 'all' | string, done?: string) {
    setWorking(id)
    setError(null)
    setNotice(null)
    try {
      await task()
      if (done) setNotice(done)
    } catch (e) {
      setError(codeOf(e))
      setErrorDetail(e instanceof ContentError ? e.detail : null)
      await queryClient.invalidateQueries({ queryKey: key })
    } finally {
      setWorking(null)
    }
  }

  const writeAll = () => {
    setConfirmReplace(false)
    return run(async () => {
      queryClient.setQueryData(key, await generateComments(ideaId, postId, count))
      setRunner('idle')
    }, 'all', 'Your comments are ready. Read each one, edit anything, untick any you do not want, then approve them.')
  }

  const rewriteOne = (c: PostComment) => run(async () => {
    queryClient.setQueryData(key, await rewriteComment(ideaId, c.id))
  }, c.id, `Comment ${c.position} was written again. Approve it again if you want it posted.`)

  const toggle = (c: PostComment) => run(async () => {
    queryClient.setQueryData<PostComment[]>(key, (list) => list?.map((x) => (x.id === c.id ? { ...x, included: !c.included } : x)))
    await updateComment(c.id, { included: !c.included })
  }, c.id)

  const remove = (c: PostComment) => {
    setConfirmDelete(null)
    return run(async () => {
      await deleteComment(c.id)
      const rest = comments.filter((x) => x.id !== c.id)
      await saveOrder(rest)
      queryClient.setQueryData(key, rest.map((x, i) => ({ ...x, position: i + 1 })))
    }, c.id, 'Comment deleted.')
  }

  const move = (index: number, by: -1 | 1) => run(async () => {
    const next = [...comments]
    const [item] = next.splice(index, 1)
    next.splice(index + by, 0, item)
    queryClient.setQueryData(key, next.map((x, i) => ({ ...x, position: i + 1 })))
    await saveOrder(next)
  }, comments[index].id)

  async function saveEdit() {
    if (!editing) return
    const text = editing.text.trim()
    if (!text) return setEditError('A comment cannot be empty. Delete it instead if you do not want it.')
    if (text.length > COMMENT_MAX_CHARS) return setEditError(`Please keep a comment under ${COMMENT_MAX_CHARS} characters.`)
    setEditError(null)
    const id = editing.id
    await run(async () => {
      await updateComment(id, { body: text })
      await refresh()
      setEditing(null)
    }, id, 'Comment saved. If it was approved, approve it again to post it.')
  }

  // Approve every ticked draft (and any failed ones, which retries them). If the post is already
  // live, posting starts straight away (owner: "post automatically once I approve").
  const approve = () => run(async () => {
    const ids = comments.filter((c) => c.included && c.status === 'draft').map((c) => c.id)
    await approveComments(ids)
    await refresh()
    setPostError(null)
    if (published) schedule()
  }, 'all', published
    ? 'Approved. Hiba is posting them under your LinkedIn post, one by one. Keep this page open.'
    : postStatus === 'scheduled'
      ? 'Approved. Hiba posts these under your post automatically after it goes live. You do not need to keep this page open.'
      : 'Approved. When you post this to LinkedIn from Hiba, these comments are posted under it automatically, one by one. Keep this page open after posting.')

  const withdraw = () => run(async () => {
    clearTimer()
    setRunner('idle')
    setNextAt(null)
    await withdrawApproval(queue.map((c) => c.id))
    await refresh()
  }, 'all', 'Approval taken back. Nothing more will be posted.')

  const pause = () => { clearTimer(); setNextAt(null); setRunner('paused'); setNotice('Paused. Nothing more is posted until you resume.') }
  const resume = () => { setPostError(null); setNotice(null); schedule() }
  const stop = () => {
    setConfirmStop(false)
    clearTimer()
    setNextAt(null)
    return run(async () => {
      await withdrawApproval(queue.map((c) => c.id))
      await refresh()
      setRunner('stopped')
    }, 'all', 'Stopped. The remaining comments were not posted and are back to draft.')
  }

  const retry = (c: PostComment) => run(async () => {
    await approveComments([c.id])
    await refresh()
    setPostError(null)
    if (published) schedule()
  }, c.id)

  async function copy(c: PostComment) {
    try {
      await navigator.clipboard.writeText(c.body)
      setCopied(c.id)
    } catch {
      setPostError({ text: 'Your browser blocked copying. Select the comment text and copy it yourself.' })
    }
  }

  // Failed comments are retried with their own "Try posting again" button, not here.
  const draftsToApprove = comments.filter((c) => c.included && c.status === 'draft').length
  const postedCount = comments.filter((c) => c.status === 'published').length
  const used = comments.filter((c) => c.included).length
  const nextComment = queue[0]
  const secondsLeft = nextAt ? Math.max(0, Math.ceil((nextAt - now) / 1000)) : 0

  const countPicker = (
    <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
      How many
      <select value={count} onChange={(e) => setCount(Number(e.target.value))} disabled={busy}
        className="h-9 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] px-2">
        {Array.from({ length: COMMENTS_MAX - COMMENTS_MIN + 1 }, (_, i) => COMMENTS_MIN + i).map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </label>
  )

  return (
    <Card aria-labelledby="comments-title">
      <h2 id="comments-title" className="flex items-center gap-2 text-lg font-semibold text-[var(--color-text-primary)]">
        <MessagesSquare size={20} aria-hidden="true" /> Follow-up comments
      </h2>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
        Short comments (20 to 50 words) that Hiba posts under your own LinkedIn post, so the conversation goes deeper.
        Only comments you approve are posted, one by one, 15 to 60 seconds apart, after your post is live.
        {postStatus === 'scheduled' ? ' For a scheduled post, Hiba posts them by itself, even if you are offline.' : ' Keep this page open while they post.'}
      </p>
      {serverQueued > 0 && published && (
        <p role="status" className="mt-2 rounded-[var(--radius-sm)] bg-sky-50 px-2 py-1.5 text-sm text-sky-900">
          Hiba is posting {serverQueued === 1 ? 'the last approved comment' : `${serverQueued} approved comments`} under your post automatically, 15 to 60 seconds apart.
        </p>
      )}

      {!online && <p role="status" className="mt-3 text-sm text-amber-800">You are offline. Your comments are shown, but changes and posting need a connection.</p>}
      {outdated && (
        <div role="alert" className="mt-3 rounded-[var(--radius-sm)] bg-red-50 p-3 text-sm text-red-800">
          <p className="font-semibold">Hiba cannot write comments yet: its writing service on the server is out of date.</p>
          <p className="mt-1">To fix it, redeploy the <span className="font-mono">generate-drafts</span> function in Supabase (Verify JWT on), then reload this page. Comments you already have are still shown below and can still be approved and posted.</p>
        </div>
      )}

      {query.isPending && (
        <div className="mt-4 space-y-3" role="status" aria-label="Loading comments">
          {[0, 1].map((i) => <div key={i} className="h-14 animate-pulse rounded-[var(--radius-md)] bg-[var(--color-border)]" />)}
        </div>
      )}
      {query.isError && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          We could not load your comments.{' '}
          <button type="button" className="font-semibold underline" onClick={() => query.refetch()}>Try again</button>
        </p>
      )}

      {query.isSuccess && comments.length === 0 && working !== 'all' && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {countPicker}
          <button type="button" className={primaryBtn} onClick={writeAll} disabled={!online || busy || outdated}>Write follow-up comments</button>
        </div>
      )}

      {working === 'all' && (
        <p role="status" className="mt-4 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          {slow ? 'Still working. Your connection seems slow, please keep this page open.' : 'Working...'}
        </p>
      )}

      {/* Posting sequence status and controls */}
      {comments.length > 0 && (sequenceActive || runner === 'paused' || queue.length > 0 || postedCount > 0) && (
        <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-light-green)] p-3 text-sm" aria-live="polite">
          <p className="font-semibold text-[var(--color-text-primary)]">
            {postedCount} posted · {queue.length} approved and waiting
          </p>
          {runner === 'waiting' && nextComment && (
            <p className="mt-1 text-[var(--color-text-primary)]">Comment {nextComment.position} will be posted in {secondsLeft} seconds.</p>
          )}
          {runner === 'posting' && (
            <p className="mt-1 flex items-center gap-2 text-[var(--color-text-primary)]"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Posting a comment to LinkedIn...</p>
          )}
          {runner === 'paused' && queue.length > 0 && (
            <p className="mt-1 text-[var(--color-text-primary)]">
              {published ? 'Paused. The approved comments are not posted until you resume.' : 'Waiting for your post to go live on LinkedIn.'}
            </p>
          )}
          {!published && queue.length > 0 && runner !== 'paused' && (
            <p className="mt-1 text-[var(--color-text-primary)]">These are posted automatically after you post this to LinkedIn from Hiba.</p>
          )}
          {(runner === 'done' || (postedCount > 0 && !sequenceActive)) && postUrl && (
            <p className="mt-1"><a href={postUrl} target="_blank" rel="noopener noreferrer" className="font-semibold underline">See your post and comments on LinkedIn</a></p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {sequenceActive && <button type="button" className={outlineBtn} onClick={pause} disabled={runner === 'posting'}><Pause size={14} aria-hidden="true" /> Pause</button>}
            {runner === 'paused' && published && queue.length > 0 && (
              <button type="button" className={outlineBtn} onClick={resume} disabled={!online}><Play size={14} aria-hidden="true" /> Resume posting</button>
            )}
            {queue.length > 0 && (confirmStop ? (
              <span className="flex flex-wrap items-center gap-2">
                {sequenceActive || runner === 'paused' ? 'Stop and keep the rest as drafts?' : 'Take back approval? Nothing will be posted.'}
                <button type="button" className={outlineBtn} onClick={() => { setConfirmStop(false); void (sequenceActive || runner === 'paused' ? stop() : withdraw()) }} disabled={runner === 'posting'}>
                  {sequenceActive || runner === 'paused' ? 'Yes, stop' : 'Yes, take it back'}
                </button>
                <button type="button" className="font-semibold underline" onClick={() => setConfirmStop(false)}>Keep going</button>
              </span>
            ) : (
              <button type="button" className={outlineBtn} onClick={() => setConfirmStop(true)} disabled={runner === 'posting' || working !== null}>
                <Square size={14} aria-hidden="true" /> {sequenceActive || runner === 'paused' ? 'Stop' : 'Take back approval'}
              </button>
            ))}
          </div>
        </div>
      )}

      {postError && (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 text-sm text-red-700">
          {postError.text}
          {postError.session && <SignInAgainButton />}
        </div>
      )}

      {comments.length > 0 && working !== 'all' && (
        <>
          <p className="mt-4 text-sm font-semibold text-[var(--color-text-primary)]">{used} of {comments.length} comments will be used</p>
          <ol className="mt-2 space-y-3">
            {comments.map((c, i) => {
              const locked = isLocked(c)
              return (
                <li key={c.id} className={clsx('rounded-[var(--radius-md)] border p-3', c.included ? 'border-[var(--color-border)] bg-[var(--color-surface)]' : 'border-dashed border-[var(--color-border)] bg-[var(--color-bg-cream)] opacity-70')}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
                      <input type="checkbox" checked={c.included} onChange={() => toggle(c)} disabled={!online || busy || locked}
                        className="h-4 w-4 accent-[var(--color-primary-dark)]" />
                      Comment {i + 1}{!c.included && <span className="font-normal text-[var(--color-text-secondary)]"> (not used)</span>}
                      <span className={clsx('rounded-full px-2 py-0.5 text-xs', STATUS_TONE[c.status])}>
                        {c.status === 'published' && <CheckCircle2 size={12} className="mr-1 inline" aria-hidden="true" />}{STATUS_TEXT[c.status]}
                      </span>
                    </label>
                    {!locked && (
                      <span className="flex items-center">
                        <button type="button" className={iconBtn} aria-label={`Move comment ${i + 1} up`} onClick={() => move(i, -1)} disabled={i === 0 || !online || busy || isLocked(comments[i - 1])}><ArrowUp size={16} aria-hidden="true" /></button>
                        <button type="button" className={iconBtn} aria-label={`Move comment ${i + 1} down`} onClick={() => move(i, 1)} disabled={i === comments.length - 1 || !online || busy}><ArrowDown size={16} aria-hidden="true" /></button>
                      </span>
                    )}
                  </div>

                  {editing?.id === c.id ? (
                    <div className="mt-2">
                      <label htmlFor={`comment-edit-${c.id}`} className="sr-only">Edit comment {i + 1}</label>
                      <textarea id={`comment-edit-${c.id}`} value={editing.text} maxLength={COMMENT_MAX_CHARS + 200}
                        aria-invalid={Boolean(editError)} aria-describedby={`comment-count-${c.id}`}
                        onChange={(e) => { setEditing({ id: c.id, text: e.target.value }); setEditError(null) }}
                        className="min-h-[110px] w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-cream)] p-2 text-sm aria-[invalid=true]:border-red-700" />
                      <p id={`comment-count-${c.id}`} className={clsx('text-xs', editing.text.length > COMMENT_MAX_CHARS ? 'text-red-700' : 'text-[var(--color-text-secondary)]')}>
                        {editing.text.trim() ? editing.text.trim().split(/\s+/).length : 0} words (aim for 20 to 50) · {editing.text.length} of {COMMENT_MAX_CHARS} characters
                      </p>
                      {c.status === 'approved' && <p className="text-xs text-amber-800">Saving a change sends this comment back to draft. Approve it again to post it.</p>}
                      {editError && <p role="alert" className="mt-1 text-sm text-red-700">{editError}</p>}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button type="button" className={primaryBtn} onClick={saveEdit} disabled={!online || working !== null}>{working === c.id ? 'Saving...' : 'Save'}</button>
                        <button type="button" className={outlineBtn} onClick={() => { setEditing(null); setEditError(null) }} disabled={working !== null}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 whitespace-pre-line break-words text-sm text-[var(--color-text-primary)]">{c.body}</p>
                  )}

                  {c.status === 'failed' && c.failure_reason && <p className="mt-2 text-sm text-red-700">{c.failure_reason}</p>}

                  {working === c.id && editing?.id !== c.id && (
                    <p role="status" className="mt-2 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                      <Loader2 size={14} className="animate-spin" aria-hidden="true" />{slow ? 'Still working. Your connection seems slow.' : 'Working...'}
                    </p>
                  )}

                  {editing?.id !== c.id && (
                    confirmDelete === c.id ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                        Delete comment {i + 1}?
                        <button type="button" className={outlineBtn} onClick={() => remove(c)} disabled={!online || busy}>Yes, delete</button>
                        <button type="button" className="font-semibold underline" onClick={() => setConfirmDelete(null)}>Keep it</button>
                      </div>
                    ) : (
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        <button type="button" className={iconBtn} onClick={() => copy(c)}><Copy size={14} aria-hidden="true" /> {copied === c.id ? 'Copied' : 'Copy'}</button>
                        {!locked && (
                          <>
                            <button type="button" className={iconBtn} onClick={() => { setEditing({ id: c.id, text: c.body }); setNotice(null) }} disabled={!online || busy}><Pencil size={14} aria-hidden="true" /> Edit</button>
                            <button type="button" className={iconBtn} onClick={() => rewriteOne(c)} disabled={!online || busy || outdated}><RefreshCw size={14} aria-hidden="true" /> Write again</button>
                            <button type="button" className={clsx(iconBtn, 'text-red-700 hover:text-red-800')} onClick={() => setConfirmDelete(c.id)} disabled={!online || busy}><Trash2 size={14} aria-hidden="true" /> Delete</button>
                          </>
                        )}
                        {c.status === 'failed' && published && (
                          <button type="button" className={outlineBtn} onClick={() => retry(c)} disabled={!online || busy}>Try posting again</button>
                        )}
                      </div>
                    )
                  )}
                </li>
              )
            })}
          </ol>

          <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] pt-3">
            {draftsToApprove > 0 && (
              <button type="button" className={primaryBtn} onClick={approve} disabled={!online || busy}>
                {published ? `Approve and post ${draftsToApprove} comment${draftsToApprove === 1 ? '' : 's'}` : `Approve ${draftsToApprove} comment${draftsToApprove === 1 ? '' : 's'}`}
              </button>
            )}
            {!anyLocked && (confirmReplace ? (
              <span className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-text-primary)]">
                This replaces all {comments.length} comments, including your edits.
                <button type="button" className={outlineBtn} onClick={writeAll} disabled={!online || busy || outdated}>Yes, write new ones</button>
                <button type="button" className="font-semibold underline" onClick={() => setConfirmReplace(false)}>Keep these</button>
              </span>
            ) : (
              <>
                {countPicker}
                <button type="button" className={outlineBtn} onClick={() => setConfirmReplace(true)} disabled={!online || busy || outdated}>
                  <RefreshCw size={14} aria-hidden="true" /> Write all again
                </button>
              </>
            ))}
          </div>
        </>
      )}

      {notice && <p role="status" className="mt-3 text-sm text-[var(--color-primary-dark)]">{notice}</p>}
      {error && (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 text-sm text-red-700">
          {message(error)}
          {errorDetail && <span className="basis-full text-xs">Reason: {errorDetail}</span>}
          {error === 'session_expired' && <SignInAgainButton />}
        </div>
      )}
    </Card>
  )
}
