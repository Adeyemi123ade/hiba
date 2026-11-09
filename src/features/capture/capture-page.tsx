import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useBlocker, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Loader2, Mic, Square } from 'lucide-react'
import { clsx } from 'clsx'
import { useSession } from '@/features/auth/use-session'
import { SignInAgainButton } from '@/features/auth/components/sign-in-again-button'
import { useOnline } from '@/features/onboarding/use-online'
import { useSpeechInput } from '@/features/onboarding/use-speech-input'
import { Banner } from '@/components/ui/banner'
import { Card, SkeletonCard } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/status-badge'
import { clearCaptureDraft, loadCaptureDraft, saveCaptureDraft } from '@/features/capture/capture-draft'
import {
  AWAITING_REVIEW, ContentError, ERROR_TEXT, IDEA_MAX, PLATFORMS, STATUS_LABELS, approvePost, cleanIdea, fetchIdea, generateDrafts, saveIdea,
  savePostBody, type ContentErrorCode, type Platform, type Post,
} from '@/features/content/api/content-service'

type Phase = 'loading' | 'write' | 'working' | 'drafts'
type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-primary-dark)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50'
const outlineBtn =
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-dark)] disabled:cursor-not-allowed disabled:opacity-50'

const codeOf = (e: unknown): ContentErrorCode => (e instanceof ContentError ? e.code : 'unknown')
const order = (p: Platform) => PLATFORMS.findIndex((x) => x.id === p)

/** What publishing looks like for each platform until accounts can be connected. */
const NEXT_STEP: Record<Platform, string> = {
  linkedin: 'Connect LinkedIn first to schedule it. For now, copy it and post it on LinkedIn yourself.',
  x: 'Connect X first to schedule it. For now, copy it and post it on X yourself.',
  substack: 'Substack has no automatic posting. Copy it and paste it into a new Substack post.',
}

function countLabel(platform: Platform, body: string) {
  if (platform === 'x') {
    const parts = body.split(/\n\s*\n/).filter((p) => p.trim())
    const tooLong = parts.filter((p) => p.length > 280).length
    return {
      text: `${parts.length} ${parts.length === 1 ? 'post' : 'posts'} in this thread`,
      warning: tooLong ? `${tooLong} ${tooLong === 1 ? 'post is' : 'posts are'} over 280 characters. X will not accept ${tooLong === 1 ? 'it' : 'them'}.` : null,
    }
  }
  if (platform === 'substack') {
    const words = body.trim() ? body.trim().split(/\s+/).length : 0
    return { text: `${words} words`, warning: null }
  }
  return {
    text: `${body.length} of 3000 characters`,
    warning: body.length > 3000 ? 'This is over the LinkedIn limit of 3000 characters.' : null,
  }
}

