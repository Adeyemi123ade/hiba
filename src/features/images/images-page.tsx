import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Download, ImagePlus, Loader2, Sparkles, Trash2 } from 'lucide-react'
import { clsx } from 'clsx'
import { Card, SkeletonCard } from '@/components/ui/card'
import { useSession } from '@/features/auth/use-session'
import { STATUS_LABELS, type PostStatus } from '@/features/content/api/content-service'
import { useOnline } from '@/features/onboarding/use-online'
import {
  IMAGE_ALT_MAX, IMAGE_ERROR_TEXT, ImageError, deleteFromLibrary, saveLibraryAlt, uploadToLibrary,
  type ImageErrorCode, type ImageUse, type LibraryImage,
} from '@/features/content/api/image-service'
import { GenerateImagePanel } from '@/features/images/image-components'
import { LIBRARY_KEY, outlineBtn, primaryBtn, useLibrary } from '@/features/images/use-library'

type Filter = 'all' | 'generated' | 'upload'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'generated', label: 'Created with AI' },
  { id: 'upload', label: 'Uploaded' },
]
const codeOf = (e: unknown): ImageErrorCode => (e instanceof ImageError ? e.code : 'upload')

/** H07-S02 / HPD-59: every image the person uploaded or created, ready to use on a post. */
export function ImagesPage() {
  const { session } = useSession()
  const userId = session?.user.id
  const online = useOnline()
  const queryClient = useQueryClient()
  const { library, thumbs } = useLibrary(Boolean(userId))
  const fileInput = useRef<HTMLInputElement>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [creating, setCreating] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<ImageErrorCode | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const images = useMemo(
    () => (library.data?.images ?? []).filter((i) => filter === 'all' || i.source === filter),
    [library.data, filter],
  )
  const refresh = () => queryClient.invalidateQueries({ queryKey: LIBRARY_KEY })

  async function upload(list: FileList | null) {
    const files = Array.from(list ?? [])
    if (!files.length || !userId) return
    setUploading(true)
    setError(null)
    setNotice(null)
    try {
      await uploadToLibrary(userId, files)
      await refresh()
      setNotice(files.length === 1 ? 'Image added.' : `${files.length} images added.`)
    } catch (e) {
      setError(codeOf(e))
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-[var(--color-text-primary)]">Images</h1>
      <p className="mb-5 text-[var(--color-text-secondary)]">
        Every image you upload or create with Hiba. Add them to your LinkedIn posts from the post itself.
      </p>

      <Card>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={primaryBtn} onClick={() => setCreating((c) => !c)} aria-expanded={creating} disabled={!online}>
            <Sparkles size={16} aria-hidden="true" /> {creating ? 'Close' : 'Create with AI'}
          </button>
          <button type="button" className={outlineBtn} onClick={() => fileInput.current?.click()} disabled={uploading || !online}>
            {uploading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <ImagePlus size={16} aria-hidden="true" />}
            {uploading ? 'Uploading...' : 'Upload images'}
          </button>
          <input ref={fileInput} type="file" multiple accept="image/jpeg,image/png,image/gif" className="sr-only"
            aria-label="Choose images to upload" tabIndex={-1} onChange={(e) => upload(e.target.files)} />
        </div>
        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">JPG, PNG or GIF, up to 5 MB each.</p>
        {creating && (
          <div className="mt-3">
            <GenerateImagePanel online={online} onCreated={() => { setCreating(false); setNotice('Your new image is ready. It is first in the list below.') }} />
          </div>
        )}
        {notice && <p role="status" className="mt-2 text-sm text-emerald-800">{notice}</p>}
        {error && <p role="alert" className="mt-2 text-sm text-[var(--color-error)]">{IMAGE_ERROR_TEXT[error]}</p>}
      </Card>

      {library.isLoading && <SkeletonCard />}
      {library.isError && (
        <Card role="alert">
          <p className="text-[var(--color-error)]">Your images could not be loaded.</p>
          <button type="button" className="mt-2 font-semibold underline" onClick={() => library.refetch()}>Try again</button>
        </Card>
      )}

      {library.isSuccess && (
        <Card>
          <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Show">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}
                className={clsx('rounded-full border px-3 py-1 text-sm', filter === f.id
                  ? 'border-[var(--color-primary-dark)] bg-[var(--color-primary-soft)] font-semibold text-[var(--color-primary-dark)]'
                  : 'border-[var(--color-border)] text-[var(--color-text-primary)]')}>
                {f.label}
              </button>
            ))}
            <span className="text-sm text-[var(--color-text-secondary)]">{images.length} image{images.length === 1 ? '' : 's'}</span>
          </div>
          {images.length ? (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {images.map((img) => (
                <ImageTile key={img.id} image={img} url={thumbs[img.path]} uses={library.data.uses[img.path] ?? []}
                  online={online} onChanged={refresh} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--color-text-secondary)]">
              {filter === 'all' ? 'No images yet. Create one with AI or upload your own.' : 'No images here yet.'}
            </p>
          )}
        </Card>
      )}
    </div>
  )
}

