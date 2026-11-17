import { CheckCircle2, Info } from 'lucide-react'
import { PASSWORD_RULES } from '@/lib/password'

const MISSING: Record<string, string> = {
  length: '8 characters',
  upper: 'an uppercase letter',
  lower: 'a lowercase letter',
  digit: 'a number',
}

/** One-line password guidance from the design; says exactly what is still missing while typing. */
export function PasswordHint({ id, password }: { id: string; password: string }) {
  const missing = PASSWORD_RULES.filter((r) => !r.test(password)).map((r) => MISSING[r.id] ?? r.label)
  if (password && missing.length === 0) {
    return (
      <p id={id} className="flex items-center gap-2 text-sm text-[var(--color-success)]">
        <CheckCircle2 size={18} aria-hidden="true" /> Password meets all the requirements.
      </p>
    )
  }
  return (
    <p id={id} aria-live="polite" className="flex items-start gap-2 text-sm text-[var(--color-text-secondary)]">
      <Info size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
      {password
        ? <span>Still needed: {missing.join(', ')}.</span>
        : <span>At least 8 characters (A-Z, a-z, 0-9)</span>}
    </p>
  )
}
