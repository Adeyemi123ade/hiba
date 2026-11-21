// Daily limits and the AI usage record (migration 0019). Used by generate-drafts and transcribe.
// Every database call here runs AS THE CALLER (Row Level Security applies).
// If migration 0019 has not been run yet, limits are not enforced and nothing is recorded:
// the app keeps working exactly as before, and the problem is written to the function log.

export type Operation = 'draft' | 'rewrite' | 'angles' | 'comments' | 'comment_rewrite' | 'voice'

/**
 * Estimated prices in US dollars per 1 million tokens (OpenAI price table, Nov 2026).
 * Used only to estimate cost for the owner's records. Check the OpenAI pricing page when it changes.
 */
const TEXT_PRICES: Record<string, { input: number; cached: number; output: number }> = {
  'gpt-4o-mini': { input: 0.15, cached: 0.075, output: 0.6 },
  'gpt-4o': { input: 2.5, cached: 1.25, output: 10 },
}
/** Estimated transcription price in US dollars per minute of audio. */
const AUDIO_PRICE_PER_MINUTE: Record<string, number> = {
  'gpt-4o-transcribe': 0.006,
  'gpt-4o-mini-transcribe': 0.003,
  'whisper-1': 0.006,
}

/** Everything one request used. Created per request, never shared between requests. */
export interface AiMeter {
  key: string
  model: string
  calls: number
  input: number
  cached: number
  output: number
  /** Internal reason for the last failure. Logged and recorded, never shown in the app. */
  error: string
  /** Why the last call failed, as far as the app needs to know: OpenAI busy, or not usable (key, credit). */
  failure: '' | 'busy' | 'unavailable'
}

export const newMeter = (key: string, model: string): AiMeter =>
  ({ key, model, calls: 0, input: 0, cached: 0, output: 0, error: '', failure: '' })

/** Adds the token counts OpenAI returns with each chat answer. */
// deno-lint-ignore no-explicit-any
export function addChatUsage(m: AiMeter, usage: any) {
  m.calls += 1
  const input = Number(usage?.prompt_tokens) || 0
  const cached = Number(usage?.prompt_tokens_details?.cached_tokens) || 0
  m.input += input
  m.cached += Math.min(cached, input)
  m.output += Number(usage?.completion_tokens) || 0
}

export function chatCost(m: AiMeter): number {
  const p = TEXT_PRICES[m.model] ?? TEXT_PRICES[m.model.replace(/-\d{4}-\d{2}-\d{2}$/, '')]
  if (!p) return 0
  return ((m.input - m.cached) * p.input + m.cached * p.cached + m.output * p.output) / 1_000_000
}

export const audioCost = (model: string, seconds: number) => ((AUDIO_PRICE_PER_MINUTE[model] ?? 0) * seconds) / 60

/** Is the caller allowed one more of this action today? `nextAt` says when the next one frees up. */
// deno-lint-ignore no-explicit-any
export async function checkAllowance(db: any, op: Operation): Promise<{ allowed: boolean; nextAt: string | null }> {
  const { data, error } = await db.rpc('my_allowances')
  if (error) {
    console.error('Daily limits not checked (is migration 0019 run?)', error.message)
    return { allowed: true, nextAt: null }
  }
  const row = (data ?? []).find((r: { operation: string }) => r.operation === op)
  if (!row) return { allowed: true, nextAt: null }
  return { allowed: row.used < row.per_day, nextAt: row.next_at ?? null }
}

export interface UsageEntry {
  userId: string
  operation: Operation
  ok: boolean
  model: string
  calls: number
  input?: number
  cached?: number
  output?: number
  audioSeconds?: number
  cost: number
  ideaId?: string | null
  postId?: string | null
  error?: string
}

/** Writes one usage row. A failure here never affects what the person sees. */
// deno-lint-ignore no-explicit-any
export async function recordUsage(db: any, e: UsageEntry) {
  const { error } = await db.from('ai_usage').insert({
    user_id: e.userId,
    operation: e.operation,
    ok: e.ok,
    model: e.model.slice(0, 60),
    calls: Math.min(20, e.calls),
    input_tokens: e.input ?? 0,
    cached_tokens: e.cached ?? 0,
    output_tokens: e.output ?? 0,
    audio_seconds: e.audioSeconds ?? null,
    cost_usd: Number(e.cost.toFixed(6)),
    idea_id: e.ideaId ?? null,
    post_id: e.postId ?? null,
    error: e.error ? e.error.slice(0, 500) : null,
  })
  if (error) console.error('Usage not recorded (is migration 0019 run?)', error.message)
}

/** OpenAI says "busy, try again" (not "out of credit"): worth one more try after a short wait. */
export function isBusy(status: number, body: string) {
  if (status >= 500) return true
  return status === 429 && !/insufficient_quota|billing/i.test(body)
}

/** How long OpenAI asks us to wait, capped so the person is not kept waiting long. */
export function retryDelayMs(res: Response, capMs = 4000) {
  const s = Number(res.headers.get('retry-after'))
  const ms = Number(res.headers.get('retry-after-ms'))
  const wanted = Number.isFinite(ms) && ms > 0 ? ms : Number.isFinite(s) && s > 0 ? s * 1000 : 1500
  return Math.min(capMs, Math.max(500, wanted))
}
