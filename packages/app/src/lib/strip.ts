/** Height of the schematic strip under the chart: limits, default and the remembered value. */

export const STRIP_MIN = 60;
export const STRIP_MAX = 240;
export const STRIP_DEFAULT = 84;
const STRIP_KEY = 'smithonline.schematicHeight';

export function clampStripHeight(h: number): number {
  return Number.isFinite(h)
    ? Math.round(Math.min(STRIP_MAX, Math.max(STRIP_MIN, h)))
    : STRIP_DEFAULT;
}

/** The strip height remembered from the last session, or the default. */
export function readStripHeight(): number {
  try {
    const v = Number(localStorage.getItem(STRIP_KEY));
    return v > 0 ? clampStripHeight(v) : STRIP_DEFAULT;
  } catch {
    return STRIP_DEFAULT;
  }
}

export function storeStripHeight(h: number): void {
  try {
    localStorage.setItem(STRIP_KEY, String(h));
  } catch {
    // Private mode or quota: the height still holds for this session.
  }
}
