import { useState } from 'react'
import { Download } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { useSession } from '@/features/auth/use-session'
import { useOnline } from '@/features/onboarding/use-online'
import {
  ExportError, checkCanRequestData, exportErrorText, sendMyDataByEmail, type ExportErrorCode,
} from '@/features/settings/data-export'

type Step = 'start' | 'confirm' | 'email' | 'sent'

const primary = 'whitespace-nowrap rounded-[var(--radius-sm)] bg-[var(--color-primary-dark)] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50'
const secondary = 'whitespace-nowrap rounded-[var(--radius-sm)] border border-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-dark)] disabled:opacity-50'

/**
 * HPD-159 (owner, 24 Nov 2026): Download my data, then confirm, then type your sign-in email.
 * The copy is sent to that email as a private link that works for 7 days. Nothing downloads here.
 * Once every 3 days: checked as soon as the button is pressed.
 */
export function DownloadData() {
  const user = useSession().session?.user
  const online = useOnline()
  const [step, setStep] = useState<Step>('start')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ code: ExportErrorCode; nextAt: string | null } | null>(null)
  const showError = (e: unknown) => setError(e instanceof ExportError ? { code: e.code, nextAt: e.nextAt } : { code: 'failed', nextAt: null })

  async function start() {
    setBusy(true)
    setError(null)
    try {
      await checkCanRequestData()
      setStep('confirm')
    } catch (e) {
      showError(e)
    } finally {
      setBusy(false)
    }
  }

  function cancel() {
    setStep('start')
    setTyped('')
    setError(null)
  }

  async function send() {
    if (!user || !typed.trim()) return
    setBusy(true)
    setError(null)
    try {
      await sendMyDataByEmail(user.id, user.email ?? null, typed)
      setStep('sent')
      setTyped('')
    } catch (e) {
      showError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <h2 id="download-title" className="text-lg font-semibold text-[var(--color-text-primary)]">Download your data</h2>
      <p className="text-sm text-[var(--color-text-secondary)]">
        Get a copy of everything Hiba keeps about you: your account, answers, ideas, posts, comments and post images.
        We send it to your email. Your image library stays on this device and is not included.
      </p>

      {step === 'start' && (
        <>
          <button type="button" onClick={() => void start()} disabled={!user || busy || !online}
            className={`mt-3 inline-flex items-center gap-2 ${secondary}`}>
            <Download size={16} aria-hidden="true" />
            {busy ? 'Checking...' : 'Download my data'}
          </button>
          {error && <p role="alert" className="mt-2 text-sm text-[var(--color-error)]">{exportErrorText(error.code, error.nextAt)}</p>}
          {!online && <p className="mt-2 text-sm text-[var(--color-text-secondary)]">You are offline. Check your network connection and try again.</p>}
        </>
      )}

      {step === 'confirm' && (
        <div className="mt-3" role="group" aria-labelledby="download-confirm">
          <p id="download-confirm" className="text-sm font-medium text-[var(--color-text-primary)]">
            Do you want a copy of your data sent to your email?
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setStep('email')} className={primary}>Yes</button>
            <button type="button" onClick={cancel} className={secondary}>Cancel</button>
          </div>
        </div>
      )}

      {step === 'email' && (
        <form className="mt-3" onSubmit={(e) => { e.preventDefault(); void send() }}>
          <label htmlFor="download-email" className="block text-sm font-medium text-[var(--color-text-primary)]">
            Type your email address
          </label>
          <input id="download-email" type="email" autoComplete="email" value={typed} disabled={busy} autoFocus
            onChange={(e) => { setTyped(e.target.value); setError(null) }}
            className="mt-1 h-11 w-full max-w-sm rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 text-sm" />
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Use the email you sign in with. We only send it there.</p>
          {error && <p role="alert" className="mt-2 text-sm text-[var(--color-error)]">{exportErrorText(error.code, error.nextAt)}</p>}
          {!online && !error && <p className="mt-2 text-sm text-[var(--color-text-secondary)]">You are offline. Check your network connection and try again.</p>}
          <div className="mt-3 flex gap-2">
            <button type="submit" disabled={busy || !online || !typed.trim()} className={primary}>
              {busy ? 'Sending...' : 'Send'}
            </button>
            <button type="button" onClick={cancel} disabled={busy} className={secondary}>Cancel</button>
          </div>
        </form>
      )}

      <div aria-live="polite">
        {step === 'sent' && (
          <p className="mt-3 text-sm text-[var(--color-text-primary)]">
            We sent a download link to your email. It works for 7 days. If you cannot find it, check your spam folder.
          </p>
        )}
      </div>
    </Card>
  )
}
