import { useLocation, useNavigate } from 'react-router-dom'

/** A one-off note handed over when the person comes back from LinkedIn (for example after Cancel). */
export function useLinkedInNotice() {
  const location = useLocation()
  const navigate = useNavigate()
  const notice = (location.state as { linkedinNotice?: string } | null)?.linkedinNotice ?? null
  const dismiss = () => navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
  return { notice, dismiss }
}
