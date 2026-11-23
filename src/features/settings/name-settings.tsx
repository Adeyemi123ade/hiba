import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, Pencil } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { SignInAgainButton } from '@/features/auth/components/sign-in-again-button'
import { useSession } from '@/features/auth/use-session'
import { useOnline } from '@/features/onboarding/use-online'
import { supabase } from '@/lib/supabase'
import { NAME_MAX, cleanName, validateName } from '@/lib/person-name'

interface Names { first_name: string | null; last_name: string | null }

const input =
  'mt-1 h-11 w-full rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[var(--color-text-primary)] aria-[invalid=true]:border-red-700'

/**
 * First name and surname from sign-up (PR #17), editable with the same rules as the sign-up form.
 * Loaded on its own, so the rest of Settings still works if the names columns (migration 0012)
 * are not there yet: this card then simply says names cannot be changed yet.
 */
export function NameSettings() {
  const { session } = useSession()
  const userId = session?.user.id
  const online = useOnline()
  const queryClient = useQueryClient()
  const names = useQuery({
    queryKey: ['profile-names', userId],
    enabled: Boolean(userId),
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('first_name, last_name').eq('id', userId as string).maybeSingle()
      if (error) throw error
      return (data ?? { first_name: null, last_name: null }) as Names
    },
  })
  const [editing, setEditing] = useState(false)
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [errors, setErrors] = useState<{ first?: string; last?: string }>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  function open() {
    setFirst(names.data?.first_name ?? '')
    setLast(names.data?.last_name ?? '')
    setErrors({})
    setSaveError(null)
    setSaved(false)
    setEditing(true)
  }

  async function save() {
    const next = { first: validateName(first, 'first name') ?? undefined, last: validateName(last, 'surname') ?? undefined }
    setErrors(next)
    if (next.first || next.last) {
      document.getElementById(next.first ? 'settings-first-name' : 'settings-last-name')?.focus()
      return
    }
    if (!navigator.onLine) {
      setSaveError('You are offline. Check your network connection and try again.')
      return
    }
    setSaving(true)
    setSaveError(null)
    const { error } = await supabase.from('profiles')
      .update({ first_name: cleanName(first), last_name: cleanName(last) }).eq('id', userId as string)
    setSaving(false)
    if (error) {
      if (error.code === 'PGRST301' || /jwt/i.test(error.message)) setExpired(true)
      else setSaveError('We could not save that.')
      return
    }
    await queryClient.invalidateQueries({ queryKey: ['profile-names', userId] })
    setEditing(false)
    setSaved(true)
  }

  // Names not available on the server yet (for example migration 0012 not run): say so plainly.
  if (names.isError) {
    return (
      <Card>
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Your name</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">Your first name and surname cannot be shown here just now. Please try again later.</p>
      </Card>
    )
  }

  const shown = [names.data?.first_name, names.data?.last_name].filter(Boolean).join(' ')
  return (
    <Card aria-labelledby="name-title">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="name-title" className="text-lg font-semibold text-[var(--color-text-primary)]">Your name</h2>
          {names.isPending ? (
            <div className="mt-1 h-4 w-40 animate-pulse rounded bg-[var(--color-border)]" aria-label="Loading your name" />
          ) : !editing && (
            <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">{shown || 'Not added yet'}</p>
          )}
          {saved && !editing && (
            <p role="status" className="mt-1 flex items-center gap-1 text-sm text-[var(--color-primary-dark)]"><Check size={14} aria-hidden="true" /> Name saved.</p>
          )}
        </div>
        {!editing && names.isSuccess && (
          <button type="button" onClick={open} aria-label="Edit your name"
            className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-sm font-medium text-[var(--color-primary-dark)] hover:bg-[var(--color-bg-light-green)]">
            <Pencil size={14} aria-hidden="true" /> Edit
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Your legal name for your account. The name Hiba calls you is "Preferred name" below.</p>

      {editing && (
        <form noValidate onSubmit={(e) => { e.preventDefault(); void save() }} className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="settings-first-name" className="text-sm font-semibold text-[var(--color-text-primary)]">First name</label>
            <input id="settings-first-name" value={first} maxLength={NAME_MAX} autoComplete="given-name"
              aria-invalid={Boolean(errors.first) || undefined} aria-describedby={errors.first ? 'settings-first-error' : undefined}
              onChange={(e) => { setFirst(e.target.value); setErrors((x) => ({ ...x, first: undefined })) }} className={input} />
            {errors.first && <p id="settings-first-error" role="alert" className="mt-1 text-sm text-red-700">{errors.first}</p>}
          </div>
          <div>
            <label htmlFor="settings-last-name" className="text-sm font-semibold text-[var(--color-text-primary)]">Surname</label>
            <input id="settings-last-name" value={last} maxLength={NAME_MAX} autoComplete="family-name"
              aria-invalid={Boolean(errors.last) || undefined} aria-describedby={errors.last ? 'settings-last-error' : undefined}
              onChange={(e) => { setLast(e.target.value); setErrors((x) => ({ ...x, last: undefined })) }} className={input} />
            {errors.last && <p id="settings-last-error" role="alert" className="mt-1 text-sm text-red-700">{errors.last}</p>}
          </div>
          {saveError && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{saveError}</p>}
          {expired && (
            <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-red-700 sm:col-span-2">
              Your session expired. Sign in again to continue. <SignInAgainButton />
            </p>
          )}
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="submit" disabled={saving || !online}
              className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-primary-dark)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
              {saving && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}{saving ? 'Saving...' : 'Save'}
            </button>
            <button type="button" onClick={() => setEditing(false)} disabled={saving}
              className="rounded-[var(--radius-sm)] border border-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-dark)]">
              Cancel
            </button>
          </div>
        </form>
      )}
    </Card>
  )
}
