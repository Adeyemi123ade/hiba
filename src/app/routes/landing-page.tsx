import { Link } from 'react-router-dom'

export function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--color-bg-cream)]">
      <h1 className="text-3xl font-semibold text-[var(--color-text-primary)]">Hiba</h1>
      <p className="max-w-md text-center text-[var(--color-text-secondary)]">
        AI Personal Brand Operating System — placeholder landing page.
      </p>
      <Link
        to="/auth"
        className="rounded-[var(--radius-sm)] bg-[var(--color-primary)] px-4 py-2 text-white"
      >
        Get started
      </Link>
    </div>
  )
}
