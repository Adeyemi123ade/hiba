export interface PasswordRule {
  id: string
  label: string
  test: (password: string) => boolean
}

// Keep in sync with the Supabase Auth password settings (min length 8, lower + upper + digits).
export const PASSWORD_RULES: PasswordRule[] = [
  { id: 'length', label: 'At least 8 characters', test: (p) => p.length >= 8 },
  { id: 'upper', label: 'One uppercase letter (A-Z)', test: (p) => /[A-Z]/.test(p) },
  { id: 'lower', label: 'One lowercase letter (a-z)', test: (p) => /[a-z]/.test(p) },
  { id: 'digit', label: 'One number (0-9)', test: (p) => /[0-9]/.test(p) },
]

const MAX_BYTES = 72 // bcrypt ignores everything after 72 bytes

export function validatePassword(password: string): string | null {
  if (!PASSWORD_RULES.every((r) => r.test(password))) {
    return 'Your password does not meet all the requirements listed below.'
  }
  if (new TextEncoder().encode(password).length > MAX_BYTES) {
    return 'Password is too long. Use 72 characters or fewer.'
  }
  return null
}
