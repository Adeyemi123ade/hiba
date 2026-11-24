import { useState } from 'react'
import { Download } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { useSession } from '@/features/auth/use-session'
import { useOnline } from '@/features/onboarding/use-online'
import { EXPORT_ERROR_TEXT, ExportError, downloadMyData, type ExportErrorCode } from '@/features/settings/data-export'

/** HPD-159: a copy of everything Hiba keeps about the person, as one ZIP file. */
export function DownloadData() {
  const user = useSession().session?.user
  const online = useOnline()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ExportErrorCode | null>(null)
  const [done, setDone] = useState(false)

  async function download() {
    if (!user) return
    setBusy(true)
    setError(null)
    setDone(false)
    try {
      await downloadMyData(user.id, user.email ?? null)
      setDone(true)
    } catch (e) {
      setError(e instanceof ExportError ? e.code : 'failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <h2 id="download-title" className="text-lg font-semibold text-[var(--color-text-primary)]">Download your data</h2>
      <p className="text-sm text-[var(--color-text-secondary)]">
        Get a copy of everything Hiba keeps about you in one ZIP file: your account, answers, ideas, posts, comments and post images.
        Your image library stays on this device and is not included.
      </p>
      <button type="button" onClick={download} disabled={busy || !online || !user}
        className="mt-3 inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-dark)] disabled:cursor-not-allowed disabled:opacity-50">
        <Download size={16} aria-hidden="true" />
        {busy ? 'Preparing your file...' : 'Download my data'}
      </button>
      <div aria-live="polite">
        {done && <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Your file is downloading. Open read-me-first.html inside it to see your data.</p>}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-[var(--color-error)]">{EXPORT_ERROR_TEXT[error]}</p>}
      {!online && !error && <p className="mt-2 text-sm text-[var(--color-text-secondary)]">You are offline. Check your network connection and try again.</p>}
    </Card>
  )
}
