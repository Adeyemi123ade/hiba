import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useBlocker, useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, Check, Copy, Loader2, Mic, Plus, ShieldCheck, Square, Trash2 } from 'lucide-react'
import { clsx } from 'clsx'
import { useSession } from '@/features/auth/use-session'
import { SignInAgainButton } from '@/features/auth/components/sign-in-again-button'
import { useOnline } from '@/features/onboarding/use-online'
import { useSpeechInput } from '@/features/onboarding/use-speech-input'
import { Banner } from '@/components/ui/banner'
import { Card, SkeletonCard } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/status-badge'
import { RewriteBox, VersionHistory } from '@/features/capture/rewrite-and-versions'
import { LinkedInPublishPanel } from '@/features/linkedin/linkedin-components'
import { SCHEDULE_ERROR_TEXT, ScheduleError, backToApproved } from '@/features/content/api/schedule-service'
import { PostMedia, type PostMediaHandle } from '@/features/capture/post-attachment'
import { AttachmentMenu } from '@/features/capture/attachment-menu'
import { attachChoices } from '@/features/capture/attachment-choices'
import { IMAGE_MAX_COUNT, imageFields, imagesOf } from '@/features/content/api/image-service'
import { AnglesPanel } from '@/features/capture/angles-panel'
import { CommentsPanel } from '@/features/capture/comments-panel'
import { LeftToday } from '@/features/content/left-today'
import { ALLOWANCES_KEY, useDraftPlatforms } from '@/features/content/use-allowances'
import { useProfile } from '@/features/onboarding/use-profile'
import { DeletePostDialog } from '@/features/library/delete-post-dialog'
import { clearCaptureDraft, loadCaptureDraft, saveCaptureDraft } from '@/features/capture/capture-draft'
import {
  AWAITING_REVIEW, ContentError, ERROR_TEXT, IDEA_MAX, PLATFORMS, STATUS_LABELS, approvePost, lengthCheck, cleanIdea, fetchIdea, generateDrafts, saveIdea,
  restoreVersion, savePostBody, archivePost, restorePost, wasPublished, type Angle, type ContentErrorCode, type Platform, type Post, type PostVersion,
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
  linkedin: 'Post it to your LinkedIn profile now, or copy it and post it yourself.',
  x: 'Connect X first to schedule it. For now, copy it and post it on X yourself.',
  substack: 'Substack has no automatic posting. Copy it and paste it into a new Substack post.',
}

function countLabel(platform: Platform, body: string) {
  return lengthCheck(platform, body)
}

