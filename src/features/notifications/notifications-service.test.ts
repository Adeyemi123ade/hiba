import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: {} }))
import { linkFor, timeAgo, type AppNotification } from './notifications-service'

const n = (over: Partial<AppNotification>): AppNotification => ({
  id: '1', kind: 'review', idea_id: 'idea-1', post_id: null, message: 'm', created_at: new Date().toISOString(), read_at: null, ...over,
})

describe('notifications', () => {
  it('opens the idea for review, published and failed posts', () => {
    expect(linkFor(n({ kind: 'review' }))).toBe('/dashboard/capture?idea=idea-1')
    expect(linkFor(n({ kind: 'published', post_id: 'p' }))).toBe('/dashboard/capture?idea=idea-1')
    expect(linkFor(n({ kind: 'failed', post_id: 'p' }))).toBe('/dashboard/capture?idea=idea-1')
  })
  it('opens Settings to reconnect LinkedIn', () => {
    expect(linkFor(n({ kind: 'reconnect' }))).toBe('/dashboard/settings#settings-accounts')
  })
  it('falls back to Posts when the idea is gone', () => {
    expect(linkFor(n({ idea_id: null }))).toBe('/dashboard/library')
  })
  it('says how long ago in plain words', () => {
    const now = Date.parse('2026-11-23T12:00:00Z')
    expect(timeAgo('2026-11-23T11:59:40Z', now)).toBe('Just now')
    expect(timeAgo('2026-11-23T11:45:00Z', now)).toBe('15 min ago')
    expect(timeAgo('2026-11-23T09:00:00Z', now)).toBe('3 h ago')
    expect(timeAgo('2026-11-22T10:00:00Z', now)).toBe('Yesterday')
  })
})
