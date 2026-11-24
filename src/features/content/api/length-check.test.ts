import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
import { lengthCheck } from './content-service'

const words = (n: number, w = 'word') => Array.from({ length: n }, () => w).join(' ')

describe('draft word limits (owner, 24 Nov 2026)', () => {
  it('LinkedIn allows 300 words, not 301', () => {
    expect(lengthCheck('linkedin', words(300)).warning).toBeNull()
    expect(lengthCheck('linkedin', words(300)).text).toContain('300 of 300 words')
    expect(lengthCheck('linkedin', words(301)).warning).toContain('limit of 300 words')
  })
  it('LinkedIn still keeps its own 3000-character limit', () => {
    expect(lengthCheck('linkedin', words(250, 'abcdefghijklm')).warning).not.toBeNull() // 250 words, 3499 characters
  })
  it('X allows 150 words in the thread, each post at most 280 characters', () => {
    const thread = [words(40), words(40), words(40), words(30)].join('\n\n') // 150 words, 4 posts under 280 characters
    expect(lengthCheck('x', thread).warning).toBeNull()
    expect(lengthCheck('x', `${thread}\n\nmore`).warning).toContain('the limit is 150')
    expect(lengthCheck('x', words(60, 'longer')).warning).toContain('over 280 characters')
  })
  it('Substack allows 3000 words, not 3001', () => {
    expect(lengthCheck('substack', words(3000)).warning).toBeNull()
    expect(lengthCheck('substack', words(3001)).warning).toContain('limit of 3000 words')
  })
})
