import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
import { centreCrop } from './image-service'

describe('post images are 1080 × 1350 (owner, 24 Nov 2026)', () => {
  it('a wide photo keeps its middle, full height', () => {
    expect(centreCrop(4000, 3000)).toEqual({ sx: 800, sy: 0, sw: 2400, sh: 3000 })
  })
  it('a tall phone photo keeps its middle, full width', () => {
    expect(centreCrop(1080, 1920)).toEqual({ sx: 0, sy: 285, sw: 1080, sh: 1350 })
  })
  it('an image already 4:5 is not trimmed', () => {
    expect(centreCrop(2160, 2700)).toEqual({ sx: 0, sy: 0, sw: 2160, sh: 2700 })
  })
  it('a square image loses a little from each side', () => {
    expect(centreCrop(1000, 1000)).toEqual({ sx: 100, sy: 0, sw: 800, sh: 1000 })
  })
})