export function CapturePage() {
  const { session } = useSession()
  const userId = session?.user.id
  const online = useOnline()
  const queryClient = useQueryClient()
  // Follow-up comments are on unless switched off in Settings.
  const { data: profile } = useProfile(userId)
  const followUps = profile?.onboarding?.followUpComments !== 'off'
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
  // The AI's question when an idea is too unclear to write about (owner rule: ask, do not guess).
  const [clarify, setClarify] = useState<string | null>(null)
  const [slow, setSlow] = useState(false)
  const [posts, setPosts] = useState<Post[]>([])
  const [tab, setTab] = useState<Platform>('linkedin')
  // Which platforms to write for: the Settings default until the person changes the ticks.
  const defaultPlatforms = useDraftPlatforms(Boolean(userId))
  const [chosenPlatforms, setChosenPlatforms] = useState<Platform[] | null>(null)
  const platforms = chosenPlatforms ?? defaultPlatforms.data ?? ['linkedin']
  const [adding, setAdding] = useState<Platform | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null)
  const [approving, setApproving] = useState(false)
  // HPD-57: archive, restore and permanent delete of the open post.
  const [lifecycle, setLifecycle] = useState<{ busy: boolean; confirmScheduled: boolean; deleteOpen: boolean; message: string | null; error: string | null }>(
    { busy: false, confirmScheduled: false, deleteOpen: false, message: null, error: null },
  )
  const navigate = useNavigate()
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // HPD-53: the edit waiting to be saved, so it is never dropped when the person leaves.
  const pending = useRef<Post | null>(null)
  const loadedIdea = useRef<string | null>(null)
  const mediaRef = useRef<PostMediaHandle>(null)

  const [heardNotice, setHeardNotice] = useState(false)
  const [voiceSlow, setVoiceSlow] = useState(false)
  const speech = useSpeechInput(
    useCallback((heard: string) => {
      setSource('voice')
      setFieldError(null)
      setHeardNotice(true)
      setText((t) => {
        const joined = t.trim() ? `${t.trimEnd()} ${heard.trim()}` : heard.trim()
        if (joined.length > IDEA_MAX) {
          setLimitNotice(`Your idea reached the ${IDEA_MAX} character limit, so the last words you said were not added.`)
        }
        return joined.slice(0, IDEA_MAX)
      })
    }, []),
  )

  // After the AI asks a question, put the cursor in the idea box so the answer can be added straight away.
  useEffect(() => {
    if (clarify && phase === 'write') document.getElementById('idea')?.focus()
  }, [clarify, phase])

  // Slow network while turning a recording into text: say so after 10 seconds.
  useEffect(() => {
    setVoiceSlow(false)
    if (!speech.transcribing) return
    const t = setTimeout(() => setVoiceSlow(true), 10_000)
    return () => clearTimeout(t)
  }, [speech.transcribing])

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
        // Opening one post from the Posts page (?platform=...) shows that post first.
        const wanted = params.get('platform')
        setTab(sorted.find((p) => p.platform === wanted)?.platform ?? sorted[0]?.platform ?? 'linkedin')
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
    // Only the idea and user decide when to load; the platform is read once at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // After each recording is turned into text, refresh what is left today.
  useEffect(() => {
    if (!speech.transcribing) void queryClient.invalidateQueries({ queryKey: ALLOWANCES_KEY })
  }, [speech.transcribing, queryClient])

  // Moving to another page in Hiba after a save failed: ask before leaving.
  const blocker = useBlocker(saveState === 'failed')

  async function makePosts() {
    if (speech.listening || speech.transcribing) {
      setFieldError('Finish your recording first: tap stop, then check the text below.')
      return
    }
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
    setHeardNotice(false)
    setClarify(null)
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
      const result = await generateDrafts(id, { platforms })
      const sorted = [...result].sort((a, b) => order(a.platform) - order(b.platform))
      setPosts(sorted)
      setTab(sorted.find((p) => AWAITING_REVIEW.includes(p.status))?.platform ?? sorted[0]?.platform ?? 'linkedin')
      setPhase('drafts')
      loadedIdea.current = id
      setParams({ idea: id }, { replace: true })
      clearCaptureDraft(userId)
      queryClient.invalidateQueries({ queryKey: ['home-posts'] })
      queryClient.invalidateQueries({ queryKey: ['library'] })
    } catch (e) {
      if (e instanceof ContentError && e.code === 'needs_clarification' && e.detail) {
        setClarify(e.detail)
        setPhase('write')
        return
      }
      setError(codeOf(e))
      setPhase('write')
    } finally {
      clearTimeout(slowTimer)
      void queryClient.invalidateQueries({ queryKey: ALLOWANCES_KEY })
    }
  }

  // Write this idea for a platform it does not have yet (X or Substack, when the person asks).
  async function addPlatform(p: Platform) {
    if (!ideaId || adding) return
    await saveNow()
    setAdding(p)
    setError(null)
    try {
      const result = await generateDrafts(ideaId, { platforms: [p] })
      setPosts([...result].sort((a, b) => order(a.platform) - order(b.platform)))
      setTab(p)
      setCopied(null)
      queryClient.invalidateQueries({ queryKey: ['home-posts'] })
      queryClient.invalidateQueries({ queryKey: ['library'] })
    } catch (e) {
      setError(codeOf(e))
    } finally {
      setAdding(null)
      void queryClient.invalidateQueries({ queryKey: ALLOWANCES_KEY })
    }
  }

  function togglePlatform(p: Platform) {
    const next = platforms.includes(p) ? platforms.filter((x) => x !== p) : [...platforms, p]
    if (next.length) setChosenPlatforms(next)
  }

  function startOver() {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    flushSave()
    speech.cancel()
    setHeardNotice(false)
    clearCaptureDraft(userId)
    setText('')
    setIdeaId(null)
    setSavedText(null)
    setSource('typed')
    setPosts([])
    setError(null)
    setFieldError(null)
    setLimitNotice(null)
    setClarify(null)
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
    setFieldError(null)
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
    const length = lengthCheck(active.platform, active.body)
    if (length.warning) {
      setError(null)
      setFieldError(length.warning)
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
      queryClient.invalidateQueries({ queryKey: ['library'] })
    } catch (e) {
      setError(codeOf(e))
    } finally {
      setApproving(false)
    }
  }

  /** Saves a waiting edit now (throws if it cannot), so a rewrite or version switch starts from it. */
  async function saveNow() {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    const item = pending.current
    if (!item) return
    pending.current = null
    try {
      await savePostBody(item.id, item.title, item.body)
      setSaveState('saved')
    } catch (e) {
      pending.current = item
      setSaveState('failed')
      throw e
    }
  }

  // HPD-50: new version of the open draft, optionally guided. The function keeps the old text.
  async function rewriteActive(guidance: string) {
    if (!active || !ideaId) return
    await saveNow()
    const result = await generateDrafts(ideaId, { platform: active.platform, guidance })
      .finally(() => queryClient.invalidateQueries({ queryKey: ALLOWANCES_KEY }))
    setPosts([...result].sort((a, b) => order(a.platform) - order(b.platform)))
    setSaveState('idle')
    setCopied(null)
    queryClient.invalidateQueries({ queryKey: ['versions', active.id] })
    queryClient.invalidateQueries({ queryKey: ['home-posts'] })
    queryClient.invalidateQueries({ queryKey: ['library'] })
  }

  // HPD-49: rewrite every draft that is not approved yet from the chosen angle.
  async function writeFromAngle(angle: Angle) {
    if (!ideaId) return
    await saveNow()
    const result = await generateDrafts(ideaId, { angleId: angle.id })
      .finally(() => queryClient.invalidateQueries({ queryKey: ALLOWANCES_KEY }))
    const sorted = [...result].sort((a, b) => order(a.platform) - order(b.platform))
    setPosts(sorted)
    if (!sorted.find((p) => p.platform === tab && AWAITING_REVIEW.includes(p.status))) {
      setTab(sorted.find((p) => AWAITING_REVIEW.includes(p.status))?.platform ?? tab)
    }
    setSaveState('idle')
    setCopied(null)
    setFieldError(null)
    queryClient.invalidateQueries({ queryKey: ['versions'] })
    queryClient.invalidateQueries({ queryKey: ['home-posts'] })
    document.getElementById('drafts-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function switchVersion(version: PostVersion, all: PostVersion[]) {
    if (!active) return
    await saveNow()
    const current = posts.find((p) => p.id === active.id) ?? active
    await restoreVersion(current, version, all)
    setPosts((list) => list.map((p) => (p.id === active.id ? { ...p, title: version.title, body: version.body } : p)))
    setSaveState('saved')
    setCopied(null)
    queryClient.invalidateQueries({ queryKey: ['home-posts'] })
    queryClient.invalidateQueries({ queryKey: ['library'] })
  }

  function lifecycleError(e: unknown) {
    const code = codeOf(e)
    return code === 'offline' ? 'You are offline. Reconnect, then try again.'
      : code === 'session_expired' ? 'Your session expired. Sign in again, then try again.'
        : code === 'not_found' ? 'This post has changed or was removed. Reload the page.'
          : 'Something went wrong. Please try again.'
  }

  function refreshLists() {
    queryClient.invalidateQueries({ queryKey: ['home-posts'] })
    queryClient.invalidateQueries({ queryKey: ['library'] })
  }

  async function archiveActive() {
    if (!active) return
    setLifecycle((l) => ({ ...l, busy: true, error: null, message: null }))
    try {
      await saveNow()
      await archivePost(active.id)
      setPosts((list) => list.map((p) => (p.id === active.id ? { ...p, status: 'archived', scheduled_for: null } : p)))
      setLifecycle((l) => ({ ...l, busy: false, confirmScheduled: false,
        message: wasPublished(active) ? 'Archived. It stays on LinkedIn; only Hiba hides it.' : 'Archived. It is hidden from your lists.' }))
      refreshLists()
    } catch (e) {
      setLifecycle((l) => ({ ...l, busy: false, error: lifecycleError(e) }))
    }
  }

  async function restoreActive() {
    if (!active) return
    setLifecycle((l) => ({ ...l, busy: true, error: null, message: null }))
    try {
      const back = await restorePost(active.id)
      setPosts((list) => list.map((p) => (p.id === active.id ? { ...p, status: back } : p)))
      setLifecycle((l) => ({ ...l, busy: false, message: `Restored. It is back as ${STATUS_LABELS[back]}.` }))
      refreshLists()
    } catch (e) {
      setLifecycle((l) => ({ ...l, busy: false, error: lifecycleError(e) }))
    }
  }

  function afterDelete() {
    if (!active) return
    const text = wasPublished(active) ? 'Post deleted from Hiba for good. It is still on LinkedIn.' : 'Post deleted for good.'
    const remaining = posts.filter((p) => p.id !== active.id)
    refreshLists()
    if (!remaining.length) {
      clearCaptureDraft(userId)
      navigate('/dashboard/library', { state: { notice: text } })
      return
    }
    setPosts(remaining)
    setTab(remaining[0].platform)
    setLifecycle({ busy: false, confirmScheduled: false, deleteOpen: false, message: text, error: null })
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
      tone={error === 'offline' || error === 'rate_limited' || error === 'daily_limit' || error === 'ai_busy' ? 'warning' : 'error'}
      action={
        error === 'session_expired' ? (
          <SignInAgainButton />
        ) : error === 'not_found' ? (
          <button type="button" className="font-semibold underline" onClick={startOver}>Start a new idea</button>
        ) : phase === 'write' && (error === 'ai_failed' || error === 'ai_busy' || error === 'unknown' || error === 'not_configured') ? (
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
        <h1 className="sr-only">Capture</h1>
        <SkeletonCard lines={4} />
      </div>
    )
  }

  if (phase === 'working') {
    return (
      <div>
        <h1 className="sr-only">Capture</h1>
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
    // Attachments can still change until the post is scheduled or published (as before).
    const mediaEditable = active.status === 'draft' || active.status === 'needs_review' || active.status === 'approved'
    const canAttach = active.platform === 'linkedin' && Boolean(userId) && mediaEditable
    const anyDraft = posts.some((p) => AWAITING_REVIEW.includes(p.status))
    return (
      <div>
        <h1 id="drafts-title" className="mb-4 scroll-mt-4 text-2xl font-bold text-[var(--color-text-primary)]">Your drafts</h1>
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
                  setLifecycle({ busy: false, confirmScheduled: false, deleteOpen: false, message: null, error: null })
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
            {PLATFORMS.filter((x) => !posts.some((p) => p.platform === x.id)).map((x) => (
              <button key={x.id} type="button" onClick={() => addPlatform(x.id)} disabled={!online || adding !== null}
                className="flex items-center gap-1 rounded-full border border-dashed border-[var(--color-border)] px-4 py-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:opacity-50">
                {adding === x.id ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
                {adding === x.id ? `Writing the ${x.name}...` : `Also write ${x.name}`}
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
          <div className="relative">
            <textarea
              id="draft-text"
              value={active.body}
              readOnly={isApproved}
              onChange={(e) => editActive({ body: e.target.value })}
              aria-describedby="draft-count"
              className={clsx('min-h-[240px] w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg-cream)] p-3 text-[var(--color-text-primary)]',
                canAttach && 'pb-12')}
            />
            {canAttach && (
              <div className="absolute bottom-2 left-2">
                <AttachmentMenu disabled={!online}
                  enabled={attachChoices(imagesOf(active).length, IMAGE_MAX_COUNT, Boolean(active.attachment))}
                  onChoose={(choice) => mediaRef.current?.choose(choice)} />
              </div>
            )}
          </div>
          <div id="draft-count" className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-text-secondary)]">
            <span className="flex flex-wrap items-center gap-1">
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

          {active.platform === 'linkedin' && userId && (
            <PostMedia
              ref={mediaRef}
              key={active.id}
              userId={userId}
              postId={active.id}
              posted={wasPublished(active)}
              images={imagesOf(active)}
              attachment={active.attachment ?? null}
              editable={mediaEditable}
              online={online}
              onImagesChange={(images) => {
                setPosts((list) => list.map((p) => (p.id === active.id ? { ...p, ...imageFields(images) } : p)))
                queryClient.invalidateQueries({ queryKey: ['home-posts'] })
                queryClient.invalidateQueries({ queryKey: ['library'] })
              }}
              onAttachmentChange={(attachment) => {
                setPosts((list) => list.map((p) => (p.id === active.id ? { ...p, attachment } : p)))
              }}
            />
          )}

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
              {active.status === 'archived' && (
                <>
                  <p className="mt-1 text-sm text-[var(--color-text-primary)]">
                    It is hidden from your lists. Restore it to use it again, or delete it for good.
                  </p>
                  {active.external_url && (
                    <p className="mt-2 flex gap-2 text-sm text-[var(--color-primary-dark)]">
                      <ShieldCheck size={18} className="shrink-0" aria-hidden="true" />
                      Your post is still on LinkedIn. Archiving or deleting it here never removes it there.
                    </p>
                  )}
                </>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={primaryBtn} onClick={copyActive}>
                  <Copy size={16} aria-hidden="true" /> Copy
                </button>
                {active.status === 'archived' && (
                  <>
                    <button type="button" className={outlineBtn} onClick={restoreActive} disabled={lifecycle.busy || !online}>
                      {lifecycle.busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <ArchiveRestore size={16} aria-hidden="true" />} Restore
                    </button>
                    <button type="button" disabled={lifecycle.busy || !online}
                      onClick={() => setLifecycle((l) => ({ ...l, deleteOpen: true, message: null, error: null }))}
                      className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-red-700 px-4 py-2 text-sm font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-50">
                      <Trash2 size={16} aria-hidden="true" /> Delete permanently
                    </button>
                  </>
                )}
              </div>
              {active.platform === 'linkedin' && active.status === 'failed' && (
                <BackToApproved
                  postId={active.id}
                  online={online}
                  onDone={() => {
                    setPosts((list) => list.map((p) => (p.id === active.id ? { ...p, status: 'approved', failure_reason: null, scheduled_for: null } : p)))
                    queryClient.invalidateQueries({ queryKey: ['home-posts'] })
                  }}
                />
              )}
              {active.platform === 'linkedin' && ideaId && (active.status === 'approved' || active.status === 'published'
                || (active.status === 'scheduled' && Boolean(active.scheduled_for))) && (
                <LinkedInPublishPanel
                  postId={active.id}
                  ideaId={ideaId}
                  isPublished={active.status === 'published'}
                  text={active.body}
                  images={imagesOf(active)}
                  attachment={active.attachment ?? null}
                  followUps={followUps}
                  publishedUrl={active.external_url ?? null}
                  scheduledFor={active.status === 'scheduled' ? active.scheduled_for : null}
                  onScheduleChange={(at) => {
                    setPosts((list) => list.map((p) => (p.id === active.id ? { ...p, status: at ? 'scheduled' : 'approved', scheduled_for: at } : p)))
                    queryClient.invalidateQueries({ queryKey: ['home-posts'] })
                    queryClient.invalidateQueries({ queryKey: ['calendar'] })
                    queryClient.invalidateQueries({ queryKey: ['library'] })
                  }}
                  onPublished={(url) => {
                    setPosts((list) => list.map((p) => (p.id === active.id ? { ...p, status: 'published', external_url: url } : p)))
                    queryClient.invalidateQueries({ queryKey: ['home-posts'] })
                    queryClient.invalidateQueries({ queryKey: ['library'] })
                  }}
                />
              )}
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <RewriteBox
                key={active.id}
                platformName={PLATFORMS.find((x) => x.id === active.platform)?.name ?? 'draft'}
                online={online}
                onRewrite={rewriteActive}
              />
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
          <VersionHistory post={active} readOnly={isApproved} onUse={switchVersion} />

          {active.status !== 'archived' && (
            <div className="mt-3 border-t border-[var(--color-border)] pt-3 text-sm">
              {lifecycle.confirmScheduled ? (
                <div className="rounded-[var(--radius-sm)] bg-amber-50 p-3 text-amber-900">
                  Archiving cancels its scheduled time. If you restore it, it comes back as Approved with no time set.
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" className={outlineBtn} onClick={archiveActive} disabled={lifecycle.busy || !online}>Archive anyway</button>
                    <button type="button" className="font-semibold underline" onClick={() => setLifecycle((l) => ({ ...l, confirmScheduled: false }))}>Keep it scheduled</button>
                  </div>
                </div>
              ) : (
                <button type="button" disabled={lifecycle.busy || !online}
                  onClick={() => (active.status === 'scheduled' ? setLifecycle((l) => ({ ...l, confirmScheduled: true })) : archiveActive())}
                  className="inline-flex items-center gap-1 font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-50">
                  {lifecycle.busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Archive size={16} aria-hidden="true" />}
                  Archive this post
                </button>
              )}
              <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Hides it from your lists. You can restore it at any time.</p>
            </div>
          )}
          {lifecycle.message && <p role="status" className="mt-2 text-sm text-[var(--color-primary-dark)]">{lifecycle.message}</p>}
          {lifecycle.error && (
            <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-sm text-red-700">
              {lifecycle.error}
              {lifecycle.error.startsWith('Your session expired') && <SignInAgainButton />}
            </div>
          )}
          {lifecycle.deleteOpen && (
            <DeletePostDialog
              post={active}
              online={online}
              onClose={() => setLifecycle((l) => ({ ...l, deleteOpen: false }))}
              onDeleted={afterDelete}
            />
          )}
        </Card>

        {ideaId && active.platform === 'linkedin' && active.body.trim() && active.status !== 'archived' && (
          <CommentsPanel key={active.id} ideaId={ideaId} postId={active.id} online={online} enabled={followUps} postStatus={active.status} postUrl={active.external_url ?? null} />
        )}

        {ideaId && <AnglesPanel ideaId={ideaId} online={online} canRewrite={anyDraft} onChoose={writeFromAngle} />}

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
      <h1 className="sr-only">Capture</h1>
      {errorBanner}
      {clarify && (
        <Banner tone="info">
          <span>
            <span className="font-semibold">Before I write, one question: </span>{clarify}
            <span className="mt-1 block">Add your answer to your idea below, then press Draft my post again. Your idea is saved.</span>
          </span>
        </Banner>
      )}

      <Card className="flex flex-col items-center gap-3 py-8 text-center">
        {speech.supported ? (
          <>
            <button
              type="button"
              onClick={speech.toggle}
              disabled={speech.transcribing}
              aria-label={speech.listening ? 'Stop recording' : 'Start recording'}
              className={clsx(
                'flex h-24 w-24 items-center justify-center rounded-full text-white transition-colors disabled:opacity-50',
                speech.listening
                  ? 'animate-pulse bg-[var(--color-error)] shadow-[0_0_0_12px_rgba(239,68,68,0.2)]'
                  : 'bg-[var(--color-primary)] shadow-[0_0_0_10px_var(--color-primary-soft)]',
              )}
            >
              {speech.transcribing ? <Loader2 size={34} className="animate-spin" aria-hidden="true" />
                : speech.listening ? <Square size={30} aria-hidden="true" /> : <Mic size={38} aria-hidden="true" />}
            </button>
            <h2 className="mt-2 text-lg font-semibold text-[var(--color-text-primary)]">
              {speech.listening ? 'Recording... tap to stop' : speech.transcribing ? 'Turning your voice into text...' : 'Tap and talk'}
            </h2>
            {(speech.listening || speech.transcribing) && (
              <p role="status" className="min-h-6 max-w-md text-sm text-[var(--color-text-secondary)]">
                {speech.transcribing && voiceSlow ? 'Still working. Your connection seems slow, please keep this page open.' : speech.interim}
              </p>
            )}
            {!speech.listening && !speech.transcribing && !speech.error && (
              <p className="max-w-md text-sm text-[var(--color-text-secondary)]">
                Speak naturally for up to 5 minutes. You can check and fix the text before anything is written.
              </p>
            )}
            {!online && !speech.listening && !speech.transcribing && (
              <p className="text-sm text-[var(--color-text-secondary)]">You are offline. You can record now and send it once you reconnect, or type below.</p>
            )}
            {speech.error && (
              <div role="alert" className="flex max-w-md flex-col items-center gap-2 text-sm text-red-700">
                <p>{speech.error} You can also type your idea below.</p>
                {speech.canRetry && (
                  <button type="button" className={outlineBtn} onClick={speech.retry} disabled={!online}>Try again</button>
                )}
              </div>
            )}
            {!speech.listening && !speech.transcribing && <LeftToday action="voice" />}
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Type your idea below</h2>
            <p className="max-w-md text-sm text-[var(--color-text-secondary)]">
              Voice recording does not work in this browser. Please type instead, or use Chrome, Edge or Safari.
            </p>
          </>
        )}
      </Card>

      <Card>
        <label htmlFor="idea" className="mb-2 block text-lg font-semibold text-[var(--color-text-primary)]">
          {speech.supported ? (heardNotice ? 'Your idea' : 'Or type your idea') : 'Your idea'}
        </label>
        {heardNotice && (
          <p role="status" className="mb-2 rounded-[var(--radius-sm)] bg-[var(--color-primary-soft)] px-3 py-2 text-sm text-[var(--color-primary-dark)]">
            Here is what I heard. Please read it and fix anything I got wrong before making your posts.
          </p>
        )}
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
        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-[var(--color-text-secondary)]">
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
        <fieldset className="mt-4">
          <legend className="text-sm font-semibold text-[var(--color-text-primary)]">Write for</legend>
          <div className="mt-1 flex flex-wrap gap-x-5 gap-y-2">
            {PLATFORMS.map((p) => {
              const on = platforms.includes(p.id)
              return (
                <label key={p.id} className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
                  <input type="checkbox" checked={on} onChange={() => togglePlatform(p.id)}
                    disabled={on && platforms.length === 1} className="h-4 w-4 accent-[var(--color-primary-dark)]" />
                  {p.name}
                </label>
              )
            })}
          </div>
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
            At least one. Choose what is ticked at the start in <Link to="/dashboard/settings" className="underline">Settings</Link>.
          </p>
        </fieldset>
        <div className="mt-4 flex flex-wrap justify-between gap-2">
          <button type="button" className={outlineBtn} onClick={startOver} disabled={!text && !ideaId}>
            Clear
          </button>
          <div className="flex flex-col items-end gap-1">
            <button type="button" className={primaryBtn} onClick={makePosts} disabled={!online}>
              Draft my post
            </button>
            <LeftToday action="draft" />
          </div>
        </div>
      </Card>
    </div>
  )
}

/** A LinkedIn post that failed goes back to Approved, so it can be posted or scheduled again. */
function BackToApproved({ postId, online, onDone }: { postId: string; online: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function run() {
    setBusy(true)
    setError(null)
    try {
      await backToApproved(postId)
      onDone()
    } catch (e) {
      setError(SCHEDULE_ERROR_TEXT[e instanceof ScheduleError ? e.code : 'unknown'])
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-3">
      <button type="button" onClick={run} disabled={busy || !online}
        className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-dark)] disabled:cursor-not-allowed disabled:opacity-50">
        {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null} Try again: move back to Approved
      </button>
      <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Then you can post it now or schedule it again. Check LinkedIn first if the message above asks you to.</p>
      {error && <p role="alert" className="mt-1 text-sm text-[var(--color-error)]">{error}</p>}
    </div>
  )
}
