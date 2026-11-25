import type { Platform } from '@/features/content/api/content-service'

/**
 * The real LinkedIn, X and Substack logos, in their own brand colours (owner, 25 Nov 2026:
 * "non-negotiable", so people recognise each platform at a glance).
 * Shapes from Simple Icons (CC0): X and Substack from v13.21.0, LinkedIn from v9.21.0
 * (the last release that included it). LinkedIn blue is LinkedIn's own #0A66C2.
 */
const LOGOS: Record<Platform, { name: string; color: string; path: string }> = {
  linkedin: {
    name: 'LinkedIn',
    color: '#0A66C2',
    path: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z',
  },
  x: {
    name: 'X',
    color: '#000000',
    path: 'M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z',
  },
  substack: {
    name: 'Substack',
    color: '#FF6719',
    path: 'M22.539 8.242H1.46V5.406h21.08v2.836zM1.46 10.812V24L12 18.11 22.54 24V10.812H1.46zM22.54 0H1.46v2.836h21.08V0z',
  },
}

/** A platform's logo. Hidden from screen readers when the name is written next to it (the usual case). */
export function PlatformLogo({ platform, size = 16, labelled = false, className }: {
  platform: Platform
  size?: number
  /** True when the logo stands alone, so screen readers hear the platform's name. */
  labelled?: boolean
  className?: string
}) {
  const logo = LOGOS[platform]
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={logo.color} className={className}
      role={labelled ? 'img' : undefined} aria-label={labelled ? logo.name : undefined} aria-hidden={labelled ? undefined : true}
      style={{ flexShrink: 0 }}>
      <path d={logo.path} />
    </svg>
  )
}
