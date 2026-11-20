// Supabase Edge Function: create an image for a post with OpenAI and save it to the person's
// Images library (H07-S01, HPD-58, HPD-108).
//
// Security
// - Verify JWT ON. The database client acts AS THE CALLER, so Row Level Security applies; the
//   image is saved in the caller's own private folder only. No service_role key.
// - The OpenAI key is a function secret, never sent to the browser.
// - At most IMAGES_PER_DAY generated images per person per 24 hours (each one costs money).
//
// Secrets: OPENAI_API_KEY, APP_ORIGINS. Optional: IMAGE_MODEL (default gpt-image-1).
import { createClient } from 'npm:@supabase/supabase-js@2'

const IMAGE_MODEL = Deno.env.get('IMAGE_MODEL') ?? 'gpt-image-1'
const FALLBACK_MODEL = 'dall-e-3'
const IMAGES_PER_DAY = 20
const OPENAI_TIMEOUT_MS = 110_000
const BUCKET = 'post-images'
const MAX_BYTES = 5 * 1024 * 1024

const cors = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const CORS_ORIGINS = (Deno.env.get('APP_ORIGINS') ?? '')
  .split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean)
function withOrigin(res: Response, origin: string | null): Response {
  const headers = new Headers(res.headers)
  headers.set('Access-Control-Allow-Origin',
    !CORS_ORIGINS.length ? '*' : origin && CORS_ORIGINS.includes(origin) ? origin : CORS_ORIGINS[0])
  headers.set('Vary', 'Origin')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

type ErrorCode = 'bad_request' | 'unauthorized' | 'not_configured' | 'rate_limited' | 'ai_failed' | 'refused' | 'server_error'
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' },
})
const fail = (status: number, code: ErrorCode, detail?: string) => reply(status, { error: code, ...(detail ? { detail: detail.slice(0, 300) } : {}) })

export const STYLES: Record<string, string> = {
  photo: 'a natural, realistic professional photograph with soft light',
  illustration: 'a clean modern flat illustration with a calm colour palette',
  minimal: 'a minimal, uncluttered graphic with lots of empty space and one clear subject',
  '3d': 'a soft, friendly 3D render with gentle lighting',
}
export const SHAPES: Record<string, { gpt: string; dalle: string; w: number; h: number }> = {
  square: { gpt: '1024x1024', dalle: '1024x1024', w: 1024, h: 1024 },
  landscape: { gpt: '1536x1024', dalle: '1792x1024', w: 1536, h: 1024 },
  portrait: { gpt: '1024x1536', dalle: '1024x1792', w: 1024, h: 1536 },
}

/** Control characters out, spaces tidied, length capped. */
const clean = (v: unknown, max: number) =>
  // oxlint-disable-next-line no-control-regex
  typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : ''

export function buildImagePrompt(description: string, style: string) {
  return [
    `Create ${STYLES[style] ?? STYLES.photo} for a LinkedIn post.`,
    `What it should show: ${description}`,
    'It must look professional and trustworthy, suitable for a business audience.',
    'Do not include any words, letters, numbers, captions, logos, watermarks or brand names in the image.',
    'Do not show any real, identifiable person.',
  ].join('\n')
}

async function callOpenAI(key: string, model: string, prompt: string, shape: (typeof SHAPES)[string]) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), OPENAI_TIMEOUT_MS)
  const gpt = model.startsWith('gpt-image')
  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(gpt
        ? { model, prompt, n: 1, size: shape.gpt, quality: 'medium', output_format: 'jpeg', output_compression: 85 }
        : { model, prompt, n: 1, size: shape.dalle, response_format: 'b64_json' }),
    })
    if (!res.ok) {
      const body = (await res.text()).slice(0, 500)
      console.error('OpenAI image error', model, res.status, body)
      return { status: res.status, body }
    }
    const data = await res.json()
    const b64 = data?.data?.[0]?.b64_json
    return typeof b64 === 'string' ? { b64, gpt } : { status: 502, body: 'no image in answer' }
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError'
    console.error('OpenAI image request failed', model, e instanceof Error ? e.message : e)
    return { status: aborted ? 504 : 502, body: aborted ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
  }
}

