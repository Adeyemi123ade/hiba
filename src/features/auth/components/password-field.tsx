import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { authInput, authLabel } from '@/features/auth/components/auth-ui'

interface PasswordFieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  autoComplete: 'new-password' | 'current-password'
  describedBy?: string
  invalid?: boolean
}

export function PasswordField({ id, label, value, onChange, autoComplete, describedBy, invalid }: PasswordFieldProps) {
  const [show, setShow] = useState(false)
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className={authLabel}>{label}</label>
      <div className="relative">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          required
          autoComplete={autoComplete}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${authInput} pr-14`}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? 'Hide password' : 'Show password'}
          aria-pressed={show}
          className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
        >
          {show ? <EyeOff size={22} aria-hidden="true" /> : <Eye size={22} aria-hidden="true" />}
        </button>
      </div>
    </div>
  )
}
