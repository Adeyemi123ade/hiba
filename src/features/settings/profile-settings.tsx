import { useEffect, useState } from 'react'
import { useBlocker } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, Pencil } from 'lucide-react'
import { Card, SkeletonCard } from '@/components/ui/card'
import { Banner } from '@/components/ui/banner'
import { SignInAgainButton } from '@/features/auth/components/sign-in-again-button'
import { useSession } from '@/features/auth/use-session'
import { useOnline } from '@/features/onboarding/use-online'
import { useProfile } from '@/features/onboarding/use-profile'
import { saveOnboarding } from '@/features/onboarding/api/onboarding-service'
import { StepInput } from '@/features/onboarding/components/step-input'
import {
  STEPS, defaultPrefs, formatAnswer, isAnswered, sanitizeText, validateStep, writePrefs,
  type Answers, type OnboardingStep,
} from '@/features/onboarding/steps'

/** HPD-77 / HPD-78: the onboarding answers, grouped the way people think about them. */
const GROUPS: { title: string; intro: string; ids: string[] }[] = [
  { title: 'Your profile', intro: 'Who you are. Hiba uses this in every draft.', ids: ['preferredName', 'craft', 'intro', 'writingSample'] },
  { title: 'Your content', intro: 'What you write about, why, and for whom.', ids: ['goals', 'audience', 'tone', 'topics'] },
  { title: 'Publishing', intro: 'Where and how often you post, and how much Hiba does for you.', ids: ['platforms', 'frequency', 'approval', 'workingPrefs'] },
]

const stepById = (id: string) => STEPS.find((s) => s.id === id) as OnboardingStep

const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-primary-dark)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50'
const outlineBtn =
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-dark)] disabled:cursor-not-allowed disabled:opacity-50'

/** Extra words shown under some answers in Settings, so nothing promises more than Hiba does today. */
const NOTES: Record<string, string> = {
  writingSample: 'Paste a post you wrote and like. Hiba copies its voice and its layout: line breaks, grouping and how it ends.',
  approval: 'Automatic publishing is not built yet. Until it is, every post waits for your approval, whatever you choose here.',
}

const draftKey = (userId: string, stepId: string) => `hiba:settings-draft:${userId}:${stepId}`
function readDraft(userId: string, stepId: string): string | string[] | undefined {
  try {
    const raw = sessionStorage.getItem(draftKey(userId, stepId))
    return raw ? (JSON.parse(raw) as string | string[]) : undefined
  } catch {
    return undefined
  }
}
function writeDraft(userId: string, stepId: string, value: string | string[] | null) {
  try {
    if (value === null) sessionStorage.removeItem(draftKey(userId, stepId))
    else sessionStorage.setItem(draftKey(userId, stepId), JSON.stringify(value))
  } catch {
    // Storage unavailable: the edit stays on the page only.
  }
}

/** Short version of long answers, so the list stays easy to scan. */
function shortAnswer(step: OnboardingStep, value: string | string[] | undefined) {
  const text = formatAnswer(step, value)
  return step.kind === 'longtext' && text.length > 160 ? `${text.slice(0, 157)}...` : text
}

