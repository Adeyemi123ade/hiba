import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RegisterForm } from '@/features/auth/components/register-form'
import { LoginForm } from '@/features/auth/components/login-form'
import { OtpForm } from '@/features/auth/components/otp-form'
import { ForgotPasswordForm } from '@/features/auth/components/forgot-password-form'
import { ResetPasswordForm } from '@/features/auth/components/reset-password-form'
import { GoogleSignInButton } from '@/features/auth/components/google-signin-button'
import { resendRegistrationOtp } from '@/features/auth/api/auth-service'
import { authLink } from '@/features/auth/components/auth-ui'

type Mode = 'register' | 'login' | 'otp' | 'forgot' | 'reset'

const HEADINGS: Record<Mode, string> = {
  register: 'Create your account',
  login: 'Welcome back',
  otp: 'Verify your email',
  forgot: 'Reset your password',
  reset: 'Choose a new password',
}


/**
 * Register -> verify email (OTP) -> onboarding -> dashboard.
 * Sign in, forgot password and reset password are all reachable from each other
 * without a page refresh. No Magic Link anywhere in this flow.
 */
export function AuthPage() {
  const [mode, setMode] = useState<Mode>('register')
  const [email, setEmail] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const navigate = useNavigate()

  function go(next: Mode, nextEmail = email) {
    setEmail(nextEmail)
    setNotice(null)
    setMode(next)
  }

  const showSocial = mode === 'register' || mode === 'login'

  return (
    <div className="flex min-h-dvh items-center justify-center bg-white px-4 py-4 sm:py-8">
     <div className="flex w-full max-w-md flex-col items-stretch gap-3 sm:gap-4">
      <title>{HEADINGS[mode]} · Hiba</title>
      <meta name="robots" content="noindex" />
      <h1 className="text-center text-2xl font-bold text-[var(--color-text-primary)] sm:text-3xl">{HEADINGS[mode]}</h1>

      {notice && (
        <p role="status" className="w-full rounded-lg bg-[var(--color-primary-soft)] px-3 py-2 text-sm text-[var(--color-primary-dark)]">
          {notice}
        </p>
      )}

      {mode === 'register' && (
        <RegisterForm initialEmail={email} onRegistered={(e) => go('otp', e)} />
      )}

      {mode === 'login' && (
        <LoginForm
          onSignedIn={() => navigate('/dashboard/home', { replace: true })}
          onForgotPassword={(e) => go('forgot', e)}
          onNeedsVerification={(e) => {
            void resendRegistrationOtp(e).catch(() => undefined)
            go('otp', e)
          }}
        />
      )}

      {mode === 'otp' && (
        <OtpForm
          email={email}
          onVerified={() => navigate('/dashboard/home', { replace: true })}
          onChangeEmail={() => go('register')}
          onBackToSignIn={() => go('login')}
          onForgotPassword={() => go('forgot')}
        />
      )}

      {mode === 'forgot' && (
        <ForgotPasswordForm initialEmail={email} onSent={(e) => go('reset', e)} />
      )}

      {mode === 'reset' && (
        <ResetPasswordForm
          email={email}
          onDone={() => {
            go('login')
            setNotice('Password updated. Sign in with your new password.')
          }}
          onChangeEmail={() => go('forgot', '')}
          onBackToSignIn={() => go('login')}
        />
      )}

      {showSocial && (
        <>
          <div className="flex w-full items-center gap-4 text-sm text-[var(--color-text-secondary)]">
            <div className="h-px flex-1 bg-slate-200" />
            or
            <div className="h-px flex-1 bg-slate-200" />
          </div>
          <GoogleSignInButton />
        </>
      )}

      <p className="text-center text-base text-[var(--color-text-primary)]">
        {mode === 'register' && (
          <>Already have an account?{' '}
            <button type="button" onClick={() => go('login')} className={`${authLink} font-bold`}>Sign in</button></>
        )}
        {mode === 'login' && (
          <>New here?{' '}
            <button type="button" onClick={() => go('register')} className={`${authLink} font-bold`}>Create an account</button></>
        )}
        {mode === 'forgot' && (
          <button type="button" onClick={() => go('login')} className={`${authLink} font-bold`}>Back to sign in</button>
        )}
      </p>
      <p className="text-center text-xs text-[var(--color-text-secondary)]">
        <a href="/terms" className={`${authLink} underline`}>Terms of Service</a>
        {' · '}
        <a href="/privacy" className={`${authLink} underline`}>Privacy Policy</a>
      </p>
     </div>
    </div>
  )
}
