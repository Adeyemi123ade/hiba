/** How long a success message stays (owner, 25 Nov 2026: gone within one second). */
export const SUCCESS_MS = 1000

type Listener = (text: string) => void
let listener: Listener | null = null

/** Shows a short success message at the bottom of the screen, for example "Copied." */
export function showSuccess(text: string) {
  listener?.(text)
}

/** Used by <SuccessMessages /> only. */
export function listenForSuccess(next: Listener | null) {
  listener = next
}
