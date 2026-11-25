import { useEffect, useState } from 'react'
import { SUCCESS_MS, listenForSuccess } from '@/components/ui/show-success'

/**
 * The bottom success message (HPD-170). Mounted once in the dashboard layout.
 * Only for short confirmations; messages with Undo or details to read stay on the page.
 * The area is always present so screen readers announce each new message.
 */
export function SuccessMessages() {
  const [message, setMessage] = useState<{ text: string; id: number } | null>(null)

  useEffect(() => {
    listenForSuccess((text) => setMessage({ text, id: Date.now() }))
    return () => listenForSuccess(null)
  }, [])

  useEffect(() => {
    if (!message) return
    const timer = setTimeout(() => setMessage(null), SUCCESS_MS)
    return () => clearTimeout(timer)
  }, [message])

  return (
    <div role="status" aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] z-40 flex justify-center px-4 lg:bottom-6">
      {message && (
        <p key={message.id} className="rounded-full bg-[var(--color-ink)] px-4 py-2 text-sm font-medium text-white shadow-lg">
          {message.text}
        </p>
      )}
    </div>
  )
}