function ImageTile({ image, url, uses, online, onChanged }: {
  image: LibraryImage
  url: string | undefined
  uses: ImageUse[]
  online: boolean
  onChanged: () => Promise<unknown>
}) {
  const [alt, setAlt] = useState(image.alt ?? '')
  const [altState, setAltState] = useState<'idle' | 'saved' | 'failed'>('idle')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ImageErrorCode | null>(null)
  const scheduled = uses.some((u) => u.status === 'scheduled')

  async function saveAlt() {
    if ((image.alt ?? '') === alt.trim()) return
    try {
      await saveLibraryAlt(image.id, alt)
      setAltState('saved')
    } catch {
      setAltState('failed')
    }
  }

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await deleteFromLibrary(image, uses)
      await onChanged()
    } catch (e) {
      setError(codeOf(e))
      setBusy(false)
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] p-2">
      <div className="relative flex h-44 items-center justify-center overflow-hidden rounded-[var(--radius-sm)] bg-[var(--color-bg-soft-green)]">
        {url ? <img src={url} alt={alt || 'Image in your library'} className="h-full w-full object-cover" />
          : <Loader2 size={20} className="animate-spin text-[var(--color-text-secondary)]" aria-label="Loading preview" />}
        {image.source === 'generated' && (
          <span className="absolute left-1.5 top-1.5 rounded-full bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">AI</span>
        )}
      </div>
      <p className="text-xs text-[var(--color-text-secondary)]">
        {new Date(image.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
        {' · '}
        {uses.length ? (
          <>On {uses.length} post{uses.length === 1 ? '' : 's'}: {uses.slice(0, 3).map((u, i) => (
            <span key={u.postId}>{i ? ', ' : ''}<Link to={`/dashboard/capture?idea=${u.ideaId}`} className="underline">{STATUS_LABELS[u.status as PostStatus] ?? u.status}</Link></span>
          ))}</>
        ) : 'Not on any post'}
      </p>
      {image.prompt && <p className="line-clamp-2 text-xs text-[var(--color-text-secondary)]" title={image.prompt}>Asked for: {image.prompt}</p>}
      <label className="text-xs font-semibold text-[var(--color-text-primary)]">
        Description <span className="font-normal text-[var(--color-text-secondary)]">(for screen readers)</span>
        <input value={alt} maxLength={IMAGE_ALT_MAX} onChange={(e) => { setAlt(e.target.value); setAltState('idle') }} onBlur={saveAlt}
          className="mt-1 block w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-cream)] px-2 py-1.5 text-sm font-normal" />
      </label>
      <p className="text-xs" aria-live="polite">
        {altState === 'saved' && <span className="text-[var(--color-text-secondary)]">Saved. New posts get this description.</span>}
        {altState === 'failed' && <span className="text-[var(--color-error)]">Not saved. Check your connection.</span>}
      </p>
      {confirm ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>
            Delete this image for good?{uses.length ? ` It is taken off ${uses.length === 1 ? 'the post' : `all ${uses.length} posts`} that use${uses.length === 1 ? 's' : ''} it. Posts already on LinkedIn keep it there.` : ''}
          </span>
          <button type="button" onClick={remove} disabled={busy}
            className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-red-700 px-3 py-1.5 text-sm font-semibold text-red-700 disabled:opacity-50">
            {busy ? 'Deleting...' : 'Yes, delete'}
          </button>
          <button type="button" className="font-semibold underline" onClick={() => setConfirm(false)}>Keep it</button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {url && (
            <a href={url} download target="_blank" rel="noopener noreferrer" className={outlineBtn}>
              <Download size={16} aria-hidden="true" /> Download
            </a>
          )}
          <button type="button" className={outlineBtn} disabled={!online || scheduled} onClick={() => setConfirm(true)}
            title={scheduled ? 'On a scheduled post: change that post first' : undefined}>
            <Trash2 size={16} aria-hidden="true" /> Delete
          </button>
        </div>
      )}
      {scheduled && <p className="text-xs text-[var(--color-text-secondary)]">On a scheduled post, so it cannot be deleted until that post goes out or is cancelled.</p>}
      {error && <p role="alert" className="text-sm text-[var(--color-error)]">{IMAGE_ERROR_TEXT[error]}</p>}
    </li>
  )
}
