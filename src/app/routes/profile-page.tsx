import { Link } from 'react-router-dom'

/** Public profiles are not built yet. Says so plainly instead of showing an unfinished page. */
export function ProfilePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--color-bg-cream)] p-4 text-center">
      <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">Public profiles are not available yet</h1>
      <p className="max-w-md text-[var(--color-text-secondary)]">This page will show a person&apos;s public Hiba profile once that is ready.</p>
      <Link to="/" className="rounded-[var(--radius-sm)] bg-[var(--color-primary-dark)] px-4 py-2 font-semibold text-white">Go to Hiba</Link>
    </div>
  )
}
