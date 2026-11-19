import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLinkedInConnection } from '@/features/linkedin/use-linkedin-connection'
import { useLinkedInNotice } from '@/features/linkedin/use-linkedin-notice'
import { ExternalLink, Loader2, Send } from 'lucide-react'
import { Card } from '@/components/ui/card'
import {
  LINKEDIN_ERROR_TEXT, LinkedInError, disconnectLinkedIn, isExpired, linkedInFunctionIsCurrent, publishToLinkedIn,
  startLinkedInConnect, type LinkedInErrorCode,
} from '@/features/linkedin/linkedin-service'
import { imagePreviewUrl, type PostImageItem } from '@/features/content/api/image-service'
import { fetchComments, type PostComment } from '@/features/content/api/comments-service'

const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] bg-[var(--color-primary-dark)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50'
const outlineBtn =
  'inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-dark)] disabled:cursor-not-allowed disabled:opacity-50'

const codeOf = (e: unknown): LinkedInErrorCode => (e instanceof LinkedInError ? e.code : 'unknown')

/** Shown after the person pressed Cancel on LinkedIn's approval screen and came back here. */
function CancelledNotice() {
  const { notice, dismiss } = useLinkedInNotice()
  if (notice !== 'cancelled') return null
  return (
    <div role="status" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] bg-sky-50 px-3 py-2 text-sm text-sky-900">
      <span>LinkedIn was not connected because you cancelled. You can connect any time.</span>
      <button type="button" className="font-semibold underline" onClick={dismiss}>OK</button>
    </div>
  )
}

function useConnectAction(returnTo: string) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<LinkedInErrorCode | null>(null)
  async function connect() {
    setBusy(true)
    setError(null)
    try {
      await startLinkedInConnect(returnTo)
      // The browser is now leaving for LinkedIn.
    } catch (e) {
      setError(codeOf(e))
      setBusy(false)
    }
  }
  return { busy, error, connect }
}

