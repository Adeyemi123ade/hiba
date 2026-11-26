// How many tiles the LinkedIn-style image grid shows, and the frame for a single image (HPD-175).
export function gridLayout(count: number): { tiles: number; more: number } {
  if (count <= 3) return { tiles: count, more: 0 }
  return { tiles: 4, more: count - 4 }
}

/** Width ÷ height of the frame for one image: its own shape, but never taller than portrait 4:5 or wider than 1.91:1. */
export function singleFrameRatio(w: number, h: number): number {
  return Math.min(1.91, Math.max(4 / 5, w / h))
}
