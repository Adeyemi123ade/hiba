import { describe, expect, it, vi } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'

const selects: { table: string; columns: string; filter: [string, string] }[] = []
const ROWS: Record<string, Record<string, unknown>[]> = {}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from(table: string) {
      const q = {
        columns: '',
        filter: ['', ''] as [string, string],
        select(c: string) { q.columns = c; return q },
        eq(k: string, v: string) { q.filter = [k, v]; selects.push({ table, columns: q.columns, filter: q.filter }); return q },
        order() { return q },
        range(from: number, to: number) { return Promise.resolve({ data: (ROWS[table] ?? []).slice(from, to + 1), error: null }) },
        maybeSingle() { return Promise.resolve({ data: (ROWS[table] ?? [])[0] ?? null, error: null }) },
      }
      return q
    },
  },
}))

import { buildZip, collectMyData, readablePage, wantedFiles, zipFileName, type MyData } from './data-export'

const ME = 'user-1'

function sample(): MyData {
  return {
    exported_at: '2026-11-24T10:00:00.000Z',
    account: { email: 'me@example.com' },
    profile: { id: ME, first_name: 'Sulaimon', onboarding: { role: 'Coach', topics: ['Careers', 'AI'] }, created_at: '2026-11-01T09:00:00Z' },
    linkedin_connection: { name: 'Sulaimon A.', member_id: 'abc' },
    ideas: [{ id: 'i1', body: 'An idea <script>alert(1)</script>', source: 'voice', created_at: '2026-11-20T09:00:00Z' }],
    posts: [
      { id: 'p1', idea_id: 'i1', platform: 'linkedin', status: 'published', body: 'Line one\n<b>not bold</b>', published_at: '2026-11-21T09:00:00Z',
        images: [{ path: `${ME}/a.jpg`, alt: 'Me "smiling"' }, { path: `${ME}/gone.png`, alt: null }], external_url: 'https://www.linkedin.com/feed/update/x/' },
      { id: 'p2', idea_id: 'i1', platform: 'x', status: 'draft', body: 'Short one', images: [],
        attachment: { kind: 'document', path: `${ME}/deck.pdf`, name: 'My deck.pdf' } },
    ],
    post_versions: [{ post_id: 'p1', body: 'old' }, { post_id: 'p1', body: 'older' }],
    post_comments: [{ post_id: 'p1', position: 2, body: 'Second' }, { post_id: 'p1', position: 1, body: 'First' }],
    angles: [], publishing_history: [], notifications: [], plan: null,
    usage: { ai_actions: [], draft_requests: [], voice_requests: [] },
    online_image_library: [{ path: `${ME}/a.jpg` }, { path: `${ME}/lib.jpg` }],
  }
}

describe('Download my data (HPD-159)', () => {
  it('reads only the signed-in person, and never the LinkedIn sign-in key', async () => {
    selects.length = 0
    ROWS.posts = Array.from({ length: 1500 }, (_, i) => ({ id: `p${i}` }))
    const data = await collectMyData(ME, 'me@example.com')
    expect(data.posts).toHaveLength(1500) // more than one page is read
    for (const s of selects) expect(s.filter[1]).toBe(ME)
    const linkedin = selects.find((s) => s.table === 'linkedin_connections')!
    expect(linkedin.columns).not.toMatch(/token|\*/)
    expect(selects.find((s) => s.table === 'ai_usage')!.columns).not.toMatch(/cost|error|\*/)
    expect(selects.map((s) => s.table)).not.toContain('linkedin_oauth_states')
    delete ROWS.posts
  })

  it('names each file, and includes a file used twice only once', () => {
    expect(wantedFiles(sample()).map((f) => f.name)).toEqual([
      'images/post-1-image-1.jpg', 'images/post-1-image-2.png', 'files/post-2-My deck.pdf', 'images/library-2.jpg',
    ])
  })

  it('the readable page shows text as text, never as code', () => {
    const data = sample()
    const files = wantedFiles(data)
    const html = readablePage(data, files, new Set([`${ME}/a.jpg`]))
    expect(html).not.toContain('<script>alert')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('&lt;b&gt;not bold&lt;/b&gt;')
    expect(html).toContain('alt="Me &quot;smiling&quot;"')
  })

  it('the readable page has the account, answers, posts in order, comments in order and missing files explained', () => {
    const data = sample()
    const html = readablePage(data, wantedFiles(data), new Set([`${ME}/a.jpg`]))
    expect(html).toContain('me@example.com')
    expect(html).toContain('Connected as Sulaimon A.')
    expect(html).toContain('Careers, AI')
    expect(html).toContain('<img src="images/post-1-image-1.jpg"')
    expect(html).toContain('An image that Hiba no longer keeps')
    expect(html).toContain('My deck.pdf (no longer kept by Hiba)')
    expect(html.indexOf('First')).toBeLessThan(html.indexOf('Second'))
    expect(html).toContain('2 earlier versions of this post are in my-data.json')
    expect(html).toContain('Your image library stays on your device')
  })

  it('the ZIP holds the page, the full data and the files Hiba still has', () => {
    const data = sample()
    const files = wantedFiles(data)
    const zip = unzipSync(buildZip(data, files, new Map([[`${ME}/a.jpg`, new Uint8Array([1, 2, 3])]])))
    expect(Object.keys(zip).sort()).toEqual(['images/post-1-image-1.jpg', 'my-data.json', 'read-me-first.html'])
    expect(JSON.parse(strFromU8(zip['my-data.json'])).posts).toHaveLength(2)
    expect([...zip['images/post-1-image-1.jpg']]).toEqual([1, 2, 3])
  })

  it('the file is named with the date', () => {
    expect(zipFileName(new Date('2026-11-24T10:00:00Z'))).toBe('hiba-my-data-2026-11-24.zip')
  })
})
