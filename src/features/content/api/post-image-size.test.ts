import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
import { coverFrame, fitInside } from './image-service'

const W = 1080
const H = 1350

describe('post images are 1080 × 1350 with nothing cut off (owner, 24 Nov 2026)', () => {
  const shapes: [number, number][] = [[4000, 3000], [1080, 1920], [1000, 1000], [2160, 2700], [500, 300], [300, 4000]]

  it.each(shapes)('a %i × %i image is shown whole, inside the frame', (w, h) => {
    const f = fitInside(w, h)
    expect(f.dx).toBeGreaterThanOrEqual(0)
    expect(f.dy).toBeGreaterThanOrEqual(0)
    expect(f.dx + f.dw).toBeLessThanOrEqual(W)
    expect(f.dy + f.dh).toBeLessThanOrEqual(H)
    expect(f.dw === W || f.dh === H).toBe(true) // as large as it can be
    expect(Math.abs(f.dw / f.dh - w / h)).toBeLessThan(0.01) // not squashed or stretched
  })

  it('an image already 4:5 fills the frame exactly', () => {
    expect(fitInside(2160, 2700)).toEqual({ dx: 0, dy: 0, dw: W, dh: H })
  })

  it('a wide photo sits in the middle, full width', () => {
    expect(fitInside(4000, 3000)).toEqual({ dx: 0, dy: 270, dw: W, dh: 810 })
  })

  it.each(shapes)('the blurred background for %i × %i covers the whole frame', (w, h) => {
    const c = coverFrame(w, h)
    expect(c.dx).toBeLessThanOrEqual(0)
    expect(c.dy).toBeLessThanOrEqual(0)
    expect(c.dx + c.dw).toBeGreaterThanOrEqual(W)
    expect(c.dy + c.dh).toBeGreaterThanOrEqual(H)
  })
})
