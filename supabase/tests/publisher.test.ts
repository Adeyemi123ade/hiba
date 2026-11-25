// The background publisher (supabase/functions/publisher), run as Supabase runs it: the real
// function file, with a pretend database and a pretend LinkedIn. Nothing leaves this computer.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { env, served } from './deno-stub'

// ---------- a pretend database ----------
interface Write { table: string; op: 'update' | 'insert'; payload: Record<string, unknown>; filters: string[] }
interface DbState {
  posts?: Record<string, unknown>[]
  comments?: Record<string, unknown>[]
  conn?: Record<string, unknown> | null
  livePost?: Record<string, unknown> | null
  stale?: { id: string; user_id: string }[]
  files?: Record<string, Blob>
}

let state: DbState = {}
let writes: Write[] = []
let rpcs: { name: string; args: unknown }[] = []

function from(table: string) {
  let op: 'select' | 'update' | 'insert' = 'select'
  let payload: Record<string, unknown> = {}
  let returning = false
  const filters: string[] = []
  const result = () => {
    if (op !== 'select') writes.push({ table, op, payload, filters })
    if (table === 'posts' && op === 'update' && returning) return { data: state.stale ?? [], error: null }
    if (table === 'linkedin_connections') return { data: state.conn ?? null, error: null }
    if (table === 'posts' && op === 'select') return { data: state.livePost ?? null, error: null }
    return { data: null, error: null }
  }
  const q = {
    select: () => { if (op === 'update') returning = true; return q },
    update: (p: Record<string, unknown>) => { op = 'update'; payload = p; return q },
    insert: (p: Record<string, unknown>) => { op = 'insert'; payload = p; return q },
    eq: (k: string, v: unknown) => { filters.push(`${k}=${v}`); return q },
    not: (k: string, o: string, v: unknown) => { filters.push(`${k} not ${o} ${v}`); return q },
    lt: (k: string) => { filters.push(`${k}<`); return q },
    maybeSingle: () => Promise.resolve(result()),
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, bad),
  }
  return q
}

const db = {
  from,
  rpc: async (name: string, args: unknown) => {
    rpcs.push({ name, args })
    if (name === 'claim_due_posts') return { data: state.posts ?? [], error: null }
    if (name === 'claim_due_comments') return { data: state.comments ?? [], error: null }
    return { data: null, error: null }
  },
  storage: {
    from: () => ({
      download: async (path: string) => (state.files?.[path] ? { data: state.files[path], error: null } : { data: null, error: { message: 'missing' } }),
    }),
  },
}
vi.mock('@supabase/supabase-js', () => ({ createClient: () => db }))

// ---------- a pretend LinkedIn ----------
type LinkedIn = (url: string, init: RequestInit) => Response | Promise<Response>
let linkedin: LinkedIn = () => new Response('', { status: 500 })
const fetchMock = vi.fn((url: string | URL, init?: RequestInit) => Promise.resolve(linkedin(String(url), init ?? {})))
const calls = (part: string) => fetchMock.mock.calls.filter(([url]) => String(url).includes(part))
const created = (urn: string) => new Response('{}', { status: 201, headers: { 'x-restli-id': urn } })

// ---------- secrets and the stored LinkedIn token ----------
const SECRET = 'a-long-shared-publisher-secret-1234'
const TOKEN = 'linkedin-access-token'
let storedToken = ''

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
async function encrypt(rawKey: Uint8Array, text: string) {
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)))
  return `v1:${b64(iv)}:${b64(data)}`
}

const run = (init: RequestInit = { method: 'POST', headers: { 'x-publisher-secret': SECRET } }) =>
  served()(new Request('https://example.test/publisher', init))
const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString()
const post = (extra: Record<string, unknown> = {}) => ({
  id: 'p1', user_id: 'u1', status: 'scheduled', body: 'I cancelled two meetings last week. What would you cancel?', publish_attempts: 1, ...extra,
})
// Every run first sweeps up claims left half way (those updates filter on an age, `<`). Leave them out.
const isSweep = (w: Write) => w.filters.some((f) => f.endsWith('<'))
const postWrites = () => writes.filter((w) => w.table === 'posts' && w.op === 'update' && !isSweep(w))
const attempts = () => writes.filter((w) => w.table === 'publish_attempts').map((w) => w.payload)

