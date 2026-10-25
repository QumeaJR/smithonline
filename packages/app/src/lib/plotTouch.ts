/**
 * Touch on the Response and S-Plot graphs (docs/07 section 5, Phone): uPlot follows the
 * mouse only, so a finger drives its cursor through pointer events. The first movement
 * decides what the finger does: sideways it scrubs the cursor along the frequency axis
 * (the readout row under the plot follows it), up or down it scrolls the page, which the
 * plot leaves to the browser (`touch-action: pan-y`). A tap sets a marker.
 */

/** A finger has to move this far before its direction counts, px. */
export const SCRUB_SLOP = 6;

/**
 * What a finger that moved (dx, dy) px from where it went down is doing: 'scrub' when the
 * movement is mostly sideways, 'scroll' when it is mostly up or down, null while it is still
 * within the slop (a tap, so far).
 */
export function scrubIntent(dx: number, dy: number, slop = SCRUB_SLOP): 'scrub' | 'scroll' | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (Math.hypot(dx, dy) < slop) return null;
  return Math.abs(dx) > Math.abs(dy) ? 'scrub' : 'scroll';
}

/** The cursor position for a finger at (x, y) over a plotting area, clamped inside it, px. */
export function cursorAt(
  area: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  },
  x: number,
  y: number,
): { left: number; top: number } {
  const clamp = (v: number, max: number): number =>
    Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : 0;
  return { left: clamp(x - area.left, area.width), top: clamp(y - area.top, area.height) };
}
