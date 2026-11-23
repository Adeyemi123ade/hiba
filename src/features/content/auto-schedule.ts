/**
 * Publish automatically (HPD-163, owner decision 23 Nov 2026): the creator still approves every post,
 * and Approve puts it on the calendar at their preferred posting time, on the next free day.
 * Free means no other post is already scheduled that day (in their time zone).
 */

const MIN_LEAD_MS = 5 * 60_000
const MAX_DAYS = 365

function safeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0)
    return timeZone
  } catch {
    return 'UTC'
  }
}

/** How far the zone's wall clock is ahead of UTC at that moment, in ms. */
function offsetMs(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(at))
  const n = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - Math.floor(at / 1000) * 1000
}

/** The moment it is `hh:mm` on that calendar day in the zone. */
function zonedMoment(y: number, m: number, d: number, hh: number, mm: number, timeZone: string): Date {
  const wall = Date.UTC(y, m, d, hh, mm)
  let t = wall - offsetMs(wall, timeZone)
  t = wall - offsetMs(t, timeZone) // again, in case the clocks change that day
  return new Date(t)
}

/** "YYYY-MM-DD" for that moment in the zone. */
export function dayIn(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: safeZone(timeZone), year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

/** The next time to post: preferred time, first day with nothing else scheduled, at least 5 minutes away. */
export function nextPostingSlot({ now, postingTime, timeZone, busy }: {
  now: Date
  postingTime: string // "HH:MM"
  timeZone: string
  busy: Date[] // times of posts already scheduled
}): Date | null {
  const zone = safeZone(timeZone)
  const [hh, mm] = postingTime.split(':').map(Number)
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null
  const taken = new Set(busy.map((b) => dayIn(b, zone)))
  const [y, m, d] = dayIn(now, zone).split('-').map(Number)
  for (let i = 0; i <= MAX_DAYS; i++) {
    const day = new Date(Date.UTC(y, m - 1, d + i))
    const at = zonedMoment(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hh, mm, zone)
    if (at.getTime() < now.getTime() + MIN_LEAD_MS) continue
    if (taken.has(dayIn(at, zone))) continue
    return at
  }
  return null
}

/** The saved Final approval answer that turns this on. */
export const AUTO_PUBLISH = 'publish-automatically'
