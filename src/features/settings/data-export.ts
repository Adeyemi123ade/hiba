import { zipSync, strToU8, type Zippable } from 'fflate'
import { supabase } from '@/lib/supabase'
import { IMAGE_BUCKET, imagesOf, type PostImageItem } from '@/features/content/api/image-service'
import { MEDIA_BUCKET } from '@/features/content/api/media-service'

/**
 * HPD-159 Download my data. Owner decision, 24 Nov 2026: one ZIP file with
 *   read-me-first.html  a page anyone can open and read,
 *   my-data.json        everything, for other apps,
 *   images/ and files/  the post images and attachments Hiba still holds.
 * Everything is read as the signed-in person, so Row Level Security only ever returns their own rows.
 * LinkedIn sign-in keys are never read. The image library on the device is not included.
 */

type Row = Record<string, unknown>

export interface MyData {
  exported_at: string
  account: { email: string | null }
  profile: Row | null
  linkedin_connection: Row | null
  ideas: Row[]
  posts: Row[]
  post_versions: Row[]
  post_comments: Row[]
  angles: Row[]
  publishing_history: Row[]
  notifications: Row[]
  plan: Row | null
  usage: { ai_actions: Row[]; draft_requests: Row[]; voice_requests: Row[] }
  online_image_library: Row[]
}

export type ExportErrorCode = 'offline' | 'session' | 'failed'

export const EXPORT_ERROR_TEXT: Record<ExportErrorCode, string> = {
  offline: 'You are offline. Check your network connection and try again.',
  session: 'Your session expired. Sign in again to continue.',
  failed: 'We could not prepare your file. Please try again.',
}

export class ExportError extends Error {
  readonly code: ExportErrorCode
  constructor(code: ExportErrorCode) {
    super(code)
    this.code = code
  }
}

const PAGE = 1000

function fail(message: string): never {
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new ExportError('offline')
  throw new ExportError(/jwt|unauthor/i.test(message) ? 'session' : 'failed')
}

/** Every row of one table that belongs to the person, a page at a time. */
async function all(table: string, columns: string, owner: string, userId: string, order = 'created_at'): Promise<Row[]> {
  const rows: Row[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from(table).select(columns).eq(owner, userId)
      .order(order, { ascending: true }).range(from, from + PAGE - 1)
    if (error) fail(error.message)
    const page = (data ?? []) as unknown as Row[]
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

async function one(table: string, columns: string, owner: string, userId: string): Promise<Row | null> {
  const { data, error } = await supabase.from(table).select(columns).eq(owner, userId).maybeSingle()
  if (error) fail(error.message)
  return (data as unknown as Row | null) ?? null
}

/** Reads everything Hiba keeps about the person. */
export async function collectMyData(userId: string, email: string | null, now = new Date()): Promise<MyData> {
  const [
    profile, linkedin, ideas, posts, versions, comments, angles, attempts, notifications, plan,
    aiActions, draftRequests, voiceRequests, library,
  ] = await Promise.all([
    one('profiles', '*', 'id', userId),
    // Never the access token: only what the person can see in Settings.
    one('linkedin_connections', 'member_id, name, picture, scope, expires_at, connected_at, updated_at', 'user_id', userId),
    all('ideas', '*', 'user_id', userId),
    all('posts', '*', 'user_id', userId),
    all('post_versions', '*', 'user_id', userId),
    all('post_comments', '*', 'user_id', userId),
    all('angles', '*', 'user_id', userId),
    all('publish_attempts', '*', 'user_id', userId, 'started_at'),
    all('notifications', '*', 'user_id', userId),
    one('user_plans', '*', 'user_id', userId),
    all('ai_usage', 'id, operation, ok, created_at', 'user_id', userId),
    all('draft_requests', '*', 'user_id', userId),
    all('transcription_requests', '*', 'user_id', userId),
    all('images', '*', 'user_id', userId),
  ])
  return {
    exported_at: now.toISOString(),
    account: { email },
    profile,
    linkedin_connection: linkedin,
    ideas, posts, post_versions: versions, post_comments: comments, angles,
    publishing_history: attempts, notifications, plan,
    usage: { ai_actions: aiActions, draft_requests: draftRequests, voice_requests: voiceRequests },
    online_image_library: library,
  }
}

// ---------- files ----------

export interface WantedFile {
  bucket: string
  path: string
  /** Where it goes in the ZIP. */
  name: string
}

const extOf = (path: string) => (/\.([a-z0-9]{1,5})$/i.exec(path)?.[1] ?? 'bin').toLowerCase()
const safeName = (name: string) => name.replace(/[^\w.\- ]+/g, '_').replace(/^\.+/, '').slice(0, 80) || 'file'

/** The files to include, each with a readable name in the ZIP. A file used twice is included once. */
export function wantedFiles(data: Pick<MyData, 'posts' | 'online_image_library'>): WantedFile[] {
  const out: WantedFile[] = []
  const seen = new Set<string>()
  const add = (bucket: string, path: unknown, name: string) => {
    if (typeof path !== 'string' || !path || seen.has(`${bucket}/${path}`)) return
    seen.add(`${bucket}/${path}`)
    out.push({ bucket, path, name })
  }
  data.posts.forEach((post, p) => {
    const n = p + 1
    imagesOf(post as { images?: PostImageItem[] | null; image_path?: string | null; image_alt?: string | null })
      .forEach((img, i) => add(IMAGE_BUCKET, img.path, `images/post-${n}-image-${i + 1}.${extOf(img.path)}`))
    const att = post.attachment as { path?: string; name?: string } | null | undefined
    if (att?.path) add(MEDIA_BUCKET, att.path, `files/post-${n}-${safeName(att.name ?? `attachment.${extOf(att.path)}`)}`)
  })
  data.online_image_library.forEach((img, i) => add(IMAGE_BUCKET, img.path, `images/library-${i + 1}.${extOf(String(img.path ?? ''))}`))
  return out
}

/** Downloads the files. A file Hiba no longer holds (removed after posting) is just left out. */
async function fetchFiles(files: WantedFile[]): Promise<Map<string, Uint8Array>> {
  const got = new Map<string, Uint8Array>()
  for (const f of files) {
    const { data, error } = await supabase.storage.from(f.bucket).download(f.path)
    if (error || !data) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) throw new ExportError('offline')
      continue
    }
    got.set(f.path, new Uint8Array(await data.arrayBuffer()))
  }
  return got
}

