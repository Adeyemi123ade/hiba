import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown, ArrowUp, CheckCircle2, Copy, Loader2, MessagesSquare, Pencil, RefreshCw, Send, Square, Trash2,
} from 'lucide-react'
import { clsx } from 'clsx'
import { Card } from '@/components/ui/card'
import { SignInAgainButton } from '@/features/auth/components/sign-in-again-button'
import { LeftToday } from '@/features/content/left-today'
import { EmojiButton } from '@/components/ui/emoji-picker'
import { insertAtCursor, placeCaret } from '@/lib/emoji'
import { ALLOWANCES_KEY } from '@/features/content/use-allowances'
import { ContentError, ERROR_TEXT, type ContentErrorCode, type PostStatus } from '@/features/content/api/content-service'
import {
  COMMENTS_MAX, COMMENTS_MIN, COMMENT_MAX_CHARS, GAP_CHOICES, approveComments, draftingFunctionIsCurrent, deleteComment, fetchComments, generateComments,
  queueComments, rewriteComment, saveOrder, updateComment, withdrawApproval, type PostComment,
} from '@/features/content/api/comments-service'

const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-primary-dark)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50'
const outlineBtn =
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-primary)] px-3 py-1.5 text-sm font-semibold text-[var(--color-primary-dark)] disabled:cursor-not-allowed disabled:opacity-50'
const iconBtn =
  'inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-sm font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-40'

