import { describe, expect, it, vi } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'

const selects: { table: string; columns: string; filter: [string, string] }[] = []
const ROWS: Record<string, Record<string, unknown>[]> = {}
const calls: string[] = []
let invokeResult: { error: unknown; data?: unknown } = { error: null }

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
    storage: {
      from(bucket: string) {
        return {
          download: () => Promise.resolve({ data: null, error: { message: 'Object not found' } }),
          upload: (path: string) => { calls.push(`upload ${bucket} ${path}`); return Promise.resolve({ data: { path }, error: null }) },
          remove: (paths: string[]) => { calls.push(`remove ${bucket} ${paths.join(',')}`); return Promise.resolve({ data: [], error: null }) },
        }
      },
    },
    functions: {
      invoke: (name: string, opts: { body: Record<string, string | boolean> }) => {
        calls.push(opts.body.check ? `check ${name}` : `invoke ${name} ${opts.body.email} ${opts.body.path}`)
        return Promise.resolve({ data: null, ...invokeResult })
      },
    },
  },
}))

import { FunctionsHttpError } from '@supabase/supabase-js'
import {
  ExportError, buildZip, checkCanRequestData, exportErrorText, collectMyData, readablePage, sendMyDataByEmail, wantedFiles, zipFileName, zipWithinLimit, type MyData,
} from './data-export'

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
    expect(html).toContain('An image that Hiba no longer has')
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

  it('over 50 MB, attached videos and documents are left out and the page says where they are', () => {
    const data = sample()
    const files = wantedFiles(data)
    const big = new Uint8Array(3000).map((_, i) => (i * 7919) % 251) // does not compress much
    const contents = new Map([[`${ME}/a.jpg`, new Uint8Array([1])], [`${ME}/deck.pdf`, big]])
    const zip = unzipSync(zipWithinLimit(data, files, contents, 2500))
    expect(Object.keys(zip)).not.toContain('files/post-2-My deck.pdf')
    expect(Object.keys(zip)).toContain('images/post-1-image-1.jpg')
    expect(strFromU8(zip['read-me-first.html'])).toContain('My deck.pdf (too large to include here; open the post in Hiba to get it)')
    expect(() => zipWithinLimit(data, files, contents, 100)).toThrow(ExportError)
  })
})

describe('Download my data goes to the email (owner, 24 Nov 2026)', () => {
  it('a different email sends nothing at all', async () => {
    calls.length = 0
    selects.length = 0
    await expect(sendMyDataByEmail(ME, 'me@example.com', 'someone@else.com')).rejects.toMatchObject({ code: 'email_mismatch' })
    expect(calls).toEqual([])
    expect(selects).toEqual([])
  })

  it("the file goes to the person's own private folder, then the function emails it", async () => {
    calls.length = 0
    invokeResult = { error: null }
    await sendMyDataByEmail(ME, 'Me@Example.com', '  me@example.com ')
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatch(new RegExp(`^upload data-exports ${ME}/[0-9a-f-]{36}[.]zip$`))
    const path = calls[0].split(' ')[2]
    expect(calls[1]).toBe(`invoke send-my-data me@example.com ${path}`)
  })

  it('when sending fails, the file is removed and the reason is plain', async () => {
    for (const [code, expected] of [['rate_limited', 'rate_limited'], ['email_mismatch', 'email_mismatch'], ['not_configured', 'send_failed']]) {
      calls.length = 0
      invokeResult = { error: new FunctionsHttpError(new Response(JSON.stringify({ error: code }), { status: 400 })) }
      await expect(sendMyDataByEmail(ME, 'me@example.com', 'me@example.com')).rejects.toMatchObject({ code: expected })
      expect(calls[2]).toMatch(/^remove data-exports /)
    }
    invokeResult = { error: null }
  })

  it('once every 3 days: the check says when the person can ask again, before anything is built', async () => {
    calls.length = 0
    selects.length = 0
    invokeResult = { error: null, data: { allowed: false, nextAt: '2026-11-27T10:00:00.000Z' } }
    const e = await checkCanRequestData().catch((x) => x)
    expect(e).toMatchObject({ code: 'rate_limited', nextAt: '2026-11-27T10:00:00.000Z' })
    expect(calls).toEqual(['check send-my-data'])
    expect(selects).toEqual([])
    expect(exportErrorText(e.code, e.nextAt)).toMatch(/^You can ask for a copy of your data once every 3 days\. You can ask again on 27 November/)
    invokeResult = { error: null, data: { allowed: true, nextAt: null } }
    await expect(checkCanRequestData()).resolves.toBeUndefined()
  })

  it('if the 3 days are not over when sending, the date comes back too and the file is removed', async () => {
    calls.length = 0
    invokeResult = { error: new FunctionsHttpError(new Response(JSON.stringify({ error: 'rate_limited', nextAt: '2026-11-27T10:00:00.000Z' }), { status: 429 })) }
    await expect(sendMyDataByEmail(ME, 'me@example.com', 'me@example.com')).rejects.toMatchObject({ code: 'rate_limited', nextAt: '2026-11-27T10:00:00.000Z' })
    expect(calls[2]).toMatch(/^remove data-exports /)
    invokeResult = { error: null }
  })
})