beforeAll(async () => {
  const rawKey = crypto.getRandomValues(new Uint8Array(32))
  env.set('PUBLISHER_SECRET', SECRET)
  env.set('TOKEN_ENCRYPTION_KEY', b64(rawKey))
  env.set('SUPABASE_URL', 'https://example.supabase.co')
  env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-role')
  storedToken = await encrypt(rawKey, TOKEN)
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await import('../functions/publisher/index.ts')
})

beforeEach(() => {
  writes = []
  rpcs = []
  fetchMock.mockClear()
  state = { conn: { member_id: 'm1', access_token_enc: storedToken, expires_at: inAnHour() } }
  linkedin = () => new Response('', { status: 500 })
})
afterEach(() => { state = {} })

describe('who may run the publisher', () => {
  it('only answers POST requests', async () => {
    expect((await run({ method: 'GET' })).status).toBe(405)
  })

  it('refuses a request without the shared secret, or with a wrong one', async () => {
    expect((await run({ method: 'POST' })).status).toBe(401)
    expect((await run({ method: 'POST', headers: { 'x-publisher-secret': `${SECRET}x` } })).status).toBe(401)
    expect(rpcs).toHaveLength(0)
  })

  it('does nothing when the token encryption key is missing', async () => {
    const key = env.get('TOKEN_ENCRYPTION_KEY')!
    env.delete('TOKEN_ENCRYPTION_KEY')
    try {
      expect((await run()).status).toBe(503)
      expect(rpcs).toHaveLength(0)
    } finally {
      env.set('TOKEN_ENCRYPTION_KEY', key)
    }
  })
})

