import { useRef, useState } from 'react'
import { Check, ClipboardPaste, Lock, Mic, Plus, Square, X } from 'lucide-react'
import clsx from 'clsx'
import {
  CUSTOM_MAX, labelFor, readPrefs, sanitizeText, writePrefs, type OnboardingStep, type StepOption, type WorkingPrefs,
} from '@/features/onboarding/steps'
import { useSpeechInput } from '@/features/onboarding/use-speech-input'
import { ICONS } from '@/features/onboarding/icons'

interface StepInputProps {
  step: OnboardingStep
  value: string | string[]
  onChange: (value: string | string[]) => void
  onSubmit: () => void
}

export function StepInput({ step, value, onChange, onSubmit }: StepInputProps) {
  if (step.kind === 'prefs') {
    return <PrefsEditor value={value} onChange={onChange} />
  }
  if (step.kind === 'multi' || step.kind === 'single') {
    return <ChipPicker step={step} value={value} onChange={onChange} />
  }
  return (
    <TextEntry step={step} value={typeof value === 'string' ? value : ''} onChange={onChange} onSubmit={onSubmit} />
  )
}

const clearBtn =
  'inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-soft-green)] hover:text-[var(--color-text-primary)]'

function ChipPicker({ step, value, onChange }: Omit<StepInputProps, 'onSubmit'>) {
  const selected = Array.isArray(value) ? value : value ? [value] : []
  const [draft, setDraft] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const optionValues = new Set(step.options?.map((o) => o.value))
  const customItems = selected.filter((v) => !optionValues.has(v))
  const single = step.kind === 'single'

  function toggle(v: string) {
    setMessage(null)
    if (single) return onChange(v)
    if (selected.includes(v)) return onChange(selected.filter((s) => s !== v))
    if (step.maxSelect && selected.length >= step.maxSelect) {
      return setMessage(`You can choose up to ${step.maxSelect}. Tap one to remove it first.`)
    }
    onChange([...selected, v])
  }

  function addCustom() {
    const text = sanitizeText(draft, false)
    if (!text) return
    if (text.length > CUSTOM_MAX) return setMessage(`Keep it under ${CUSTOM_MAX} characters.`)
    if (selected.some((s) => s.toLowerCase() === text.toLowerCase())) return setDraft('')
    if (step.maxSelect && selected.length >= step.maxSelect) {
      return setMessage(`You can choose up to ${step.maxSelect}. Tap one to remove it first.`)
    }
    onChange([...selected, text])
    setDraft('')
    setMessage(null)
  }

  const chip = (on: boolean) =>
    clsx(
      'rounded-full border px-4 py-2 text-sm font-medium transition-colors',
      on
        ? 'border-[var(--color-primary)] bg-[var(--color-primary-soft)] text-[var(--color-primary-dark)]'
        : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] hover:border-[var(--color-primary-light)]',
    )

  return (
    <div>
      <div role="group" aria-label={step.label} className={groupClass(step.display)}>
        {step.options?.map((opt) => (
          <OptionButton key={opt.value} step={step} option={opt} on={selected.includes(opt.value)}
            onClick={() => toggle(opt.value)} />
        ))}
      </div>
      {customItems.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {customItems.map((c) => (
            <button key={c} type="button" aria-pressed="true" aria-label={`Remove ${labelFor(step, c)}`}
              onClick={() => onChange(selected.filter((s) => s !== c))}
              className={clsx(chip(true), 'inline-flex items-center gap-1')}>
              {labelFor(step, c)}
              <X size={14} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}

      {step.allowCustom && (
        <div className="mt-4 flex items-center gap-2">
          <input
            type="text"
            value={draft}
            maxLength={CUSTOM_MAX}
            aria-label="Add your own answer"
            placeholder={step.customLabel ?? 'Or type your own and press Enter'}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addCustom()
              }
            }}
            className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-cream)] px-3 py-2 text-sm outline-none"
          />
          <button type="button" onClick={addCustom} disabled={!draft.trim()}
            className="inline-flex items-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--color-primary-dark)] disabled:opacity-50">
            <Plus size={16} aria-hidden="true" />Add
          </button>
          {draft && (
            <button type="button" onClick={() => setDraft('')} className={clearBtn}>
              <X size={14} aria-hidden="true" />Clear
            </button>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between text-xs text-[var(--color-text-secondary)]">
        <span>
          {!single && step.maxSelect ? `${selected.length} of ${step.maxSelect} chosen` : !single ? `${selected.length} chosen` : ''}
        </span>
        {selected.length > 0 && !single && (
          <button type="button" onClick={() => { setMessage(null); onChange([]) }} className={clearBtn}>
            <X size={14} aria-hidden="true" />Clear all
          </button>
        )}
      </div>
      {message && <p role="alert" className="mt-2 text-sm text-[var(--color-error)]">{message}</p>}
    </div>
  )
}

function groupClass(display: OnboardingStep['display']) {
  switch (display) {
    case 'cards':
      return 'grid grid-cols-2 gap-3 sm:grid-cols-3'
    case 'icons':
      return 'grid grid-cols-2 gap-3 sm:grid-cols-3'
    case 'platforms':
    case 'list':
      return 'flex flex-col gap-3'
    default:
      return 'flex flex-wrap gap-2'
  }
}

const BRAND: Record<string, { text: string; className: string }> = {
  linkedin: { text: 'in', className: 'bg-[#0a66c2] text-white' },
  'x-twitter': { text: 'X', className: 'bg-black text-white' },
  substack: { text: 'S', className: 'bg-[#ff6719] text-white' },
}

function OptionButton({ step, option, on, onClick }: { step: OnboardingStep; option: StepOption; on: boolean; onClick: () => void }) {
  const Icon = option.icon ? ICONS[option.icon] : undefined
  const base = 'transition-colors text-left'
  const state = on
    ? 'border-[var(--color-primary)] bg-[var(--color-bg-light-green)]'
    : 'border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-primary-light)]'
  const tick = (
    <span className={clsx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
      on ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white' : 'border-[var(--color-border)]')}>
      {on && <Check size={12} aria-hidden="true" />}
    </span>
  )

  if (step.display === 'cards') {
    return (
      <button type="button" aria-pressed={on} onClick={onClick}
        className={clsx(base, state, 'relative flex flex-col items-center gap-2 rounded-[var(--radius-lg)] border p-3 text-center')}>
        <span className="absolute right-2 top-2">{tick}</span>
        {Icon && <span className="mt-2 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-primary-soft)] text-[var(--color-primary-dark)]"><Icon size={20} aria-hidden="true" /></span>}
        <span className="text-sm font-semibold text-[var(--color-ink)]">{option.label}</span>
        {option.description && <span className="text-xs text-[var(--color-text-secondary)]">{option.description}</span>}
      </button>
    )
  }
  if (step.display === 'icons') {
    return (
      <button type="button" aria-pressed={on} onClick={onClick}
        className={clsx(base, state, 'relative flex flex-col items-center gap-2 rounded-[var(--radius-lg)] border px-3 py-4 text-center')}>
        <span className="absolute right-2 top-2">{tick}</span>
        {Icon && <Icon size={22} aria-hidden="true" className="text-[var(--color-text-secondary)]" />}
        <span className="text-sm font-medium text-[var(--color-ink)]">{option.label}</span>
      </button>
    )
  }
  if (step.display === 'platforms' || step.display === 'list') {
    const brand = step.display === 'platforms' ? BRAND[option.value] : undefined
    return (
      <button type="button" aria-pressed={on} onClick={onClick}
        className={clsx(base, state, 'flex items-center gap-3 rounded-[var(--radius-lg)] border px-4 py-3')}>
        {brand ? (
          <span className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold', brand.className)}>{brand.text}</span>
        ) : Icon ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-soft)] text-[var(--color-primary-dark)]"><Icon size={18} aria-hidden="true" /></span>
        ) : null}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-[var(--color-ink)]">{option.label}</span>
          {option.description && <span className="block text-xs text-[var(--color-text-secondary)]">{option.description}</span>}
        </span>
        {tick}
      </button>
    )
  }
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={clsx(base, state, 'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium text-[var(--color-ink)]')}>
      {on ? <Check size={16} aria-hidden="true" className="text-[var(--color-primary)]" /> : Icon ? <Icon size={16} aria-hidden="true" className="text-[var(--color-text-secondary)]" /> : null}
      {option.label}
    </button>
  )
}

