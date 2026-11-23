import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { useSession } from '@/features/auth/use-session'
import { useOnline } from '@/features/onboarding/use-online'
import {
  AccountDeletionError, DELETE_ERROR_TEXT, deleteMyAccount, emailMatches, type DeleteStep,
} from '@/features/settings/account-deletion'

export const ACCOUNT_DELETED_NOTICE = 'Your account has been deleted.'

/** HPD-157: anyone can delete their own account here. Once deleted, everything goes. */
export function DeleteAccount() {
  const { session } = useSession()
  const user = session?.user
  const online = useOnline()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<DeleteStep | null>(null)
  const matches = emailMatches(typed, user?.email)

  function close() {
    setOpen(false)
    setTyped('')
    setError(null)
  }

  async function confirm() {
    if (!user || !matches) return
    setDeleting(true)
    setError(null)
    try {
      await deleteMyAccount(user.id)
      queryClient.clear()
      navigate('/auth', { replace: true, state: { notice: ACCOUNT_DELETED_NOTICE } })
    } catch (e) {
      setError(e instanceof AccountDeletionError ? e.step : 'account')
      setDeleting(false)
    }
  }

  return (
    <Card className="border-red-700">
      <h2 id="delete-title" className="text-lg font-semibold text-red-800">Delete your account</h2>
      <p className="text-sm text-[var(--color-text-secondary)]">
        This deletes your account and every detail related to you. This process cannot be reversed.
      </p>

      {!open ? (
        <button type="button" onClick={() => setOpen(true)}
          className="mt-3 rounded-[var(--radius-sm)] border border-red-700 px-4 py-2 text-sm font-semibold text-red-700">
          Delete my account
        </button>
      ) : (
        <div className="mt-3">
          <label htmlFor="delete-confirm-email" className="block text-sm font-medium text-[var(--color-text-primary)]">
            Type your email address to confirm
          </label>
          <input id="delete-confirm-email" type="email" autoComplete="off" value={typed} disabled={deleting}
            onChange={(e) => { setTyped(e.target.value); setError(null) }}
            placeholder={user?.email ?? ''}
            className="mt-1 h-11 w-full max-w-sm rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 text-sm" />
          {error && <p role="alert" className="mt-2 text-sm text-[var(--color-error)]">{DELETE_ERROR_TEXT[error]}</p>}
          {!online && <p className="mt-2 text-sm text-[var(--color-text-secondary)]">You are offline. Check your network connection and try again.</p>}
          {/* Side by side, never stacked (owner, 23 Nov 2026). */}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={confirm} disabled={!matches || deleting || !online}
              className="whitespace-nowrap rounded-[var(--radius-sm)] bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
              {deleting ? 'Deleting...' : 'Delete account'}
            </button>
            <button type="button" onClick={close} disabled={deleting}
              className="whitespace-nowrap rounded-[var(--radius-sm)] border border-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-dark)] disabled:opacity-50">
              Cancel
            </button>
          </div>
        </div>
      )}
    </Card>
  )
}