describe('publishing a scheduled post', () => {
  it('posts the text once as the owner, marks it published and queues its comments', async () => {
    state.posts = [post()]
    linkedin = (url) => (url.endsWith('/v2/ugcPosts') ? created('urn:li:share:42') : new Response('', { status: 404 }))

    const res = await run()

    expect(await res.json()).toEqual({ posts: 1, comments: 0 })
    const sent = calls('/v2/ugcPosts')
    expect(sent).toHaveLength(1)
    const init = sent[0][1]!
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`)
    const body = JSON.parse(String(init.body))
    expect(body.author).toBe('urn:li:person:m1')
    expect(body.specificContent['com.linkedin.ugc.ShareContent']).toMatchObject({
      shareCommentary: { text: post().body }, shareMediaCategory: 'NONE',
    })
    expect(postWrites()).toEqual([expect.objectContaining({
      payload: { status: 'published', external_id: 'urn:li:share:42', external_url: 'https://www.linkedin.com/feed/update/urn:li:share:42/' },
    })])
    expect(attempts()).toEqual([expect.objectContaining({ post_id: 'p1', outcome: 'published' })])
    expect(rpcs).toContainEqual({ name: 'queue_post_comments', args: { p_post_id: 'p1' } })
  })

  it('tries again in 5 minutes when LinkedIn is busy, and posts nothing', async () => {
    state.posts = [post({ publish_attempts: 1 })]
    linkedin = () => new Response('busy', { status: 503 })
    const before = Date.now()

    await run()

    const [w] = postWrites()
    expect(w.payload.publish_lock).toBeNull()
    expect(w.filters).toContain('status=scheduled')
    const next = new Date(String(w.payload.scheduled_for)).getTime()
    expect(next - before).toBeGreaterThanOrEqual(5 * 60_000 - 1000)
    expect(next - before).toBeLessThan(5 * 60_000 + 5000)
    expect(attempts()[0]).toMatchObject({ outcome: 'retry', detail: 'LinkedIn was busy, so nothing was posted. Trying again in 5 minutes.' })
    expect(rpcs.map((r) => r.name)).not.toContain('queue_post_comments')
  })

  it('waits 15 minutes before the third try, then gives up with a plain reason', async () => {
    linkedin = () => new Response('slow down', { status: 429 })
    state.posts = [post({ publish_attempts: 2 })]
    await run()
    expect(attempts()[0].detail).toBe('LinkedIn was busy, so nothing was posted. Trying again in 15 minutes.')

    writes = []
    state.posts = [post({ publish_attempts: 3 })]
    await run()
    expect(postWrites()[0].payload).toEqual({ status: 'failed', failure_reason: 'LinkedIn was busy, so nothing was posted. Hiba tried 3 times.' })
    expect(attempts()[0].outcome).toBe('failed')
  })

  it('does not try again when LinkedIn says the post itself is wrong', async () => {
    state.posts = [post()]
    linkedin = () => new Response('bad request', { status: 422 })
    await run()
    expect(postWrites()[0].payload).toEqual({
      status: 'failed',
      failure_reason: 'LinkedIn did not accept this post. Nothing was posted. Check the text and images, then schedule it again.',
    })
  })

  it('never tries again by itself when LinkedIn does not answer, because it may have gone out', async () => {
    state.posts = [post()]
    linkedin = () => { throw new TypeError('network down') }
    await run()
    expect(calls('/v2/ugcPosts')).toHaveLength(1)
    expect(postWrites()[0].payload).toEqual({
      status: 'failed',
      failure_reason: 'LinkedIn did not answer, so Hiba cannot tell whether your post went out. Check your LinkedIn profile before trying again.',
    })
    expect(attempts()[0].outcome).toBe('unconfirmed')
  })

  it('asks the owner to reconnect when LinkedIn refuses the connection', async () => {
    state.posts = [post()]
    linkedin = () => new Response('', { status: 401 })
    await run()
    expect(postWrites()[0].payload.failure_reason).toBe('LinkedIn refused your connection. Reconnect it in Settings, then schedule the post again.')
  })

  it.each([
    ['LinkedIn is not connected', null, 'LinkedIn is not connected. Connect it in Settings, then schedule the post again.'],
    ['the connection has expired', { member_id: 'm1', access_token_enc: 'set later', expires_at: '2020-01-01T00:00:00Z' },
      'Your LinkedIn connection expired. Reconnect it in Settings, then schedule the post again.'],
    ['the stored token cannot be read', { member_id: 'm1', access_token_enc: 'v1:broken:token', expires_at: 'in an hour' },
      'Your LinkedIn connection needs renewing. Reconnect it in Settings, then schedule the post again.'],
  ])('fails without calling LinkedIn when %s', async (_name, conn, reason) => {
    state.conn = conn && conn.expires_at === 'in an hour' ? { ...conn, expires_at: inAnHour() } : conn
    state.posts = [post()]
    await run()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(postWrites()[0].payload).toEqual({ status: 'failed', failure_reason: reason })
  })

  it.each([
    ['empty', '   ', 'The post is empty, so nothing was posted.'],
    ['over 300 words', Array(301).fill('word').join(' '), 'The post is longer than 300 words, so nothing was posted. Shorten it and schedule it again.'],
  ])('fails without calling LinkedIn when the post is %s', async (_name, body, reason) => {
    state.posts = [post({ body })]
    await run()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(postWrites()[0].payload).toEqual({ status: 'failed', failure_reason: reason })
  })
})

describe('posts with images', () => {
  const registered = (n: number) => new Response(JSON.stringify({
    value: {
      asset: `urn:li:digitalmediaAsset:A${n}`,
      uploadMechanism: { 'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest': { uploadUrl: `https://upload.test/${n}` } },
    },
  }), { status: 200 })

  it('sends every image in order, with its description, then the post', async () => {
    state.files = { 'u1/a.jpg': new Blob(['a'], { type: 'image/jpeg' }), 'u1/b.jpg': new Blob(['b'], { type: 'image/jpeg' }) }
    state.posts = [post({ images: [{ path: 'u1/a.jpg', alt: ' Team photo ' }, { path: 'u1/b.jpg' }] })]
    let n = 0
    linkedin = (url) => {
      if (url.includes('registerUpload')) return registered(++n)
      if (url.startsWith('https://upload.test/')) return new Response('', { status: 201 })
      return created('urn:li:share:7')
    }

    await run()

    expect(calls('https://upload.test/').map(([u]) => u)).toEqual(['https://upload.test/1', 'https://upload.test/2'])
    const share = JSON.parse(String(calls('/v2/ugcPosts')[0][1]!.body)).specificContent['com.linkedin.ugc.ShareContent']
    expect(share.shareMediaCategory).toBe('IMAGE')
    expect(share.media).toEqual([
      { status: 'READY', media: 'urn:li:digitalmediaAsset:A1', description: { text: 'Team photo' } },
      { status: 'READY', media: 'urn:li:digitalmediaAsset:A2' },
    ])
    expect(attempts()[0]).toMatchObject({ outcome: 'published', detail: 'With 2 image(s).' })
  })

  it('posts nothing and names the image when one cannot be read', async () => {
    state.files = { 'u1/a.jpg': new Blob(['a'], { type: 'image/jpeg' }) }
    state.posts = [post({ images: [{ path: 'u1/a.jpg' }, { path: 'u1/gone.jpg' }] })]
    linkedin = (url) => (url.includes('registerUpload') ? registered(1) : new Response('', { status: 201 }))

    await run()

    expect(calls('/v2/ugcPosts')).toHaveLength(0)
    expect(attempts()[0]).toMatchObject({
      outcome: 'retry',
      detail: 'Image 2: Hiba could not read your image. Remove it and add it again. Nothing was posted. Trying again in 5 minutes.',
    })
  })

  it('still reads the single image of posts made before multiple images', async () => {
    state.files = { 'u1/old.jpg': new Blob(['o'], { type: 'image/jpeg' }) }
    state.posts = [post({ images: null, image_path: 'u1/old.jpg', image_alt: 'Old photo' })]
    linkedin = (url) => (url.includes('registerUpload') ? registered(1) : url.startsWith('https://upload.test/') ? new Response('', { status: 201 }) : created('urn:li:share:8'))
    await run()
    const share = JSON.parse(String(calls('/v2/ugcPosts')[0][1]!.body)).specificContent['com.linkedin.ugc.ShareContent']
    expect(share.media).toEqual([{ status: 'READY', media: 'urn:li:digitalmediaAsset:A1', description: { text: 'Old photo' } }])
  })
})