function fromBase64(b64: string) {
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

Deno.serve(async (req) => withOrigin(await handle(req), req.headers.get('origin')))

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return fail(405, 'bad_request')
  const auth = req.headers.get('Authorization')
  if (!auth) return fail(401, 'unauthorized')
  const key = Deno.env.get('OPENAI_API_KEY')
  if (!key) return fail(503, 'not_configured')

  let input: Record<string, unknown>
  try {
    input = await req.json()
  } catch {
    return fail(400, 'bad_request')
  }
  const description = clean(input.description, 800)
  const style = typeof input.style === 'string' && STYLES[input.style] ? input.style : 'photo'
  const shapeName = typeof input.shape === 'string' && SHAPES[input.shape] ? input.shape : 'landscape'
  if (description.length < 5) return fail(400, 'bad_request', 'Describe the image in a few words.')

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  })
  const { data: userData, error: userError } = await db.auth.getUser()
  if (userError || !userData.user) return fail(401, 'unauthorized')
  const userId = userData.user.id

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count, error: countError } = await db.from('image_requests').select('id', { count: 'exact', head: true }).gte('created_at', since)
  if (countError) return fail(500, 'server_error', 'The Images library is not set up yet (migration 0018).')
  if ((count ?? 0) >= IMAGES_PER_DAY) return fail(429, 'rate_limited', `You can create ${IMAGES_PER_DAY} images a day. Try again tomorrow.`)
  // Counted before the call, so a failed or slow attempt still counts and cannot be repeated endlessly.
  const { error: logError } = await db.from('image_requests').insert({ user_id: userId })
  if (logError) return fail(500, 'server_error')

  const prompt = buildImagePrompt(description, style)
  const shape = SHAPES[shapeName]
  let result = await callOpenAI(key, IMAGE_MODEL, prompt, shape)
  // gpt-image-1 needs a verified OpenAI organisation; without it, use the older model.
  if ('status' in result && (result.status === 403 || result.status === 404) && IMAGE_MODEL !== FALLBACK_MODEL) {
    result = await callOpenAI(key, FALLBACK_MODEL, prompt, shape)
  }
  if ('status' in result) {
    if (result.status === 400 && /safety|policy|moderation/i.test(result.body)) {
      return fail(422, 'refused', 'OpenAI would not create this image. Try describing it differently.')
    }
    const why = result.status === 429 ? 'OpenAI refused: rate limit or no credit left on the OpenAI account (429)'
      : result.status === 401 ? 'OpenAI refused the API key (401)'
      : result.status === 504 ? 'OpenAI took too long to create the image'
      : `OpenAI could not create the image (${result.status})`
    return fail(502, 'ai_failed', why)
  }

  const bytes = fromBase64(result.b64)
  if (bytes.length > MAX_BYTES) return fail(502, 'ai_failed', 'The created image was larger than 5 MB.')
  const ext = result.gpt ? 'jpg' : 'png'
  const path = `${userId}/${crypto.randomUUID()}.${ext}`
  const { error: upError } = await db.storage.from(BUCKET)
    .upload(path, bytes, { contentType: result.gpt ? 'image/jpeg' : 'image/png', upsert: false, cacheControl: '3600' })
  if (upError) {
    console.error('Saving image failed', upError.message)
    return fail(500, 'server_error', 'The image was created but could not be saved. Please try again.')
  }
  const row = {
    user_id: userId, path, source: 'generated', prompt: description,
    alt: description.slice(0, 300), bytes: bytes.length,
    ...(() => { const [w, h] = (result.gpt ? shape.gpt : shape.dalle).split('x').map(Number); return { width: w, height: h } })(),
  }
  const { data: saved, error: rowError } = await db.from('images').insert(row)
    .select('id, path, source, prompt, alt, width, height, bytes, created_at').single()
  if (rowError || !saved) {
    await db.storage.from(BUCKET).remove([path])
    return fail(500, 'server_error', 'The image was created but could not be added to your library. Please try again.')
  }
  return reply(200, { image: saved })
}
