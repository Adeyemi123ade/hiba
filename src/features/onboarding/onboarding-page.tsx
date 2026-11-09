import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, ArrowRight, BadgeCheck, Check, Link2, Loader2, Pencil, Settings, ShieldCheck, Sparkles, Target, FileText, Heart,
} from 'lucide-react'
import clsx from 'clsx'
import { useSession } from '@/features/auth/use-session'
import { signOutUser } from '@/features/auth/api/auth-service'
import { useOnline } from '@/features/onboarding/use-online'
import { useProfile } from '@/features/onboarding/use-profile'
import { TermsCheckbox } from '@/features/legal/terms-checkbox'
import { acceptTerms, saveOnboarding } from '@/features/onboarding/api/onboarding-service'
import { StepInput } from '@/features/onboarding/components/step-input'
import { ICONS } from '@/features/onboarding/icons'
import {
  STEPS, defaultPrefs, formatAnswer, isAnswered, normalizeAnswers, sanitizeText, validateStep, writePrefs, type Answers,
} from '@/features/onboarding/steps'

type Phase = 'welcome' | 'steps' | 'summary' | 'building' | 'done'

const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary-dark)] px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-[#126a32] disabled:opacity-60'
const outlineBtn =
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-primary)] px-5 py-3 text-base font-medium text-[var(--color-primary-dark)] hover:bg-[var(--color-bg-light-green)]'

const BUILD_ROWS = [
  { icon: FileText, title: 'Preparing your first content workspace...', text: 'Getting everything in place for you.' },
  { icon: Link2, title: 'Connecting your platforms...', text: 'Setting up your publishing choices.' },
  { icon: Settings, title: 'Setting up your preferences...', text: 'Tuning Hiba to match your style.' },
  { icon: Sparkles, title: 'Almost ready...', text: 'Final touches for a smooth start.' },
]

