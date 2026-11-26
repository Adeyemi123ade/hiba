import { describe, expect, it } from 'vitest'
import { gridLayout, singleFrameRatio } from './post-image-layout'

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

  it('frames one image in its own shape, between wide 1.91:1 and portrait 4:5', () => {
    expect(singleFrameRatio(4000, 3000)).toBeCloseTo(4 / 3)
    expect(singleFrameRatio(1080, 1350)).toBeCloseTo(0.8)
    expect(singleFrameRatio(1080, 2340)).toBeCloseTo(0.8)
    expect(singleFrameRatio(6000, 1500)).toBeCloseTo(1.91)
  })
})
