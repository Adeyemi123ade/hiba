import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RegisterForm } from '@/features/auth/components/register-form'
import { LoginForm } from '@/features/auth/components/login-form'
import { OtpForm } from '@/features/auth/components/otp-form'
import { GoogleSignInButton } from '@/features/auth/components/google-signin-button'

type Step = 'register' | 'login' | 'otp'

/**
 * Registration → Email Verification → OTP → Onboarding → Dashboard.
 * Sign in → Dashboard (route guard sends unfinished users to onboarding).
 * Google Sign-In → OAuth redirect → /auth/callback → Dashboard.
 * No Magic Link anywhere in this flow — see Authentication Flow Clarification.
 */
export function AuthPage() {
  const [step, setStep] = useState<Step>('register')
  const [email, setEmail] = useState('')
  const navigate = useNavigate()
  const isLogin = step === 'login'

  const heading =
    step === 'otp' ? 'Verify your email' : isLogin ? 'Welcome back' : 'Create your account'

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[var(--color-bg-cream)] px-4">
      <title>{heading} · Hiba</title>
      <meta name="robots" content="noindex" />
      <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">{heading}</h1>

      {step !== 'otp' && (
        <>
          {isLogin ? (
            <LoginForm onSignedIn={() => navigate('/dashboard/home', { replace: true })} />
          ) : (
            <RegisterForm
              onRegistered={(registeredEmail) => {
                setEmail(registeredEmail)
                setStep('otp')
              }}
            />
          )}
          <div className="flex w-full max-w-sm items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <div className="h-px flex-1 bg-[var(--color-border)]" />
            or
            <div className="h-px flex-1 bg-[var(--color-border)]" />
          </div>
          <GoogleSignInButton />
          <button
            type="button"
            onClick={() => setStep(isLogin ? 'register' : 'login')}
            className="text-sm text-[var(--color-primary-dark)] underline"
          >
            {isLogin ? 'New here? Create an account' : 'Already have an account? Sign in'}
          </button>
        </>
      )}

      {step === 'otp' && (
        <OtpForm email={email} onVerified={() => navigate('/dashboard/home', { replace: true })} />
      )}
    </div>
  )
}
