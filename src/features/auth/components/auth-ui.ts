// Shared look for every sign-in screen (owner's registration design, 17 Nov 2026).
// The button green is the darker brand green so white text stays readable (WCAG contrast).
export const authLabel = 'text-base font-medium text-[var(--color-text-primary)]'
export const authInput =
  'h-12 w-full rounded-[12px] border border-slate-300 bg-white px-4 text-base text-[var(--color-text-primary)] outline-none transition-colors focus:border-[var(--color-primary-dark)] focus:ring-2 focus:ring-[var(--color-primary-soft)] aria-[invalid=true]:border-[var(--color-error)]'
export const authPrimary =
  'inline-flex h-12 w-full items-center justify-center rounded-[12px] bg-[var(--color-primary-dark)] px-4 text-base font-semibold text-white transition-colors hover:bg-[#126a32] disabled:cursor-not-allowed disabled:opacity-60'
export const authOutline =
  'inline-flex h-12 w-full items-center justify-center gap-3 rounded-[12px] border border-slate-700 bg-white px-4 text-base font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60'
export const authLink = 'font-medium text-blue-700 underline-offset-2 hover:underline'
export const authFieldError = 'text-sm text-red-700'
