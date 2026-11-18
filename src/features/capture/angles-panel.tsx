import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Bookmark, BookmarkCheck, Compass, Loader2, RotateCcw, Sparkles, X } from 'lucide-react'
import { clsx } from 'clsx'
import { Card } from '@/components/ui/card'
import { SignInAgainButton } from '@/features/auth/components/sign-in-again-button'
import {
  ANGLE_KINDS, ContentError, ERROR_TEXT, fetchAngles, setAngleStatus, suggestAngles,
  type Angle, type AngleStatus, type ContentErrorCode,
} from '@/features/content/api/content-service'

const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-primary-dark)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50'
const outlineBtn =
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-primary)] px-3 py-1.5 text-sm font-semibold text-[var(--color-primary-dark)] disabled:cursor-not-allowed disabled:opacity-50'
const quietBtn =
  'inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1.5 text-sm font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-50'

const codeOf = (e: unknown): ContentErrorCode => (e instanceof ContentError ? e.code : 'unknown')

/** Angle errors reuse the shared messages, worded for this panel (the drafts are never at risk here). */
function angleError(code: ContentErrorCode) {
  if (code === 'ai_failed') return 'We could not find new angles just now. Your drafts are unchanged. Please try again.'
  if (code === 'not_found') return 'We could not find that angle or idea. It may have been removed.'
  return ERROR_TEXT[code].replace('Your idea is kept on this page.', 'Your drafts are unchanged.')
}

/**
 * HPD-49: different ways to tell the same idea. The person can ask for angles, read a short
 * preview of each, save or discard them, ask for more, and rewrite their drafts from one.
 */
