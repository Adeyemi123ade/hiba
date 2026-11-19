import { useEffect, useId, useRef, useState } from 'react'
import { Loader2, ShieldCheck } from 'lucide-react'
import { SignInAgainButton } from '@/features/auth/components/sign-in-again-button'
import {
  ContentError, DELETE_WORD, ERROR_TEXT, deletePostForever, wasPublished, type ContentErrorCode, type Post,
} from '@/features/content/api/content-service'

const codeOf = (e: unknown): ContentErrorCode => (e instanceof ContentError ? e.code : 'unknown')

function deleteError(code: ContentErrorCode) {
  if (code === 'not_found') return 'This post is no longer archived or was already deleted. Refresh the page to see where it is.'
  if (code === 'offline') return 'You are offline, so nothing was deleted. Reconnect, then try again.'
  if (code === 'session_expired') return 'Your session expired, so nothing was deleted. Sign in again, then try again.'
  if (code === 'image_delete_failed') return ERROR_TEXT.image_delete_failed
  return 'Something went wrong, so the post was not deleted. Please try again.'
}

/**
 * HPD-57: asks before deleting an archived post for good. The person must type DELETE.
 * Explains exactly what is removed, and that a published post stays on LinkedIn.
 */
export function DeletePostDialog({ post, online, onClose, onDeleted }: {
  post: Pick<Post, 'id' | 'status' | 'image_path' | 'archived_from' | 'external_url'>
  online: boolean
  onClose: () => void
  onDeleted: () => void
}) {
  const [typed, setTyped] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [error, setError] = useState<ContentErrorCode | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const fieldId = useId()

  useEffect(() => input.current?.focus(), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  async function confirm() {
    if (typed.trim() !== DELETE_WORD) {
      setFieldError(`Type ${DELETE_WORD} in capital letters to confirm.`)
      input.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await deletePostForever(post)
      onDeleted()
    } catch (e) {
      setError(codeOf(e))
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
      <div role="alertdialog" aria-modal="true" aria-labelledby={titleId}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-[var(--radius-lg)] bg-[var(--color-surface)] p-5 shadow-xl">
        <h2 id={titleId} className="text-lg font-semibold text-[var(--color-text-primary)]">Delete this post for good?</h2>
        <p className="mt-2 text-sm text-[var(--color-text-primary)]">This removes, straight away and with no copy kept:</p>
        <ul className="mt-1 list-disc pl-5 text-sm text-[var(--color-text-primary)]">
          <li>the post text</li>
          <li>all its earlier versions and follow-up comments</li>
          {post.image_path && <li>its image</li>}
          <li>the idea it came from and its angles, if no other post comes from that idea</li>
        </ul>
        <p className="mt-2 text-sm font-semibold text-red-700">This cannot be undone.</p>

        {wasPublished(post) && (
          <p className="mt-3 flex gap-2 rounded-[var(--radius-sm)] bg-[var(--color-primary-soft)] p-3 text-sm text-[var(--color-primary-dark)]">
            <ShieldCheck size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>Your post stays on LinkedIn. Deleting it here only removes Hiba&apos;s copy, so people can still see it there.</span>
          </p>
        )}

        <label htmlFor={fieldId} className="mt-4 block text-sm font-semibold text-[var(--color-text-primary)]">
          Type {DELETE_WORD} to confirm
        </label>
        <input
          ref={input}
          id={fieldId}
          value={typed}
          disabled={busy}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-invalid={Boolean(fieldError)}
          aria-describedby={fieldError ? `${fieldId}-error` : undefined}
          onChange={(e) => { setTyped(e.target.value); setFieldError(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter') void confirm() }}
          className="mt-1 h-11 w-full rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 aria-[invalid=true]:border-red-700"
        />
        {fieldError && <p id={`${fieldId}-error`} className="mt-1 text-sm text-red-700">{fieldError}</p>}

        {!online && <p role="status" className="mt-3 text-sm text-amber-800">You are offline. Reconnect to delete this post.</p>}
        {error && (
          <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 text-sm text-red-700">
            {deleteError(error)}
            {error === 'session_expired' && <SignInAgainButton />}
          </div>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy}
            className="rounded-[var(--radius-sm)] border border-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-dark)] disabled:opacity-50">
            Keep it
          </button>
          <button type="button" onClick={confirm} disabled={busy || !online}
            className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
            {busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
            {busy ? 'Deleting...' : 'Delete for good'}
          </button>
        </div>
      </div>
    </div>
  )
}
