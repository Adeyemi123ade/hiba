import { Link } from 'react-router-dom'
import { CONTACT_EMAIL, EFFECTIVE_DATE } from '@/lib/legal'
import { PRIVACY, TERMS, type LegalSection } from '@/features/legal/legal-content'

function LegalPage({ title, blurb, sections }: { title: string; blurb: string; sections: LegalSection[] }) {
  return (
    <div className="min-h-screen bg-[var(--color-bg-cream)] px-4 py-10">
      <title>{`${title} · Hiba`}</title>
      <meta name="description" content={blurb} />
      <article className="mx-auto max-w-2xl text-[var(--color-text-primary)]">
        <nav className="mb-6 flex flex-wrap gap-4 text-sm">
          <Link to="/auth" className="text-[var(--color-primary-dark)] hover:underline">Back to sign in</Link>
          <Link to="/terms" className="hover:underline">Terms of Service</Link>
          <Link to="/privacy" className="hover:underline">Privacy Policy</Link>
        </nav>
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Effective {EFFECTIVE_DATE}</p>
        {sections.map(([heading, paragraphs]) => (
          <section key={heading} className="mt-6">
            <h2 className="text-lg font-semibold">{heading}</h2>
            {paragraphs.map((p) => (
              <p key={p} className="mt-2 text-[var(--color-text-secondary)]">{p}</p>
            ))}
          </section>
        ))}
        <p className="mt-8 text-sm text-[var(--color-text-secondary)]">
          Questions? <a className="text-[var(--color-primary-dark)] underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </p>
      </article>
    </div>
  )
}

export function PrivacyPage() {
  return <LegalPage title="Privacy Policy" blurb="How Hiba collects, uses and protects your personal information." sections={PRIVACY} />
}

export function TermsPage() {
  return <LegalPage title="Terms of Service" blurb="The terms for using Hiba." sections={TERMS} />
}
