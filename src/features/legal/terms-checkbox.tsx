interface TermsCheckboxProps {
  id: string
  checked: boolean
  onChange: (checked: boolean) => void
  error?: string | null
}

export function TermsCheckbox({ id, checked, onChange, error }: TermsCheckboxProps) {
  const link = 'text-[var(--color-primary-dark)] underline'
  return (
    <div className="text-left">
      <label htmlFor={id} className="flex items-start gap-2 text-sm text-[var(--color-text-primary)]">
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
          aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined}
          className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-primary-dark)]" />
        <span>
          I have read and agree to the{' '}
          <a href="/terms" target="_blank" rel="noopener noreferrer" className={link}>Terms of Service</a> and the{' '}
          <a href="/privacy" target="_blank" rel="noopener noreferrer" className={link}>Privacy Policy</a>.
        </span>
      </label>
      {error && <p id={`${id}-error`} role="alert" className="mt-1 text-sm text-[var(--color-error)]">{error}</p>}
    </div>
  )
}
