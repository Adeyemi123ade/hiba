import { useEffect, useRef, useState, type HTMLAttributes } from 'react'
import { clsx } from 'clsx'

/**
 * A row of chips you can swipe right to left when they do not all fit (owner, 25 Nov 2026).
 * Sits on a soft green track; a fade on the right shows when more are hidden.
 * Keyboard focus scrolls the focused chip into view by itself.
 */
export function SwipeRow({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  const row = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState({ left: false, right: false })

  useEffect(() => {
    const el = row.current
    if (!el) return
    const check = () => setMore({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 })
    check()
    el.addEventListener('scroll', check, { passive: true })
    const observer = new ResizeObserver(check)
    observer.observe(el)
    return () => { el.removeEventListener('scroll', check); observer.disconnect() }
  }, [])

  return (
    <div className="relative">
      <div ref={row} {...rest}
        className={clsx(
          'flex snap-x snap-mandatory scroll-px-1.5 gap-2 overflow-x-auto overscroll-x-contain rounded-full bg-[var(--color-bg-soft-green)] p-1.5',
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0 [&>*]:snap-start',
          className,
        )}>
        {children}
      </div>
      {more.left && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-8 rounded-l-full bg-gradient-to-r from-[var(--color-bg-soft-green)] to-transparent" />}
      {more.right && <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-10 rounded-r-full bg-gradient-to-l from-[var(--color-bg-soft-green)] to-transparent" />}
    </div>
  )
}
