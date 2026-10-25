import { useSyncExternalStore } from 'react';

/**
 * Coarse or fine pointer: a touch screen or a mouse. The layout reads the
 * same media query in index.css; components that render differently (the
 * ladder card overflow menu, the Auto match method chooser) read it here.
 */
export const COARSE_POINTER_QUERY = '(pointer: coarse)';

/** The media query list, or null where there is none (server, tests, an engine that throws). */
function query(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  try {
    return window.matchMedia(COARSE_POINTER_QUERY) ?? null;
  } catch {
    return null;
  }
}

/** True on a touch screen without a mouse; false wherever there is no window (server, tests). */
export function isCoarsePointer(): boolean {
  return query()?.matches ?? false;
}

function subscribe(onChange: () => void): () => void {
  const q = query();
  if (!q) return () => undefined;
  if (typeof q.addEventListener === 'function') {
    q.addEventListener('change', onChange);
    return () => q.removeEventListener('change', onChange);
  }
  // Safari 13 and older WebViews only have the legacy listener methods.
  if (typeof q.addListener === 'function') {
    q.addListener(onChange);
    return () => q.removeListener(onChange);
  }
  return () => undefined;
}

/** The pointer kind as React state: re-renders when a tablet gets or loses its mouse. */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribe, isCoarsePointer, () => false);
}

/**
 * Capture a pointer on an element so its moves and its release come there wherever it goes
 * (outside the element, outside the window). A pointer the browser no longer knows (a
 * synthetic event, one already released) cannot be captured; the gesture goes on without it.
 */
export function capturePointer(el: Element, pointerId: number): void {
  try {
    el.setPointerCapture?.(pointerId);
  } catch {
    // Not an active pointer: nothing to capture.
  }
}
