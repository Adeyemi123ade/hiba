import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Mic } from 'lucide-react'
import { useSession } from '@/features/auth/use-session'
import { useProfile } from '@/features/onboarding/use-profile'
import { Banner } from '@/components/ui/banner'
import { Card, SkeletonCard } from '@/components/ui/card'
import { loadCaptureDraft } from '@/features/capture/capture-draft'
import {
  AWAITING_REVIEW, ContentError, PLATFORMS, fetchHomePosts, type Post,
} from '@/features/content/api/content-service'
import { StatusBadge } from '@/components/ui/status-badge'
import { SignInAgainButton } from '@/features/auth/components/sign-in-again-button'
import { SAMPLE_GROWTH } from '@/features/dashboard/sample-data'

function greeting(date = new Date()) {
  const h = date.getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

const platformName = (p: Post['platform']) => PLATFORMS.find((x) => x.id === p)?.name ?? p

/** First line of a post, short enough for a list row. */
function headline(posts: Post[]) {
  const source = posts.find((p) => p.platform === 'substack')?.title || posts[0]?.body || 'Untitled idea'
  const line = source.split('\n').find((l) => l.trim()) ?? source
  return line.length > 80 ? `${line.slice(0, 77)}...` : line
}

function groupByIdea(posts: Post[]) {
  const map = new Map<string, Post[]>()
  for (const p of posts) map.set(p.idea_id, [...(map.get(p.idea_id) ?? []), p])
  return [...map.entries()]
}

function IdeaRow({ ideaId, posts, action }: { ideaId: string; posts: Post[]; action: string }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] py-3 first:border-t-0">
      <div className="min-w-0">
        <p className="truncate font-semibold text-[var(--color-text-primary)]">{headline(posts)}</p>
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-[var(--color-text-secondary)]">
          {posts.map((p) => (
            <li key={p.id} className="inline-flex items-center gap-1.5">
              {platformName(p.platform)} <StatusBadge status={p.status} />
            </li>
          ))}
        </ul>
      </div>
      <Link
        to={`/dashboard/capture?idea=${ideaId}`}
        className="rounded-[var(--radius-sm)] bg-[var(--color-primary-dark)] px-4 py-2 text-sm font-semibold text-white"
      >
        {action}
      </Link>
    </li>
  )
}

