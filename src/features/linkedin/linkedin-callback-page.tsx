import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import {
  LINKEDIN_ERROR_TEXT, LinkedInError, clearLinkedInReturnPath, completeLinkedInConnect, readLinkedInReturnPath,
  type LinkedInErrorCode,
} from '@/features/linkedin/linkedin-service'

// A LinkedIn code works once. React may run effects twice in development, so remember used codes.
const usedCodes = new Set<string>()

/** LinkedIn sends the person back here (through the linkedin-callback function) after approval. */
export function LinkedInCallbackPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [state, setState] = useState<'working' | 'done' | 'error'>('working')
  const [error, setError] = useState<{ code: LinkedInErrorCode; detail?: string } | null>(null)
  const [name, setName] = useState<string | null>(null)
  const [returnPath] = useState(() => readLinkedInReturnPath())
  // Read what LinkedIn sent once; the address is cleared right after, so never re-read it.
  const [incoming] = useState(() => ({
    code: params.get('code'),
    state: params.get('state'),
    error: params.get('error'),
  }))

  useEffect(() => {
    const { code, state: oauthState, error: denied } = incoming
    if (denied) {
      if (denied.includes('cancel') || denied === 'access_denied') {
        // Cancelled on LinkedIn: go straight back to where the person started, with a short note.
        clearLinkedInReturnPath()
        navigate(returnPath, { replace: true, state: { linkedinNotice: 'cancelled' } })
        return
      }
      setError({ code: 'linkedin_failed' })
      setState('error')
      return
    }
    if (!code || !oauthState) {
      setError({ code: 'state_invalid' })
      setState('error')
      return
    }
    if (usedCodes.has(code)) return
    usedCodes.add(code)
    // Remove the one-time code from the address bar so a refresh never reuses it.
    setParams({}, { replace: true })
    completeLinkedInConnect(code, oauthState)
      .then((res) => {
        setName(res.name)
        setState('done')
        clearLinkedInReturnPath()
        queryClient.invalidateQueries({ queryKey: ['linkedin-connection'] })
      })
      .catch((e) => {
        setError(e instanceof LinkedInError ? { code: e.code, detail: e.detail } : { code: 'unknown' })
        setState('error')
        clearLinkedInReturnPath()
      })
  }, [incoming, setParams, queryClient, navigate, returnPath])

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-[var(--color-text-primary)]">Connect LinkedIn</h1>
      {state === 'working' && (
        <Card role="status" className="flex items-center gap-3">
          <Loader2 className="animate-spin text-[var(--color-primary-dark)]" size={22} aria-hidden="true" />
          <span className="text-[var(--color-text-primary)]">Finishing your LinkedIn connection...</span>
        </Card>
      )}
      {state === 'done' && (
        <Card role="status" className="flex flex-col items-start gap-3">
          <p className="flex items-center gap-2 text-lg font-semibold text-[var(--color-primary-dark)]">
            <CheckCircle2 size={22} aria-hidden="true" /> LinkedIn connected{name ? ` as ${name}` : ''}.
          </p>
          <p className="text-sm text-[var(--color-text-secondary)]">
            You can now post approved LinkedIn drafts straight to your profile. Hiba only posts when you press the button.
          </p>
          <button type="button" onClick={() => navigate(returnPath, { replace: true })}
            className="rounded-[var(--radius-sm)] bg-[var(--color-primary-dark)] px-4 py-2 text-sm font-semibold text-white">
            Continue
          </button>
        </Card>
      )}
      {state === 'error' && error && (
        <Card role="alert" className="flex flex-col items-start gap-3">
          <p className="text-[var(--color-error)]">{LINKEDIN_ERROR_TEXT[error.code]}</p>
          {error.detail && <p className="text-xs text-[var(--color-text-secondary)]">{error.detail}</p>}
          <div className="flex flex-wrap gap-2">
            <Link to="/dashboard/settings" className="rounded-[var(--radius-sm)] bg-[var(--color-primary-dark)] px-4 py-2 text-sm font-semibold text-white">
              Go to connected accounts
            </Link>
            <Link to={returnPath} className="rounded-[var(--radius-sm)] border border-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-[var(--color-primary-dark)]">
              Back to where I was
            </Link>
          </div>
        </Card>
      )}
    </div>
  )
}
