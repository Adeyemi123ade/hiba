import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Copy, Loader2, MessagesSquare, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { clsx } from 'clsx'
import { Card } from '@/components/ui/card'
import { SignInAgainButton } from '@/features/auth/components/sign-in-again-button'
import { ContentError, ERROR_TEXT, type ContentErrorCode } from '@/features/content/api/content-service'
import {
  COMMENTS_MAX, COMMENTS_MIN, COMMENT_MAX_CHARS, deleteComment, fetchComments, generateComments, rewriteComment,
  saveOrder, updateComment, type PostComment,
} from '@/features/content/api/comments-service'

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

/**
 * Phase 2 (owner's master prompt, section 10): 5 to 10 follow-up comments that extend the
 * LinkedIn post. The person reviews, edits, deletes, reorders, rewrites one, chooses which to use
 * and copies them. Hiba does not post comments to LinkedIn.
 */
export function CommentsPanel({ ideaId, postId, online, enabled }: {
  ideaId: string
  postId: string
  online: boolean
  /** The Settings switch for follow-up comments. */
  enabled: boolean
}) {
  const queryClient = useQueryClient()
  const key = ['comments', postId]
  const query = useQuery({ queryKey: key, queryFn: () => fetchComments(postId), enabled, retry: 1 })
  const [count, setCount] = useState(COMMENTS_MIN)
  const [working, setWorking] = useState<'all' | string | null>(null)
  const [slow, setSlow] = useState(false)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [error, setError] = useState<ContentErrorCode | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

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

  const comments = query.data ?? []
  const used = comments.filter((c) => c.included).length
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
    }
  }

  const writeAll = () => {
    setConfirmReplace(false)
    return run(async () => {
      queryClient.setQueryData(key, await generateComments(ideaId, postId, count))
    }, 'all', 'Your comments are ready. Read each one, edit anything, and untick any you do not want.')
  }

  const rewriteOne = (c: PostComment) => run(async () => {
    queryClient.setQueryData(key, await rewriteComment(ideaId, c.id))
  }, c.id, `Comment ${c.position} was written again.`)

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
      queryClient.setQueryData<PostComment[]>(key, (list) => list?.map((x) => (x.id === id ? { ...x, body: text } : x)))
      setEditing(null)
    }, id, 'Comment saved.')
  }

  async function copy(c: PostComment) {
    try {
      await navigator.clipboard.writeText(c.body)
      setCopied(c.id)
    } catch {
      setError('unknown')
      setNotice('Your browser blocked copying. Select the comment text and copy it yourself.')
    }
  }

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
        Extra thoughts you add under your own LinkedIn post, so the conversation goes deeper without making the post longer.
        Hiba does not post comments for you: after your post is live, copy each one and paste it as a comment, in order.
      </p>

      {!online && <p role="status" className="mt-3 text-sm text-amber-800">You are offline. Your comments are shown, but changes need a connection.</p>}

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
          <button type="button" className={primaryBtn} onClick={writeAll} disabled={!online || busy}>
            Write follow-up comments
          </button>
        </div>
      )}

      {working === 'all' && (
        <p role="status" className="mt-4 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          {slow ? 'Still working. Your connection seems slow, please keep this page open.' : `Writing ${count} follow-up comments...`}
        </p>
      )}

      {comments.length > 0 && working !== 'all' && (
        <>
          <p className="mt-4 text-sm font-semibold text-[var(--color-text-primary)]">
            {used} of {comments.length} comments will be used
          </p>
          <ol className="mt-2 space-y-3">
            {comments.map((c, i) => (
              <li key={c.id} className={clsx('rounded-[var(--radius-md)] border p-3', c.included ? 'border-[var(--color-border)] bg-[var(--color-surface)]' : 'border-dashed border-[var(--color-border)] bg-[var(--color-bg-cream)] opacity-70')}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text-primary)]">
                    <input type="checkbox" checked={c.included} onChange={() => toggle(c)} disabled={!online || busy}
                      className="h-4 w-4 accent-[var(--color-primary-dark)]" />
                    Comment {i + 1}{!c.included && <span className="font-normal text-[var(--color-text-secondary)]"> (not used)</span>}
                  </label>
                  <span className="flex items-center">
                    <button type="button" className={iconBtn} aria-label={`Move comment ${i + 1} up`} onClick={() => move(i, -1)} disabled={i === 0 || !online || busy}><ArrowUp size={16} aria-hidden="true" /></button>
                    <button type="button" className={iconBtn} aria-label={`Move comment ${i + 1} down`} onClick={() => move(i, 1)} disabled={i === comments.length - 1 || !online || busy}><ArrowDown size={16} aria-hidden="true" /></button>
                  </span>
                </div>

                {editing?.id === c.id ? (
                  <div className="mt-2">
                    <label htmlFor={`comment-edit-${c.id}`} className="sr-only">Edit comment {i + 1}</label>
                    <textarea id={`comment-edit-${c.id}`} value={editing.text} maxLength={COMMENT_MAX_CHARS + 200}
                      aria-invalid={Boolean(editError)} aria-describedby={`comment-count-${c.id}`}
                      onChange={(e) => { setEditing({ id: c.id, text: e.target.value }); setEditError(null) }}
                      className="min-h-[110px] w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-cream)] p-2 text-sm aria-[invalid=true]:border-red-700" />
                    <p id={`comment-count-${c.id}`} className={clsx('text-xs', editing.text.length > COMMENT_MAX_CHARS ? 'text-red-700' : 'text-[var(--color-text-secondary)]')}>
                      {editing.text.length} of {COMMENT_MAX_CHARS} characters
                    </p>
                    {editError && <p role="alert" className="mt-1 text-sm text-red-700">{editError}</p>}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" className={primaryBtn} onClick={saveEdit} disabled={!online || working !== null}>
                        {working === c.id ? 'Saving...' : 'Save'}
                      </button>
                      <button type="button" className={outlineBtn} onClick={() => { setEditing(null); setEditError(null) }} disabled={working !== null}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 whitespace-pre-line break-words text-sm text-[var(--color-text-primary)]">{c.body}</p>
                )}

                {working === c.id && editing?.id !== c.id && (
                  <p role="status" className="mt-2 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                    <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                    {slow ? 'Still working. Your connection seems slow.' : 'Working...'}
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
                      <button type="button" className={iconBtn} onClick={() => { setEditing({ id: c.id, text: c.body }); setNotice(null) }} disabled={!online || busy}><Pencil size={14} aria-hidden="true" /> Edit</button>
                      <button type="button" className={iconBtn} onClick={() => rewriteOne(c)} disabled={!online || busy}><RefreshCw size={14} aria-hidden="true" /> Write again</button>
                      <button type="button" className={clsx(iconBtn, 'text-red-700 hover:text-red-800')} onClick={() => setConfirmDelete(c.id)} disabled={!online || busy}><Trash2 size={14} aria-hidden="true" /> Delete</button>
                    </div>
                  )
                )}
              </li>
            ))}
          </ol>

          <div className="mt-4 border-t border-[var(--color-border)] pt-3">
            {confirmReplace ? (
              <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-text-primary)]">
                This replaces all {comments.length} comments, including your edits.
                <button type="button" className={outlineBtn} onClick={writeAll} disabled={!online || busy}>Yes, write new ones</button>
                <button type="button" className="font-semibold underline" onClick={() => setConfirmReplace(false)}>Keep these</button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                {countPicker}
                <button type="button" className={outlineBtn} onClick={() => setConfirmReplace(true)} disabled={!online || busy}>
                  <RefreshCw size={14} aria-hidden="true" /> Write all again
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {notice && !error && <p role="status" className="mt-3 text-sm text-[var(--color-primary-dark)]">{notice}</p>}
      {error && (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 text-sm text-red-700">
          {notice && error === 'unknown' ? notice : message(error)}
          {error === 'session_expired' && <SignInAgainButton />}
        </div>
      )}
    </Card>
  )
}
