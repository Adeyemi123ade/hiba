import { describe, expect, it } from 'vitest'
import { dayIn, nextPostingSlot } from './auto-schedule'

const iso = (d: Date | null) => d?.toISOString()

describe('next posting slot', () => {
  it('uses today when the time is still ahead', () => {
    // 07:00 in Lagos (UTC+1) -> 09:00 Lagos today = 08:00 UTC
    expect(iso(nextPostingSlot({ now: new Date('2026-11-23T06:00:00Z'), postingTime: '09:00', timeZone: 'Africa/Lagos', busy: [] })))
      .toBe('2026-11-23T08:00:00.000Z')
  })
  it('moves to tomorrow when today\'s time has passed', () => {
    expect(iso(nextPostingSlot({ now: new Date('2026-11-23T12:00:00Z'), postingTime: '09:00', timeZone: 'Africa/Lagos', busy: [] })))
      .toBe('2026-11-24T08:00:00.000Z')
  })
  it('needs at least 5 minutes', () => {
    expect(iso(nextPostingSlot({ now: new Date('2026-11-23T07:57:00Z'), postingTime: '09:00', timeZone: 'Africa/Lagos', busy: [] })))
      .toBe('2026-11-24T08:00:00.000Z')
  })
  it('skips days that already have a scheduled post, in the creator\'s time zone', () => {
    const busy = [new Date('2026-11-23T15:00:00Z'), new Date('2026-11-24T08:00:00Z')]
    expect(iso(nextPostingSlot({ now: new Date('2026-11-23T06:00:00Z'), postingTime: '09:00', timeZone: 'Africa/Lagos', busy })))
      .toBe('2026-11-25T08:00:00.000Z')
  })
  it('follows daylight saving time', () => {
    // London: 30 Mar 2026 is summer time (UTC+1), so 09:00 is 08:00 UTC
    expect(iso(nextPostingSlot({ now: new Date('2026-03-30T00:00:00Z'), postingTime: '09:00', timeZone: 'Europe/London', busy: [] })))
      .toBe('2026-03-30T08:00:00.000Z')
    expect(iso(nextPostingSlot({ now: new Date('2026-01-10T00:00:00Z'), postingTime: '09:00', timeZone: 'Europe/London', busy: [] })))
      .toBe('2026-01-10T09:00:00.000Z')
  })
  it('works across the date line and with a bad time zone', () => {
    expect(dayIn(new Date('2026-11-23T20:00:00Z'), 'Pacific/Auckland')).toBe('2026-11-24')
    expect(iso(nextPostingSlot({ now: new Date('2026-11-23T06:00:00Z'), postingTime: '09:00', timeZone: 'Not/AZone', busy: [] })))
      .toBe('2026-11-23T09:00:00.000Z')
    expect(nextPostingSlot({ now: new Date(), postingTime: 'soon', timeZone: 'UTC', busy: [] })).toBeNull()
  })
})
