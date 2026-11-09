import { useNavigate } from 'react-router-dom'
import { signOutUser } from '@/features/auth/api/auth-service'

/** Clears the expired session, then opens sign in. Unsaved work stays in this tab's storage. */
export function SignInAgainButton() {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      className="font-semibold underline"
      onClick={async () => {
        try {
          await signOutUser()
        } finally {
          navigate('/auth', { replace: true })
        }
      }}
    >
      Sign in again
    </button>
  )
}
