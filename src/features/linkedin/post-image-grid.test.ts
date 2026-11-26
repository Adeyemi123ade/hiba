import { describe, expect, it } from 'vitest'
import { gridLayout } from './post-image-grid'

describe('images laid out the way the LinkedIn feed shows them (owner, 26 Nov 2026)', () => {
  it('shows up to three images as they are', () => {
    expect(gridLayout(1)).toEqual({ tiles: 1, more: 0 })
    expect(gridLayout(2)).toEqual({ tiles: 2, more: 0 })
    expect(gridLayout(3)).toEqual({ tiles: 3, more: 0 })
  })

  it('shows four tiles and "+N" for the rest', () => {
    expect(gridLayout(4)).toEqual({ tiles: 4, more: 0 })
    expect(gridLayout(7)).toEqual({ tiles: 4, more: 3 })
    expect(gridLayout(9)).toEqual({ tiles: 4, more: 5 })
  })
})
