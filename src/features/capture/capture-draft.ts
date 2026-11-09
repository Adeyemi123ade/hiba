// Keeps the idea the user is working on in this browser tab, so going offline,
// a failed request or an expired session never loses their words.
export interface CaptureDraft {
  text: string
  ideaId: string | null
}

const key = (userId: string) => `hiba:capture-draft:${userId}`

export function loadCaptureDraft(userId: string | undefined): CaptureDraft | null {
  if (!userId) return null
  try {
    const raw = sessionStorage.getItem(key(userId))
    if (!raw) return null
    const d = JSON.parse(raw) as Partial<CaptureDraft>
    if (typeof d.text !== 'string') return null
    return { text: d.text, ideaId: typeof d.ideaId === 'string' ? d.ideaId : null }
  } catch {
    return null
  }
}

export function saveCaptureDraft(userId: string | undefined, draft: CaptureDraft) {
  if (!userId) return
  try {
    if (!draft.text.trim() && !draft.ideaId) sessionStorage.removeItem(key(userId))
    else sessionStorage.setItem(key(userId), JSON.stringify(draft))
  } catch {
    // Storage blocked or full: the page still works, only the backup is lost.
  }
}

export function clearCaptureDraft(userId: string | undefined) {
  if (!userId) return
  try {
    sessionStorage.removeItem(key(userId))
  } catch {
    // Ignore: nothing to clear.
  }
}
