import type { ButtonHTMLAttributes } from 'react'
import { clsx } from 'clsx'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost'
}

// Variants and states (default/hover/pressed/disabled) per UI Design System, section 5.
const variantClasses: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:
    'bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-dark)] disabled:bg-[var(--color-primary-light)]',
  secondary:
    'bg-transparent text-[var(--color-text-primary)] hover:text-[var(--color-primary-dark)] disabled:text-[var(--color-text-secondary)]',
  ghost:
    'bg-transparent border border-[var(--color-primary)] text-[var(--color-primary)] hover:bg-[var(--color-primary-soft)] disabled:opacity-50',
}

export function Button({ variant = 'primary', className, ...props }: ButtonProps) {
  return (
    <button
      className={clsx(
        'rounded-[var(--radius-sm)] px-4 py-2 text-sm font-medium transition-colors',
        'duration-[var(--motion-duration-fast)] disabled:cursor-not-allowed',
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  )
}
