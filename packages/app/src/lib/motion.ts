/**
 * The user asks for reduced motion (`prefers-reduced-motion: reduce`): the CSS durations are
 * 0 then, and the chart's Fit jumps home instead of moving there.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
