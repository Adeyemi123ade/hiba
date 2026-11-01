import { useRef } from 'react'
import { ClipboardPaste, Lock, Mic, Square } from 'lucide-react'
import clsx from 'clsx'
import type { OnboardingStep } from '@/features/onboarding/steps'
import { useSpeechInput } from '@/features/onboarding/use-speech-input'

interface StepInputProps {
  step: OnboardingStep
  value: string | string[]
  onChange: (value: string | string[]) => void
  onSubmit: () => void
}

export function StepInput({ step, value, onChange, onSubmit }: StepInputProps) {
  if (step.kind === 'multi' || step.kind === 'single') {
    return <OptionPicker step={step} value={value} onChange={onChange} />
  }
  return <TextEntry step={step} value={typeof value === 'string' ? value : ''} onChange={onChange} onSubmit={onSubmit} />
}

function OptionPicker({ step, value, onChange }: Omit<StepInputProps, 'onSubmit'>) {
  const selected = Array.isArray(value) ? value : value ? [value] : []
  function toggle(v: string) {
    if (step.kind === 'single') return onChange(v)
    if (selected.includes(v)) return onChange(selected.filter((s) => s !== v))
    if (step.maxSelect && selected.length >= step.maxSelect) return
    onChange([...selected, v])
  }
  return (
    <div role="group" aria-label={step.label} className="flex flex-wrap gap-3">
      {step.options?.map((o) => {
        const on = selected.includes(o.value)
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(o.value)}
            className={clsx(
              'rounded-[var(--radius-lg)] border px-4 py-3 text-sm font-medium transition-colors',
              on
                ? 'border-[var(--color-primary)] bg-[var(--color-primary-soft)] text-[var(--color-primary-dark)]'
                : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] hover:border-[var(--color-primary-light)]',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function TextEntry({ step, value, onChange, onSubmit }: Omit<StepInputProps, 'value'> & { value: string }) {
  const valueRef = useRef(value)
  valueRef.current = value
  const speech = useSpeechInput((text) => {
    const next = `${valueRef.current} ${text}`.trim()
    onChange(step.maxLength ? next.slice(0, step.maxLength) : next)
  })

  async function paste() {
    try {
      const text = await navigator.clipboard.readText()
      const next = `${valueRef.current} ${text}`.trim()
      onChange(step.maxLength ? next.slice(0, step.maxLength) : next)
    } catch {
      /* clipboard permission denied: user can still paste with Ctrl/Cmd+V */
    }
  }

  const common = {
    id: 'step-field',
    value,
    maxLength: step.maxLength,
    placeholder: step.placeholder,
    autoFocus: true,
    'aria-label': step.label,
    className: 'w-full resize-none bg-transparent text-lg text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-secondary)]/60',
  }

  return (
    <div>
      <div className="flex items-start gap-3 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-bg-cream)] px-5 py-4">
        {step.kind === 'longtext' ? (
          <textarea
            {...common}
            rows={5}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSubmit()
            }}
          />
        ) : (
          <input {...common} type="text" autoComplete="off" onChange={(e) => onChange(e.target.value)} />
        )}
        <div className="flex shrink-0 items-center gap-2">
          {speech.supported && (
            <button
              type="button"
              onClick={speech.toggle}
              aria-label={speech.listening ? 'Stop recording' : 'Speak your answer'}
              className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-dark)]"
            >
              {speech.listening ? <Square size={16} /> : <Mic size={18} />}
            </button>
          )}
          <button
            type="button"
            onClick={paste}
            aria-label="Paste from clipboard"
            className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-soft-green)]"
          >
            <ClipboardPaste size={18} />
          </button>
        </div>
      </div>
      <p className="mt-3 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
        <Lock size={14} aria-hidden="true" />
        You can type, speak with the microphone, or paste anytime.
        {step.maxLength && (
          <span className="ml-auto tabular-nums">{value.length}/{step.maxLength}</span>
        )}
      </p>
    </div>
  )
}