export function OnboardingPage() {
  const { session } = useSession()
  const userId = session?.user.id
  const { data: profile, isLoading } = useProfile(userId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [phase, setPhase] = useState<Phase>('welcome')
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Answers>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [resumed, setResumed] = useState(false)
  const [buildStep, setBuildStep] = useState(0)
  const [buildError, setBuildError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [slow, setSlow] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [editingFromSummary, setEditingFromSummary] = useState(false)
  const [termsError, setTermsError] = useState<string | null>(null)
  const online = useOnline()
  const draftKey = userId ? `hiba:onboarding-draft:${userId}` : null

  // Resume where the user left off (skips the welcome screen).
  useEffect(() => {
    if (!profile || resumed) return
    setResumed(true)
    let saved: Answers = profile.onboarding ?? {}
    if (Object.keys(saved).length === 0 && draftKey) {
      // Unsaved work from before a session expiry or refresh.
      try {
        const draft = sessionStorage.getItem(draftKey)
        if (draft) saved = JSON.parse(draft) as Answers
      } catch {
        /* storage unavailable: nothing to restore */
      }
    }
    if (Object.keys(saved).length === 0) return
    saved = normalizeAnswers(saved)
    setAnswers(saved)
    // Resume at the next unanswered required question, or at the summary when all are done.
    const firstOpen = STEPS.findIndex((s) => s.required && !isAnswered(saved[s.id]))
    if (firstOpen === -1) {
      setPhase('summary')
      return
    }
    setIndex(firstOpen)
    setPhase('steps')
  }, [profile, resumed, draftKey])

  // Keep unsaved answers on this device so an expired session never costs the user their work.
  useEffect(() => {
    if (!draftKey || Object.keys(answers).length === 0) return
    try {
      sessionStorage.setItem(draftKey, JSON.stringify(answers))
    } catch {
      /* storage unavailable: skip */
    }
  }, [answers, draftKey])

  // "Building your workspace": do the real final save while the checklist plays.
  useEffect(() => {
    if (phase !== 'building' || !userId) return
    let cancelled = false
    setBuildStep(0)
    setBuildError(null)
    const timers = [700, 1400, 2100].map((ms, i) => setTimeout(() => !cancelled && setBuildStep(i + 1), ms))
    Promise.all([saveOnboarding(userId, answers, true), new Promise((r) => setTimeout(r, 2800))])
      .then(() => {
        if (cancelled) return
        setBuildStep(BUILD_ROWS.length)
        setPhase('done')
      })
      .catch((err) => {
        console.error('Final onboarding save failed', err)
        if (!cancelled) setBuildError('We could not finish setting things up. Check your connection and try again.')
      })
    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
    }
  }, [phase, userId, attempt, answers])

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center text-[var(--color-text-secondary)]">Loading...</div>
  }
  // No automatic redirect out of this page: the only automatic redirect in the app goes
  // dashboard -> onboarding (route guard), so the two can never bounce the user back and forth.

  const step = STEPS[index]
  const isLast = index === STEPS.length - 1
  const fallback = step.kind === 'multi' ? [] : step.kind === 'prefs' ? writePrefs(defaultPrefs()) : ''
  const value = answers[step.id] ?? fallback
  const StepIcon = ICONS[step.icon] ?? Sparkles

  async function enterWorkspace() {
    if (draftKey) {
      try {
        sessionStorage.removeItem(draftKey)
      } catch {
        /* ignore */
      }
    }
    await queryClient.invalidateQueries({ queryKey: ['profile', userId] })
    navigate('/dashboard/home', { replace: true })
  }

  const needsTerms = !profile?.terms_accepted_at

  async function startOrLater(later: boolean) {
    if (!userId || saving) return
    if (needsTerms && !agreed) {
      setTermsError('Please accept the Terms of Service and Privacy Policy to continue.')
      return
    }
    setSaving(true)
    try {
      if (needsTerms) await acceptTerms(userId)
      if (!later) {
        setPhase('steps')
        return
      }
      await saveOnboarding(userId, { ...answers, skipped: 'true' }, true)
      await enterWorkspace()
    } catch (err) {
      console.error('Start failed', err)
      setError('We could not save that. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function doLater() {
    if (!userId || saving) return
    setSaving(true)
    try {
      await saveOnboarding(userId, { ...answers, skipped: 'true' }, true)
      await enterWorkspace()
    } catch (err) {
      console.error('Skip failed', err)
      setError('We could not save that. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function next() {
    if (saving) return
    if (!userId) {
      setSessionExpired(true)
      return
    }
    if (!navigator.onLine) {
      setError('You are offline. Your answers are kept on this page. Reconnect, then press Continue again.')
      return
    }
    const raw = answers[step.id] ?? (step.kind === 'prefs' ? writePrefs(defaultPrefs()) : undefined)
    const clean =
      typeof raw === 'string'
        ? sanitizeText(raw, step.kind === 'longtext')
        : Array.isArray(raw) && step.allowCustom
          ? raw.map((v) => sanitizeText(v, false)).filter(Boolean)
          : raw
    const problem = validateStep(step, clean)
    if (problem) return setError(problem)

    const merged: Answers = { ...answers }
    if (isAnswered(clean)) merged[step.id] = clean as string | string[]
    else delete merged[step.id]

    setError(null)
    setSaving(true)
    const slowTimer = setTimeout(() => setSlow(true), 3000)
    try {
      await saveOnboarding(userId, merged, false)
      setAnswers(merged)
      if (isLast || editingFromSummary) openSummary()
      else setIndex(index + 1)
    } catch (err) {
      console.error('Onboarding save failed', err)
      const e = err as { code?: string; message?: string; status?: number }
      if (e.status === 401 || e.code === 'PGRST301' || /jwt/i.test(e.message ?? '')) {
        setSessionExpired(true)
        return
      }
      if (!navigator.onLine || /failed to fetch|network/i.test(e.message ?? '')) {
        setError('We could not reach the server. Check your connection, then press Continue again. Your answers are kept.')
        return
      }
      setError(
        import.meta.env.DEV
          ? `Could not save (${e.code ?? 'no code'}): ${e.message ?? 'unknown error'} [project: ${new URL(import.meta.env.VITE_SUPABASE_URL as string).host}]`
          : 'We could not save that. Please try again.',
      )
    } finally {
      clearTimeout(slowTimer)
      setSlow(false)
      setSaving(false)
    }
  }

  function openSummary() {
    setEditingFromSummary(false)
    setError(null)
    setPhase('summary')
  }

  function editFromSummary(stepIndex: number) {
    setEditingFromSummary(true)
    setError(null)
    setIndex(stepIndex)
    setPhase('steps')
  }

  function finishFromSummary() {
    const missing = STEPS.findIndex((s) => s.required && !isAnswered(answers[s.id]))
    if (missing !== -1) {
      editFromSummary(missing)
      setError('Please answer this question before you finish.')
      return
    }
    setPhase('building')
  }

  function skipStep() {
    setError(null)
    if (isLast || editingFromSummary) openSummary()
    else setIndex(index + 1)
  }

  function goBack() {
    setError(null)
    if (editingFromSummary) openSummary()
    else if (index === 0) setPhase('welcome')
    else setIndex(index - 1)
  }

  const logo = (
    <div className="flex items-center gap-2">
      <span className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary-dark)] text-lg font-bold text-white">H</span>
      <span className="text-xl font-bold text-[var(--color-ink)]">Hiba</span>
    </div>
  )

  return (
    <div className="min-h-screen bg-[var(--color-bg-cream)] pb-10">
      <title>Set up Hiba</title>
      <meta name="robots" content="noindex" />

      <header className="mx-auto flex max-w-xl items-center justify-between px-4 pt-5">
        {logo}
        <div className="flex items-center gap-4 text-sm">
          {phase === 'steps' && (
            <span className="text-[var(--color-ink)]">
              Step <strong className="text-[var(--color-primary-dark)]">{index + 1}</strong> of {STEPS.length}
            </span>
          )}
          {(phase === 'welcome' || phase === 'steps') && (
            <button type="button" className="text-[var(--color-text-secondary)] hover:underline"
              onClick={async () => { await signOutUser(); navigate('/auth', { replace: true }) }}>
              Sign out
            </button>
          )}
        </div>
      </header>

      {phase === 'steps' && (
        <div role="progressbar" aria-valuemin={0} aria-valuemax={STEPS.length} aria-valuenow={index + 1}
          aria-label="Onboarding progress" className="mx-auto mt-4 flex max-w-xl gap-1.5 px-4">
          {STEPS.map((s, i) => (
            <span key={s.id} className={clsx('h-1.5 flex-1 rounded-full', i <= index ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]')} />
          ))}
        </div>
      )}

      {!online && (
        <p role="alert" className="mx-auto mt-4 max-w-xl rounded-[var(--radius-md)] bg-amber-100 px-4 py-2 text-sm text-amber-900">
          You are offline. Your answers are kept on this page. Reconnect to continue.
        </p>
      )}
      {sessionExpired && (
        <div role="alert" className="mx-auto mt-4 flex max-w-xl flex-col gap-2 rounded-[var(--radius-md)] bg-amber-100 px-4 py-3 text-sm text-amber-900">
          <span>Your session expired. Your answers are kept on this device and will be restored when you sign in again.</span>
          <button type="button" className="self-start font-semibold underline"
            onClick={async () => { await signOutUser(); navigate('/auth', { replace: true }) }}>
            Sign in again
          </button>
        </div>
      )}

      <main className="mx-auto max-w-xl px-4 pt-8">
        {phase === 'welcome' && (
          <section className="flex flex-col gap-6 text-center sm:text-left">
            <h1 className="text-3xl font-bold leading-tight text-[var(--color-ink)] sm:text-4xl">
              Meet Hiba, your AI partner for your <span className="text-[var(--color-primary)]">personal brand journey.</span>
            </h1>
            <p className="text-[var(--color-text-secondary)]">
              Every professional has valuable experiences worth sharing. My job is to help you capture them, shape them into meaningful stories, and build a reputation you are proud of.
            </p>
            <ul className="flex flex-col gap-4 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 text-left">
              {[{ icon: Target, t: 'Share your journey', d: 'Capture moments, ideas, and lessons that matter.' },
                { icon: Sparkles, t: 'Let Hiba do the heavy lifting', d: 'I will turn your experiences into content that connects and inspires.' }].map(({ icon: Icon, t, d }) => (
                <li key={t} className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-soft)] text-[var(--color-primary-dark)]"><Icon size={20} aria-hidden="true" /></span>
                  <span><span className="block font-semibold text-[var(--color-ink)]">{t}</span><span className="text-sm text-[var(--color-text-secondary)]">{d}</span></span>
                </li>
              ))}
            </ul>
            {needsTerms && (
              <TermsCheckbox id="welcome-terms" checked={agreed} error={termsError}
                onChange={(v) => { setAgreed(v); if (v) setTermsError(null) }} />
            )}
            <button type="button" className={primaryBtn} onClick={() => void startOrLater(false)} disabled={saving}>
              Let&apos;s build your profile <ArrowRight size={18} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => void startOrLater(true)} disabled={saving} className="text-sm font-medium text-[var(--color-primary-dark)] hover:underline">
              Maybe later
            </button>
            {error && <p role="alert" className="text-sm text-[var(--color-error)]">{error}</p>}
          </section>
        )}

        {phase === 'steps' && (
          <form onSubmit={(e) => { e.preventDefault(); void next() }}
            className="rounded-[var(--radius-xl)] sm:border sm:border-[var(--color-border)] sm:bg-[var(--color-surface)] sm:p-8">
            <div className="flex flex-col items-center text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-primary-soft)] text-[var(--color-primary-dark)]">
                <StepIcon size={30} aria-hidden="true" />
              </span>
              <h1 className="mt-5 text-2xl font-bold text-[var(--color-ink)] sm:text-3xl">{step.title}</h1>
              <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{step.description}</p>
            </div>

            <p className="mb-2 mt-7 text-sm font-semibold text-[var(--color-ink)]">
              {step.label}{!step.required && ' (optional)'}
            </p>
            <StepInput key={step.id} step={step} value={value}
              onChange={(v) => { setError(null); setAnswers({ ...answers, [step.id]: v }) }}
              onSubmit={() => void next()} />

            <div className="mt-6 flex items-start gap-3 rounded-[var(--radius-lg)] bg-[var(--color-bg-light-green)] p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-soft)] text-[var(--color-primary-dark)]">
                <ShieldCheck size={18} aria-hidden="true" />
              </span>
              <p className="text-sm text-[var(--color-text-secondary)]">
                <span className="font-semibold text-[var(--color-primary-dark)]">{step.tip.title}</span>
                <br />{step.tip.text}
              </p>
            </div>

            {error && <p role="alert" className="mt-4 text-sm text-[var(--color-error)]">{error}</p>}

            <div className="mt-6 flex items-center gap-3">
              <button type="button" className={outlineBtn} onClick={goBack}>
                <ArrowLeft size={18} aria-hidden="true" />Back
              </button>
              {!step.required && (
                <button type="button" onClick={skipStep} className="text-sm font-medium text-[var(--color-primary-dark)] underline decoration-dashed underline-offset-4">
                  Skip for now
                </button>
              )}
              <button type="submit" disabled={saving} className={clsx(primaryBtn, 'flex-1')}>
                {saving
                  ? slow ? 'Still saving... slow connection' : 'Saving...'
                  : editingFromSummary ? 'Save and review' : isLast ? 'Review my answers' : 'Continue'}
                {!saving && <ArrowRight size={18} aria-hidden="true" />}
              </button>
            </div>
            {index === 0 && (
              <button type="button" onClick={doLater} disabled={saving} className="mx-auto mt-4 block text-sm font-medium text-[var(--color-primary-dark)] hover:underline">
                I&apos;ll do this later
              </button>
            )}
          </form>
        )}

        {phase === 'summary' && (
          <section className="rounded-[var(--radius-xl)] sm:border sm:border-[var(--color-border)] sm:bg-[var(--color-surface)] sm:p-8">
            <div className="flex flex-col items-center text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-primary-soft)] text-[var(--color-primary-dark)]"><BadgeCheck size={30} aria-hidden="true" /></span>
              <h1 className="mt-5 text-2xl font-bold text-[var(--color-ink)] sm:text-3xl">Check your answers</h1>
              <p className="mt-2 text-sm text-[var(--color-text-secondary)]">This is how Hiba will write and plan for you. Change anything before you finish.</p>
            </div>
            <dl className="mt-6 divide-y divide-[var(--color-border)]">
              {STEPS.map((s, i) => (
                <div key={s.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <dt className="text-sm font-semibold text-[var(--color-ink)]">{s.label}</dt>
                    <dd className={clsx('mt-0.5 break-words text-sm', isAnswered(answers[s.id]) || s.kind === 'prefs'
                      ? 'text-[var(--color-text-secondary)]' : s.required ? 'text-[var(--color-error)]' : 'italic text-[var(--color-text-secondary)]')}>
                      {s.kind === 'longtext' && typeof answers[s.id] === 'string' && (answers[s.id] as string).length > 160
                        ? `${(answers[s.id] as string).slice(0, 157)}...`
                        : formatAnswer(s, answers[s.id])}
                    </dd>
                  </div>
                  <button type="button" onClick={() => editFromSummary(i)} aria-label={`Edit ${s.label}`}
                    className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-sm font-medium text-[var(--color-primary-dark)] hover:bg-[var(--color-bg-light-green)]">
                    <Pencil size={14} aria-hidden="true" />Edit
                  </button>
                </div>
              ))}
            </dl>
            {error && <p role="alert" className="mt-4 text-sm text-[var(--color-error)]">{error}</p>}
            <div className="mt-6 flex items-center gap-3">
              <button type="button" className={outlineBtn} onClick={() => editFromSummary(STEPS.length - 1)}>
                <ArrowLeft size={18} aria-hidden="true" />Back
              </button>
              <button type="button" className={clsx(primaryBtn, 'flex-1')} onClick={finishFromSummary} disabled={!online}>
                Looks good, build my workspace <ArrowRight size={18} aria-hidden="true" />
              </button>
            </div>
          </section>
        )}

        {phase === 'building' && (
          <section className="rounded-[var(--radius-xl)] sm:border sm:border-[var(--color-border)] sm:bg-[var(--color-surface)] sm:p-8">
            <div className="flex flex-col items-center text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--color-primary-soft)] text-[var(--color-primary-dark)]"><Sparkles size={30} aria-hidden="true" /></span>
              <h1 className="mt-5 text-2xl font-bold text-[var(--color-ink)] sm:text-3xl">Building your workspace</h1>
              <p className="mt-2 text-sm text-[var(--color-text-secondary)]">This will not take long. We are setting things up so Hiba can start working for you.</p>
            </div>
            <ul className="mt-6 divide-y divide-[var(--color-border)]" role="status" aria-live="polite">
              {BUILD_ROWS.map(({ icon: Icon, title, text }, i) => (
                <li key={title} className="flex items-center gap-3 py-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-bg-light-green)] text-[var(--color-primary-dark)]"><Icon size={18} aria-hidden="true" /></span>
                  <span className="flex-1"><span className="block text-sm font-semibold text-[var(--color-ink)]">{title}</span><span className="text-xs text-[var(--color-text-secondary)]">{text}</span></span>
                  {i < buildStep ? <Check size={20} className="text-[var(--color-primary)]" aria-label="Done" />
                    : i === buildStep && !buildError ? <Loader2 size={20} className="animate-spin text-[var(--color-primary)]" aria-label="Working" /> : null}
                </li>
              ))}
            </ul>
            {buildError ? (
              <div className="mt-4 flex flex-col items-center gap-3">
                <p role="alert" className="text-sm text-[var(--color-error)]">{buildError}</p>
                <button type="button" className={primaryBtn} onClick={() => setAttempt(attempt + 1)}>Try again</button>
              </div>
            ) : (
              <p className="mt-4 flex items-center gap-2 rounded-[var(--radius-lg)] bg-[var(--color-bg-light-green)] p-4 text-sm text-[var(--color-text-secondary)]">
                <Heart size={18} className="shrink-0 text-[var(--color-primary-dark)]" aria-hidden="true" />
                <span><strong className="text-[var(--color-primary-dark)]">Thanks for your patience!</strong> We are building something great to help you show up and stand out.</span>
              </p>
            )}
          </section>
        )}

        {phase === 'done' && (
          <section className="flex flex-col items-center gap-5 rounded-[var(--radius-xl)] py-6 text-center sm:border sm:border-[var(--color-border)] sm:bg-[var(--color-surface)] sm:p-10">
            <span className="flex h-24 w-24 items-center justify-center rounded-full bg-[var(--color-primary-soft)] text-[var(--color-primary-dark)]"><BadgeCheck size={52} aria-hidden="true" /></span>
            <h1 className="text-3xl font-bold text-[var(--color-ink)] sm:text-4xl">Everything is ready.</h1>
            <p className="max-w-sm text-[var(--color-text-secondary)]">
              From this point forward, simply capture what happens in your day. Hiba will help transform those moments into content that reflects your experience, your expertise, and your voice.
            </p>
            <button type="button" className={primaryBtn} onClick={() => void enterWorkspace()}>
              Enter My Workspace <ArrowRight size={18} aria-hidden="true" />
            </button>
          </section>
        )}
      </main>
    </div>
  )
}
