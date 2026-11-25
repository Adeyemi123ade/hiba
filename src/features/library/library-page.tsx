import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, ExternalLink, ImageIcon, Loader2, Search, Trash2, X } from 'lucide-react'
import { clsx } from 'clsx'
import { useSession } from '@/features/auth/use-session'
import { useOnline } from '@/features/onboarding/use-online'
import { Banner } from '@/components/ui/banner'
import { Card, SkeletonCard } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/status-badge'
import { SignInAgainButton } from '@/features/auth/components/sign-in-again-button'
import {
  ContentError, PLATFORMS, SAVED_IDEAS_KEY, STATUS_LABELS, archivePost, fetchSavedIdeas, restorePost, wasPublished, type ContentErrorCode, type Platform,
} from '@/features/content/api/content-service'
import { DeletePostDialog } from '@/features/library/delete-post-dialog'
import { SavedIdeas } from '@/features/library/saved-ideas'
import {
  SEARCH_MAX, STATUS_FILTERS, fetchLibraryPage, imageThumbnails, isPlatform, isStatusFilter,
  type LibraryPost, type StatusFilter,
} from '@/features/library/library-service'
import { PlatformLogo } from '@/components/ui/platform-logo'
import { SwipeRow } from '@/components/ui/swipe-row'

const platformName = (p: Platform) => PLATFORMS.find((x) => x.id === p)?.name ?? p

/** Substack title, or the first line of the post, short enough for a list row. */
function preview(post: LibraryPost) {
  const source = (post.platform === 'substack' && post.title) || post.body || 'Empty draft'
  const line = source.split('\n').find((l) => l.trim()) ?? source
  return line.length > 120 ? `${line.slice(0, 117)}...` : line
}

const quietBtn =
  'inline-flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-sm font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-50'

function actionError(code: ContentErrorCode) {
  if (code === 'offline') return 'You are offline. Reconnect, then try again.'
  if (code === 'session_expired') return 'Your session expired. Sign in again, then try again.'
  if (code === 'not_found') return 'This post has changed or was removed. Refresh the page.'
  return 'Something went wrong. Please try again.'
}

type Notice = { text: string; undo?: () => Promise<void> }

