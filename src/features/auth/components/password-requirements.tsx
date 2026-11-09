import { Check, Circle } from 'lucide-react'
import { PASSWORD_RULES } from '@/lib/password'

export function PasswordRequirements({ id, password }: { id: string; password: string }) {
  return (
    <ul id={id} aria-label="Password requirements" className="grid gap-1 text-xs sm:grid-cols-2">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(password)
        return (
          <li
            key={rule.id}
            className={`flex items-center gap-1.5 ${met ? 'text-[var(--color-success)]' : 'text-[var(--color-text-secondary)]'}`}
          >
            {met ? <Check size={14} aria-hidden="true" /> : <Circle size={14} aria-hidden="true" />}
            <span>{rule.label}</span>
            <span className="sr-only">{met ? '(met)' : '(not met)'}</span>
          </li>
        )
      })}
    </ul>
  )
}