// ---------- the readable page ----------

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

const when = (v: unknown) => {
  if (typeof v !== 'string' || !v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

const STATUS: Record<string, string> = {
  draft: 'Draft', needs_review: 'Draft', approved: 'Approved', scheduled: 'Scheduled',
  publishing: 'Posting', published: 'Published', failed: 'Not published', archived: 'Archived',
}
const PLATFORM: Record<string, string> = { linkedin: 'LinkedIn', x: 'X', substack: 'Substack' }

function answer(v: unknown): string {
  if (v == null || v === '') return ''
  if (Array.isArray(v)) return v.map(answer).filter(Boolean).join(', ')
  if (typeof v === 'object') return Object.entries(v as Row).map(([k, x]) => `${k}: ${answer(x)}`).filter((s) => !s.endsWith(': ')).join('; ')
  return String(v)
}

const label = (key: string) => key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())

/** The page anyone can open in a browser. Files Hiba no longer holds are not linked. */
export function readablePage(data: MyData, files: WantedFile[], included: Set<string>): string {
  const fileFor = new Map(files.filter((f) => included.has(f.path)).map((f) => [f.path, f.name]))
  const commentsBy = new Map<string, Row[]>()
  for (const c of data.post_comments) {
    const list = commentsBy.get(String(c.post_id)) ?? []
    list.push(c)
    commentsBy.set(String(c.post_id), list)
  }
  const versionsBy = new Map<string, number>()
  for (const v of data.post_versions) versionsBy.set(String(v.post_id), (versionsBy.get(String(v.post_id)) ?? 0) + 1)
  const postsBy = new Map<string, Row[]>()
  for (const p of data.posts) {
    const list = postsBy.get(String(p.idea_id)) ?? []
    list.push(p)
    postsBy.set(String(p.idea_id), list)
  }

  const profile = data.profile ?? {}
  const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.preferred_name || ''
  const onboarding = (profile.onboarding ?? {}) as Row
  const answers = Object.entries(onboarding).map(([k, v]) => [label(k), answer(v)] as const).filter(([, v]) => v)

  const post = (p: Row) => {
    const images = imagesOf(p as { images?: PostImageItem[] | null; image_path?: string | null; image_alt?: string | null })
    const att = p.attachment as { path?: string; name?: string; kind?: string } | null | undefined
    const comments = (commentsBy.get(String(p.id)) ?? []).sort((a, b) => Number(a.position) - Number(b.position))
    const status = STATUS[String(p.status)] ?? String(p.status ?? '')
    const dates = [
      p.scheduled_for && p.status === 'scheduled' ? `Scheduled for ${when(p.scheduled_for)}` : '',
      p.published_at ? `Published ${when(p.published_at)}` : '',
    ].filter(Boolean).join(' · ')
    const earlier = versionsBy.get(String(p.id)) ?? 0
    return `<article class="post">
  <p class="meta"><strong>${esc(PLATFORM[String(p.platform)] ?? p.platform)}</strong> · ${esc(dates || status)}${p.archived_at ? ' · Archived' : ''}</p>
  ${p.title ? `<h4>${esc(p.title)}</h4>` : ''}
  <div class="body">${esc(p.body)}</div>
  ${images.length ? `<div class="images">${images.map((img) => {
    const f = fileFor.get(img.path)
    return f ? `<img src="${esc(f)}" alt="${esc(img.alt ?? '')}">` : '<p class="note">An image that Hiba no longer keeps (it was removed after posting).</p>'
  }).join('')}</div>` : ''}
  ${att?.path ? `<p>${fileFor.has(att.path) ? `Attached file: <a href="${esc(fileFor.get(att.path))}">${esc(att.name ?? 'file')}</a>` : `Attached file: ${esc(att.name ?? 'file')} (no longer kept by Hiba)`}</p>` : ''}
  ${p.external_url ? `<p><a href="${esc(p.external_url)}">View on LinkedIn</a></p>` : ''}
  ${comments.length ? `<p class="meta">Follow-up comments</p><ol>${comments.map((c) => `<li>${esc(c.body)}</li>`).join('')}</ol>` : ''}
  ${earlier ? `<p class="note">${earlier} earlier version${earlier === 1 ? '' : 's'} of this post ${earlier === 1 ? 'is' : 'are'} in my-data.json.</p>` : ''}
</article>`
  }

  const ideas = [...data.ideas].reverse().map((idea) => `<section class="idea">
  <p class="meta">Idea · ${esc(when(idea.created_at))}${idea.source === 'voice' ? ' · Recorded' : ''}</p>
  <div class="body">${esc(idea.body)}</div>
  ${(postsBy.get(String(idea.id)) ?? []).map(post).join('\n')}
</section>`).join('\n')

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Your Hiba data</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:760px;margin:0 auto;padding:24px 16px;color:#1a202c;background:#fff;line-height:1.5}
h1{margin-bottom:4px}h2{margin-top:32px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
.meta{color:#4a5568;font-size:14px;margin:0 0 6px}.note{color:#4a5568;font-size:14px}
.idea{border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin:16px 0}
.post{border-top:1px solid #edf2f7;margin-top:12px;padding-top:12px}
.body{white-space:pre-wrap;word-wrap:break-word}
.images{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.images img{width:180px;height:auto;border-radius:8px;border:1px solid #e2e8f0}
dt{font-weight:600}dd{margin:0 0 10px}
</style></head><body>
<h1>Your Hiba data</h1>
<p class="meta">Downloaded ${esc(when(data.exported_at))}</p>
<p>This page shows your account, your answers and every idea with its posts. Everything, including your publishing history, notifications and usage records, is also in <strong>my-data.json</strong> in this folder. Post images and attached files Hiba still keeps are in the <strong>images</strong> and <strong>files</strong> folders. Your image library stays on your device and is not part of this download.</p>

<h2>Your account</h2>
<dl>
  ${name ? `<dt>Name</dt><dd>${esc(name)}</dd>` : ''}
  <dt>Email</dt><dd>${esc(data.account.email)}</dd>
  ${profile.created_at ? `<dt>Joined</dt><dd>${esc(when(profile.created_at))}</dd>` : ''}
  <dt>LinkedIn</dt><dd>${data.linkedin_connection ? `Connected${data.linkedin_connection.name ? ` as ${esc(data.linkedin_connection.name)}` : ''}` : 'Not connected'}</dd>
</dl>

${answers.length ? `<h2>Your answers</h2>\n<dl>${answers.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}

<h2>Your ideas and posts (${data.ideas.length})</h2>
${ideas || '<p>You have no ideas or posts yet.</p>'}
</body></html>
`
}

// ---------- the ZIP ----------

export function buildZip(data: MyData, files: WantedFile[], contents: Map<string, Uint8Array>): Uint8Array {
  const included = new Set(contents.keys())
  const zip: Zippable = {
    'read-me-first.html': strToU8(readablePage(data, files, included)),
    'my-data.json': strToU8(JSON.stringify(data, null, 2)),
  }
  for (const f of files) {
    const bytes = contents.get(f.path)
    if (bytes) zip[f.name] = [bytes, { level: 0 }] // images and videos are already compressed
  }
  return zipSync(zip, { level: 6 })
}

export const zipFileName = (now = new Date()) => `hiba-my-data-${now.toISOString().slice(0, 10)}.zip`

/** Builds the ZIP and hands it to the browser to save. */
export async function downloadMyData(userId: string, email: string | null): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new ExportError('offline')
  const data = await collectMyData(userId, email)
  const files = wantedFiles(data)
  const contents = await fetchFiles(files)
  const bytes = buildZip(data, files, contents)
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }))
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = zipFileName()
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}
