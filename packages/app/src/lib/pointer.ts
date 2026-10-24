import { useSyncExternalStore } from 'react';

/**
 * Coarse or fine pointer: a touch screen or a mouse. The layout reads the
 * same media query in index.css; components that render differently (the
 * ladder card overflow menu, the Auto match method chooser) read it here.
 */
export const COARSE_POINTER_QUERY = '(pointer: coarse)';

function query(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(COARSE_POINTER_QUERY)
    : null;
}

/** True on a touch screen without a mouse; false wherever there is no window (server, tests). */
export function isCoarsePointer(): boolean {
  return query()?.matches ?? false;
}

function subscribe(onChange: () => void): () => void {
  const q = query();
  if (!q) return () => undefined;
  q.addEventListener('change', onChange);
  return () => q.removeEventListener('change', onChange);
}

/** The pointer kind as React state: re-renders when a tablet gets or loses its mouse. */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, isCoarsePointer, () => false);
}
