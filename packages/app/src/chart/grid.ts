/**
 * Smith chart grid geometry in reflection-coefficient coordinates.
 *
 * Constant normalized resistance r: circle centre (r / (1 + r), 0), radius 1 / (1 + r).
 * Constant normalized reactance x: circle centre (1, 1 / x), radius 1 / |x|.
 * The admittance grid is the same picture mirrored through the origin.
 */
import type { LabelDensity } from '../lib/settings';
import type { GridDensity } from '../store/useDesignStore';

export interface GridCircle {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly major: boolean;
}

export interface GridLabel {
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly anchor: 'start' | 'middle' | 'end';
}

const MAJOR = [0.2, 0.5, 1, 2, 5];
const FEW = [0.5, 1, 2];

const VALUES: Readonly<Record<GridDensity, readonly number[]>> = {
  coarse: MAJOR,
  normal: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.2, 1.5, 2, 3, 4, 5, 10],
  fine: [
    0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.2, 1.4, 1.6,
    1.8, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10, 20,
  ],
};

/** Reflection coefficient of the normalized impedance r + jx. */
export function gammaOfNormalized(r: number, x: number): { re: number; im: number } {
  const dr = r + 1;
  const d = dr * dr + x * x;
  return { re: (r * r + x * x - 1) / d, im: (2 * x) / d };
}

/**
 * Circles of one grid. `sign` is +1 for the impedance grid and -1 for the
 * admittance grid (mirrored). Reactance circles are returned whole and must
 * be clipped to the unit disk by the caller.
 */
export function gridCircles(density: GridDensity, sign: 1 | -1): GridCircle[] {
  const out: GridCircle[] = [];
  for (const v of VALUES[density]) {
    const major = MAJOR.includes(v);
    out.push({ cx: (sign * v) / (1 + v), cy: 0, r: 1 / (1 + v), major });
    out.push({ cx: sign, cy: 1 / v, r: 1 / v, major });
    out.push({ cx: sign, cy: -1 / v, r: 1 / v, major });
  }
  return out;
}

/** Labels for the impedance grid: r on the real axis, x around the rim. */
export function gridLabels(
  density: GridDensity,
  sign: 1 | -1,
  labels: LabelDensity = 'auto',
): GridLabel[] {
  const values =
    labels === 'few'
      ? FEW
      : labels === 'many'
        ? [0.1, 0.2, 0.3, 0.5, 1, 1.5, 2, 3, 5, 10]
        : density === 'coarse'
          ? MAJOR
          : [0.2, 0.5, 1, 2, 5, ...(density === 'fine' ? [0.1, 0.3, 1.5, 3, 10] : [])];
  const out: GridLabel[] = [];
  for (const r of values) {
    const g = gammaOfNormalized(r, 0);
    out.push({ x: sign * g.re, y: 0, text: String(r), anchor: 'middle' });
  }
  for (const x of values) {
    for (const s of [1, -1] as const) {
      const g = gammaOfNormalized(0, s * x);
      const radius = 1.07;
      const px = sign * g.re * radius;
      const py = g.im * radius;
      // Y grid labels are susceptances, which flip sign relative to the mirrored reactance.
      const value = sign === 1 ? s * x : -s * x;
      out.push({
        x: px,
        y: -py,
        text: `${value > 0 ? '+j' : '-j'}${x}`,
        anchor: px > 0.05 ? 'start' : px < -0.05 ? 'end' : 'middle',
      });
    }
  }
  return out;
}