function TextEntry({ step, value, onChange, onSubmit }: Omit<StepInputProps, 'value'> & { value: string }) {
  const valueRef = useRef(value)
  valueRef.current = value
  const limit = (text: string) => (step.maxLength ? text.slice(0, step.maxLength) : text)
  const speech = useSpeechInput((text) => onChange(limit(`${valueRef.current} ${text}`.trim())))
  const [pasteError, setPasteError] = useState<string | null>(null)

  async function paste() {
    setPasteError(null)
    try {
      const text = await navigator.clipboard.readText()
      onChange(limit(`${valueRef.current} ${text}`.trim()))
    } catch {
      setPasteError('Your browser blocked paste. Press Ctrl+V (or Cmd+V) inside the box instead.')
    }
  }

  const common = {
    id: 'step-field',
    value,
    maxLength: step.maxLength,
    placeholder: step.placeholder,
    autoFocus: true,
    'aria-label': step.label,
    className:
      'w-full resize-none bg-transparent text-lg text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-secondary)]/60',
  }

  return (
    <div>
      <div className="flex items-start gap-3 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-bg-cream)] px-5 py-4">
        {step.kind === 'longtext' ? (
          <textarea {...common} rows={5} onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSubmit() }} />
        ) : (
          <input {...common} type="text" autoComplete="off" onChange={(e) => onChange(e.target.value)} />
        )}
        <div className="flex shrink-0 items-center gap-2">
          {speech.supported && (
            <button
              type="button"
              onClick={speech.toggle}
              aria-pressed={speech.listening}
              aria-label={speech.listening ? 'Stop recording' : 'Speak your answer'}
              className={clsx(
                'flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] text-white',
                speech.listening ? 'animate-pulse bg-red-500 hover:bg-red-600' : 'bg-[var(--color-primary)] hover:bg-[var(--color-primary-dark)]',
              )}
            >
              {speech.listening ? <Square size={16} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}
            </button>
          )}
          <button type="button" onClick={paste} aria-label="Paste from clipboard"
            className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-soft-green)]">
            <ClipboardPaste size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      {speech.listening && (
        <div role="status" className="mt-3 flex items-center gap-3 rounded-[var(--radius-lg)] bg-[var(--color-primary-soft)] px-4 py-3 text-sm text-[var(--color-primary-dark)]">
          <span className="relative flex h-3 w-3 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
          </span>
          <span className="flex h-4 shrink-0 items-end gap-0.5" aria-hidden="true">
            {[0, 150, 300, 450].map((delay, i) => (
              <span key={delay} className="w-1 animate-pulse rounded bg-[var(--color-primary)]"
                style={{ height: `${[60, 100, 75, 90][i]}%`, animationDelay: `${delay}ms` }} />
            ))}
          </span>
          <span className="min-w-0 break-words">{speech.interim || 'Listening... speak now, tap the red button to stop'}</span>
        </div>
      )}
      {(speech.error || pasteError) && (
        <p role="alert" className="mt-3 text-sm text-[var(--color-error)]">{speech.error ?? pasteError}</p>
      )}

      <div className="mt-3 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
        <Lock size={14} aria-hidden="true" />
        <span>You can type, speak, or paste anytime.</span>
        <span className="ml-auto flex items-center gap-2">
          {step.maxLength && <span className="tabular-nums">{value.length}/{step.maxLength}</span>}
          {value.length > 0 && (
            <button type="button" onClick={() => { speech.stop(); onChange('') }} className={clearBtn}>
              <X size={14} aria-hidden="true" />Clear
            </button>
          )}
        </span>
      </div>
    </div>
  )
}

