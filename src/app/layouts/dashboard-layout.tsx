import { Outlet } from 'react-router-dom'

/**
 * Dashboard shell — Front-end Architecture, section 5 (Layout Structure).
 * Top bar + left nav (desktop) / bottom nav (mobile) wrapping routed page content.
 * Nav items and top bar controls are placeholders until the real screens arrive.
 */
export function DashboardLayout() {
  return (
    <div className="min-h-screen bg-[var(--color-bg-cream)]">
      <header className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-3">
        <span className="font-semibold text-[var(--color-text-primary)]">Hiba</span>
      </header>
      <div className="flex">
        <aside className="hidden w-56 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4 lg:block">
          {/* Nav: Home, Capture, Calendar, Library, Assistant, Settings — Front-end Architecture routing map */}
        </aside>
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
