import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { Banner } from '@/components/ui/banner'
import { Card, SkeletonCard } from '@/components/ui/card'
import { Modal } from '@/components/ui/modal'
import { showSuccess } from '@/components/ui/show-success'
import { SignInAgainButton } from '@/features/auth/components/sign-in-again-button'
import {
  ContentError, SAVED_IDEAS_KEY, deleteSavedIdea, type ContentErrorCode, type SavedIdea,
} from '@/features/content/api/content-service'

const primaryBtn = 'inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-primary-dark)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50'
const outlineBtn = 'inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-dark)] disabled:cursor-not-allowed disabled:opacity-50'
const quietBtn = 'rounded-[var(--radius-sm)] px-2 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50'

const codeOf = (e: unknown): ContentErrorCode => (e instanceof ContentError ? e.code : 'unknown')
const savedOn = (at: string) => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

function deleteError(code: ContentErrorCode) {
  if (code === 'offline') return 'You are offline, so nothing was deleted. Reconnect, then try again.'
  if (code === 'session_expired') return 'Your session expired, so nothing was deleted. Sign in again, then try again.'
  if (code === 'not_found') return 'This idea was already drafted or deleted. Refresh the page to see your saved ideas.'
  return 'We could not delete this idea. Please try again.'
}

/** HPD-171: Posts > Saved ideas. Ideas kept for later; draft one when ready, or delete it. */
export function SavedIdeas({ query, online }: { query: UseQueryResult<SavedIdea[]>; online: boolean }) {
  const [deleting, setDeleting] = useState<SavedIdea | null>(null)

  if (query.isPending) {
    return (
      <div role="status" aria-label="Loading your saved ideas">
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
      </div>
    )
  }
  if (query.isError) {
    const code = codeOf(query.error)
    return (
      <Banner tone="error" action={code === 'session_expired'
        ? <SignInAgainButton />
        : <button type="button" className="font-semibold underline" onClick={() => query.refetch()}>Try again</button>}>
        {code === 'session_expired' ? 'Your session expired. Sign in again to see your saved ideas.'
          : code === 'offline' ? 'You are offline. Reconnect to see your saved ideas.'
          : 'Your saved ideas could not be loaded.'}
      </Banner>
    )
  }

  const ideas = query.data
  if (!ideas.length) {
    return (
      <Card className="text-center">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">No saved ideas yet</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">On Capture, tap Save for later to keep an idea here until you are ready.</p>
        <Link to="/dashboard/capture" className={`mt-3 ${outlineBtn}`}>Go to Capture</Link>
      </Card>
    )
  }

  return (
    <>
      <ul aria-label="Your saved ideas">
        {ideas.map((idea) => (
          <li key={idea.id}>
            <Card>
              <p className="line-clamp-3 whitespace-pre-line text-[var(--color-text-primary)]">{idea.body}</p>
              <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                {idea.source === 'voice' ? 'Spoken' : 'Typed'} · saved {savedOn(idea.saved_at)}
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <button type="button" className={quietBtn} onClick={() => setDeleting(idea)} disabled={!online}>Delete</button>
                <Link to={`/dashboard/capture?idea=${encodeURIComponent(idea.id)}&from=saved`} className={primaryBtn}>Draft my post</Link>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      {deleting && <DeleteSavedIdeaDialog idea={deleting} online={online} onClose={() => setDeleting(null)} />}
    </>
  )
}

function DeleteSavedIdeaDialog({ idea, online, onClose }: { idea: SavedIdea; online: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const titleId = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ContentErrorCode | null>(null)
  const preview = idea.body.length > 110 ? `${idea.body.slice(0, 107)}...` : idea.body

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await deleteSavedIdea(idea.id)
      await queryClient.invalidateQueries({ queryKey: SAVED_IDEAS_KEY })
      onClose()
      showSuccess('Idea deleted.')
    } catch (e) {
      setError(codeOf(e))
      setBusy(false)
    }
  }

  return (
    <Modal role="alertdialog" labelledBy={titleId} onClose={onClose} canClose={!busy}
      className="w-full max-w-sm rounded-[var(--radius-lg)] bg-[var(--color-surface)] p-5 shadow-xl">
      <h2 id={titleId} className="text-lg font-semibold text-[var(--color-text-primary)]">Delete this saved idea?</h2>
      <p className="mt-2 rounded-[var(--radius-sm)] bg-[var(--color-bg-cream)] px-3 py-2 text-sm text-[var(--color-text-secondary)]">{preview}</p>
      <p className="mt-2 text-sm text-[var(--color-text-primary)]">It is removed for good. No posts are affected.</p>
      <p className="mt-1 text-sm font-semibold text-red-700">This cannot be undone.</p>
      {error && (
        <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 text-sm text-red-700">
          {deleteError(error)}
          {error === 'session_expired' && <SignInAgainButton />}
        </div>
      )}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        {/* Focus starts on the safe choice. */}
        <button type="button" onClick={onClose} disabled={busy} className={outlineBtn} autoFocus>Keep it</button>
        <button type="button" onClick={remove} disabled={busy || !online}
          className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
          {busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
          {busy ? 'Deleting...' : 'Delete'}
        </button>
      </div>
    </Modal>
  )
}
