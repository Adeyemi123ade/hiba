import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { CalendarDays, FileText, Home, LogOut, Mic, Settings } from 'lucide-react'
import { clsx } from 'clsx'
import { signOutUser } from '@/features/auth/api/auth-service'
import { useOnline } from '@/features/onboarding/use-online'
import { Banner } from '@/components/ui/banner'

const NAV = [
  { to: '/dashboard/home', label: 'Home', icon: Home },
  { to: '/dashboard/capture', label: 'Capture', icon: Mic },
  { to: '/dashboard/library', label: 'Posts', icon: FileText },
  { to: '/dashboard/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/dashboard/settings', label: 'Settings', icon: Settings },
]

const linkClass = ({ isActive }: { isActive: boolean }) =>
  clsx(
    'flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-sm font-medium transition-colors',
    isActive
      ? 'bg-[var(--color-primary-soft)] font-semibold text-[var(--color-primary-dark)]'
      : 'text-[var(--color-text-primary)] hover:bg-[var(--color-bg-light-green)]',
  )

/** Dashboard shell: left nav on large screens, bottom nav on phones. */
export function DashboardLayout() {
  const online = useOnline()
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)

  async function signOut() {
    setSigningOut(true)
    try {
      await signOutUser()
    } finally {
      navigate('/auth', { replace: true })
    }
  }

  return (
    <div className="flex min-h-screen bg-[var(--color-bg-cream)]">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col gap-1 border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4 lg:flex">
        <span className="mb-4 px-3 text-xl font-bold text-[var(--color-ink)]">Hiba</span>
        <nav aria-label="Main" className="flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={linkClass}>
              <Icon size={18} aria-hidden="true" /> {label}
            </NavLink>
          ))}
        </nav>
        <button
          type="button"
          onClick={signOut}
          disabled={signingOut}
          className="mt-auto flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-light-green)] disabled:opacity-60"
        >
          <LogOut size={18} aria-hidden="true" /> {signingOut ? 'Signing out...' : 'Sign out'}
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 lg:hidden">
          <span className="text-lg font-bold text-[var(--color-ink)]">Hiba</span>
          <button type="button" onClick={signOut} disabled={signingOut} className="text-sm text-[var(--color-text-secondary)]">
            {signingOut ? 'Signing out...' : 'Sign out'}
          </button>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-6 lg:pb-10">
          {!online && <Banner tone="warning">You are offline. Anything you type stays on this page until you reconnect.</Banner>}
          <Outlet />
        </main>
      </div>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-10 flex border-t border-[var(--color-border)] bg-[var(--color-surface)] lg:hidden"
      >
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              clsx(
                'flex flex-1 flex-col items-center gap-0.5 py-2 text-xs',
                isActive ? 'font-semibold text-[var(--color-primary-dark)]' : 'text-[var(--color-text-secondary)]',
              )
            }
          >
            <Icon size={20} aria-hidden="true" /> {label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
