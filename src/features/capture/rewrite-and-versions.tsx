import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { History, Loader2, RefreshCw } from 'lucide-react'
import { clsx } from 'clsx'
import {
  ContentError, ERROR_TEXT, GUIDANCE_MAX, fetchVersions, type ContentErrorCode, type Post, type PostVersion,
} from '@/features/content/api/content-service'

const outlineBtn =
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-dark)] disabled:cursor-not-allowed disabled:opacity-50'
const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-primary-dark)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50'

const codeOf = (e: unknown): ContentErrorCode => (e instanceof ContentError ? e.code : 'unknown')

const SUGGESTIONS = ['Make it shorter', 'More personal', 'More practical', 'Simpler words', 'Stronger opening']

/** HPD-50: ask for a new version of one draft, optionally saying what should change. */
export function RewriteBox({ platformName, online, onRewrite }: {
  platformName: string
  online: boolean
  onRewrite: (guidance: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [guidance, setGuidance] = useState('')
  const [working, setWorking] = useState(false)
  const [slow, setSlow] = useState(false)
  const [error, setError] = useState<ContentErrorCode | null>(null)
  const [done, setDone] = useState(false)

  async function run() {
    setWorking(true)
    setError(null)
    setDone(false)
    setSlow(false)
    const timer = setTimeout(() => setSlow(true), 10_000)
    try {
      await onRewrite(guidance.trim())
      setGuidance('')
      setOpen(false)
      setDone(true)
    } catch (e) {
      setError(codeOf(e))
    } finally {
      clearTimeout(timer)
      setWorking(false)
    }
  }

  if (!open) {
    return (
      <div className="flex flex-col items-start gap-1">
        <button type="button" className={outlineBtn} onClick={() => { setOpen(true); setDone(false) }} disabled={!online}>
          <RefreshCw size={16} aria-hidden="true" /> Write it again
        </button>
        {done && <span role="status" className="text-xs text-[var(--color-primary-dark)]">New version ready. Your earlier one is saved below.</span>}
      </div>
    )
  }

  return (
    <div className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-light-green)] p-4">
      <label htmlFor="rewrite-guidance" className="block text-sm font-semibold text-[var(--color-text-primary)]">
        What should change in the {platformName}? <span className="font-normal text-[var(--color-text-secondary)]">(optional)</span>
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" disabled={working}
            onClick={() => setGuidance((g) => (g.trim() ? `${g.trim()}. ${s}` : s).slice(0, GUIDANCE_MAX))}
            className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-xs text-[var(--color-text-primary)] hover:border-[var(--color-primary-light)]">
            {s}
          </button>
        ))}
      </div>
      <textarea
        id="rewrite-guidance"
        value={guidance}
        maxLength={GUIDANCE_MAX}
        disabled={working}
        onChange={(e) => setGuidance(e.target.value)}
        aria-describedby="rewrite-hint"
        placeholder="e.g. Start with the lesson, and mention it took us two weeks."
        className="mt-2 min-h-[70px] w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-sm"
      />
      <p id="rewrite-hint" className="text-xs text-[var(--color-text-secondary)]">
        {GUIDANCE_MAX - guidance.length} characters left. Leave it empty for a fresh take. Your current version is kept.
      </p>
      {error && <p role="alert" className="mt-2 text-sm text-[var(--color-error)]">{ERROR_TEXT[error].replace('Your idea is saved.', 'Your current version is unchanged.')}</p>}
      {working && (
        <p role="status" className="mt-2 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          {slow ? 'Still working. Your connection seems slow.' : 'Writing a new version...'}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={primaryBtn} onClick={run} disabled={working || !online}>
          {error ? 'Try again' : 'Write a new version'}
        </button>
        <button type="button" className={outlineBtn} onClick={() => { setOpen(false); setError(null) }} disabled={working}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function describe(v: PostVersion, n: number) {
  const when = new Date(v.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  return `Version ${n} · ${v.source === 'ai' ? 'written by Hiba' : 'your edit'} · ${when}`
}

/** HPD-50: earlier versions of one draft, to preview and switch back to. */
export function VersionHistory({ post, readOnly, onUse }: {
  post: Post
  readOnly: boolean
  onUse: (version: PostVersion, all: PostVersion[]) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const versions = useQuery({
    queryKey: ['versions', post.id],
    queryFn: () => fetchVersions(post.id),
    enabled: open,
  })

  useEffect(() => {
    setPreviewId(null)
    setError(null)
  }, [post.id])

  const list = versions.data ?? []
  const total = list.length

  async function use(v: PostVersion) {
    setBusyId(v.id)
    setError(null)
    try {
      await onUse(v, list)
      await versions.refetch()
      setPreviewId(null)
    } catch {
      setError('We could not switch to that version. Your current text is unchanged. Please try again.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mt-4 border-t border-[var(--color-border)] pt-3">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--color-primary-dark)]">
        <History size={16} aria-hidden="true" /> {open ? 'Hide versions' : 'Earlier versions'}
      </button>

      {open && (
        <div className="mt-2">
          {versions.isLoading && <p className="text-sm text-[var(--color-text-secondary)]">Loading versions...</p>}
          {versions.isError && (
            <p role="alert" className="text-sm text-[var(--color-error)]">
              We could not load earlier versions.{' '}
              <button type="button" className="font-semibold underline" onClick={() => versions.refetch()}>Try again</button>
            </p>
          )}
          {versions.isSuccess && total === 0 && (
            <p className="text-sm text-[var(--color-text-secondary)]">No earlier versions yet. Each time you use "Write it again", the previous text is kept here.</p>
          )}
          {versions.isSuccess && total > 0 && (
            <ol className="flex flex-col gap-2">
              {list.map((v, i) => {
                const isCurrent = v.body === post.body && (v.title ?? null) === (post.title ?? null)
                const showing = previewId === v.id
                return (
                  <li key={v.id} className={clsx('rounded-[var(--radius-md)] border p-3 text-sm',
                    isCurrent ? 'border-[var(--color-primary)] bg-[var(--color-bg-light-green)]' : 'border-[var(--color-border)]')}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[var(--color-text-primary)]">
                        {describe(v, total - i)}
                        {isCurrent && <span className="ml-2 font-semibold text-[var(--color-primary-dark)]">Showing now</span>}
                      </span>
                      <span className="flex gap-2">
                        <button type="button" className="font-semibold text-[var(--color-primary-dark)] underline"
                          onClick={() => setPreviewId(showing ? null : v.id)} aria-expanded={showing}>
                          {showing ? 'Hide' : 'Preview'}
                        </button>
                        {!isCurrent && !readOnly && (
                          <button type="button" className="font-semibold text-[var(--color-primary-dark)] underline disabled:opacity-50"
                            onClick={() => use(v)} disabled={busyId !== null}>
                            {busyId === v.id ? 'Switching...' : 'Use this version'}
                          </button>
                        )}
                      </span>
                    </div>
                    {v.guidance && <p className="mt-1 text-xs italic text-[var(--color-text-secondary)]">You asked: {v.guidance}</p>}
                    {showing && (
                      <div className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-[var(--radius-sm)] bg-[var(--color-surface)] p-2 text-[var(--color-text-primary)]">
                        {v.title && <strong className="block">{v.title}</strong>}
                        {v.body}
                      </div>
                    )}
                  </li>
                )
              })}
            </ol>
          )}
          {error && <p role="alert" className="mt-2 text-sm text-[var(--color-error)]">{error}</p>}
        </div>
      )}
    </div>
  )
}