const codeOf = (e: unknown): ContentErrorCode => (e instanceof ContentError ? e.code : 'unknown')
function message(code: ContentErrorCode) {
  if (code === 'ai_failed') return 'We could not write your comments this time. Anything you already had is unchanged. Please try again.'
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

/** "in a few seconds", "in about 40 seconds" or "at 14:05". */
function dueText(dueAt: string, now: number) {
  const s = Math.ceil((new Date(dueAt).getTime() - now) / 1000)
  if (s <= 5) return 'in a few seconds'
  if (s < 90) return `in about ${s} seconds`
  return `at ${new Date(dueAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
}

/**
 * Follow-up comments (owner's master prompt, sections 10 and 11; owner decisions of 19 Nov 2026).
 * Hiba writes 5 to 10 comments of 20 to 50 words. The person edits, deletes, reorders, rewrites,
 * chooses and approves them. Once the post is live on LinkedIn, Hiba posts each approved comment
 * after a different random gap of 15 to 60 seconds. The person can pause, resume or stop at any time,
 * sees the next comment and when it goes out, and sees what was posted and what failed. A failed
 * comment stops the sequence (never skipped silently) and can be retried. Posting is done by Hiba's
 * background publisher, so it carries on when this page, the browser or the laptop is closed.
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
  const query = useQuery({
    queryKey: key, queryFn: () => fetchComments(postId), enabled, retry: 1,
    // While Hiba is posting comments in the background, check every 10 seconds to show progress.
    refetchInterval: (q) => ((q.state.data ?? []).some((c) => c.included && (c.status === 'publishing' || (c.status === 'approved' && c.due_at))) ? 10_000 : false),
  })
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
  const [postError, setPostError] = useState<{ text: string; session?: boolean } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const prevStatus = useRef(postStatus)
  const editBox = useRef<HTMLTextAreaElement>(null)

  const comments = query.data ?? []
  const published = postStatus === 'published'
  const anyLocked = comments.some(isLocked)
  // Handed to the background publisher: posting now, or approved with a time to go out.
  const queued = comments.filter((c) => c.included && (c.status === 'publishing' || (c.status === 'approved' && c.due_at)))
  // Approved but not handed over yet (the post is not live yet, or it was approved before this change).
  const waiting = comments.filter((c) => c.included && c.status === 'approved' && !c.due_at)
  const sending = queued.length > 0
  const nextComment = [...queued].sort((a, b) =>
    (a.status === 'publishing' ? 0 : 1) - (b.status === 'publishing' ? 0 : 1) || (a.due_at ?? '').localeCompare(b.due_at ?? ''))[0]

  const refresh = useCallback(async () => {
    const fresh = await fetchComments(postId)
    queryClient.setQueryData(key, fresh)
    return fresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, queryClient])

  // Keeps "in about 40 seconds" up to date while comments are going out.
  useEffect(() => {
    if (!sending) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(t)
  }, [sending])

  // The post just went live from this page. The server has already queued the approved comments.
  useEffect(() => {
    if (prevStatus.current !== 'published' && postStatus === 'published') {
      void refresh().then((fresh) => {
        if (fresh.some((c) => c.included && c.status === 'approved' && c.due_at)) {
          setNotice('Your post is live. Hiba is now posting your approved comments under it, one by one. You can close this page.')
        }
      }).catch(() => {})
    }
    prevStatus.current = postStatus
  }, [postStatus, refresh])

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

  const busy = working !== null || editing !== null

  async function run(task: () => Promise<void>, id: 'all' | string, done?: string) {
    setWorking(id)
    setError(null)
    setNotice(null)
    try {
      await task()
      if (done) setNotice(done)
    } catch (e) {
      setError(codeOf(e))
      await queryClient.invalidateQueries({ queryKey: key })
    } finally {
      setWorking(null)
      void queryClient.invalidateQueries({ queryKey: ALLOWANCES_KEY })
    }
  }

  const writeAll = () => {
    setConfirmReplace(false)
    return run(async () => {
      queryClient.setQueryData(key, await generateComments(ideaId, postId, count))
    }, 'all', 'Your comments are ready. Read each one, edit anything, untick any you do not want, then approve them.')
  }

  const rewriteOne = (c: PostComment) => run(async () => {
    queryClient.setQueryData(key, await rewriteComment(ideaId, c.id))
  }, c.id, `Comment ${c.position} was written again. Approve it again if you want it posted.`)

  // The wait before this comment (after the post for the first one, after the previous one otherwise).
  const setGap = (c: PostComment, gap: number | null) => run(async () => {
    queryClient.setQueryData<PostComment[]>(key, (list) => list?.map((x) => (x.id === c.id ? { ...x, gap_seconds: gap } : x)))
    await updateComment(c.id, { gap_seconds: gap })
  }, c.id)

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

  // Approve every ticked draft. If the post is already live, Hiba starts posting them straight away
  // (owner: "post automatically once I approve"), from the server, so this page can be closed.
  const approve = () => run(async () => {
    const ids = comments.filter((c) => c.included && c.status === 'draft').map((c) => c.id)
    await approveComments(ids)
    if (published) await queueComments(postId)
    await refresh()
    setPostError(null)
  }, 'all', published
    ? 'Approved. Hiba posts them under your LinkedIn post one by one, with the waits you chose. You can close this page or your laptop.'
    : postStatus === 'scheduled'
      ? 'Approved. Hiba posts these under your post automatically after it goes live. You do not need to keep this page open.'
      : 'Approved. When you post this to LinkedIn from Hiba, these comments are posted under it automatically, one by one. You do not need to keep this page open.')

  // Approved comments of a live post that were never handed to the publisher (e.g. approved earlier).
  const sendWaiting = () => run(async () => {
    await queueComments(postId)
    await refresh()
  }, 'all', 'Hiba is posting them now, one by one. You can close this page or your laptop.')

  // Stops everything not posted yet. A comment being posted at this very moment still finishes.
  const stop = () => {
    setConfirmStop(false)
    return run(async () => {
      await withdrawApproval(comments.filter((c) => c.included && c.status === 'approved').map((c) => c.id))
      await refresh()
    }, 'all', sending ? 'Stopped. The comments that were not posted yet are back to draft.' : 'Approval taken back. Nothing will be posted.')
  }

  const retry = (c: PostComment) => run(async () => {
    await approveComments([c.id])
    if (published) await queueComments(postId)
    await refresh()
    setPostError(null)
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
  const stoppable = comments.some((c) => c.included && c.status === 'approved')

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
        Only comments you approve are posted, one by one, after your post is live. Choose how long Hiba waits before each one.
        Hiba posts them by itself, even if you close this page or your laptop.
      </p>

      {!online && <p role="status" className="mt-3 text-sm text-amber-800">You are offline. Your comments are shown, but changes and posting need a connection.</p>}
      {outdated && (
        <div role="alert" className="mt-3 rounded-[var(--radius-sm)] bg-red-50 p-3 text-sm text-red-800">
          <p className="font-semibold">Writing new comments is not available right now.</p>
          <p className="mt-1">Please try again later. Comments you already have are shown below and can still be approved and posted.</p>
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
          <LeftToday action="comments" className="basis-full" />
        </div>
      )}

      {working === 'all' && (
        <p role="status" className="mt-4 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          {slow ? 'Still working. Your connection seems slow, please keep this page open.' : 'Working...'}
        </p>
      )}

      {/* Posting progress and controls. The posting itself happens on the server. */}
      {comments.length > 0 && (sending || waiting.length > 0 || postedCount > 0) && (
        <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-light-green)] p-3 text-sm" aria-live="polite">
          <p className="font-semibold text-[var(--color-text-primary)]">
            {postedCount} posted · {queued.length + waiting.length} approved and waiting
          </p>
          {sending && nextComment && (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-[var(--color-text-primary)]">
              {nextComment.status === 'publishing'
                ? <><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Posting comment {nextComment.position} now.</>
                : <>Comment {nextComment.position} goes out {dueText(nextComment.due_at!, now)}.</>}
              {' '}Hiba does this by itself, so you can close this page or your laptop.
            </p>
          )}
          {!published && waiting.length > 0 && (
            <p className="mt-1 text-[var(--color-text-primary)]">These are posted automatically after your post goes live on LinkedIn.</p>
          )}
          {published && waiting.length > 0 && !sending && (
            <p className="mt-1 text-[var(--color-text-primary)]">These approved comments are not being posted yet.</p>
          )}
          {postedCount > 0 && postUrl && (
            <p className="mt-1"><a href={postUrl} target="_blank" rel="noopener noreferrer" className="font-semibold underline">See your post and comments on LinkedIn</a></p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {published && waiting.length > 0 && (
              <button type="button" className={primaryBtn} onClick={sendWaiting} disabled={!online || busy}>
                <Send size={14} aria-hidden="true" /> Post {waiting.length} approved comment{waiting.length === 1 ? '' : 's'}
              </button>
            )}
            {stoppable && (confirmStop ? (
              <span className="flex flex-wrap items-center gap-2">
                {sending ? 'Stop and keep the rest as drafts?' : 'Take back approval? Nothing will be posted.'}
                <button type="button" className={outlineBtn} onClick={() => void stop()} disabled={working !== null}>
                  {sending ? 'Yes, stop' : 'Yes, take it back'}
                </button>
                <button type="button" className="font-semibold underline" onClick={() => setConfirmStop(false)}>Keep going</button>
              </span>
            ) : (
              <button type="button" className={outlineBtn} onClick={() => setConfirmStop(true)} disabled={working !== null}>
                <Square size={14} aria-hidden="true" /> {sending ? 'Stop posting the rest' : 'Take back approval'}
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
                      <textarea ref={editBox} id={`comment-edit-${c.id}`} value={editing.text} maxLength={COMMENT_MAX_CHARS + 200}
                        aria-invalid={Boolean(editError)} aria-describedby={`comment-count-${c.id}`}
                        onChange={(e) => { setEditing({ id: c.id, text: e.target.value }); setEditError(null) }}
                        className="min-h-[110px] w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-cream)] p-2 text-sm aria-[invalid=true]:border-red-700" />
                      <p id={`comment-count-${c.id}`} className={clsx('flex flex-wrap items-center gap-1 text-xs', editing.text.length > COMMENT_MAX_CHARS ? 'text-red-700' : 'text-[var(--color-text-secondary)]')}>
                        <EmojiButton onPick={(emoji) => {
                          const next = insertAtCursor(editBox.current, editing.text, emoji)
                          setEditing({ id: c.id, text: next.text })
                          setEditError(null)
                          placeCaret(editBox.current, next.caret)
                        }} />
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

                  {c.included && c.status !== 'published' && (
                    <label className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                      {i === 0 ? 'Wait after the post goes live:' : 'Wait after the previous comment:'}
                      <select value={c.gap_seconds ?? ''} disabled={!online || busy || locked || Boolean(c.due_at)}
                        onChange={(e) => setGap(c, e.target.value ? Number(e.target.value) : null)}
                        className="h-8 rounded-[8px] border border-[var(--color-border)] bg-[var(--color-surface)] px-1 text-xs text-[var(--color-text-primary)]">
                        {GAP_CHOICES.map((g) => <option key={g.label} value={g.value ?? ''}>{g.label}</option>)}
                      </select>
                      {c.due_at && c.status === 'approved' && <span>(already planned)</span>}
                    </label>
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
                <LeftToday action="comments" className="basis-full" />
              </>
            ))}
          </div>
        </>
      )}

      {notice && <p role="status" className="mt-3 text-sm text-[var(--color-primary-dark)]">{notice}</p>}
      {error && (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 text-sm text-red-700">
          {message(error)}
          {error === 'session_expired' && <SignInAgainButton />}
        </div>
      )}
    </Card>
  )
}
