export const NAME_MAX = 60

// Letters from any language, with spaces, hyphens, apostrophes and full stops between them
// (for example "Mary-Jane", "O'Neil", "Adé", "St. John").
const NAME_RE = /^\p{L}[\p{L}\p{M}' .-]*$/u

/** Single spaces, trimmed. */
export function cleanName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

/** Returns a message for the field, or null when the name is fine. */
export function validateName(raw: string, label: 'first name' | 'surname'): string | null {
  const name = cleanName(raw)
  if (!name) return `Please enter your ${label}.`
  if (name.length > NAME_MAX) return `Your ${label} can be up to ${NAME_MAX} characters.`
  if (!NAME_RE.test(name)) return `Please use letters only. Spaces, hyphens (-) and apostrophes (') are fine.`
  return null
}
