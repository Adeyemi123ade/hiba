import { GUIDANCE_MAX } from '@/features/content/api/content-service'

/** The parts of the guidance, split at full stops: a quick reason counts as picked when it is one of them. */
export const reasonsIn = (g: string) => g.split(/\.\s*/).map((x) => x.trim()).filter(Boolean)

/** Adds a quick reason to the guidance, or takes it out again if it is already there. */
export function toggleReason(g: string, reason: string): string {
  const parts = reasonsIn(g)
  const next = parts.includes(reason) ? parts.filter((x) => x !== reason) : [...parts, reason]
  return next.join('. ').slice(0, GUIDANCE_MAX)
}
