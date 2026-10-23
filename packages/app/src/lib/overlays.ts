/**
 * Stored plot overlays: a snapshot of the response curves kept under a name
 * and a colour, drawn beside the live curves. Up to MAX_OVERLAYS are kept in
 * the browser's local storage; a snapshot is compact (four to five
 * significant digits) so ten of them fit comfortably.
 */
import type { LimitQuantity, Response } from '@smithonline/core';
import { LIMIT_QUANTITIES } from '@smithonline/core';

export const MAX_OVERLAYS = 10;

export const OVERLAY_KEY = 'smithonline.overlays.v1';

/** Colours handed out in turn; distinct from the live curve colours. */
export const OVERLAY_COLORS: readonly string[] = [
  '#e03131',
  '#9c36b5',
  '#1098ad',
  '#5c940d',
  '#c2255c',
  '#e67700',
  '#3b5bdb',
  '#099268',
  '#868e96',
  '#a61e4d',
];

export interface Overlay {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  /** Hz, ascending. */
  readonly frequency: readonly number[];
  /** One column per response quantity; non-finite samples are null. */
  readonly columns: Readonly<Record<LimitQuantity, readonly (number | null)[]>>;
}

function round(v: number): number | null {
  return Number.isFinite(v) ? Number(v.toPrecision(5)) : null;
}

/** A snapshot of the response under a name and colour. */
export function snapshot(id: string, name: string, color: string, response: Response): Overlay {
  const columns = {} as Record<LimitQuantity, (number | null)[]>;
  for (const q of LIMIT_QUANTITIES) columns[q] = response[q].map(round);
  // Frequencies keep full precision: they are the x axis the curves are interpolated on.
  return { id, name, color, frequency: [...response.frequency], columns };
}

/**
 * One stored column on another frequency grid by linear interpolation; null
 * outside the stored range and wherever a neighbouring sample is missing.
 */
export function resample(
  overlay: Overlay,
  quantity: LimitQuantity,
  xs: readonly number[],
): (number | null)[] {
  const fx = overlay.frequency;
  const fy = overlay.columns[quantity];
  const n = fx.length;
  return xs.map((x) => {
    if (n === 0 || !(x >= (fx[0] as number)) || !(x <= (fx[n - 1] as number))) return null;
    // Largest j with fx[j] <= x.
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((fx[mid] as number) <= x) lo = mid;
      else hi = mid - 1;
    }
    const x0 = fx[lo] as number;
    const y0 = fy[lo] ?? null;
    if (lo === n - 1 || x === x0) return y0;
    const x1 = fx[lo + 1] as number;
    const y1 = fy[lo + 1] ?? null;
    if (y0 === null || y1 === null) return null;
    return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  });
}

function isOverlay(v: unknown): v is Overlay {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.name !== 'string' || typeof o.color !== 'string') {
    return false;
  }
  if (!Array.isArray(o.frequency) || !o.frequency.every((f) => typeof f === 'number')) return false;
  const columns = o.columns as Record<string, unknown> | null;
  if (typeof columns !== 'object' || columns === null) return false;
  return LIMIT_QUANTITIES.every((q) => {
    const c = columns[q];
    return (
      Array.isArray(c) &&
      c.length === (o.frequency as unknown[]).length &&
      c.every((y) => y === null || typeof y === 'number')
    );
  });
}

/** What local storage held, keeping only well-formed overlays (at most MAX_OVERLAYS). */
export function parseOverlays(text: string | null): Overlay[] {
  if (!text) return [];
  try {
    const raw = JSON.parse(text) as unknown;
    return Array.isArray(raw) ? raw.filter(isOverlay).slice(0, MAX_OVERLAYS) : [];
  } catch {
    return [];
  }
}
