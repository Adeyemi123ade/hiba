import { Card } from '@/components/ui/card'
import { LinkedInConnectionCard } from '@/features/linkedin/linkedin-components'
import { ProfileSettings } from '@/features/settings/profile-settings'

const SECTIONS = [
  { id: 'settings-profile', label: 'Profile and preferences' },
  { id: 'settings-accounts', label: 'Connected accounts' },
  { id: 'settings-notifications', label: 'Notifications' },
]

/** H11 Settings: profile and preferences (HPD-77, HPD-78), connected accounts (HPD-80), notifications (HPD-79). */
export function SettingsPage() {
  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-[var(--color-text-primary)]">Settings</h1>
      <p className="mb-3 text-[var(--color-text-secondary)]">Change anything you told Hiba during onboarding, at any time.</p>
      <nav aria-label="Settings sections" className="mb-5 flex flex-wrap gap-2">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#${s.id}`}
            className="rounded-full border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-text-primary)] hover:border-[var(--color-primary-light)]">
            {s.label}
          </a>
        ))}
      </nav>

      <section id="settings-profile" aria-label="Profile and preferences" className="scroll-mt-4">
        <ProfileSettings />
      </section>

      <section id="settings-accounts" aria-labelledby="accounts-title" className="scroll-mt-4">
        <h2 id="accounts-title" className="mb-3 mt-2 text-xl font-bold text-[var(--color-text-primary)]">Connected accounts</h2>
        <LinkedInConnectionCard />
        <Card>
          <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">X and Substack</h3>
          <p className="text-sm text-[var(--color-text-secondary)]">
            No connection needed, and none is offered yet. Hiba writes the drafts, and you use Copy to post them yourself.
          </p>
        </Card>
      </section>

      <section id="settings-notifications" aria-labelledby="notifications-title" className="scroll-mt-4">
        <Card>
          <h2 id="notifications-title" className="text-lg font-semibold text-[var(--color-text-primary)]">Notifications</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Hiba does not send you any notifications yet, so there is nothing to switch on or off. Account emails, such as
            sign-in codes and password resets, always come from our sign-in service. When Hiba starts sending updates, you
            will choose them here.
          </p>
        </Card>
      </section>
    </div>
  )
}
