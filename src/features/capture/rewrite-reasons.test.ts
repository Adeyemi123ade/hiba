import { describe, expect, it } from 'vitest'
import { reasonsIn, toggleReason } from './rewrite-reasons'

describe('Write it again: quick reasons (owner, 25 Nov 2026)', () => {
  it('a tap adds the reason, and shows as picked', () => {
    const g = toggleReason('', 'Stronger opening')
    expect(g).toBe('Stronger opening')
    expect(reasonsIn(g)).toContain('Stronger opening')
  })

  it('a second reason is added after the first, and a second tap takes one back out', () => {
    let g = toggleReason('', 'Make it shorter')
    g = toggleReason(g, 'Stronger opening')
    expect(g).toBe('Make it shorter. Stronger opening')
    g = toggleReason(g, 'Make it shorter')
    expect(g).toBe('Stronger opening')
    expect(reasonsIn(g)).not.toContain('Make it shorter')
  })

  it('keeps what the person typed themselves', () => {
    const g = toggleReason('Mention it took two weeks', 'More personal')
    expect(g).toBe('Mention it took two weeks. More personal')
    expect(toggleReason(g, 'More personal')).toBe('Mention it took two weeks')
  })
})