describe('follow-up comments', () => {
  const comment = (extra: Record<string, unknown> = {}) => ({ id: 'c1', post_id: 'p1', user_id: 'u1', body: 'One more thing I learned from this.', ...extra })
  const commentWrites = () => writes.filter((w) => w.table === 'post_comments' && w.op === 'update' && !isSweep(w))

  it('posts the comment under the live post and marks it published', async () => {
    state.comments = [comment()]
    state.livePost = { id: 'p1', status: 'published', external_id: 'urn:li:share:42' }
    linkedin = () => created('urn:li:comment:9')

    expect(await (await run()).json()).toEqual({ posts: 0, comments: 1 })

    const [[url, init]] = calls('/socialActions/')
    expect(url).toBe(`https://api.linkedin.com/v2/socialActions/${encodeURIComponent('urn:li:share:42')}/comments`)
    expect(JSON.parse(String(init!.body))).toEqual({ actor: 'urn:li:person:m1', object: 'urn:li:share:42', message: { text: comment().body } })
    expect(commentWrites()[0].payload).toEqual({ status: 'published', external_id: 'urn:li:comment:9' })
  })

  it('does not post a comment when its post is not live on LinkedIn', async () => {
    state.comments = [comment()]
    state.livePost = { id: 'p1', status: 'failed', external_id: null }
    await run()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(commentWrites()[0].payload).toEqual({ status: 'failed', failure_reason: 'The post is not live on LinkedIn, so the comment was not posted.' })
  })

  it('says to try again in a minute when LinkedIn is busy', async () => {
    state.comments = [comment()]
    state.livePost = { id: 'p1', status: 'published', external_id: 'urn:li:share:42' }
    linkedin = () => new Response('', { status: 429 })
    await run()
    expect(commentWrites()[0].payload.failure_reason).toBe('LinkedIn was busy, so this comment was not posted. Press Try posting again in a minute.')
  })

  it('tells the owner to approve the comment again after reconnecting', async () => {
    state.comments = [comment()]
    state.livePost = { id: 'p1', status: 'published', external_id: 'urn:li:share:42' }
    state.conn = null
    await run()
    expect(commentWrites()[0].payload.failure_reason).toBe('LinkedIn is not connected. Connect it in Settings, then approve the comment again.')
  })
})

describe('a run that stopped half way', () => {
  it('marks posts stuck in the middle as failed, never posts them again by surprise', async () => {
    state.stale = [{ id: 'p9', user_id: 'u1' }]
    await run()
    const stuck = writes.filter((w) => w.table === 'posts' && isSweep(w))[0]
    expect(stuck.payload).toEqual({ status: 'failed', failure_reason: expect.stringContaining('cannot tell whether it reached LinkedIn') })
    expect(stuck.filters).toEqual(expect.arrayContaining(['status=scheduled', 'publish_lock not is null']))
    expect(attempts()).toEqual([expect.objectContaining({ post_id: 'p9', outcome: 'unconfirmed' })])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