export function AnglesPanel({ ideaId, online, canRewrite, onChoose }: {
  ideaId: string
  online: boolean
  /** False when every post for this idea is already approved, so nothing can be rewritten. */
  canRewrite: boolean
  onChoose: (angle: Angle) => Promise<void>
}) {
  const queryClient = useQueryClient()
  const key = ['angles', ideaId]
  const query = useQuery({ queryKey: key, queryFn: () => fetchAngles(ideaId), retry: 1 })
  const [suggesting, setSuggesting] = useState(false)
  const [slow, setSlow] = useState(false)
  const [error, setError] = useState<ContentErrorCode | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [writingId, setWritingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; undo?: Angle } | null>(null)
  const [showDiscarded, setShowDiscarded] = useState(false)

  const angles = query.data ?? []
  const visible = angles
    .filter((a) => a.status !== 'discarded')
    .sort((a, b) => Number(b.status === 'chosen') - Number(a.status === 'chosen'))
  const discarded = angles.filter((a) => a.status === 'discarded')
  const busy = suggesting || writingId !== null

  async function suggest() {
    setSuggesting(true)
    setError(null)
    setNotice(null)
    setSlow(false)
    const timer = setTimeout(() => setSlow(true), 10_000)
    try {
      const all = await suggestAngles(ideaId)
      queryClient.setQueryData(key, all)
    } catch (e) {
      setError(codeOf(e))
    } finally {
      clearTimeout(timer)
      setSuggesting(false)
    }
  }

  /** Changes the status on screen at once, and puts it back if saving fails. */
  async function changeStatus(angle: Angle, status: Exclude<AngleStatus, 'chosen'>, message: string | null) {
    setError(null)
    const before = queryClient.getQueryData<Angle[]>(key)
    queryClient.setQueryData<Angle[]>(key, (list) => list?.map((a) => (a.id === angle.id ? { ...a, status } : a)))
    try {
      await setAngleStatus(angle.id, status)
      setNotice(message ? { text: message, undo: status === 'discarded' ? angle : undefined } : null)
    } catch (e) {
      queryClient.setQueryData(key, before)
      setNotice(null)
      setError(codeOf(e))
    }
  }

  async function choose(angle: Angle) {
    setWritingId(angle.id)
    setConfirmId(null)
    setError(null)
    setNotice(null)
    setSlow(false)
    const timer = setTimeout(() => setSlow(true), 10_000)
    try {
      await onChoose(angle)
      await queryClient.invalidateQueries({ queryKey: key })
      setNotice({ text: 'Your drafts above are now written from this angle. Your earlier text is in each draft\'s version history.' })
    } catch (e) {
      setError(codeOf(e))
    } finally {
      clearTimeout(timer)
      setWritingId(null)
    }
  }

  return (
    <Card aria-labelledby="angles-title">
      <h2 id="angles-title" className="flex items-center gap-2 text-lg font-semibold text-[var(--color-text-primary)]">
        <Compass size={20} aria-hidden="true" /> Other ways to tell this idea
      </h2>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
        The same idea can work as a story, a lesson, an opinion and more. Pick one you like and Hiba rewrites your drafts from it.
      </p>

      {!online && (
        <p role="status" className="mt-3 text-sm text-amber-800">
          You are offline. Angles you already have are shown, but you cannot ask for new ones or use them until you reconnect.
        </p>
      )}
      {!canRewrite && (
        <p role="status" className="mt-3 text-sm text-[var(--color-text-secondary)]">
          Every post for this idea is approved, so angles cannot change them. You can still explore and save angles.
        </p>
      )}

      {query.isPending && (
        <div className="mt-4 space-y-3" role="status" aria-label="Loading angles">
          {[0, 1].map((i) => <div key={i} className="h-16 animate-pulse rounded-[var(--radius-md)] bg-[var(--color-border)]" />)}
        </div>
      )}

      {query.isError && (
        <div role="alert" className="mt-3 text-sm text-red-700">
          {codeOf(query.error) === 'session_expired' ? (
            <span className="flex flex-wrap items-center gap-2">{ERROR_TEXT.session_expired} <SignInAgainButton /></span>
          ) : (
            <span>
              We could not load your angles.{' '}
              <button type="button" className="font-semibold underline" onClick={() => query.refetch()}>Try again</button>
            </span>
          )}
        </div>
      )}

      {query.isSuccess && visible.length === 0 && !suggesting && (
        <div className="mt-4">
          {discarded.length > 0 && (
            <p className="mb-2 text-sm text-[var(--color-text-secondary)]">You discarded every angle so far.</p>
          )}
          <button type="button" className={primaryBtn} onClick={suggest} disabled={!online || busy}>
            <Sparkles size={16} aria-hidden="true" /> Show me 3 angles
          </button>
        </div>
      )}

      {visible.length > 0 && (
        <ul className="mt-4 space-y-3">
          {visible.map((angle) => (
            <li
              key={angle.id}
              className={clsx(
                'rounded-[var(--radius-md)] border p-4',
                angle.status === 'chosen'
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary-soft)]'
                  : 'border-[var(--color-border)] bg-[var(--color-surface)]',
              )}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                <span className="rounded-full bg-[var(--color-bg-soft-green)] px-2.5 py-0.5 text-[var(--color-primary-dark)]">
                  {ANGLE_KINDS[angle.kind] ?? 'Angle'}
                </span>
                {angle.status === 'chosen' && <span className="text-[var(--color-primary-dark)]">In use for your drafts</span>}
                {angle.status === 'saved' && <span className="text-[var(--color-text-secondary)]">Saved</span>}
              </div>
              <h3 className="mt-2 font-semibold text-[var(--color-text-primary)]">{angle.title}</h3>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{angle.summary}</p>

              {writingId === angle.id ? (
                <p role="status" className="mt-3 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
                  <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                  {slow ? 'Still working. Your connection seems slow, please keep this page open.' : 'Writing your posts from this angle...'}
                </p>
              ) : confirmId === angle.id ? (
                <div className="mt-3 rounded-[var(--radius-sm)] bg-[var(--color-bg-light-green)] p-3 text-sm">
                  <p className="text-[var(--color-text-primary)]">
                    This rewrites your drafts that are not approved yet. Approved posts stay as they are, and your current text is kept in each draft&apos;s version history.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className={primaryBtn} onClick={() => choose(angle)} disabled={!online || busy}>
                      Yes, rewrite my drafts
                    </button>
                    <button type="button" className={outlineBtn} onClick={() => setConfirmId(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {angle.status !== 'chosen' && (
                    <button type="button" className={outlineBtn} disabled={!online || busy || !canRewrite}
                      onClick={() => { setConfirmId(angle.id); setNotice(null) }}>
                      Write my posts from this
                    </button>
                  )}
                  {angle.status === 'suggested' && (
                    <button type="button" className={quietBtn} disabled={!online || busy}
                      onClick={() => changeStatus(angle, 'saved', 'Angle saved. It stays here with this idea.')}>
                      <Bookmark size={16} aria-hidden="true" /> Save for later
                    </button>
                  )}
                  {angle.status === 'saved' && (
                    <button type="button" className={quietBtn} disabled={!online || busy}
                      onClick={() => changeStatus(angle, 'suggested', null)}>
                      <BookmarkCheck size={16} aria-hidden="true" /> Saved (tap to unsave)
                    </button>
                  )}
                  {angle.status !== 'chosen' && (
                    <button type="button" className={quietBtn} disabled={!online || busy}
                      onClick={() => changeStatus(angle, 'discarded', 'Angle discarded.')}>
                      <X size={16} aria-hidden="true" /> Discard
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {suggesting && (
        <p role="status" className="mt-4 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          {slow ? 'Still working. Your connection seems slow, please keep this page open.' : 'Finding new angles for your idea...'}
        </p>
      )}

      {notice && (
        <p role="status" className="mt-3 text-sm text-[var(--color-primary-dark)]">
          {notice.text}{' '}
          {notice.undo && (
            <button type="button" className="font-semibold underline" disabled={!online}
              onClick={() => notice.undo && changeStatus(notice.undo, 'suggested', 'Angle brought back.')}>
              Undo
            </button>
          )}
        </p>
      )}

      {error && (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 text-sm text-red-700">
          {angleError(error)}
          {error === 'session_expired' && <SignInAgainButton />}
        </div>
      )}

      {query.isSuccess && (visible.length > 0 || discarded.length > 0) && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {visible.length > 0 && !suggesting && (
            <button type="button" className={outlineBtn} onClick={suggest} disabled={!online || busy}>
              <Sparkles size={16} aria-hidden="true" /> Show 3 more angles
            </button>
          )}
          {discarded.length > 0 && (
            <button type="button" className="text-sm font-semibold underline text-[var(--color-text-secondary)]"
              aria-expanded={showDiscarded} onClick={() => setShowDiscarded((v) => !v)}>
              {showDiscarded ? 'Hide discarded angles' : `Show discarded angles (${discarded.length})`}
            </button>
          )}
        </div>
      )}

      {showDiscarded && discarded.length > 0 && (
        <ul className="mt-3 space-y-2">
          {discarded.map((angle) => (
            <li key={angle.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-dashed border-[var(--color-border)] p-3 text-sm">
              <span className="text-[var(--color-text-secondary)]">
                <span className="font-semibold">{ANGLE_KINDS[angle.kind] ?? 'Angle'}:</span> {angle.title}
              </span>
              <button type="button" className={quietBtn} disabled={!online || busy}
                onClick={() => changeStatus(angle, 'suggested', 'Angle brought back.')}>
                <RotateCcw size={16} aria-hidden="true" /> Bring back
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
