import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowRight, Keyboard, Mic, ClipboardPaste, Sparkles } from 'lucide-react'
import clsx from 'clsx'
import { Button } from '@/components/ui/button'
import { useSession } from '@/features/auth/use-session'
import { useProfile } from '@/features/onboarding/use-profile'
import { saveOnboarding } from '@/features/onboarding/api/onboarding-service'
import { StepInput } from '@/features/onboarding/components/step-input'
import { useSpeechInput } from '@/features/onboarding/use-speech-input'
import {
  STEPS,
  isAnswered,
  sanitizeText,
  validateStep,
  type Answers,
} from '@/features/onboarding/steps'

export function OnboardingPage() {
  const { session } = useSession()
  const userId = session?.user.id
  const { data: profile, isLoading } = useProfile(userId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const voice = useSpeechInput(() => {})

  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<Answers>({})
  const [furthest, setFurthest] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const resumed = useRef(false)

  // Resume where the user left off.
  useEffect(() => {
    if (!profile || resumed.current) return
    resumed.current = true
    const saved = profile.onboarding ?? {}
    setAnswers(saved)
    const firstOpen = STEPS.findIndex((s) => s.required && !isAnswered(saved[s.id]))
    const start = firstOpen === -1 ? 0 : firstOpen
    setIndex(start)
    setFurthest(start)
  }, [profile])

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center text-[var(--color-text-secondary)]">Loading…</div>
  }
  if (profile?.onboarding_completed) return <Navigate to="/dashboard/home" replace />

  const step = STEPS[index]
  const isLast = index === STEPS.length - 1
  const value = answers[step.id] ?? (step.kind === 'multi' ? [] : '')
  const progress = ((index + 1) / STEPS.length) * 100

  async function next() {
    if (!userId || saving) return
    const raw = answers[step.id]
    const clean =
      typeof raw === 'string' ? sanitizeText(raw, step.kind === 'longtext') : raw
    const problem = validateStep(step, clean)
    if (problem) return setError(problem)

    const merged: Answers = { ...answers }
    if (isAnswered(clean)) merged[step.id] = clean as string | string[]
    else delete merged[step.id]

    setError(null)
    setSaving(true)
    try {
      await saveOnboarding(userId, merged, isLast)
      setAnswers(merged)
      if (isLast) {
        await queryClient.invalidateQueries({ queryKey: ['profile', userId] })
        navigate('/dashboard/home', { replace: true })
        return
      }
      setIndex(index + 1)
      setFurthest(Math.max(furthest, index + 1))
    } catch {
      setError('We could not save that. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  function goTo(i: number) {
    if (i > furthest) return
    setError(null)
    setIndex(i)
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg-cream)]">
      <title>Set up Hiba</title>
      <meta name="robots" content="noindex" />

      <header className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white">
              <Sparkles size={20} aria-hidden="true" />
            </span>
            <span className="text-lg font-semibold">Hiba</span>
            <span className="rounded-full bg-[var(--color-primary-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--color-primary-dark)]">AI</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-cream)] px-3 py-1.5">
              Step {index + 1} of {STEPS.length} · <strong>{step.label}</strong>
            </span>
            <span className="hidden items-center gap-1.5 rounded-full border border-[var(--color-border)] px-3 py-1.5 sm:flex">
              <Mic size={14} aria-hidden="true" />
              {voice.supported ? 'Voice Engine Active' : 'Voice unavailable'}
            </span>
          </div>
        </div>
        <div role="progressbar" aria-valuemin={0} aria-valuemax={STEPS.length} aria-valuenow={index + 1}
          aria-label="Onboarding progress" className="h-1 bg-[var(--color-border)]">
          <div className="h-full bg-[var(--color-primary)] transition-all duration-[var(--motion-duration-base)]" style={{ width: `${progress}%` }} />
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-10">
        <form
          onSubmit={(e) => { e.preventDefault(); void next() }}
          className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-sm sm:p-10"
        >
          <span className="inline-block rounded-full bg-[var(--color-primary-soft)] px-3 py-1 text-sm font-medium text-[var(--color-primary-dark)]">
            {step.category}
          </span>
          <h1 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">{step.title}</h1>
          <p className="mt-3 text-base text-[var(--color-text-secondary)]">{step.description}</p>

          <p className="mb-2 mt-8 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
            {step.label}{!step.required && ' (optional)'}
          </p>
          <StepInput
            key={step.id}
            step={step}
            value={value}
            onChange={(v) => { setError(null); setAnswers({ ...answers, [step.id]: v }) }}
            onSubmit={() => void next()}
          />

          {error && <p role="alert" className="mt-4 text-sm text-[var(--color-error)]">{error}</p>}

          <div className="mt-8 flex items-center justify-between gap-3 border-t border-[var(--color-border)] pt-6">
            {index > 0 ? (
              <Button type="button" variant="secondary" onClick={() => goTo(index - 1)}>
                <ArrowLeft size={16} className="mr-1 inline" aria-hidden="true" />Back
              </Button>
            ) : (
              <span className="text-sm text-[var(--color-text-secondary)]">Press Enter to continue</span>
            )}
            <Button type="submit" disabled={saving} className="px-6 py-3">
              {saving ? 'Saving…' : isLast ? 'Finish' : step.required || isAnswered(answers[step.id]) ? 'Continue' : 'Skip'}
              {!saving && <ArrowRight size={16} className="ml-2 inline" aria-hidden="true" />}
            </Button>
          </div>
        </form>

        <nav aria-label="Jump to step" className="mt-8 flex flex-wrap items-center justify-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <span className="mr-2 hidden items-center gap-3 sm:flex">
            <span className="flex items-center gap-1"><Keyboard size={14} aria-hidden="true" />Type</span>
            <span className="flex items-center gap-1"><Mic size={14} aria-hidden="true" />Speak</span>
            <span className="flex items-center gap-1"><ClipboardPaste size={14} aria-hidden="true" />Paste</span>
          </span>
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => goTo(i)}
              disabled={i > furthest}
              aria-label={`Go to step ${i + 1}: ${s.label}`}
              aria-current={i === index ? 'step' : undefined}
              className={clsx(
                'h-8 w-8 rounded-full font-mono text-xs font-bold',
                i === index ? 'bg-[var(--color-primary)] text-white' : 'hover:bg-[var(--color-bg-soft-green)] disabled:opacity-40',
              )}
            >
              {i + 1}
            </button>
          ))}
        </nav>
      </main>
    </div>
  )
}