export function CapturePage() {
  const { session } = useSession()
  const userId = session?.user.id
  const online = useOnline()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const ideaParam = params.get('idea')

  const [phase, setPhase] = useState<Phase>(ideaParam ? 'loading' : 'write')
  const [text, setText] = useState(() => loadCaptureDraft(userId)?.text ?? '')
  const [ideaId, setIdeaId] = useState<string | null>(() => ideaParam ?? loadCaptureDraft(userId)?.ideaId ?? null)
  const [savedText, setSavedText] = useState<string | null>(null)
  const [source, setSource] = useState<'typed' | 'voice'>('typed')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [limitNotice, setLimitNotice] = useState<string | null>(null)
  const [error, setError] = useState<ContentErrorCode | null>(null)
  const [slow, setSlow] = useState(false)
  const [posts, setPosts] = useState<Post[]>([])
  const [tab, setTab] = useState<Platform>('linkedin')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null)
  const [approving, setApproving] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // HPD-53: the edit waiting to be saved, so it is never dropped when the person leaves.
  const pending = useRef<Post | null>(null)
  const loadedIdea = useRef<string | null>(null)

  const speech = useSpeechInput(
    useCallback((heard: string) => {
      setSource('voice')
      setFieldError(null)
      setText((t) => {
        const joined = t.trim() ? `${t.trimEnd()} ${heard.trim()}` : heard.trim()
        if (joined.length > IDEA_MAX) {
          setLimitNotice(`Your idea reached the ${IDEA_MAX} character limit, so the last words you said were not added.`)
        }
        return joined.slice(0, IDEA_MAX)
      })
    }, []),
  )

  // Keep the idea on this device while the user works, so nothing is lost.
  useEffect(() => {
    if (phase === 'write' || phase === 'working') saveCaptureDraft(userId, { text, ideaId })
  }, [userId, text, ideaId, phase])

  // Opening an existing idea from Home (?idea=...).
  useEffect(() => {
    if (!ideaParam || !userId || loadedIdea.current === ideaParam) return
    let cancelled = false
    setPhase('loading')
    setError(null)
    fetchIdea(ideaParam)
      .then((idea) => {
        if (cancelled) return
        loadedIdea.current = idea.id
        setIdeaId(idea.id)
        setText(idea.body)
        setSavedText(idea.body)
        const sorted = [...idea.posts].sort((a, b) => order(a.platform) - order(b.platform))
        setPosts(sorted)
        setTab(sorted[0]?.platform ?? 'linkedin')
        setPhase(sorted.length ? 'drafts' : 'write')
      })
      .catch((e) => {
        if (cancelled) return
        setError(codeOf(e))
        setPhase('write')
      })
    return () => {
      cancelled = true
    }
  }, [ideaParam, userId])

  // Leaving the page within a second of typing: save the last edit straight away.
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    const last = pending.current
    if (last) void savePostBody(last.id, last.title, last.body).catch(() => {})
  }, [])

  const unsaved = saveState === 'saving' || saveState === 'failed'

  // Closing or reloading the tab with unsaved edits: the browser asks first.
  useEffect(() => {
    if (!unsaved) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsaved])

  // Moving to another page in Hiba after a save failed: ask before leaving.
  const blocker = useBlocker(saveState === 'failed')

  async function makePosts() {
    const clean = cleanIdea(text)
    if (!clean) {
      setFieldError('Tell me your idea first. Type it or tap the mic.')
      return
    }
    if (clean.length > IDEA_MAX) {
      setFieldError(`Please keep your idea under ${IDEA_MAX} characters.`)
      return
    }
    if (!online) {
      setError('offline')
      return
    }
    speech.stop()
    setFieldError(null)
    setError(null)
    setSlow(false)
    setPhase('working')
    const slowTimer = setTimeout(() => setSlow(true), 10_000)
    try {
      // Save the idea first (once per wording), so a drafting failure never loses it.
      let id = ideaId
      if (!id || savedText !== clean) {
        id = await saveIdea(clean, source)
        setIdeaId(id)
        setSavedText(clean)
        saveCaptureDraft(userId, { text: clean, ideaId: id })
      }
      const result = await generateDrafts(id)
      const sorted = [...result].sort((a, b) => order(a.platform) - order(b.platform))
      setPosts(sorted)
      setTab(sorted.find((p) => AWAITING_REVIEW.includes(p.status))?.platform ?? sorted[0]?.platform ?? 'linkedin')
      setPhase('drafts')
      loadedIdea.current = id
      setParams({ idea: id }, { replace: true })
      clearCaptureDraft(userId)
      queryClient.invalidateQueries({ queryKey: ['home-posts'] })
    } catch (e) {
      setError(codeOf(e))
      setPhase('write')
    } finally {
      clearTimeout(slowTimer)
    }
  }

  function startOver() {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    flushSave()
    speech.stop()
    clearCaptureDraft(userId)
    setText('')
    setIdeaId(null)
    setSavedText(null)
    setSource('typed')
    setPosts([])
    setError(null)
    setFieldError(null)
    setLimitNotice(null)
    setSaveState('idle')
    setCopied(null)
    loadedIdea.current = null
    setParams({}, { replace: true })
    setPhase('write')
  }

  const active = posts.find((p) => p.platform === tab)

  function editActive(change: Partial<Pick<Post, 'title' | 'body'>>) {
    if (!active) return
    const next = { ...active, ...change }
    setPosts((list) => list.map((p) => (p.id === active.id ? next : p)))
    setCopied(null)
    setSaveState('saving')
    pending.current = next
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flushSave, 1000)
  }

  function flushSave() {
    const item = pending.current
    if (!item) return
    pending.current = null
    setSaveState('saving')
    savePostBody(item.id, item.title, item.body)
      .then(() => setSaveState((s) => (pending.current ? s : 'saved')))
      .catch(() => {
        // Keep the edit so "Try saving again" and leaving the page can still save it.
        if (!pending.current) pending.current = item
        setSaveState('failed')
      })
  }

  async function approve() {
    if (!active) return
    if (!active.body.trim()) {
      setError(null)
      setFieldError('This draft is empty. Write something or tap "Write it again".')
      return
    }
    setApproving(true)
    setError(null)
    try {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      await approvePost(active.id, active.title, active.body)
      pending.current = null
      setPosts((list) => list.map((p) => (p.id === active.id ? { ...p, status: 'approved' } : p)))
      setSaveState('saved')
      queryClient.invalidateQueries({ queryKey: ['home-posts'] })
    } catch (e) {
      setError(codeOf(e))
    } finally {
      setApproving(false)
    }
  }

  async function copyActive() {
    if (!active) return
    const content = active.title ? `${active.title}\n\n${active.body}` : active.body
    try {
      await navigator.clipboard.writeText(content)
      setCopied('ok')
    } catch {
      setCopied('failed')
    }
  }

  const errorBanner = error && (
    <Banner
      tone={error === 'offline' || error === 'rate_limited' ? 'warning' : 'error'}
      action={
        error === 'session_expired' ? (
          <SignInAgainButton />
        ) : error === 'not_found' ? (
          <button type="button" className="font-semibold underline" onClick={startOver}>Start a new idea</button>
        ) : phase === 'write' && (error === 'ai_failed' || error === 'unknown' || error === 'not_configured') ? (
          <button type="button" className="font-semibold underline" onClick={makePosts} disabled={!online}>
            Try again
          </button>
        ) : undefined
      }
    >
      {ERROR_TEXT[error]}
    </Banner>
  )

  const leaveDialog = blocker.state === 'blocked' && (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4">
      <div role="alertdialog" aria-modal="true" aria-labelledby="leave-title"
        className="w-full max-w-sm rounded-[var(--radius-lg)] bg-[var(--color-surface)] p-5 shadow-xl">
        <h2 id="leave-title" className="text-lg font-semibold text-[var(--color-text-primary)]">Your latest changes are not saved</h2>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          If you leave now, your most recent edit to this draft may be lost.
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" className={outlineBtn} onClick={() => blocker.reset?.()}>Stay and try again</button>
          <button type="button" className={primaryBtn} onClick={() => blocker.proceed?.()}>Leave anyway</button>
        </div>
      </div>
    </div>
  )

  if (phase === 'loading') {
    return (
      <div>
        <h1 className="mb-4 text-2xl font-bold text-[var(--color-text-primary)]">Capture</h1>
        <SkeletonCard lines={4} />
      </div>
    )
  }

  if (phase === 'working') {
    return (
      <div>
        <h1 className="mb-4 text-2xl font-bold text-[var(--color-text-primary)]">Capture</h1>
        <Card role="status">
          <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-[var(--color-text-primary)]">
            <Loader2 className="animate-spin" size={20} aria-hidden="true" /> Turning your idea into posts...
          </h2>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {slow ? 'Still working. Your connection seems slow, please keep this page open.' : 'This can take a few seconds.'}
          </p>
        </Card>
        <SkeletonCard />
      </div>
    )
  }

  if (phase === 'drafts' && active) {
    const count = countLabel(active.platform, active.body)
    const isApproved = !AWAITING_REVIEW.includes(active.status)
    const anyDraft = posts.some((p) => AWAITING_REVIEW.includes(p.status))
    return (
      <div>
        <h1 className="mb-4 text-2xl font-bold text-[var(--color-text-primary)]">Your drafts</h1>
        {leaveDialog}
        {errorBanner}
        <Card>
          <p className="mb-3 text-sm text-[var(--color-text-secondary)]">
            <span className="font-semibold text-[var(--color-text-primary)]">Your idea: </span>
            {text}
          </p>
          <p className="mb-3 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
            Status: <StatusBadge status={active.status} />
          </p>
          <div role="tablist" aria-label="Platforms" className="mb-3 flex flex-wrap gap-2">
            {posts.map((p) => (
              <button
                key={p.id}
                role="tab"
                type="button"
                aria-selected={p.platform === tab}
                onClick={() => {
                  setTab(p.platform)
                  setCopied(null)
                  setFieldError(null)
                }}
                className={clsx(
                  'flex items-center gap-1 rounded-full border px-4 py-1.5 text-sm',
                  p.platform === tab
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary-soft)] font-semibold text-[var(--color-primary-dark)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-primary)]',
                )}
              >
                {!AWAITING_REVIEW.includes(p.status) && <Check size={14} aria-label={STATUS_LABELS[p.status]} />}
                {PLATFORMS.find((x) => x.id === p.platform)?.name}
              </button>
            ))}
          </div>

          {active.platform === 'substack' && (
            <label className="mb-3 block text-sm font-medium text-[var(--color-text-primary)]">
              Title
              <input
                value={active.title ?? ''}
                maxLength={200}
                readOnly={isApproved}
                onChange={(e) => editActive({ title: e.target.value })}
                className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-cream)] px-3 py-2"
              />
            </label>
          )}
          <label htmlFor="draft-text" className="sr-only">Draft text</label>
          <textarea
            id="draft-text"
            value={active.body}
            readOnly={isApproved}
            onChange={(e) => editActive({ body: e.target.value })}
            aria-describedby="draft-count"
            className="min-h-[240px] w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-cream)] p-3 text-[var(--color-text-primary)]"
          />
          <div id="draft-count" className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-[var(--color-text-secondary)]">
            <span>
              {count.text}
              {active.platform === 'x' && ' · leave an empty line between posts'}
            </span>
            <span aria-live="polite">
              {saveState === 'saving' && 'Saving...'}
              {saveState === 'saved' && 'All changes saved'}
              {saveState === 'failed' && (
                <span className="text-[var(--color-error)]">
                  Changes not saved. Check your connection.{' '}
                  <button type="button" className="font-semibold underline" onClick={flushSave}>Try saving again</button>
                </span>
              )}
            </span>
          </div>
          {count.warning && <p className="mt-1 text-sm text-[var(--color-error)]">{count.warning}</p>}
          {fieldError && <p role="alert" className="mt-1 text-sm text-[var(--color-error)]">{fieldError}</p>}

          {isApproved ? (
            <div className="mt-4 rounded-[var(--radius-md)] bg-[var(--color-primary-soft)] p-4" role="status">
              <p className="font-semibold text-[var(--color-primary-dark)]">{STATUS_LABELS[active.status]}.</p>
              {active.status === 'approved' && (
                <p className="mt-1 text-sm text-[var(--color-text-primary)]">{NEXT_STEP[active.platform]}</p>
              )}
              {active.status === 'failed' && (
                <p className="mt-1 text-sm text-[var(--color-error)]">
                  {active.failure_reason || 'Publishing did not work. Copy the post and share it yourself, or try again later.'}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={primaryBtn} onClick={copyActive}>
                  <Copy size={16} aria-hidden="true" /> Copy
                </button>
                {active.platform !== 'substack' && (
                  <button type="button" className={outlineBtn} disabled title="Coming soon">
                    Connect {active.platform === 'x' ? 'X' : 'LinkedIn'} first
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <button type="button" className={outlineBtn} onClick={makePosts} disabled={!online}>
                Write it again
              </button>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={outlineBtn} onClick={copyActive}>
                  <Copy size={16} aria-hidden="true" /> Copy
                </button>
                <button type="button" className={primaryBtn} onClick={approve} disabled={approving || !online}>
                  {approving ? 'Approving...' : 'Approve'}
                </button>
              </div>
            </div>
          )}
          {copied === 'ok' && <p role="status" className="mt-2 text-sm text-[var(--color-primary-dark)]">Copied. Paste it wherever you like.</p>}
          {copied === 'failed' && (
            <p role="alert" className="mt-2 text-sm text-[var(--color-error)]">
              Your browser blocked copying. Select the text above and copy it yourself.
            </p>
          )}
        </Card>

        <div className="flex flex-wrap gap-2">
          <button type="button" className={outlineBtn} onClick={startOver}>Capture another idea</button>
          <Link to="/dashboard/home" className={outlineBtn}>Back to Home</Link>
        </div>
        {!anyDraft && (
          <p className="mt-3 text-sm text-[var(--color-text-secondary)]">All drafts for this idea are approved.</p>
        )}
      </div>
    )
  }

  // Write phase.
  const remaining = IDEA_MAX - text.length
  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-[var(--color-text-primary)]">Capture</h1>
      {errorBanner}

      <Card className="flex flex-col items-center gap-3 py-8 text-center">
        {speech.supported ? (
          <>
            <button
              type="button"
              onClick={speech.toggle}
              disabled={!online && !speech.listening}
              aria-label={speech.listening ? 'Stop recording' : 'Start recording'}
              className={clsx(
                'flex h-24 w-24 items-center justify-center rounded-full text-white transition-colors disabled:opacity-50',
                speech.listening
                  ? 'animate-pulse bg-[var(--color-error)] shadow-[0_0_0_12px_rgba(239,68,68,0.2)]'
                  : 'bg-[var(--color-primary)] shadow-[0_0_0_10px_var(--color-primary-soft)]',
              )}
            >
              {speech.listening ? <Square size={30} aria-hidden="true" /> : <Mic size={38} aria-hidden="true" />}
            </button>
            <h2 className="mt-2 text-lg font-semibold text-[var(--color-text-primary)]">
              {speech.listening ? 'Listening... tap to stop' : 'Tap and talk'}
            </h2>
            {speech.listening && (
              <p role="status" className="min-h-6 max-w-md text-sm italic text-[var(--color-text-secondary)]">
                {speech.interim || 'Go ahead, I am listening.'}
              </p>
            )}
            {!online && !speech.listening && (
              <p className="text-sm text-[var(--color-text-secondary)]">Voice needs an internet connection. You can still type below.</p>
            )}
            {speech.error && (
              <p role="alert" className="max-w-md text-sm text-[var(--color-error)]">
                {speech.error} You can also type your idea below.
              </p>
            )}
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Type your idea below</h2>
            <p className="max-w-md text-sm text-[var(--color-text-secondary)]">
              Voice works in Chrome, Edge and Safari. In this browser, please type instead.
            </p>
          </>
        )}
      </Card>

      <Card>
        <label htmlFor="idea" className="mb-2 block text-lg font-semibold text-[var(--color-text-primary)]">
          {speech.supported ? 'Or type your idea' : 'Your idea'}
        </label>
        <textarea
          id="idea"
          value={text}
          maxLength={IDEA_MAX}
          onChange={(e) => {
            setText(e.target.value)
            setFieldError(null)
            if (e.target.value.length < IDEA_MAX) setLimitNotice(null)
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text')
            const el = e.currentTarget
            const total = text.length - (el.selectionEnd - el.selectionStart) + pasted.length
            if (total > IDEA_MAX) {
              setLimitNotice(
                `What you pasted made your idea ${total} characters long. Only ${IDEA_MAX} fit, so the end was cut off. Please check the last part.`,
              )
            }
          }}
          aria-invalid={Boolean(fieldError)}
          aria-describedby={fieldError ? 'idea-error idea-count' : 'idea-count'}
          placeholder="e.g. Today I learned that slow meetings cost more than they save..."
          className={clsx(
            'min-h-[140px] w-full rounded-[var(--radius-md)] border bg-[var(--color-bg-cream)] p-3 text-[var(--color-text-primary)]',
            fieldError ? 'border-[var(--color-error)]' : 'border-[var(--color-border)]',
          )}
        />
        <div className="mt-1 flex justify-between gap-2 text-xs text-[var(--color-text-secondary)]">
          {fieldError ? (
            <span id="idea-error" role="alert" className="text-sm text-[var(--color-error)]">{fieldError}</span>
          ) : (
            <span>{ideaId ? 'Your idea is saved.' : ''}</span>
          )}
          <span id="idea-count" className={remaining < 100 ? 'text-[var(--color-error)]' : ''}>
            {remaining} characters left
          </span>
        </div>
        {limitNotice && (
          <p role="status" className="mt-2 rounded-[var(--radius-sm)] bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {limitNotice}
          </p>
        )}
        <div className="mt-4 flex flex-wrap justify-between gap-2">
          <button type="button" className={outlineBtn} onClick={startOver} disabled={!text && !ideaId}>
            Clear
          </button>
          <button type="button" className={primaryBtn} onClick={makePosts} disabled={!online}>
            Make my posts
          </button>
        </div>
      </Card>
    </div>
  )
}
