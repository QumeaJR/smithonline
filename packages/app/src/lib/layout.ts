import { useSyncExternalStore } from 'react';
import type { Pane } from '../store/useShell';

/**
 * The layout per width of docs/07-interaction-redesign.md section 5: phone
 * below 700 px, tablet 700 to 1099, desktop 1100 to 1439, wide 1440 and up.
 * The shell picks its structure from it; index.css reads the same classes
 * (`.app.layout-phone` and so on), so the script and the style never disagree.
 */
export type LayoutKind = 'phone' | 'tablet' | 'desktop' | 'wide';

export const TABLET_MIN = 700;
export const DESKTOP_MIN = 1100;
export const WIDE_MIN = 1440;

export function layoutForWidth(width: number): LayoutKind {
  if (!(width >= TABLET_MIN)) return Number.isFinite(width) ? 'phone' : 'desktop';
  if (width < DESKTOP_MIN) return 'tablet';
  if (width < WIDE_MIN) return 'desktop';
  return 'wide';
}

/** Three columns with a header: desktop and wide. */
export const isThreeColumn = (layout: LayoutKind): boolean =>
  layout === 'desktop' || layout === 'wide';

function currentLayout(): LayoutKind {
  if (typeof window === 'undefined') return 'desktop';
  return layoutForWidth(window.innerWidth);
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('resize', onChange);
  window.addEventListener('orientationchange', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
    window.removeEventListener('orientationchange', onChange);
  };
}

/** The layout as React state: re-renders when the window crosses a breakpoint. */
export function useLayout(): LayoutKind {
  return useSyncExternalStore(subscribe, currentLayout, () => 'desktop');
}

/** Height of the phone top bar without the safe area, px. */
export const TOP_BAR_H = 44;
/** The peek detent of the main sheet without the safe area, px. */
export const PEEK_H = 64;
/** The live strip at the top of the sheet at its full detent, px. */
export const LIVE_STRIP_H = 36;

export interface SheetHeights {
  readonly peek: number;
  readonly half: number;
  readonly full: number;
}

/**
 * The detents of the phone's main sheet in pixels: peek is 64 px plus the
 * safe area; half reaches up to just below the chart hero (`heroBottom`, the
 * bottom edge of the pinned chart), never less than peek plus 120 px; full
 * reaches up to the top bar. In pixels, not dvh: Safari's toolbar changes dvh
 * by about 60 px while the user scrolls.
 */
export function sheetHeights(
  viewportHeight: number,
  heroBottom: number,
  topBarBottom: number,
  safeBottom = 0,
): SheetHeights {
  const peek = PEEK_H + Math.max(0, safeBottom);
  const full = Math.max(peek, Math.round(viewportHeight - Math.max(0, topBarBottom)));
  const below = Math.round(viewportHeight - heroBottom);
  const half = Math.min(full, Math.max(peek + 120, below));
  return { peek, half, full };
}

/** The detents of the main sheet from the lowest; it never closes. */
export const DETENTS = ['peek', 'half', 'full'] as const;
export type PanelDetent = (typeof DETENTS)[number];

/** A flick faster than this moves one detent whatever the distance, px per ms. */
const FLICK_SPEED = 0.6;
/** A flick has to travel at least this far: a tap that slips a few pixels is not one, px. */
const FLICK_MIN = 16;

/**
 * Where the main sheet settles after a drag of its grabber or header by `dy`
 * (positive is down) in `ms`: a flick moves one detent in its direction, a
 * slow drag settles at the detent nearest the height it was let go at. It
 * never goes below peek.
 */
export function settlePanel(
  heights: SheetHeights,
  detent: PanelDetent,
  dy: number,
  ms: number,
): PanelDetent {
  const at = DETENTS.indexOf(detent);
  const speed = ms > 0 ? dy / ms : 0;
  if (Math.abs(dy) >= FLICK_MIN && Math.abs(speed) > FLICK_SPEED) {
    const next = Math.min(DETENTS.length - 1, Math.max(0, at + (dy > 0 ? -1 : 1)));
    return DETENTS[next] as PanelDetent;
  }
  const height = heights[detent] - dy;
  let best: PanelDetent = detent;
  for (const d of DETENTS) {
    if (Math.abs(heights[d] - height) < Math.abs(heights[best] - height)) best = d;
  }
  return best;
}

/**
 * The pane a column shows: a desktop's right column has Numbers and the tool
 * (Network lives in the left column); a tablet's side column and the phone's
 * sheet have all three. The tool's pane needs an open tool, except on the phone.
 */
export function effectivePane(layout: LayoutKind, pane: Pane, hasTool: boolean): Pane {
  // The phone's Tools segment lists the tools when none is open.
  if (pane === 'tool' && !hasTool)
    return layout === 'phone' ? 'tool' : layout === 'tablet' ? 'network' : 'numbers';
  if ((layout === 'desktop' || layout === 'wide') && pane === 'network') return 'numbers';
  return pane;
}