/** HPD-63, 64, 65, 80: LinkedIn connection status with connect, reconnect and disconnect. */
export function LinkedInConnectionCard() {
  const queryClient = useQueryClient()
  const connection = useLinkedInConnection()
  const { busy, error, connect } = useConnectAction('/dashboard/settings')
  const [confirming, setConfirming] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [disconnectError, setDisconnectError] = useState<LinkedInErrorCode | null>(null)
  const c = connection.data

  async function disconnect() {
    setDisconnecting(true)
    setDisconnectError(null)
    try {
      await disconnectLinkedIn()
      setConfirming(false)
      await queryClient.invalidateQueries({ queryKey: ['linkedin-connection'] })
    } catch (e) {
      setDisconnectError(codeOf(e))
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <Card>
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#0a66c2] text-sm font-bold text-white" aria-hidden="true">in</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">LinkedIn</h2>
          <CancelledNotice />

          {connection.isLoading && <p className="text-sm text-[var(--color-text-secondary)]">Checking your LinkedIn connection...</p>}

          {connection.isError && (
            <p role="alert" className="text-sm text-[var(--color-error)]">
              We could not check your LinkedIn connection.{' '}
              <button type="button" className="font-semibold underline" onClick={() => connection.refetch()}>Try again</button>
            </p>
          )}

          {connection.isSuccess && !c && (
            <>
              <p className="text-sm text-[var(--color-text-secondary)]">
                Not connected. Connect once, and you can post approved drafts to your profile with one click. Hiba never posts without you.
              </p>
              <button type="button" className={`${primaryBtn} mt-3`} onClick={connect} disabled={busy}>
                {busy ? 'Opening LinkedIn...' : 'Connect LinkedIn'}
              </button>
            </>
          )}

          {connection.isSuccess && c && (
            <>
              <p className="text-sm text-[var(--color-text-primary)]">
                {isExpired(c) ? 'Connection expired' : 'Connected'}{c.name ? ` as ${c.name}` : ''}
              </p>
              <p className="text-xs text-[var(--color-text-secondary)]">
                {isExpired(c)
                  ? 'LinkedIn connections last about 60 days. Reconnect to keep posting.'
                  : `Works until ${new Date(c.expires_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}. You will be asked to reconnect after that.`}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {isExpired(c) && (
                  <button type="button" className={primaryBtn} onClick={connect} disabled={busy}>
                    {busy ? 'Opening LinkedIn...' : 'Reconnect LinkedIn'}
                  </button>
                )}
                {!confirming ? (
                  <button type="button" className={outlineBtn} onClick={() => setConfirming(true)}>Disconnect</button>
                ) : (
                  <div role="alertdialog" aria-label="Disconnect LinkedIn" className="w-full rounded-[var(--radius-md)] bg-amber-50 p-3 text-sm text-amber-900">
                    <p>Disconnect LinkedIn? Hiba will stop being able to post for you. Posts already on LinkedIn stay there.</p>
                    <div className="mt-2 flex gap-2">
                      <button type="button" className={primaryBtn} onClick={disconnect} disabled={disconnecting}>
                        {disconnecting ? 'Disconnecting...' : 'Yes, disconnect'}
                      </button>
                      <button type="button" className={outlineBtn} onClick={() => setConfirming(false)} disabled={disconnecting}>Keep connected</button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {error && <p role="alert" className="mt-2 text-sm text-[var(--color-error)]">{LINKEDIN_ERROR_TEXT[error]}</p>}
          {disconnectError && <p role="alert" className="mt-2 text-sm text-[var(--color-error)]">{LINKEDIN_ERROR_TEXT[disconnectError]}</p>}
        </div>
      </div>
    </Card>
  )
}

/** HPD-71 (post now): publish an approved LinkedIn draft, after a clear confirmation. */
/** What the preview shows before anything is posted (owner's master prompt, section 13). */
interface Preview {
  current: boolean
  /** A private preview link per image, in order; null where it could not load. */
  imageUrls: (string | null)[]
  approved: PostComment[]
  notApproved: number
  commentsFailed: boolean
}

export function LinkedInPublishPanel({ postId, ideaId, publishedUrl, isPublished, onPublished, text, images, followUps }: {
  postId: string
  ideaId: string
  publishedUrl: string | null
  isPublished: boolean
  onPublished: (url: string | null) => void
  /** The exact post text, shown in the preview. */
  text: string
  /** Every image on the post, in order. All of them are posted together with the text. */
  images: PostImageItem[]
  /** Whether follow-up comments are switched on in Settings. */
  followUps: boolean
}) {
  const connection = useLinkedInConnection()
  const { busy: connecting, error: connectError, connect } = useConnectAction(`/dashboard/capture?idea=${ideaId}`)
  const [confirming, setConfirming] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [slow, setSlow] = useState(false)
  const [error, setError] = useState<{ code: LinkedInErrorCode; detail?: string } | null>(null)
  const [warning, setWarning] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [checking, setChecking] = useState(false)
  const [imageMissing, setImageMissing] = useState(false)

  if (isPublished) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-3" role="status">
        <span className="text-sm font-semibold text-emerald-800">Posted on LinkedIn.</span>
        {publishedUrl && (
          <a href={publishedUrl} target="_blank" rel="noopener noreferrer" className={outlineBtn}>
            <ExternalLink size={16} aria-hidden="true" /> View on LinkedIn
          </a>
        )}
        {warning && <span className="text-xs text-amber-800">It is live on LinkedIn, but Hiba could not update its status. Refresh to see it.</span>}
        {imageMissing && (
          <span role="alert" className="text-xs text-red-700">
            LinkedIn reported the post went out without its image. Please tell us, and check the post on LinkedIn.
          </span>
        )}
      </div>
    )
  }

  async function publish() {
    setPublishing(true)
    setError(null)
    setSlow(false)
    const timer = setTimeout(() => setSlow(true), 8000)
    try {
      const res = await publishToLinkedIn(postId)
      setWarning(Boolean(res.warning))
      // Belt and braces: the server says whether the image went with the post.
      const sent = typeof res.images === 'number' ? res.images : res.image ? 1 : 0
      setImageMissing(sent < images.length)
      setConfirming(false)
      setPreview(null)
      onPublished(res.url)
    } catch (e) {
      const err = e instanceof LinkedInError ? { code: e.code, detail: e.detail } : { code: 'unknown' as const }
      if (err.code === 'already_published') {
        onPublished(err.detail ?? null)
      } else {
        setError(err)
      }
      if (err.code === 'linkedin_expired' || err.code === 'not_connected') void connection.refetch()
    } finally {
      clearTimeout(timer)
      setPublishing(false)
    }
  }

  // Before anything is posted: check the server function is up to date, and gather the image and
  // the approved comments, so the person sees exactly what will go out (master prompt, section 13).
  async function openPreview() {
    setChecking(true)
    setError(null)
    try {
      const [current, imageUrls, comments] = await Promise.all([
        linkedInFunctionIsCurrent(images.length),
        Promise.all(images.map((img) => imagePreviewUrl(img.path).catch(() => null))),
        followUps ? fetchComments(postId).then((list) => ({ list, failed: false })).catch(() => ({ list: [] as PostComment[], failed: true })) : Promise.resolve({ list: [] as PostComment[], failed: false }),
      ])
      setPreview({
        current,
        imageUrls,
        approved: comments.list.filter((cm) => cm.included && cm.status === 'approved'),
        notApproved: comments.list.filter((cm) => cm.included && cm.status === 'draft').length,
        commentsFailed: comments.failed,
      })
      setConfirming(true)
    } catch (e) {
      setError({ code: codeOf(e) })
    } finally {
      setChecking(false)
    }
  }

  if (connection.isLoading) return <p className="mt-3 text-sm text-[var(--color-text-secondary)]">Checking your LinkedIn connection...</p>
  if (connection.isError) {
    return (
      <p role="alert" className="mt-3 text-sm text-[var(--color-error)]">
        We could not check your LinkedIn connection.{' '}
        <button type="button" className="font-semibold underline" onClick={() => connection.refetch()}>Try again</button>
      </p>
    )
  }

  const c = connection.data
  if (!c || isExpired(c)) {
    return (
      <div className="mt-3">
        <CancelledNotice />
        <button type="button" className={primaryBtn} onClick={connect} disabled={connecting}>
          {connecting ? 'Opening LinkedIn...' : c ? 'Reconnect LinkedIn' : 'Connect LinkedIn'}
        </button>
        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
          {c ? 'Your LinkedIn connection expired. Reconnect, and you will come straight back here.' : 'Connect once, and you will come straight back to this post.'}
        </p>
        {connectError && <p role="alert" className="mt-1 text-sm text-[var(--color-error)]">{LINKEDIN_ERROR_TEXT[connectError]}</p>}
      </div>
    )
  }

  return (
    <div className="mt-3">
      {!confirming ? (
        <button type="button" className={primaryBtn} onClick={openPreview} disabled={checking}>
          {checking ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />}
          {checking ? 'Preparing the preview...' : 'Preview and post to LinkedIn'}
        </button>
      ) : preview && !preview.current ? (
        <div role="alert" className="rounded-[var(--radius-md)] border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-semibold">Hiba cannot post right now.</p>
          <p className="mt-1">
            The LinkedIn function in Supabase is out of date. It could post your text without all of its images or fail to post comments,
            so nothing was posted. In Supabase, go to Edge Functions, redeploy <strong>linkedin</strong> with Verify JWT on, then try again.
          </p>
          <button type="button" className={`${outlineBtn} mt-2`} onClick={() => { setConfirming(false); setPreview(null) }}>OK</button>
        </div>
      ) : preview ? (
        <div role="alertdialog" aria-label="Preview your LinkedIn post" className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <p className="text-sm font-semibold text-[var(--color-text-primary)]">
            This is exactly what will be posted <strong>publicly</strong> on your LinkedIn profile{c.name ? ` (${c.name})` : ''}:
          </p>
          <div className="mt-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white p-3">
            <p className="whitespace-pre-line break-words text-sm text-[var(--color-text-primary)]">{text}</p>
            {images.length > 0 && (
              <div className={`mt-3 grid gap-1 ${images.length === 1 ? 'grid-cols-1' : images.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                {images.map((img, i) => preview.imageUrls[i] ? (
                  <img key={img.path} src={preview.imageUrls[i]!} alt={img.alt || `Image ${i + 1} attached to this post`}
                    className={`${images.length === 1 ? 'max-h-72' : 'h-28'} w-full rounded-[var(--radius-sm)] object-cover`} />
                ) : (
                  <span key={img.path} className="flex h-28 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-bg-soft-green)] px-1 text-center text-xs text-[var(--color-text-secondary)]">
                    Image {i + 1}: preview could not load, it is still posted
                  </span>
                ))}
              </div>
            )}
          </div>
          {images.length > 1 && (
            <p className="mt-2 text-xs text-[var(--color-text-secondary)]">All {images.length} images go out together as one post, in this order.</p>
          )}
          {!images.length && (
            <p className="mt-2 rounded-[var(--radius-sm)] bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
              No image attached. Posts with an image usually get much more attention. You can add one above, or post without it.
            </p>
          )}

          {followUps && (
            <div className="mt-3 text-sm">
              {preview.commentsFailed ? (
                <p className="text-amber-900">Your follow-up comments could not be checked just now. Only approved comments are ever posted.</p>
              ) : preview.approved.length > 0 ? (
                <>
                  <p className="font-semibold text-[var(--color-text-primary)]">
                    Then these {preview.approved.length} approved comment{preview.approved.length === 1 ? ' is' : 's are'} posted under it, one by one, 15 to 60 seconds apart:
                  </p>
                  <ol className="mt-1 list-decimal space-y-1 pl-5 text-[var(--color-text-primary)]">
                    {preview.approved.map((cm) => <li key={cm.id} className="whitespace-pre-line break-words">{cm.body}</li>)}
                  </ol>
                  <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Keep this page open after posting while the comments go out.</p>
                </>
              ) : (
                <p className="text-[var(--color-text-secondary)]">No follow-up comments will be posted.</p>
              )}
              {preview.notApproved > 0 && (
                <p className="mt-1 rounded-[var(--radius-sm)] bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                  {preview.notApproved} comment{preview.notApproved === 1 ? ' is' : 's are'} not approved and will not be posted.
                  Press Not yet and approve {preview.notApproved === 1 ? 'it' : 'them'} in Follow-up comments below if you want {preview.notApproved === 1 ? 'it' : 'them'} too.
                </p>
              )}
            </div>
          )}

          <p className="mt-3 text-xs text-[var(--color-text-secondary)]">Hiba cannot delete the post from LinkedIn later.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={primaryBtn} onClick={publish} disabled={publishing}>
              {publishing ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Posting...</> : 'Yes, post it'}
            </button>
            <button type="button" className={outlineBtn} onClick={() => { setConfirming(false); setPreview(null) }} disabled={publishing}>Not yet</button>
          </div>
          {publishing && slow && <p role="status" className="mt-2 text-xs text-[var(--color-text-secondary)]">Still waiting for LinkedIn. Please keep this page open.</p>}
        </div>
      ) : null}
      {error && (
        <div role="alert" className="mt-2 text-sm text-[var(--color-error)]">
          <p>{LINKEDIN_ERROR_TEXT[error.code]}</p>
          {error.detail && <p className="text-xs">{error.detail}</p>}
        </div>
      )}
    </div>
  )
}