export function ProfileSettings() {
  const { session } = useSession()
  const userId = session?.user.id
  const online = useOnline()
  const queryClient = useQueryClient()
  const profile = useProfile(userId)
  const [editing, setEditing] = useState<string | null>(null)
  const [value, setValue] = useState<string | string[]>('')
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)

  const answers: Answers = profile.data?.onboarding ?? {}

  // Leaving Settings with an unsaved edit: ask first (the edit is also kept in this tab).
  const blocker = useBlocker(dirty)
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  function open(step: OnboardingStep) {
    if (!userId) return
    if (dirty && editing && editing !== step.id) {
      setError('Save or cancel your current change first.')
      return
    }
    const saved = answers[step.id] ?? (step.kind === 'prefs' ? writePrefs(defaultPrefs()) : step.kind === 'multi' ? [] : '')
    const draft = readDraft(userId, step.id)
    setEditing(step.id)
    setValue(draft ?? saved)
    setDirty(draft !== undefined)
    setError(null)
    setSavedId(null)
  }

  function close() {
    if (userId && editing) writeDraft(userId, editing, null)
    setEditing(null)
    setDirty(false)
    setError(null)
  }

  async function save(step: OnboardingStep) {
    if (!userId) return
    if (!navigator.onLine) {
      setError('You are offline. Your change is kept on this page. Reconnect, then press Save again.')
      return
    }
    const clean =
      typeof value === 'string'
        ? sanitizeText(value, step.kind === 'longtext')
        : Array.isArray(value) && step.allowCustom
          ? value.map((v) => sanitizeText(v, false)).filter(Boolean)
          : value
    const problem = validateStep(step, clean)
    if (problem) {
      setError(problem)
      return
    }
    const merged: Answers = { ...answers }
    if (isAnswered(clean)) merged[step.id] = clean as string | string[]
    else delete merged[step.id]
    setSaving(true)
    setError(null)
    try {
      await saveOnboarding(userId, merged, true)
      queryClient.setQueryData(['profile', userId], (old: typeof profile.data) =>
        old ? { ...old, onboarding: merged, preferred_name: typeof merged.preferredName === 'string' ? merged.preferredName : old.preferred_name } : old)
      await queryClient.invalidateQueries({ queryKey: ['profile', userId] })
      writeDraft(userId, step.id, null)
      setEditing(null)
      setDirty(false)
      setSavedId(step.id)
    } catch (err) {
      const e = err as { code?: string; message?: string; status?: number }
      if (e.status === 401 || e.code === 'PGRST301' || /jwt/i.test(e.message ?? '')) setSessionExpired(true)
      else if (!navigator.onLine || /failed to fetch|network/i.test(e.message ?? '')) {
        setError('We could not reach the server. Your change is kept on this page. Check your connection, then press Save again.')
      } else setError('We could not save that. Your change is kept on this page. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (profile.isPending) {
    return <div role="status" aria-label="Loading your settings"><SkeletonCard lines={4} /><SkeletonCard lines={4} /></div>
  }
  if (profile.isError || !profile.data) {
    return (
      <Banner tone="error" action={
        <button type="button" className="font-semibold underline" onClick={() => profile.refetch()} disabled={!online}>Try again</button>
      }>
        {online ? 'We could not load your settings.' : 'You are offline. Reconnect to see your settings.'}
      </Banner>
    )
  }

  return (
    <>
      {sessionExpired && (
        <Banner tone="warning" action={<SignInAgainButton />}>
          Your session expired. Your change is kept on this device. Sign in again, then press Save.
        </Banner>
      )}
      {!online && <Banner tone="warning">You are offline. You can look at your settings, but saving needs a connection.</Banner>}

      {blocker.state === 'blocked' && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
          <div role="alertdialog" aria-modal="true" aria-labelledby="settings-leave"
            className="w-full max-w-sm rounded-[var(--radius-lg)] bg-[var(--color-surface)] p-5 shadow-xl">
            <h2 id="settings-leave" className="text-lg font-semibold text-[var(--color-text-primary)]">You have an unsaved change</h2>
            <p className="mt-2 text-sm text-[var(--color-text-secondary)]">It stays in this tab if you leave, but it is not saved to your profile.</p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" className={outlineBtn} onClick={() => blocker.reset?.()}>Stay</button>
              <button type="button" className={primaryBtn} onClick={() => blocker.proceed?.()}>Leave anyway</button>
            </div>
          </div>
        </div>
      )}

      {GROUPS.map((group) => (
        <Card key={group.title} aria-labelledby={`group-${group.title}`}>
          <h2 id={`group-${group.title}`} className="text-lg font-semibold text-[var(--color-text-primary)]">{group.title}</h2>
          <p className="mb-2 text-sm text-[var(--color-text-secondary)]">{group.intro}</p>
          <dl className="divide-y divide-[var(--color-border)]">
            {group.ids.map((id) => {
              const step = stepById(id)
              const isOpen = editing === id
              return (
                <div key={id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <dt className="text-sm font-semibold text-[var(--color-text-primary)]">
                        {step.label}{!step.required && <span className="font-normal text-[var(--color-text-secondary)]"> (optional)</span>}
                      </dt>
                      {!isOpen && (
                        <dd className="mt-0.5 whitespace-pre-line break-words text-sm text-[var(--color-text-secondary)]">
                          {shortAnswer(step, answers[id])}
                        </dd>
                      )}
                      {!isOpen && savedId === id && (
                        <p role="status" className="mt-1 flex items-center gap-1 text-sm text-[var(--color-primary-dark)]">
                          <Check size={14} aria-hidden="true" /> Saved. New drafts will use this. Posts you already have are not changed.
                        </p>
                      )}
                    </div>
                    {!isOpen && (
                      <button type="button" onClick={() => open(step)} aria-label={`Edit ${step.label}`}
                        className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-sm font-medium text-[var(--color-primary-dark)] hover:bg-[var(--color-bg-light-green)]">
                        <Pencil size={14} aria-hidden="true" /> Edit
                      </button>
                    )}
                  </div>
                  {NOTES[id] && <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{NOTES[id]}</p>}

                  {isOpen && (
                    <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-light-green)] p-4">
                      <p className="mb-3 text-sm text-[var(--color-text-secondary)]">{step.description}</p>
                      <StepInput
                        step={step}
                        value={value}
                        onChange={(v) => {
                          setValue(v)
                          setDirty(true)
                          setError(null)
                          if (userId) writeDraft(userId, id, v)
                        }}
                        onSubmit={() => void save(step)}
                      />
                      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button type="button" className={primaryBtn} onClick={() => save(step)} disabled={saving || !online}>
                          {saving && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
                          {saving ? 'Saving...' : 'Save'}
                        </button>
                        <button type="button" className={outlineBtn} onClick={close} disabled={saving}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </dl>
        </Card>
      ))}
      <FollowUpSwitch answers={answers} userId={userId} online={online}
        onSaved={(merged) => queryClient.setQueryData(['profile', userId], (old: typeof profile.data) => (old ? { ...old, onboarding: merged } : old))} />
      {error && !editing && <p role="alert" className="mb-4 text-sm text-red-700">{error}</p>}
    </>
  )
}

/** Phase 2: switch the follow-up comments feature on or off (owner's master prompt, section 10). */
function FollowUpSwitch({ answers, userId, online, onSaved }: {
  answers: Answers
  userId: string | undefined
  online: boolean
  onSaved: (merged: Answers) => void
}) {
  const on = answers.followUpComments !== 'off'
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function flip() {
    if (!userId) return
    setSaving(true)
    setProblem(null)
    setDone(false)
    const merged: Answers = { ...answers, followUpComments: on ? 'off' : 'on' }
    try {
      await saveOnboarding(userId, merged, true)
      onSaved(merged)
      setDone(true)
    } catch {
      setProblem(navigator.onLine ? 'We could not save that. Please try again.' : 'You are offline. Reconnect, then try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card aria-labelledby="followups-title">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="followups-title" className="text-lg font-semibold text-[var(--color-text-primary)]">Follow-up comments</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Hiba can write 5 to 10 comments that extend each LinkedIn post. You review and copy them; Hiba never posts them for you.
          </p>
        </div>
        <button type="button" role="switch" aria-checked={on} aria-labelledby="followups-title" onClick={flip} disabled={saving || !online}
          className={`relative mt-1 h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50 ${on ? 'bg-[var(--color-primary-dark)]' : 'bg-slate-300'}`}>
          <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? 'left-6' : 'left-1'}`} />
        </button>
      </div>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]" aria-live="polite">
        {saving ? 'Saving...' : done ? `Saved. Follow-up comments are ${on ? 'on' : 'off'}.` : on ? 'On' : 'Off'}
      </p>
      {problem && <p role="alert" className="mt-1 text-sm text-red-700">{problem}</p>}
    </Card>
  )
}
