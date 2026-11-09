import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RegisterForm } from '@/features/auth/components/register-form'
import { LoginForm } from '@/features/auth/components/login-form'
import { OtpForm } from '@/features/auth/components/otp-form'
import { ForgotPasswordForm } from '@/features/auth/components/forgot-password-form'
import { ResetPasswordForm } from '@/features/auth/components/reset-password-form'
import { GoogleSignInButton } from '@/features/auth/components/google-signin-button'
import { resendRegistrationOtp } from '@/features/auth/api/auth-service'

type Mode = 'register' | 'login' | 'otp' | 'forgot' | 'reset'

const HEADINGS: Record<Mode, string> = {
  register: 'Create your account',
  login: 'Welcome back',
  otp: 'Verify your email',
  forgot: 'Reset your password',
  reset: 'Choose a new password',
}

const linkClass = 'text-sm text-[var(--color-primary-dark)] hover:underline'

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
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-[var(--color-bg-cream)] px-4 py-8">
      <title>{HEADINGS[mode]} · Hiba</title>
      <meta name="robots" content="noindex" />
      <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">{HEADINGS[mode]}</h1>

      {notice && (
        <p role="status" className="w-full max-w-sm rounded-[var(--radius-sm)] bg-[var(--color-primary-soft)] px-3 py-2 text-sm text-[var(--color-primary-dark)]">
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
          <div className="flex w-full max-w-sm items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <div className="h-px flex-1 bg-[var(--color-border)]" />
            or
            <div className="h-px flex-1 bg-[var(--color-border)]" />
          </div>
          <GoogleSignInButton />
        </>
      )}

      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
        {mode === 'register' && (
          <button type="button" onClick={() => go('login')} className={linkClass}>
            Already have an account? Sign in
          </button>
        )}
        {mode === 'login' && (
          <button type="button" onClick={() => go('register')} className={linkClass}>
            New here? Create an account
          </button>
        )}
        {mode === 'forgot' && (
          <button type="button" onClick={() => go('login')} className={linkClass}>
            Back to sign in
          </button>
        )}
      </div>
      <p className="text-xs text-[var(--color-text-secondary)]">
        <a href="/terms" className="underline">Terms of Service</a> · <a href="/privacy" className="underline">Privacy Policy</a>
      </p>
    </div>
  )
}
