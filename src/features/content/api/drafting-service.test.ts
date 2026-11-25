import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// What Capture sends to the drafting function, and the plain sentence the person sees when it fails.
const invoke = vi.fn()
const rpc = vi.fn()
const inserts: Record<string, unknown>[] = []
vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserts.push(row)
        return { select: () => ({ single: async () => ({ data: { id: 'new-idea' }, error: null }) }) }
      },
    }),
  },
}))

import {
  ContentError, deleteSavedIdea, errorMessage, generateDrafts, saveIdeaForLater, type ContentErrorCode,
} from './content-service'

const answer = (status: number, body: unknown) =>
  ({ data: null, error: new FunctionsHttpError(new Response(JSON.stringify(body), { status })) })
async function failure(): Promise<ContentError> {
  try {
    await generateDrafts('i1')
  } catch (e) {
    return e as ContentError
  }
  throw new Error('expected generateDrafts to fail')
}

beforeEach(() => {
  invoke.mockReset()
  rpc.mockReset()
  inserts.length = 0
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('asking for drafts', () => {
  it('sends only the ticked platforms, always in the same order', async () => {
    invoke.mockResolvedValue({ data: { posts: [] }, error: null })
    await generateDrafts('i1', { platforms: ['substack', 'linkedin'] })
    expect(invoke).toHaveBeenCalledWith('generate-drafts', { body: { ideaId: 'i1', platforms: ['linkedin', 'substack'] } })
  })

  it('cleans the rewrite reasons and keeps them to 300 characters', async () => {
    invoke.mockResolvedValue({ data: { posts: [] }, error: null })
    await generateDrafts('i1', { platform: 'x', guidance: `  Shorter.\u0007${'a'.repeat(400)}` })
    const body = invoke.mock.calls[0][1].body
    expect(body.platform).toBe('x')
    expect(body.guidance.startsWith('Shorter. a')).toBe(true)
    expect(body.guidance).toHaveLength(300)
  })

  it('leaves out empty reasons', async () => {
    invoke.mockResolvedValue({ data: { posts: [] }, error: null })
    await generateDrafts('i1', { platform: 'linkedin', guidance: '   ' })
    expect(invoke.mock.calls[0][1].body).toEqual({ ideaId: 'i1', platform: 'linkedin' })
  })

  it('returns the new drafts', async () => {
    invoke.mockResolvedValue({ data: { posts: [{ id: 'p1' }] }, error: null })
    expect(await generateDrafts('i1')).toEqual([{ id: 'p1' }])
  })
})

describe('when drafting fails, the person sees a plain sentence', () => {
  it.each<[string, number, unknown, ContentErrorCode]>([
    ['the session expired', 401, {}, 'session_expired'],
    ['too many requests this hour', 429, { error: 'rate_limited' }, 'rate_limited'],
    ['the AI is busy', 503, { error: 'ai_busy' }, 'ai_busy'],
    ['writing is not set up', 503, { error: 'not_configured' }, 'not_configured'],
    ['the idea is gone', 404, { error: 'not_found' }, 'not_found'],
    ['everything is approved already', 409, { error: 'nothing_to_change' }, 'nothing_to_change'],
    ['an unexpected error', 500, { error: 'boom', detail: 'stack trace' }, 'ai_failed'],
    ['a reply that is not JSON', 500, 'oops', 'ai_failed'],
  ])('%s', async (_name, status, body, code) => {
    invoke.mockResolvedValue(answer(status, body))
    const e = await failure()
    expect(e.code).toBe(code)
    expect(errorMessage(e)).not.toMatch(/\d{3}|error|stack|boom/i)
  })

  it('passes on the AI\'s question when it needs to understand the idea better', async () => {
    invoke.mockResolvedValue(answer(422, { error: 'needs_clarification', question: 'Who is this for?' }))
    const e = await failure()
    expect(e.code).toBe('needs_clarification')
    expect(e.detail).toBe('Who is this for?')
  })

  it('names the daily limit and when more is available', async () => {
    const nextAt = new Date(Date.now() + 3_600_000).toISOString()
    invoke.mockResolvedValue(answer(429, { error: 'daily_limit', operation: 'draft', nextAt }))
    const e = await failure()
    expect(e.code).toBe('daily_limit')
    expect(errorMessage(e)).toMatch(/^You have used all of today's new drafts\. You can do more (at|tomorrow at) .+\. Everything you have is saved\.$/)
  })

  it('says writing is not available when the service cannot be reached while online', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    invoke.mockResolvedValue({ data: null, error: new FunctionsFetchError(new Error('Failed to fetch')) })
    expect((await failure()).code).toBe('not_configured')
    vi.unstubAllGlobals()
  })

  it('says the person is offline, and that the idea is kept, when there is no connection', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    invoke.mockResolvedValue({ data: null, error: new FunctionsFetchError(new Error('Failed to fetch')) })
    const e = await failure()
    expect(e.code).toBe('offline')
    expect(errorMessage(e)).toBe('You are offline. Your idea is kept on this page. Reconnect, then try again.')
    vi.unstubAllGlobals()
  })

  it('treats an empty answer as a failed attempt', async () => {
    invoke.mockResolvedValue({ data: null, error: null })
    expect((await failure()).code).toBe('ai_failed')
  })
})

describe('save for later', () => {
  it('saves the idea with the time it was saved', async () => {
    expect(await saveIdeaForLater('Fewer meetings', 'voice')).toBe('new-idea')
    expect(inserts[0]).toMatchObject({ body: 'Fewer meetings', source: 'voice' })
    expect(Number.isNaN(Date.parse(String(inserts[0].saved_at)))).toBe(false)
  })

  it('deletes a saved idea through the safe database function', async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    await deleteSavedIdea('i1')
    expect(rpc).toHaveBeenCalledWith('delete_saved_idea', { p_idea: 'i1' })
  })

  it('says it could not find the idea when nothing was deleted', async () => {
    rpc.mockResolvedValue({ data: false, error: null })
    await expect(deleteSavedIdea('i1')).rejects.toMatchObject({ code: 'not_found' })
  })
})