/** HPD-57: archive a post, or restore or delete an archived one. */
function RowActions({ post, online, onDone, onAskDelete }: {
  post: LibraryPost
  online: boolean
  onDone: (notice: Notice | null, error?: ContentErrorCode) => void
  onAskDelete: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [confirmScheduled, setConfirmScheduled] = useState(false)
  const codeOf = (e: unknown): ContentErrorCode => (e instanceof ContentError ? e.code : 'unknown')

  async function run(action: () => Promise<Notice>) {
    setBusy(true)
    try {
      onDone(await action())
    } catch (e) {
      onDone(null, codeOf(e))
    } finally {
      setBusy(false)
      setConfirmScheduled(false)
    }
  }

  const archive = () => run(async () => {
    await archivePost(post.id)
    return {
      text: wasPublished(post) ? 'Post archived. It stays on LinkedIn; only Hiba hides it.' : 'Post archived.',
      undo: async () => { await restorePost(post.id) },
    }
  })
  const restore = () => run(async () => {
    const back = await restorePost(post.id)
    return { text: `Post restored. It is back as ${STATUS_LABELS[back]}.` }
  })

  if (post.status === 'archived') {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <button type="button" className={quietBtn} disabled={busy || !online} onClick={restore}>
          {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <ArchiveRestore size={16} aria-hidden="true" />} Restore
        </button>
        <button type="button" className={clsx(quietBtn, 'text-red-700 hover:text-red-800')} disabled={busy || !online} onClick={onAskDelete}>
          <Trash2 size={16} aria-hidden="true" /> Delete permanently
        </button>
      </div>
    )
  }
  if (confirmScheduled) {
    return (
      <div className="mt-2 rounded-[var(--radius-sm)] bg-amber-50 p-2 text-sm text-amber-900">
        Archiving cancels its scheduled time. If you restore it, it comes back as Approved with no time set.
        <div className="mt-1 flex gap-2">
          <button type="button" className={quietBtn} disabled={busy || !online} onClick={archive}>Archive anyway</button>
          <button type="button" className={quietBtn} onClick={() => setConfirmScheduled(false)}>Keep it scheduled</button>
        </div>
      </div>
    )
  }
  return (
    <div className="mt-2">
      <button type="button" className={quietBtn} disabled={busy || !online}
        onClick={() => (post.status === 'scheduled' ? setConfirmScheduled(true) : archive())}>
        {busy ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Archive size={16} aria-hidden="true" />} Archive
      </button>
    </div>
  )
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

/** HPD-55 / HPD-56: every post the person has made, with search and filters. */
function PostsList() {
  const { session } = useSession()
  const userId = session?.user.id
  const online = useOnline()
  const [params, setParams] = useSearchParams()

  // Filters live in the address, so going back to this page keeps them.
  const statusParam = params.get('status')
  const status: StatusFilter = isStatusFilter(statusParam) ? statusParam : 'all'
  const platformParam = params.get('platform')
  const platform: Platform | null = isPlatform(platformParam) ? platformParam : null
  const search = params.get('q') ?? ''
  const [typed, setTyped] = useState(search)
  const [slow, setSlow] = useState(false)
  const queryClient = useQueryClient()
  const location = useLocation()
  const navigate = useNavigate()
  // A message carried over from the drafts screen (for example after a permanent delete).
  const [notice, setNotice] = useState<Notice | null>(() => {
    const text = (location.state as { notice?: string } | null)?.notice
    return text ? { text } : null
  })
  const [actionErr, setActionErr] = useState<ContentErrorCode | null>(null)
  const [deleting, setDeleting] = useState<LibraryPost | null>(null)

  // Clear the carried-over message from history, so going back does not show it again.
  useEffect(() => {
    if ((location.state as { notice?: string } | null)?.notice) navigate(location.pathname + location.search, { replace: true, state: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['library'] })
    queryClient.invalidateQueries({ queryKey: ['home-posts'] })
  }

  function afterAction(next: Notice | null, error?: ContentErrorCode) {
    setActionErr(error ?? null)
    setNotice(next)
    if (!error) refresh()
  }

  /**
   * Changes some filters, starting from the address as it is right now. (React Router's own
   * helper can hold an older copy inside the search timer, which would undo a filter change.)
   */
  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(window.location.search)
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    setParams(next, { replace: true })
  }

  // Search a moment after the person stops typing.
  useEffect(() => {
    const t = setTimeout(() => {
      if (typed.trim() !== search) update({ q: typed.trim() || null })
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed])

  const query = useInfiniteQuery({
    queryKey: ['library', userId, search, status, platform],
    queryFn: ({ pageParam }) => fetchLibraryPage({ search, status, platform }, pageParam),
    initialPageParam: null as { updated: string; id: string } | null,
    getNextPageParam: (last) => last.next,
    enabled: Boolean(userId),
    // Always check again when the page opens, so edits made a moment ago show up.
    staleTime: 0,
  })

  const posts = useMemo(() => query.data?.pages.flatMap((p) => p.posts) ?? [], [query.data])
  const paths = useMemo(() => [...new Set(posts.map((p) => p.image_path).filter((p): p is string => Boolean(p)))], [posts])
  const thumbs = useQuery({
    queryKey: ['library-thumbs', paths],
    queryFn: () => imageThumbnails(paths),
    enabled: paths.length > 0,
    staleTime: 30 * 60 * 1000,
  })

  // Slow network: say so after 10 seconds of waiting.
  const waiting = query.isPending || query.isFetchingNextPage
  useEffect(() => {
    setSlow(false)
    if (!waiting) return
    const t = setTimeout(() => setSlow(true), 10_000)
    return () => clearTimeout(t)
  }, [waiting])

  const errorCode = query.error instanceof ContentError ? query.error.code : 'unknown'
  const filtered = Boolean(search) || status !== 'all' || platform !== null
  const statusLabel = STATUS_FILTERS.find((f) => f.id === status)?.label ?? 'All'

  return (
    <div>
      <Card>
        <label htmlFor="library-search" className="block text-sm font-semibold text-[var(--color-text-primary)]">
          Search your posts
        </label>
        <div className="relative mt-1">
          <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]" aria-hidden="true" />
          <input
            id="library-search"
            type="text"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            value={typed}
            maxLength={SEARCH_MAX}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="e.g. meetings"
            aria-describedby="library-search-hint"
            className="h-11 w-full rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] pl-10 pr-10 text-[var(--color-text-primary)]"
          />
          {typed && (
            <button type="button" aria-label="Clear search" onClick={() => { setTyped(''); update({ q: null }) }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]">
              <X size={18} aria-hidden="true" />
            </button>
          )}
        </div>
        <p id="library-search-hint" className="mt-1 text-xs text-[var(--color-text-secondary)]">
          {typed.length >= SEARCH_MAX
            ? `Searches can be up to ${SEARCH_MAX} characters.`
            : 'Searches the post text, Substack titles and the idea each post came from.'}
        </p>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          {/* Swipe right to left when they do not all fit (owner, 25 Nov 2026). */}
          <SwipeRow role="group" aria-label="Filter by status" outerClassName="min-w-0 sm:flex-1">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={status === f.id}
                onClick={() => update({ status: f.id === 'all' ? null : f.id })}
                className={clsx(
                  'whitespace-nowrap rounded-full border px-3 py-1.5 text-sm shadow-sm transition active:scale-95',
                  status === f.id
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary-dark)] font-semibold text-white'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-primary)] hover:border-[var(--color-primary-light)]',
                )}
              >
                {f.label}
              </button>
            ))}
          </SwipeRow>
          <label className="flex shrink-0 items-center gap-2 text-sm text-[var(--color-text-primary)]">
            Platform
            <select
              value={platform ?? ''}
              onChange={(e) => update({ platform: e.target.value || null })}
              className="h-10 rounded-[12px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3"
            >
              <option value="">All platforms</option>
              {PLATFORMS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        </div>
      </Card>

      {!online && (
        <Banner tone="warning">You are offline. Posts already shown stay here. Reconnect to search or load more.</Banner>
      )}

      {query.isPending && (
        <div role="status" aria-label="Loading your posts">
          {slow && <p className="mb-2 text-sm text-[var(--color-text-secondary)]">Still loading. Your connection seems slow.</p>}
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {query.isError && posts.length === 0 && (
        <Banner
          tone="error"
          action={
            errorCode === 'session_expired' ? (
              <SignInAgainButton />
            ) : (
              <button type="button" className="font-semibold underline" onClick={() => query.refetch()} disabled={!online}>
                Try again
              </button>
            )
          }
        >
          {errorCode === 'offline'
            ? 'You are offline. Reconnect to see your posts.'
            : errorCode === 'session_expired'
              ? 'Your session expired. Sign in again to see your posts.'
              : 'We could not load your posts.'}
        </Banner>
      )}

      {query.isSuccess && posts.length === 0 && (
        <Card className="text-center">
          {filtered ? (
            <>
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">No posts match</h2>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
                {search ? <>Nothing found for &ldquo;{search}&rdquo;</> : 'Nothing here'}
                {status !== 'all' ? ` in ${statusLabel}` : ''}
                {platform ? ` on ${platformName(platform)}` : ''}. Try other words, or look in all your posts.
              </p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {search && (
                  <button type="button" className="rounded-[var(--radius-sm)] border border-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-dark)]"
                    onClick={() => { setTyped(''); update({ q: null }) }}>
                    Clear search
                  </button>
                )}
                {(status !== 'all' || platform) && (
                  <button type="button" className="rounded-[var(--radius-sm)] border border-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-dark)]"
                    onClick={() => update({ status: null, platform: null })}>
                    Show all statuses and platforms
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">No posts yet</h2>
              <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Capture your first idea and the posts Hiba writes will be listed here.</p>
              <Link to="/dashboard/capture" className="mt-3 inline-block rounded-[var(--radius-sm)] bg-[var(--color-primary-dark)] px-4 py-2 text-sm font-semibold text-white">
                Capture an idea
              </Link>
            </>
          )}
        </Card>
      )}

      {notice && (
        <Banner
          tone="success"
          action={notice.undo ? (
            <button type="button" className="font-semibold underline" disabled={!online}
              onClick={async () => {
                const undo = notice.undo
                setNotice(null)
                try { await undo?.(); setNotice({ text: 'Undone. The post is back.' }); refresh() } catch { setActionErr('unknown') }
              }}>
              Undo
            </button>
          ) : undefined}
        >
          {notice.text}
        </Banner>
      )}
      {actionErr && (
        <Banner tone="error" action={actionErr === 'session_expired' ? <SignInAgainButton /> : undefined}>{actionError(actionErr)}</Banner>
      )}
      {deleting && (
        <DeletePostDialog
          post={deleting}
          online={online}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            const published = wasPublished(deleting)
            setDeleting(null)
            afterAction({ text: published ? 'Post deleted from Hiba for good. It is still on LinkedIn.' : 'Post deleted for good.' })
          }}
        />
      )}

      {posts.length > 0 && (
        <Card className="p-0">
          <ul aria-label="Your posts">
            {posts.map((post) => {
              const thumb = post.image_path ? thumbs.data?.[post.image_path] : undefined
              return (
                <li key={post.id} className="border-t border-[var(--color-border)] first:border-t-0">
                  <div className="flex gap-3 p-4">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-bg-soft-green)]">
                      {thumb ? (
                        <img src={thumb} alt={post.image_alt || 'Image attached to this post'} className="h-full w-full object-cover" />
                      ) : post.image_path ? (
                        <ImageIcon size={20} className="text-[var(--color-text-secondary)]" aria-label="Has an image" />
                      ) : (
                        <PlatformLogo platform={post.platform} size={22} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--color-text-primary)]"><PlatformLogo platform={post.platform} size={14} />{platformName(post.platform)}</span>
                        <StatusBadge status={post.status} />
                      </div>
                      <Link
                        to={`/dashboard/capture?idea=${post.idea_id}&platform=${post.platform}`}
                        className="mt-1 block break-words font-semibold text-[var(--color-text-primary)] hover:underline"
                      >
                        {preview(post)}
                      </Link>
                      <p className="mt-0.5 truncate text-sm text-[var(--color-text-secondary)]">From your idea: {post.idea_body}</p>
                      <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-[var(--color-text-secondary)]">
                        <span>Updated {shortDate(post.updated_at)}</span>
                        <span>Created {shortDate(post.created_at)}</span>
                        {post.status === 'published' && post.external_url && (
                          <a href={post.external_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-[var(--color-primary-dark)] underline">
                            View on LinkedIn <ExternalLink size={12} aria-hidden="true" />
                          </a>
                        )}
                        {post.status === 'archived' && post.archived_at && <span>Archived {shortDate(post.archived_at)}</span>}
                      </p>
                      <RowActions post={post} online={online} onDone={afterAction} onAskDelete={() => setDeleting(post)} />
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {posts.length > 0 && (
        <div className="mb-6 flex flex-col items-center gap-2">
          {query.hasNextPage ? (
            <button
              type="button"
              onClick={() => query.fetchNextPage()}
              disabled={query.isFetchingNextPage || !online}
              className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-dark)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {query.isFetchingNextPage && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
              {query.isFetchingNextPage ? 'Loading more...' : 'Load more posts'}
            </button>
          ) : (
            <p className="text-sm text-[var(--color-text-secondary)]">That is everything{filtered ? ' that matches' : ''}.</p>
          )}
          {query.isFetchingNextPage && slow && (
            <p role="status" className="text-sm text-[var(--color-text-secondary)]">Still loading. Your connection seems slow.</p>
          )}
          {query.isFetchNextPageError && (
            <p role="alert" className="text-sm text-red-700">
              More posts could not be loaded.{' '}
              <button type="button" className="font-semibold underline" onClick={() => query.fetchNextPage()}>Try again</button>
            </p>
          )}
        </div>
      )}
    </div>
  )
}

type View = 'posts' | 'saved'

/**
 * Posts, with a switch to Saved ideas (HPD-171). The owner keeps 6 menu items (25 Nov 2026),
 * so saved ideas live here instead of on their own screen.
 */
export function LibraryPage() {
  const { session } = useSession()
  const userId = session?.user.id
  const online = useOnline()
  const [params, setParams] = useSearchParams()
  const view: View = params.get('view') === 'saved' ? 'saved' : 'posts'
  const saved = useQuery({
    queryKey: [...SAVED_IDEAS_KEY, userId],
    queryFn: fetchSavedIdeas,
    enabled: Boolean(userId),
    staleTime: 0,
    retry: 1,
  })

  const tabClass = (on: boolean) => clsx(
    'flex flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] px-3 py-2 text-sm',
    on ? 'bg-[var(--color-primary-soft)] font-semibold text-[var(--color-primary-dark)]' : 'text-[var(--color-text-primary)] hover:bg-[var(--color-bg-light-green)]',
  )

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Posts</h1>
      <p className="mb-4 text-[var(--color-text-secondary)]">
        {view === 'saved' ? 'Ideas you kept for later. Draft one when you are ready.' : 'Everything you have made with Hiba. Search, filter and open any post.'}
      </p>
      <div role="group" aria-label="Show" className="mb-4 flex gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1">
        <button type="button" aria-pressed={view === 'posts'} className={tabClass(view === 'posts')}
          onClick={() => setParams({}, { replace: true })}>
          Posts
        </button>
        <button type="button" aria-pressed={view === 'saved'} className={tabClass(view === 'saved')}
          onClick={() => setParams({ view: 'saved' }, { replace: true })}>
          Saved ideas
          {saved.data && (
            <span className={clsx('rounded-full px-1.5 text-xs tabular-nums',
              view === 'saved' ? 'bg-[var(--color-primary-dark)] text-white' : 'bg-[var(--color-border)] text-[var(--color-text-primary)]')}>
              {saved.data.length}
            </span>
          )}
        </button>
      </div>
      {view === 'saved' ? <SavedIdeas query={saved} online={online} /> : <PostsList />}
    </div>
  )
}
