// Common mistyped domains -> what the user most likely meant.
const TYPO_DOMAINS: Record<string, string> = {
  'gmal.com': 'gmail.com', 'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com',
  'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gmail.cm': 'gmail.com',
  'gamil.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmail.comm': 'gmail.com',
  'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yahoo.con': 'yahoo.com',
  'hotmal.com': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'outlok.com': 'outlook.com',
  'outlook.con': 'outlook.com', 'icloud.con': 'icloud.com',
}

// A real address needs a name, one @, and a domain with a dot and an alphabetic ending (2+ letters).
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

/** Returns an error message, or null when the address looks valid. */
export function validateEmail(raw: string): string | null {
  const email = normalizeEmail(raw)
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return 'Enter a valid email address, like name@example.com.'
  }
  const domain = email.split('@')[1]
  const fix = TYPO_DOMAINS[domain]
  if (fix) return `Did you mean ${email.split('@')[0]}@${fix}?`
  return null
}