export function DashboardHomePage() {
  const navigate = useNavigate()
  const { session } = useSession()
  const userId = session?.user.id
  const { data: profile } = useProfile(userId)
  const posts = useQuery({ queryKey: ['home-posts', userId], queryFn: fetchHomePosts, enabled: Boolean(userId) })
  const unfinished = loadCaptureDraft(userId)

  const name = profile?.preferred_name?.trim()
  const all = posts.data ?? []
  const waiting = groupByIdea(all.filter((p) => AWAITING_REVIEW.includes(p.status)))
  const readyCount = all.filter((p) => p.status === 'approved').length
  const approved = groupByIdea(all.filter((p) => p.status === 'approved'))
  // HPD-41: the five most recently changed ideas, whatever their status (newest first from the query).
  const recent = groupByIdea(all).slice(0, 5)
  const weekAhead = Date.now() + 7 * 24 * 60 * 60 * 1000
  const upcoming = all.filter(
    (p) => p.status === 'scheduled' && p.scheduled_for && new Date(p.scheduled_for).getTime() <= weekAhead,
  )
  const isEmpty = posts.isSuccess && all.length === 0
  const errorCode = posts.error instanceof ContentError ? posts.error.code : 'unknown'

  return (
    <div>
      <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">
        {greeting()}{name ? `, ${name}` : ''}
      </h1>
      <p className="mb-5 text-[var(--color-text-secondary)]">What happened in your day worth sharing?</p>

      {unfinished && (unfinished.text.trim() || unfinished.ideaId) && (
        <Banner
          tone="info"
          action={
            <Link to="/dashboard/capture" className="font-semibold underline">
              Continue
            </Link>
          }
        >
          You have an unfinished idea saved on this device.
        </Banner>
      )}

      <Card className="flex flex-col items-center gap-3 py-8 text-center">
        <button
          type="button"
          onClick={() => navigate('/dashboard/capture')}
          aria-label="Record an idea"
          className="flex h-24 w-24 items-center justify-center rounded-full bg-[var(--color-primary)] text-white shadow-[0_0_0_10px_var(--color-primary-soft)] transition-transform hover:scale-105"
        >
          <Mic size={38} aria-hidden="true" />
        </button>
        <h2 className="mt-2 text-lg font-semibold text-[var(--color-text-primary)]">Record an idea</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Talk for a minute. Hiba turns it into posts that sound like you.
        </p>
        <Link
          to="/dashboard/capture"
          className="rounded-[var(--radius-sm)] border border-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-dark)]"
        >
          Or type it instead
        </Link>
      </Card>

      {posts.isLoading && (
        <>
          <SkeletonCard />
          <SkeletonCard />
        </>
      )}

      {posts.isError && (
        <Banner
          tone="error"
          action={
            errorCode === 'session_expired' ? (
              <SignInAgainButton />
            ) : (
              <button type="button" className="font-semibold underline" onClick={() => posts.refetch()}>
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

      {posts.isSuccess && (
        <>
          <Card>
            <h2 className="mb-2 text-lg font-semibold text-[var(--color-text-primary)]">
              Waiting for your approval{waiting.length ? ` (${waiting.length})` : ''}
            </h2>
            {waiting.length ? (
              <ul>
                {waiting.map(([id, list]) => <IdeaRow key={id} ideaId={id} posts={list} action="Review" />)}
              </ul>
            ) : (
              <p className="text-sm text-[var(--color-text-secondary)]">
                {isEmpty
                  ? 'No posts yet. Record your first idea and it will show up here.'
                  : 'Nothing waiting. You are all caught up.'}
              </p>
            )}
          </Card>

          {approved.length > 0 && (
            <Card>
              <h2 className="mb-1 text-lg font-semibold text-[var(--color-text-primary)]">
                Ready to publish ({readyCount} {readyCount === 1 ? 'post' : 'posts'})
              </h2>
              <p className="mb-2 text-sm text-[var(--color-text-secondary)]">
                Copy these and post them yourself until you connect your accounts.
              </p>
              <ul>
                {approved.map(([id, list]) => <IdeaRow key={id} ideaId={id} posts={list} action="Open" />)}
              </ul>
            </Card>
          )}

          {recent.length > 0 && (
            <Card>
              <h2 className="mb-2 text-lg font-semibold text-[var(--color-text-primary)]">Recent posts</h2>
              <ul>
                {recent.map(([id, list]) => <IdeaRow key={id} ideaId={id} posts={list} action="Open" />)}
              </ul>
            </Card>
          )}

          <Card>
            <h2 className="mb-2 text-lg font-semibold text-[var(--color-text-primary)]">Coming up this week</h2>
            {upcoming.length ? (
              <ul>
                {upcoming.map((p) => (
                  <li key={p.id} className="border-t border-[var(--color-border)] py-2 text-sm first:border-t-0">
                    {platformName(p.platform)} · {new Date(p.scheduled_for as string).toLocaleString()}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--color-text-secondary)]">
                Nothing scheduled yet. Scheduling opens once you connect LinkedIn.
              </p>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-[var(--color-text-primary)]">
              How you are growing
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Sample</span>
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {SAMPLE_GROWTH.map((s) => (
                <div key={s.label} className="rounded-[var(--radius-md)] bg-[var(--color-bg-soft-green)] p-3">
                  <b className="block text-xl text-[var(--color-ink)]">{s.value}</b>
                  <span className="text-sm text-[var(--color-text-secondary)]">{s.label}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-[var(--color-text-secondary)]">
              These are example numbers. Your real numbers appear after your first published post.
            </p>
          </Card>

          {isEmpty && (
            <Card>
              <h2 className="mb-1 text-lg font-semibold text-[var(--color-text-primary)]">Connect your accounts</h2>
              <p className="text-sm text-[var(--color-text-secondary)]">
                Connecting LinkedIn and X is coming soon. Hiba will only ever post with your permission. Substack works
                by copy and paste.
              </p>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
