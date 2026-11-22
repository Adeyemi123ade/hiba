import { describe, expect, it } from 'vitest'
import { NO_SELECTION, longPress, startSelecting, tap } from './selection'

describe('gallery selection', () => {
  it('library: a tap opens the image when nothing is selected', () => {
    expect(tap(NO_SELECTION, 'a', 'browse')).toEqual({ selection: NO_SELECTION, open: 'a' })
  })

  it('library: long press selects, then taps add and remove', () => {
    let s = longPress(NO_SELECTION, 'a')
    expect(s).toEqual({ active: true, ids: ['a'] })
    s = tap(s, 'b', 'browse').selection
    s = tap(s, 'c', 'browse').selection
    expect(s.ids).toEqual(['a', 'b', 'c'])
    expect(tap(s, 'b', 'browse').open).toBeUndefined()
    s = tap(s, 'b', 'browse').selection
    expect(s.ids).toEqual(['a', 'c'])
  })

  it('library: removing the last selected image leaves selection mode', () => {
    const s = tap(longPress(NO_SELECTION, 'a'), 'a', 'browse').selection
    expect(s).toEqual({ active: false, ids: [] })
    expect(tap(s, 'a', 'browse').open).toBe('a')
  })

  it('library: the Select button starts selecting with nothing chosen', () => {
    expect(tap(startSelecting(), 'a', 'browse').selection.ids).toEqual(['a'])
  })

  it('choosing for a post: every tap selects, never opens', () => {
    let r = tap(NO_SELECTION, 'a', 'pick')
    expect(r.open).toBeUndefined()
    r = tap(r.selection, 'b', 'pick')
    expect(r.selection.ids).toEqual(['a', 'b'])
    r = tap(tap(r.selection, 'a', 'pick').selection, 'b', 'pick')
    expect(r.selection.ids).toEqual([])
    expect(r.open).toBeUndefined()
  })

  it('choosing for a post: stops at the number of images the post can still take', () => {
    const s = tap(tap(NO_SELECTION, 'a', 'pick', 2).selection, 'b', 'pick', 2).selection
    const r = tap(s, 'c', 'pick', 2)
    expect(r.full).toBe(true)
    expect(r.selection.ids).toEqual(['a', 'b'])
  })
})
