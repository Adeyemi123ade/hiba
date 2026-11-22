/**
 * How taps and long presses behave in the Images gallery.
 * - Library ('browse'): tap opens the image; long press starts selecting; then taps add or remove.
 * - Choosing for a post ('pick'): every tap selects, never opens, never deletes.
 */
export interface Selection {
  active: boolean
  ids: string[]
}

export const NO_SELECTION: Selection = { active: false, ids: [] }

export function longPress(s: Selection, id: string): Selection {
  return { active: true, ids: s.ids.includes(id) ? s.ids : [...s.ids, id] }
}

/** Starts selecting without choosing anything yet (the Select button, for mouse and keyboard). */
export function startSelecting(): Selection {
  return { active: true, ids: [] }
}

export function tap(
  s: Selection,
  id: string,
  mode: 'browse' | 'pick',
  max = Infinity,
): { selection: Selection; open?: string; full?: boolean } {
  if (mode === 'browse' && !s.active) return { selection: s, open: id }
  if (s.ids.includes(id)) {
    const ids = s.ids.filter((x) => x !== id)
    // In the library, un-selecting the last image leaves selection mode, so no Delete is left showing.
    return { selection: { active: mode === 'pick' || ids.length > 0, ids } }
  }
  if (s.ids.length >= max) return { selection: s, full: true }
  return { selection: { active: true, ids: [...s.ids, id] } }
}
