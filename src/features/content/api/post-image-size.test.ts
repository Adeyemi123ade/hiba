import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
import { POST_IMAGE_MAX_SIDE, postImageSize } from './image-service'

describe('post images keep their own shape (owner, 26 Nov 2026)', () => {
  const shapes: [number, number][] = [[4000, 3000], [1080, 1920], [1000, 1000], [2160, 2700], [500, 300], [300, 4000], [6000, 1000]]

  it.each(shapes)('a %i × %i image is saved whole, same shape, no frame', (w, h) => {
    const s = postImageSize(w, h)
    expect(Math.abs(s.width / s.height - w / h)).toBeLessThan(0.01) // not squashed, stretched or padded
    expect(Math.max(s.width, s.height)).toBeLessThanOrEqual(POST_IMAGE_MAX_SIDE)
  })

  it('never makes a small image bigger', () => {
    expect(postImageSize(500, 300)).toEqual({ width: 500, height: 300 })
    expect(postImageSize(1080, 1350)).toEqual({ width: 1080, height: 1350 })
  })

  it('makes a very large photo smaller, keeping its shape', () => {
    expect(postImageSize(4000, 3000)).toEqual({ width: 2048, height: 1536 })
    expect(postImageSize(300, 4000)).toEqual({ width: 154, height: 2048 })
  })
})
