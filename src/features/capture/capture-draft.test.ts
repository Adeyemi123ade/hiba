import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearCaptureDraft, loadCaptureDraft, saveCaptureDraft } from './capture-draft'

// The idea on Capture is kept in this browser tab, so going offline, a failed request or an
// expired session never loses the person's words.
let store: Map<string, string>
const tab = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
}

beforeEach(() => {
  store = new Map()
  vi.stubGlobal('sessionStorage', tab)
})
afterEach(() => vi.unstubAllGlobals())

describe('keeping the idea on Capture', () => {
  it('gives back exactly what was typed, with the idea it belongs to', () => {
    saveCaptureDraft('u1', { text: 'Fewer meetings, more focus', ideaId: 'i1' })
    expect(loadCaptureDraft('u1')).toEqual({ text: 'Fewer meetings, more focus', ideaId: 'i1' })
  })

  it('keeps each person\'s idea apart', () => {
    saveCaptureDraft('u1', { text: 'Mine', ideaId: null })
    expect(loadCaptureDraft('u2')).toBeNull()
  })

  it('keeps nothing when no one is signed in', () => {
    saveCaptureDraft(undefined, { text: 'Lost?', ideaId: null })
    expect(store.size).toBe(0)
    expect(loadCaptureDraft(undefined)).toBeNull()
  })

  it('forgets the idea once the box is empty and no idea is open', () => {
    saveCaptureDraft('u1', { text: 'Something', ideaId: null })
    saveCaptureDraft('u1', { text: '   ', ideaId: null })
    expect(loadCaptureDraft('u1')).toBeNull()
  })

  it('still remembers the open idea when the box is empty', () => {
    saveCaptureDraft('u1', { text: '', ideaId: 'i1' })
    expect(loadCaptureDraft('u1')).toEqual({ text: '', ideaId: 'i1' })
  })

  it('clears it after the drafts are written', () => {
    saveCaptureDraft('u1', { text: 'Done', ideaId: 'i1' })
    clearCaptureDraft('u1')
    expect(loadCaptureDraft('u1')).toBeNull()
  })

  it('ignores damaged saved data instead of breaking the page', () => {
    store.set('hiba:capture-draft:u1', '{not json')
    expect(loadCaptureDraft('u1')).toBeNull()
    store.set('hiba:capture-draft:u1', JSON.stringify({ text: 42 }))
    expect(loadCaptureDraft('u1')).toBeNull()
    store.set('hiba:capture-draft:u1', JSON.stringify({ text: 'Kept', ideaId: 7 }))
    expect(loadCaptureDraft('u1')).toEqual({ text: 'Kept', ideaId: null })
  })

  it('keeps working when the browser blocks storage', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('full') },
      removeItem: () => { throw new Error('blocked') },
    })
    expect(() => saveCaptureDraft('u1', { text: 'x', ideaId: null })).not.toThrow()
    expect(() => clearCaptureDraft('u1')).not.toThrow()
    expect(loadCaptureDraft('u1')).toBeNull()
  })
})
