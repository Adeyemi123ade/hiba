import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { clsx } from 'clsx'

interface ModalProps {
  /** Called on Escape, and on a tap outside the box when `closeOnBackdrop` is set. */
  onClose: () => void
  /** False while something is in progress (for example deleting): Escape and outside taps do nothing. */
  canClose?: boolean
  closeOnBackdrop?: boolean
  role?: 'dialog' | 'alertdialog'
  labelledBy?: string
  label?: string
  /** 'dim' for normal pop-ups, 'dark' for viewing a picture. */
  backdrop?: 'dim' | 'dark'
  /** 'sheet' rises from the bottom on phones and is centred on larger screens. */
  placement?: 'center' | 'sheet'
  className?: string
  children: ReactNode
}

/**
 * One pop-up window for all of Hiba (HPD-169), built on the browser's own <dialog>
 * (owner decision 25 Nov 2026: no shadcn/ui). The browser keeps keyboard focus inside and puts
 * it back on the button that opened the window when it closes; Escape closes it unless busy.
 * Render it only while it should be open.
 */
export function Modal({
  onClose, canClose = true, closeOnBackdrop = false, role = 'dialog', labelledBy, label,
  backdrop = 'dim', placement = 'center', className, children,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)
  // Latest values for the native event handlers, without reopening the window.
  const latest = useRef({ onClose, canClose })
  latest.current = { onClose, canClose }

  useLayoutEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!dialog.open) dialog.showModal()
    return () => {
      if (dialog.open) dialog.close()
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  return (
    <dialog
      ref={ref}
      role={role === 'alertdialog' ? 'alertdialog' : undefined}
      aria-labelledby={labelledBy}
      aria-label={label}
      onCancel={(e) => {
        // Escape: the page decides, so a busy window stays open.
        e.preventDefault()
        if (latest.current.canClose) latest.current.onClose()
      }}
      onClose={() => {
        // Already open again (React re-ran the opening step): this close was ours, not the person's.
        if (ref.current?.open) return
        // Some browsers close it anyway after a second Escape: follow, or reopen while busy.
        if (latest.current.canClose) latest.current.onClose()
        else ref.current?.showModal()
      }}
      onClick={(e) => {
        if (closeOnBackdrop && latest.current.canClose && e.target === e.currentTarget) latest.current.onClose()
      }}
      className={clsx(
        'm-0 hidden h-full max-h-none w-full max-w-none bg-transparent open:flex',
        placement === 'sheet' ? 'items-end justify-center p-0 sm:items-center sm:p-4' : 'items-center justify-center p-4',
        backdrop === 'dark' ? 'backdrop:bg-black/90' : 'backdrop:bg-black/40',
      )}
    >
      <div className={className}>{children}</div>
    </dialog>
  )
}
