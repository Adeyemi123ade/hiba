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

const WHAT_GOES = [
  'Your profile, onboarding answers and writing preferences',
  'All your ideas, drafts, posts, comments and schedules. Scheduled posts will not be published.',
  'Your posting history and usage records',
  'Your LinkedIn connection',
  'Your images and files stored by Hiba, and the image library on this device',
  'Your sign-in account',
]

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
        This removes your account and everything in it from Hiba for good. It cannot be undone. Posts already on
        LinkedIn stay there; delete them on LinkedIn if you want them gone.
      </p>

      {!open ? (
        <button type="button" onClick={() => setOpen(true)}
          className="mt-3 rounded-[var(--radius-sm)] border border-red-700 px-4 py-2 text-sm font-semibold text-red-700">
          Delete my account
        </button>
      ) : (
        <div className="mt-3">
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">These will be deleted:</p>
          <ul className="mt-1 list-disc pl-5 text-sm text-[var(--color-text-primary)]">
            {WHAT_GOES.map((w) => <li key={w}>{w}</li>)}
          </ul>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            If you use Hiba on another device, its image library stays there until you clear that browser.
          </p>
          <label htmlFor="delete-confirm-email" className="mt-3 block text-sm font-medium text-[var(--color-text-primary)]">
            Type your email address to confirm
          </label>
          <input id="delete-confirm-email" type="email" autoComplete="off" value={typed} disabled={deleting}
            onChange={(e) => { setTyped(e.target.value); setError(null) }}
            placeholder={user?.email ?? ''}
            className="mt-1 h-11 w-full max-w-sm rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 text-sm" />
          {error && <p role="alert" className="mt-2 text-sm text-[var(--color-error)]">{DELETE_ERROR_TEXT[error]}</p>}
          {!online && <p className="mt-2 text-sm text-[var(--color-text-secondary)]">You are offline. Reconnect to delete your account.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={confirm} disabled={!matches || deleting || !online}
              className="rounded-[var(--radius-sm)] bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
              {deleting ? 'Deleting your account...' : 'Delete my account forever'}
            </button>
            <button type="button" onClick={close} disabled={deleting}
              className="rounded-[var(--radius-sm)] border border-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-dark)] disabled:opacity-50">
              Keep my account
            </button>
          </div>
        </div>
      )}
    </Card>
  )
}
