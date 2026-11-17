import { Card } from '@/components/ui/card'
import { LinkedInConnectionCard } from '@/features/linkedin/linkedin-components'

/** Settings. For now: connected accounts (HPD-80). Other settings arrive with H11. */
export function SettingsPage() {
  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold text-[var(--color-text-primary)]">Settings</h1>
      <p className="mb-5 text-[var(--color-text-secondary)]">Connected accounts</p>
      <LinkedInConnectionCard />
      <Card>
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">X and Substack</h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          No connection needed. Hiba writes the drafts, and you use Copy to post them yourself.
        </p>
      </Card>
      <p className="text-sm text-[var(--color-text-secondary)]">
        Editing your profile, preferences and notifications is coming soon.
      </p>
    </div>
  )
}
