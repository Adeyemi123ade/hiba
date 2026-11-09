import { useCallback, useEffect, useState } from 'react'

/** Counts down from `seconds` once started; used to space out "resend code" clicks. */
export function useCooldown(seconds: number, startActive = false) {
  const [left, setLeft] = useState(startActive ? seconds : 0)
  useEffect(() => {
    if (left <= 0) return
    const t = setTimeout(() => setLeft((l) => l - 1), 1000)
    return () => clearTimeout(t)
  }, [left])
  const start = useCallback(() => setLeft(seconds), [seconds])
  return { left, start }
}