function Switch({ id, label, hint, checked, onChange }: {
  id: string; label: string; hint: string; checked: boolean; onChange: (on: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <span>
        <label htmlFor={id} className="block cursor-pointer text-sm font-semibold text-[var(--color-ink)]">{label}</label>
        <span id={`${id}-hint`} className="block text-xs text-[var(--color-text-secondary)]">{hint}</span>
      </span>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={`${id}-hint`}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
          checked ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]',
        )}
      >
        <span className={clsx('inline-block h-5 w-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-5' : 'translate-x-0.5')} />
        <span className="sr-only">{checked ? 'On' : 'Off'}</span>
      </button>
    </div>
  )
}

/** HPD-37: automatic drafts, suggested times, and the creator's preferred posting time (the clock). */
function PrefsEditor({ value, onChange }: { value: string | string[]; onChange: (value: string[]) => void }) {
  const prefs = readPrefs(Array.isArray(value) ? value : undefined)
  const set = (change: Partial<WorkingPrefs>) => onChange(writePrefs({ ...prefs, ...change }))

  return (
    <div className="flex flex-col gap-3">
      <Switch id="pref-auto-draft" label="Create drafts automatically" checked={prefs.autoDraft}
        hint="When you capture an idea, Hiba starts writing drafts straight away."
        onChange={(on) => set({ autoDraft: on })} />
      <Switch id="pref-best-times" label="Suggest the best times to post" checked={prefs.bestTimes}
        hint="Hiba recommends posting times. You always pick the final time."
        onChange={(on) => set({ bestTimes: on })} />
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
        <label htmlFor="pref-time" className="block text-sm font-semibold text-[var(--color-ink)]">
          Your preferred posting time
        </label>
        <span id="pref-time-hint" className="block text-xs text-[var(--color-text-secondary)]">
          Scheduled posts go out at this time unless you choose another. Your time zone: {prefs.timezone}.
        </span>
        <input
          id="pref-time"
          type="time"
          step={300}
          required
          value={prefs.postingTime}
          aria-describedby="pref-time-hint"
          onChange={(e) => set({ postingTime: e.target.value })}
          className="mt-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-cream)] px-3 py-2 text-lg text-[var(--color-text-primary)]"
        />
      </div>
    </div>
  )
}
