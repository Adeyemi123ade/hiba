import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RegisterForm } from '@/features/auth/components/register-form'
import { OtpForm } from '@/features/auth/components/otp-form'
import { GoogleSignInButton } from '@/features/auth/components/google-signin-button'

type Step = 'register' | 'otp'

/**
 * Registration → Email Verification → OTP → Dashboard.
 * Google Sign-In → OAuth redirect → /auth/callback → Dashboard.
 * No Magic Link anywhere in this flow — see Authentication Flow Clarification.
 */
export function AuthPage() {
  const [step, setStep] = useState<Step>('register')
  const [email, setEmail] = useState('')
  const navigate = useNavigate()

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[var(--color-bg-cream)] px-4">
      <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">
        {step === 'register' ? 'Create your account' : 'Verify your email'}
      </h1>

      {step === 'register' && (
        <>
          <RegisterForm
            onRegistered={(registeredEmail) => {
              setEmail(registeredEmail)
              setStep('otp')
            }}
          />
          <div className="flex w-full max-w-sm items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <div className="h-px flex-1 bg-[var(--color-border)]" />
            or
            <div className="h-px flex-1 bg-[var(--color-border)]" />
          </div>
          <GoogleSignInButton />
        </>
      )}

      {step === 'otp' && (
        <OtpForm email={email} onVerified={() => navigate('/dashboard/home', { replace: true })} />
      )}
    </div>
  )
}
