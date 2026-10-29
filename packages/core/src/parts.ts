/**
 * Library parts: a real inductor or capacitor from the two-port S-parameter
 * file its manufacturer publishes (phase D5).
 *
 * Fixtures. Manufacturers measure a chip part in one of two fixtures:
 *
 * - series-through: the part in series between port 1 and port 2. For an
 *   ideal part of impedance Z, S11 = Z / (Z + 2 Z0) and S21 = 2 Z0 / (Z + 2 Z0),
 *   so S11 + S21 = 1. The part is the B element of the chain matrix:
 *   Z = B = Z0 ((1 + S11)(1 + S22) - S12 S21) / (2 S21), which for the ideal
 *   fixture is the textbook 2 Z0 (1 - S21) / S21.
 * - shunt-through: the part from the through line to ground. Then
 *   S11 = -Z0 / (2 Z + Z0) and S21 = 2 Z / (2 Z + Z0), so S21 - S11 = 1. The
 *   part is the C element of the chain matrix: 1 / Z = C =
 *   ((1 - S11)(1 - S22) - S12 S21) / (2 S21 Z0), for the ideal fixture
 *   Z0 S21 / (2 (1 - S21)).
 *
 * `detectFixture` tells the two apart by which of those identities the data
 * keeps; the user can override it.
 *
 * Placement. A series part from a series-through file uses the measured
 * two-port itself (port 1 towards the source), so whatever the file holds
 * besides the series impedance (the small capacitance of the part's ends to
 * ground, a slight asymmetry) stays in. Every other combination uses the part
 * impedance Z derived above, placed as a series impedance or a shunt branch:
 * a shunt part from a shunt-through file is exact for the branch (the board's
 * via, when the board is in the network, is added in series); a shunt part
 * from a series-through file lacks what a shunt mounting adds (the ground
 * path of the fixture and the pad of the grounded end), and a series part
 * from a shunt-through file carries the fixture's ground path in its Z. Both
 * are approximations and the card says so.
 *
 * Reciprocity. A passive part is reciprocal; measured S12 and S21 differ by
 * the noise of the measurement. The model uses their mean for both, so the
 * part's two-port is reciprocal (det ABCD = 1) like every other element.
 *
 * Interpolation. Between the file's frequencies the S-parameters are
 * interpolated linearly in their real and imaginary parts, then converted.
 * Reasons: S is bounded where Z or Y are not (Z of an inductor goes through a
 * pole at its parallel resonance, Y of a capacitor at its series resonance),
 * so a linear step in S never swings wildly; a convex combination of two
 * passive matrices is passive, so the interpolant of passive data stays
 * passive (a cubic can overshoot |S| = 1 near a sharp resonance); and it is
 * scikit-rf's default (`Network.interpolate`, kind 'linear', cartesian), so
 * the oracle compares like with like. The error is of second order in the
 * step; on 201 points per decade-spanning file (the synthetic examples) it is
 * below 2e-4 in S against the generating circuit (test/parts.test.ts).
 * Outside the file's frequency range nothing is extrapolated: the part has no
 * value there, `partAbcd` returns NaN and `partRangeProblem` says why.
 *
 * Equivalent circuit. `fitPartCircuit` fits a capacitor as C with series ESL
 * and ESR, an inductor as L with series R and a parallel Cp. It is what a
 * share link carries when the file cannot travel, what the SPICE and LTspice
 * exports write, and it is flagged as approximate wherever it is used.
 */
import { cadd, cdiv, cinv, cmul, complex, cscale, csub, ONE, type Complex } from './complex.js';
import { seriesAbcd, shuntAbcd, type Abcd } from './abcd.js';
import { convertToS, type NetworkParameter } from './netparams.js';
import {
  portsFromFileName,
  readTouchstone,
  writeTouchstone,
  type TouchstoneData,
} from './io/touchstone.js';

/** How the part sat between the two ports when it was measured. */
export type PartFixture = 'series' | 'shunt';

/** What the part is below its self-resonance. */
export type PartType = 'C' | 'L';

/** The measured two-port of a part, as read from its file. */
export interface PartData {
  /** Reference impedance of the file, ohm. */
  readonly z0: number;
  /** The fixture the part was measured in. */
  readonly fixture: PartFixture;
  /** Frequencies, Hz, strictly ascending and positive. */
  readonly f: readonly number[];
  /**
   * S-parameters, eight numbers per frequency in the order
   * S11 re, S11 im, S12 re, S12 im, S21 re, S21 im, S22 re, S22 im.
   */
  readonly s: readonly number[];
}

/** A fitted equivalent circuit: the fallback when the measured data is not at hand. */
export type PartCircuit =
  /** C with ESL and ESR in series. */
  | { readonly type: 'C'; readonly c: number; readonly esl: number; readonly esr: number }
  /** L with R in series, Cp across both. */
  | { readonly type: 'L'; readonly l: number; readonly cp: number; readonly r: number };

/** One part of the library, as a ladder element carries it. */
export interface LibraryPart {
  readonly manufacturer: string;
  readonly partNumber: string;
  readonly type: PartType;
  /** Lowest and highest frequency of the measured data, Hz. */
  readonly range: readonly [number, number];
  /** The fitted equivalent circuit (always present). */
  readonly circuit: PartCircuit;
  /** The measured data; absent when only the fitted circuit is known (a share link). */
  readonly data?: PartData;
}

/** Most frequencies a part file may hold. */
export const MAX_PART_POINTS = 20001;
/** Longest manufacturer or part number kept. */
export const MAX_PART_NAME = 80;
/** Relative slack at the ends of a part's range: a frequency typed as the file's end point is inside. */
const RANGE_SLACK = 1e-9;

export class PartFileError extends Error {
  override readonly name = 'PartFileError';
}

const NAN_ABCD: Abcd = {
  a: complex(NaN, NaN),
  b: complex(NaN, NaN),
  c: complex(NaN, NaN),
  d: complex(NaN, NaN),
};

/* ---------------------------------------------------------------- circuit */

/** The impedance of a fitted circuit at angular frequency w. */
export function circuitImpedance(circuit: PartCircuit, w: number): Complex {
  if (circuit.type === 'C') {
    return complex(circuit.esr, w * circuit.esl - 1 / (w * circuit.c));
  }
  const series = complex(circuit.r, w * circuit.l);
  return circuit.cp > 0 ? cinv(cadd(cinv(series), complex(0, w * circuit.cp))) : series;
}

/** Self-resonant frequency of a fitted circuit, Hz (Infinity without ESL or Cp). */
export function circuitSrf(circuit: PartCircuit): number {
  const lc = circuit.type === 'C' ? circuit.esl * circuit.c : circuit.l * circuit.cp;
  return lc > 0 ? 1 / (2 * Math.PI * Math.sqrt(lc)) : Infinity;
}

/**
 * The two-port of an ideal part of impedance z in a fixture: S11, S12, S21,
 * S22 for a series-through or a shunt-through measurement at reference z0.
 */
export function fixtureS(z: Complex, fixture: PartFixture, z0: number): [Complex, Complex] {
  if (fixture === 'series') {
    const den = cadd(z, complex(2 * z0));
    return [cdiv(z, den), cdiv(complex(2 * z0), den)];
  }
  const den = cadd(cscale(z, 2), complex(z0));
  return [cdiv(complex(-z0), den), cdiv(cscale(z, 2), den)];
}

/**
 * Measured-style data of a circuit: what a series-through or shunt-through
 * fixture would read, at the given frequencies. Used for the synthetic
 * example files and the tests; never for a real part.
 */
export function partDataFromCircuit(
  circuit: PartCircuit,
  fixture: PartFixture,
  frequencies: readonly number[],
  z0 = 50,
): PartData {
  const s: number[] = [];
  for (const f of frequencies) {
    const [s11, s21] = fixtureS(circuitImpedance(circuit, 2 * Math.PI * f), fixture, z0);
    s.push(s11.re, s11.im, s21.re, s21.im, s21.re, s21.im, s11.re, s11.im);
  }
  return { z0, fixture, f: [...frequencies], s };
}

/* ------------------------------------------------------------ the data */

interface Sample {
  readonly s11: Complex;
  /** The mean of S12 and S21. */
  readonly s21: Complex;
  readonly s22: Complex;
}

function sampleAt(data: PartData, k: number): Sample {
  const o = 8 * k;
  const v = data.s;
  return {
    s11: complex(v[o] as number, v[o + 1] as number),
    s21: complex(
      ((v[o + 2] as number) + (v[o + 4] as number)) / 2,
      ((v[o + 3] as number) + (v[o + 5] as number)) / 2,
    ),
    s22: complex(v[o + 6] as number, v[o + 7] as number),
  };
}

/** True when f lies in the data's range (with a hair of slack at the ends). */
export function inPartRange(range: readonly [number, number], f: number): boolean {
  return (
    Number.isFinite(f) && f >= range[0] * (1 - RANGE_SLACK) && f <= range[1] * (1 + RANGE_SLACK)
  );
}

/** Linear interpolation of the samples in real and imaginary parts; null outside the range. */
function interpolate(data: PartData, f: number): Sample | null {
  const fs = data.f;
  const n = fs.length;
  if (n === 0) return null;
  const first = fs[0] as number;
  const last = fs[n - 1] as number;
  if (!inPartRange([first, last], f)) return null;
  if (f <= first) return sampleAt(data, 0);
  if (f >= last) return sampleAt(data, n - 1);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((fs[mid] as number) <= f) lo = mid;
    else hi = mid;
  }
  const a = sampleAt(data, lo);
  const b = sampleAt(data, hi);
  const t = (f - (fs[lo] as number)) / ((fs[hi] as number) - (fs[lo] as number));
  const mix = (p: Complex, q: Complex): Complex =>
    complex(p.re + t * (q.re - p.re), p.im + t * (q.im - p.im));
  return { s11: mix(a.s11, b.s11), s21: mix(a.s21, b.s21), s22: mix(a.s22, b.s22) };
}

/** Chain matrix (ohm, siemens) of a reciprocal sample at reference z0. */
function sampleAbcd(p: Sample, z0: number): Abcd {
  const s1221 = cmul(p.s21, p.s21);
  const d = cscale(p.s21, 2);
  const one11 = cadd(ONE, p.s11);
  const one22 = cadd(ONE, p.s22);
  const m11 = csub(ONE, p.s11);
  const m22 = csub(ONE, p.s22);
  return {
    a: cdiv(cadd(cmul(one11, m22), s1221), d),
    b: cscale(cdiv(csub(cmul(one11, one22), s1221), d), z0),
    c: cscale(cdiv(csub(cmul(m11, m22), s1221), d), 1 / z0),
    d: cdiv(cadd(cmul(m11, one22), s1221), d),
  };
}

/** The part impedance a sample stands for, by its fixture. */
function sampleImpedance(p: Sample, fixture: PartFixture, z0: number): Complex {
  const m = sampleAbcd(p, z0);
  return fixture === 'series' ? m.b : cinv(m.c);
}

/** The measured two-port at f as S-parameters (S12 = S21, their mean); null outside the data. */
export function partSParametersAt(
  data: PartData,
  f: number,
): { s11: Complex; s12: Complex; s21: Complex; s22: Complex } | null {
  const p = interpolate(data, f);
  return p ? { s11: p.s11, s12: p.s21, s21: p.s21, s22: p.s22 } : null;
}

/** The part impedance at f from the measured data; null outside the data. */
export function dataImpedance(data: PartData, f: number): Complex | null {
  const p = interpolate(data, f);
  return p ? sampleImpedance(p, data.fixture, data.z0) : null;
}

/** The part impedance at every frequency of the file. */
export function dataImpedances(data: PartData): Complex[] {
  return data.f.map((_, k) => sampleImpedance(sampleAt(data, k), data.fixture, data.z0));
}

/* ------------------------------------------------------- the library part */

/** The part's impedance at f: from the data when present, else from the fitted circuit; null outside its range. */
export function partImpedance(part: LibraryPart, f: number): Complex | null {
  if (!inPartRange(part.range, f) || !(f > 0)) return null;
  if (part.data) return dataImpedance(part.data, f);
  return circuitImpedance(part.circuit, 2 * Math.PI * f);
}

/** True when the part evaluates from its fitted circuit only (the file is not at hand). */
export function isApproximatePart(part: LibraryPart): boolean {
  return part.data === undefined;
}

/**
 * Whether the measured two-port is used as it stands (a series part from a
 * series-through file) rather than the impedance derived from it.
 */
export function usesFullTwoPort(part: LibraryPart, orientation: 'series' | 'shunt'): boolean {
  return part.data !== undefined && orientation === 'series' && part.data.fixture === 'series';
}

/**
 * What placing the part this way approximates, or null when the placement
 * matches the fixture (or only the fitted circuit is known, which is flagged
 * on its own).
 */
export function placementNote(part: LibraryPart, orientation: 'series' | 'shunt'): string | null {
  if (!part.data || part.data.fixture === orientation) return null;
  return orientation === 'shunt'
    ? 'measured in series: as a shunt part the ground path and the grounded pad are not in the data'
    : "measured as a shunt part: in series its impedance still holds the fixture's ground path";
}

/**
 * The chain matrix of the part placed in series or in shunt at f, with an
 * optional via inductance (H) in series with a shunt branch and an optional
 * scale on its impedance (a fit's part-to-part spread). NaN outside the
 * part's frequency range: nothing is extrapolated.
 */
export function partAbcd(
  part: LibraryPart,
  orientation: 'series' | 'shunt',
  f: number,
  via = 0,
  scale = 1,
): Abcd {
  if (!inPartRange(part.range, f) || !(f > 0)) return NAN_ABCD;
  if (usesFullTwoPort(part, orientation)) {
    const p = interpolate(part.data as PartData, f);
    if (!p) return NAN_ABCD;
    const m = sampleAbcd(p, (part.data as PartData).z0);
    // A scale on the part's impedance: on the series element B of its two-port (approximate).
    return scale === 1 ? m : { ...m, b: cscale(m.b, scale) };
  }
  const z0 = partImpedance(part, f);
  if (!z0) return NAN_ABCD;
  const z = scale === 1 ? z0 : cscale(z0, scale);
  if (orientation === 'series') return seriesAbcd(z);
  const branch = via > 0 ? cadd(z, complex(0, 2 * Math.PI * f * via)) : z;
  return shuntAbcd(cinv(branch));
}

/** Why the part has no value at f, or null when it has one. */
export function partRangeProblem(part: LibraryPart, f: number): string | null {
  if (inPartRange(part.range, f)) return null;
  return `${f < part.range[0] ? 'below' : 'above'} the part's data (${hz(part.range[0])} to ${hz(part.range[1])})`;
}

function hz(f: number): string {
  if (!Number.isFinite(f)) return String(f);
  const units: [number, string][] = [
    [1e9, 'GHz'],
    [1e6, 'MHz'],
    [1e3, 'kHz'],
  ];
  for (const [scale, unit] of units) {
    if (f >= scale) return `${Number((f / scale).toPrecision(4))} ${unit}`;
  }
  return `${Number(f.toPrecision(4))} Hz`;
}

/** Effective capacitance (F) or inductance (H) of a reactance x at f, by the part type. */
function effective(type: PartType, x: number, f: number): number | null {
  const w = 2 * Math.PI * f;
  const v = type === 'C' ? -1 / (w * x) : x / w;
  return v > 0 && Number.isFinite(v) ? v : null;
}

export interface PartAt {
  /** Hz. */
  readonly frequency: number;
  /** The part impedance, ohm. */
  readonly z: Complex;
  /** Effective capacitance or inductance; null where the reactance has the other sign (above the SRF). */
  readonly value: number | null;
  /** Series resistance at f, ohm (Re Z). */
  readonly esr: number;
  /** |X| / R; Infinity for a lossless part; NaN where the data is not passive (R < 0). */
  readonly q: number;
  /**
   * False where Re Z < 0: the data gives power back, which no passive part
   * does (calibration noise on a high-Q part, usually). The card flags it
   * instead of calling the part lossless.
   */
  readonly passive: boolean;
}

/** The part at one frequency: impedance, effective value, ESR and Q; null outside its range. */
export function partAt(part: LibraryPart, f: number): PartAt | null {
  const z = partImpedance(part, f);
  if (!z || !Number.isFinite(z.re) || !Number.isFinite(z.im)) return null;
  return {
    frequency: f,
    z,
    value: effective(part.type, z.im, f),
    esr: z.re,
    q: z.re > 0 ? Math.abs(z.im) / z.re : z.re === 0 ? Infinity : NaN,
    passive: z.re >= 0,
  };
}

/** The nominal value: the effective value at the lowest frequency of the data. */
export function partNominal(part: LibraryPart): number | null {
  return partAt(part, part.range[0])?.value ?? null;
}

/**
 * The catalogue value a part is sold as, read from its data: the nominal
 * value (the effective value at the lowest frequency, where a chip part is
 * closest to its rating) rounded to two significant digits, which is how
 * catalogues name chip inductors and capacitors (10 pF, 4.7 nH, 0.5 pF).
 * Null when the data gives no value there.
 */
export function partCatalogueValue(part: LibraryPart): number | null {
  const v = partNominal(part);
  if (v === null || !(v > 0) || !Number.isFinite(v)) return null;
  return Number(v.toPrecision(2));
}

/**
 * The self-resonant frequency inside the data, Hz, or null when the
 * reactance does not change sign there: the first frequency where a
 * capacitor's reactance turns positive or an inductor's negative, found
 * between the samples by bisection on the interpolated data.
 */
export function partSrf(part: LibraryPart): number | null {
  if (!part.data) {
    const f = circuitSrf(part.circuit);
    return inPartRange(part.range, f) ? f : null;
  }
  return dataSrf(part.data, part.type);
}

/** The self-resonance of measured data of a type (see partSrf), Hz, or null. */
function dataSrf(data: PartData, type: PartType, zs = dataImpedances(data)): number | null {
  const wrong = (x: number): boolean => (type === 'C' ? x > 0 : x < 0);
  for (let k = 1; k < zs.length; k++) {
    if (!wrong((zs[k] as Complex).im) || wrong((zs[k - 1] as Complex).im)) continue;
    let lo = data.f[k - 1] as number;
    let hi = data.f[k] as number;
    for (let i = 0; i < 60 && hi - lo > lo * 1e-12; i++) {
      const mid = (lo + hi) / 2;
      const z = dataImpedance(data, mid);
      if (z && wrong(z.im)) hi = mid;
      else lo = mid;
    }
    return (lo + hi) / 2;
  }
  return null;
}

/** A stable identity of a part in the library: manufacturer and part number, case and blanks ignored. */
export function partKey(part: Pick<LibraryPart, 'manufacturer' | 'partNumber'>): string {
  const norm = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();
  return `${norm(part.manufacturer)}|${norm(part.partNumber)}`;
}

/** The part without its measured data: what a share link carries. */
export function withoutData(part: LibraryPart): LibraryPart {
  if (!part.data) return part;
  const { data: _data, ...rest } = part;
  void _data;
  return rest;
}

/* ------------------------------------------------------------- fixtures */

export interface FixtureGuess {
  readonly fixture: PartFixture;
  /** False when the data keeps both identities about equally well (or neither): let the user choose. */
  readonly confident: boolean;
  /** Mean of |S11 + S21 - 1| (zero for an ideal series-through fixture). */
  readonly seriesError: number;
  /** Mean of |S21 - S11 - 1| (zero for an ideal shunt-through fixture). */
  readonly shuntError: number;
}

/**
 * Which fixture the data comes from: series-through keeps S21 = 1 - S11,
 * shunt-through S21 = 1 + S11 (see the head of this file). The guess is
 * confident when one error is below a quarter of the other and below 0.2.
 */
export function detectFixture(data: Pick<PartData, 'f' | 's'>): FixtureGuess {
  let series = 0;
  let shunt = 0;
  const n = data.f.length;
  for (let k = 0; k < n; k++) {
    const p = sampleAt({ z0: 50, fixture: 'series', ...data }, k);
    series += Math.hypot(p.s11.re + p.s21.re - 1, p.s11.im + p.s21.im);
    shunt += Math.hypot(p.s21.re - p.s11.re - 1, p.s21.im - p.s11.im);
  }
  series /= Math.max(1, n);
  shunt /= Math.max(1, n);
  const fixture: PartFixture = series <= shunt ? 'series' : 'shunt';
  const best = Math.min(series, shunt);
  const other = Math.max(series, shunt);
  const confident = best < 0.2 && best < other / 4;
  return { fixture, confident, seriesError: series, shuntError: shunt };
}

/* --------------------------------------------------------------- fitting */

/** Weighted least squares of y = a x - b with weights 1 / y^2 (relative errors); null when singular. */
function relativeFit(
  xs: readonly number[],
  ys: readonly number[],
): { a: number; b: number } | null {
  let sww = 0;
  let swx = 0;
  let swxx = 0;
  let swy = 0;
  let swxy = 0;
  for (let i = 0; i < xs.length; i++) {
    const y = ys[i] as number;
    const x = xs[i] as number;
    if (!(Math.abs(y) > 0) || !Number.isFinite(y) || !Number.isFinite(x)) continue;
    const w = 1 / (y * y);
    sww += w;
    swx += w * x;
    swxx += w * x * x;
    swy += w * y;
    swxy += w * x * y;
  }
  // Minimize sum w (a x - b - y)^2 over a and b.
  const det = swxx * sww - swx * swx;
  if (!(Math.abs(det) > 0) || !Number.isFinite(det)) return null;
  const a = (swxy * sww - swx * swy) / det;
  const b = (swxy * swx - swxx * swy) / det;
  return { a, b };
}

function median(values: number[]): number {
  const v = values.filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  if (v.length === 0) return 0;
  const m = v.length >> 1;
  return v.length % 2 ? (v[m] as number) : ((v[m - 1] as number) + (v[m] as number)) / 2;
}

/** The part type from the sign of the reactance at the lowest frequency that has one. */
export function partTypeOf(zs: readonly Complex[]): PartType {
  for (const z of zs) {
    if (z.im < 0) return 'C';
    if (z.im > 0) return 'L';
  }
  return 'L';
}

/**
 * Fit an equivalent circuit to measured data. A capacitor: w X = ESL w^2 - 1/C
 * is linear in w^2, fitted with relative weights over every point; ESR is the
 * median of R from a third to three times the self-resonance (the upper third
 * of the band when the data has no resonance). An inductor: with Cp known, the
 * series branch R + jwL = 1 / (1/Z - jwCp) gives L as the median of X / w below
 * a third of the self-resonance and R as the median of the resistance below
 * half of it; Cp follows from the resonance, w0^2 = 1 / (L Cp) - R^2 / L^2,
 * and the two are iterated. Without a resonance in the data, Cp comes from
 * w B = Cp w^2 - 1/L fitted over the points of Q 5 and more. Approximate by nature: a real part's ESR rises with
 * frequency and its L or C drifts; the fit is used where the data cannot be.
 */
export function fitPartCircuit(data: PartData, type?: PartType): PartCircuit {
  const zs = dataImpedances(data);
  const kind = type ?? partTypeOf(zs);
  const ws = data.f.map((f) => 2 * Math.PI * f);
  const x2 = ws.map((w) => w * w);
  if (kind === 'C') {
    const fit = relativeFit(
      x2,
      zs.map((z, i) => (ws[i] as number) * z.im),
    );
    const lowW = ws[0] as number;
    const fallbackC = -1 / (lowW * (zs[0] as Complex).im);
    const c = fit && fit.b > 0 ? 1 / fit.b : fallbackC > 0 ? fallbackC : 1e-12;
    const esl = fit && fit.a > 0 ? fit.a : 0;
    const srf = esl > 0 ? 1 / (2 * Math.PI * Math.sqrt(esl * c)) : Infinity;
    const inBand = data.f
      .map((f, i) => ({ f, r: (zs[i] as Complex).re }))
      .filter((p) =>
        Number.isFinite(srf) && srf < (data.f[data.f.length - 1] as number)
          ? p.f >= srf / 3 && p.f <= srf * 3
          : p.f >= (data.f[Math.floor((2 * data.f.length) / 3)] as number),
      );
    return { type: 'C', c, esl, esr: Math.max(0, median(inBand.map((p) => p.r))) };
  }
  // The series branch R + jwL is what is left of the admittance once jwCp is taken away.
  const series = (cp: number): Complex[] =>
    zs.map((z, i) => (cp > 0 ? cinv(csub(cinv(z), complex(0, (ws[i] as number) * cp))) : z));
  const srf = dataSrf(data, 'L', zs);
  let cp = 0;
  if (srf === null) {
    // No resonance in the data: Cp from w B = Cp w^2 - 1/L over the points of high Q.
    // One pass over the points (a 20 001 point file reads in milliseconds).
    const fx: number[] = [];
    const fy: number[] = [];
    zs.forEach((z, i) => {
      if (!(z.re <= 0 || z.im / z.re >= 5)) return;
      fx.push(x2[i] as number);
      fy.push(cinv(z).im * (ws[i] as number));
    });
    const fit = relativeFit(fx, fy);
    cp = fit && fit.a > 0 ? fit.a : 0;
  }
  const low = data.f.map((f) => (srf === null ? true : f <= srf / 3));
  if (!low.some(Boolean)) low[0] = true;
  let l = 0;
  let r = 0;
  for (let iter = 0; iter < 50; iter++) {
    const zsr = series(cp);
    l = median(zsr.flatMap((z, i) => (low[i] ? [z.im / (ws[i] as number)] : [])));
    r = Math.max(
      0,
      median(
        zsr.flatMap((z, i) => (srf === null || (data.f[i] as number) <= srf / 2 ? [z.re] : [])),
      ),
    );
    if (!(l > 0)) l = 1e-9;
    if (srf === null) break;
    // The resonance of (R + jwL) || Cp: w0^2 = 1 / (L Cp) - R^2 / L^2.
    const w0 = 2 * Math.PI * srf;
    const next = 1 / (l * (w0 * w0 + (r * r) / (l * l)));
    if (Math.abs(next - cp) <= 1e-12 * next) {
      cp = next;
      break;
    }
    cp = next;
  }
  return { type: 'L', l, cp, r };
}

/* -------------------------------------------------------------- reading */

/** Words in a file's comments that name a manufacturer, and the name to use. */
const MAKERS: readonly [RegExp, string][] = [
  [/\bmurata\b/i, 'Murata'],
  [/\bcoilcraft\b/i, 'Coilcraft'],
  [/\bjohanson\b/i, 'Johanson Technology'],
  [/\bkemet\b/i, 'KEMET'],
  [/\btdk\b/i, 'TDK'],
];

/** Part number prefixes that name a manufacturer unambiguously. */
const PREFIXES: readonly [RegExp, string][] = [[/^(GRM|GJM|GQM|GCM|LQW|LQP|LQG|BLM)/i, 'Murata']];

/** A name cut to MAX_PART_NAME characters with control characters removed. */
export function cleanPartName(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    out += code < 32 || code === 127 ? ' ' : ch;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, MAX_PART_NAME);
}

/** The manufacturer a file names in its comments (a "Manufacturer:" line first), else by part number prefix, else ''. */
export function manufacturerOf(comments: readonly string[], partNumber: string): string {
  for (const c of comments) {
    const m = /^\s*(?:manufacturer|vendor|maker)\s*[:=]\s*(.+)$/i.exec(c);
    if (m?.[1]) return cleanPartName(m[1]);
  }
  for (const c of comments) {
    for (const [re, name] of MAKERS) if (re.test(c)) return name;
  }
  for (const [re, name] of PREFIXES) if (re.test(partNumber)) return name;
  return '';
}

/** The part number of a file: its name without folders and extension. */
export function partNumberOf(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  return cleanPartName(base.replace(/\.[A-Za-z0-9]+$/, '')) || 'Unnamed part';
}

const PARAMETERS: Readonly<Record<string, NetworkParameter>> = { S: 'S', Z: 'Z', Y: 'Y', H: 'H' };

/** The S-parameters of a two-port Touchstone file as part data (Z, Y and H files converted). */
export function partDataFromTouchstone(t: TouchstoneData, fixture?: PartFixture): PartData {
  if (t.ports !== 2) {
    throw new PartFileError(`A part file is a two-port (.s2p); this one has ${t.ports} ports`);
  }
  const kind = PARAMETERS[t.parameter];
  if (!kind) throw new PartFileError(`${t.parameter}-parameters are not supported for a part`);
  if (t.points.length < 2) throw new PartFileError('A part file needs at least two frequencies');
  if (t.points.length > MAX_PART_POINTS) {
    throw new PartFileError(
      `${t.points.length} frequencies; a part file may hold at most ${MAX_PART_POINTS}`,
    );
  }
  const f: number[] = [];
  const s: number[] = [];
  for (const p of t.points) {
    if (!(p.frequency > 0)) throw new PartFileError('Frequencies must be positive');
    if (f.length > 0 && !(p.frequency > (f[f.length - 1] as number))) {
      throw new PartFileError('Frequencies must be strictly ascending');
    }
    const m = kind === 'S' ? p.s : convertToS(p.s, kind, t.z0);
    const [s11, s12, s21, s22] = m as [Complex, Complex, Complex, Complex];
    const row = [s11.re, s11.im, s12.re, s12.im, s21.re, s21.im, s22.re, s22.im];
    if (!row.every((v) => Number.isFinite(v) && Math.abs(v) <= 10)) {
      throw new PartFileError(`Unusable S-parameters at ${hz(p.frequency)}`);
    }
    f.push(p.frequency);
    s.push(...row);
  }
  const guess = fixture ?? detectFixture({ f, s }).fixture;
  return { z0: t.z0, fixture: guess, f, s };
}

/** A library part from its data, with names; the fitted circuit and type derived from the data. */
/**
 * Why measured data has no part impedance to speak of, or null when it has
 * one at every frequency: an open in series (S21 = 0), a short to ground
 * (S21 = 1), or data of the other fixture (whose chain matrix has no B or no
 * C element). The reader and the restorers (libraryPartOf) apply the same test.
 */
function impedanceProblem(data: PartData, zs: readonly Complex[]): string | null {
  const ok = zs.every(
    (z) =>
      Number.isFinite(z.re) &&
      Number.isFinite(z.im) &&
      Math.hypot(z.re, z.im) < 1e12 &&
      Math.hypot(z.re, z.im) > 1e-9,
  );
  if (ok) return null;
  return data.fixture === 'series'
    ? 'The data does not read as a part measured in series (an open somewhere, or a part measured to ground)'
    : 'The data does not read as a part measured to ground (a short somewhere, or a part measured in series)';
}

export function libraryPartFromData(
  data: PartData,
  names: { readonly manufacturer: string; readonly partNumber: string },
): LibraryPart {
  const zs = dataImpedances(data);
  const problem = impedanceProblem(data, zs);
  if (problem) throw new PartFileError(problem);
  const type = partTypeOf(zs);
  const circuit = fitPartCircuit(data, type);
  if (!partCircuitOf(circuit)) {
    throw new PartFileError(
      `The data does not fit a capacitor or an inductor of usable value (the fitted ${type} is out of range)`,
    );
  }
  return {
    manufacturer: cleanPartName(names.manufacturer),
    partNumber: cleanPartName(names.partNumber) || 'Unnamed part',
    type,
    range: [data.f[0] as number, data.f[data.f.length - 1] as number],
    circuit,
    data,
  };
}

export interface ReadPartResult {
  readonly part: LibraryPart;
  readonly guess: FixtureGuess;
}

/**
 * Read a part from the text of its .s2p file. The part number is the file
 * name, the manufacturer comes from the comments or the part number; the
 * fixture is detected unless given. Throws PartFileError or TouchstoneError.
 */
export function readPartFile(
  text: string,
  fileName: string,
  fixture?: PartFixture,
): ReadPartResult {
  const ports = portsFromFileName(fileName);
  if (ports !== null && ports !== 2) {
    throw new PartFileError(
      `A part file is a two-port (.s2p); ${fileName} is a ${ports}-port file`,
    );
  }
  const first = firstContentLine(text);
  if (first !== null && !/^#/.test(first) && !/^[+-]?(\d|\.\d)/.test(first)) {
    throw new PartFileError(
      'Not a Touchstone file: it has neither an option line (# ...) nor rows of numbers',
    );
  }
  const t = readTouchstone(text, 2);
  const data = partDataFromTouchstone(t, fixture);
  const guess = detectFixture(data);
  const partNumber = partNumberOf(fileName);
  const part = libraryPartFromData(data, {
    manufacturer: manufacturerOf(t.comments, partNumber),
    partNumber,
  });
  return { part, guess };
}

/** The first line of a text that is neither blank nor a comment (!), trimmed; null if none. */
function firstContentLine(text: string): string | null {
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)) {
    const line = raw.replace(/!.*$/, '').trim();
    if (line) return line;
  }
  return null;
}

/** The same part measured in the other fixture reading (the user's choice), refitted. */
export function withFixture(part: LibraryPart, fixture: PartFixture): LibraryPart {
  if (!part.data || part.data.fixture === fixture) return part;
  return libraryPartFromData({ ...part.data, fixture }, part);
}

/* ------------------------------------------------------------ validation */

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const inRange = (v: unknown, lo: number, hi: number): v is number =>
  finite(v) && v >= lo && v <= hi;

/** A fitted circuit from stored data with every value physical, or null. */
export function partCircuitOf(raw: unknown): PartCircuit | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const c = raw as Record<string, unknown>;
  if (c.type === 'C') {
    if (!inRange(c.c, 1e-18, 1) || !inRange(c.esl, 0, 1e-3) || !inRange(c.esr, 0, 1e6)) return null;
    return { type: 'C', c: c.c, esl: c.esl, esr: c.esr };
  }
  if (c.type === 'L') {
    if (!inRange(c.l, 1e-15, 10) || !inRange(c.cp, 0, 1e-6) || !inRange(c.r, 0, 1e6)) return null;
    return { type: 'L', l: c.l, cp: c.cp, r: c.r };
  }
  return null;
}

/** Measured data from stored data, every number checked, or null. */
export function partDataOf(raw: unknown): PartData | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const d = raw as Record<string, unknown>;
  if (!inRange(d.z0, 1e-3, 1e6)) return null;
  if (d.fixture !== 'series' && d.fixture !== 'shunt') return null;
  const f = d.f;
  const s = d.s;
  if (!Array.isArray(f) || !Array.isArray(s)) return null;
  if (f.length < 2 || f.length > MAX_PART_POINTS || s.length !== 8 * f.length) return null;
  let prev = 0;
  for (const v of f) {
    if (!finite(v) || !(v > prev) || v > 1e15) return null;
    prev = v;
  }
  for (const v of s) if (!finite(v) || Math.abs(v) > 10) return null;
  return { z0: d.z0, fixture: d.fixture, f: f as number[], s: s as number[] };
}

/**
 * A library part from a link, a file, the autosave or the browser's part
 * store, every field checked; null when anything is missing or out of range.
 * Names are cut and cleaned; the range of a part with data is the data's own.
 * Stored data passes the reader's own tests: a part impedance at every
 * frequency, and the type it reads as (a capacitor record with inductor data
 * is refused).
 */
export function libraryPartOf(raw: unknown): LibraryPart | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.manufacturer !== 'string' || typeof p.partNumber !== 'string') return null;
  if (p.type !== 'C' && p.type !== 'L') return null;
  const circuit = partCircuitOf(p.circuit);
  if (!circuit || circuit.type !== p.type) return null;
  let data: PartData | undefined;
  if (p.data !== undefined) {
    const d = partDataOf(p.data);
    if (!d) return null;
    const zs = dataImpedances(d);
    if (impedanceProblem(d, zs) !== null || partTypeOf(zs) !== p.type) return null;
    data = d;
  }
  let range: [number, number];
  if (data) {
    range = [data.f[0] as number, data.f[data.f.length - 1] as number];
  } else {
    const r = p.range;
    if (!Array.isArray(r) || r.length !== 2) return null;
    const [lo, hi] = r as unknown[];
    if (!inRange(lo, 1e-3, 1e15) || !inRange(hi, 1e-3, 1e15) || !(hi > lo)) return null;
    range = [lo, hi];
  }
  return {
    manufacturer: cleanPartName(p.manufacturer),
    partNumber: cleanPartName(p.partNumber) || 'Unnamed part',
    type: p.type,
    range,
    circuit,
    ...(data ? { data } : {}),
  };
}

/* ------------------------------------------------------------- synthetic */

/** Log-spaced frequencies from lo to hi, n points. */
export function logFrequencies(lo: number, hi: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) =>
    i === n - 1 ? hi : lo * (hi / lo) ** (i / Math.max(1, n - 1)),
  );
}

export interface SyntheticPartSpec {
  /** File name without extension, starting with SYNTH-. */
  readonly name: string;
  readonly circuit: PartCircuit;
  readonly fixture: PartFixture;
}

/**
 * The synthetic example parts: 0402-like capacitors and inductors made up
 * from equivalent circuits with typical values. They are not measurements
 * and not any manufacturer's part; they exist for the tests, the oracle and
 * the app's demo, and every one is named SYNTH-.
 */
export const SYNTHETIC_PARTS: readonly SyntheticPartSpec[] = [
  {
    name: 'SYNTH-C0402-1P0',
    circuit: { type: 'C', c: 1e-12, esl: 0.3e-9, esr: 0.4 },
    fixture: 'series',
  },
  {
    name: 'SYNTH-C0402-2P2',
    circuit: { type: 'C', c: 2.2e-12, esl: 0.32e-9, esr: 0.3 },
    fixture: 'series',
  },
  {
    name: 'SYNTH-C0402-4P7',
    circuit: { type: 'C', c: 4.7e-12, esl: 0.35e-9, esr: 0.25 },
    fixture: 'series',
  },
  {
    name: 'SYNTH-C0402-10P',
    circuit: { type: 'C', c: 10e-12, esl: 0.38e-9, esr: 0.2 },
    fixture: 'series',
  },
  {
    name: 'SYNTH-C0402-22P',
    circuit: { type: 'C', c: 22e-12, esl: 0.4e-9, esr: 0.15 },
    fixture: 'series',
  },
  {
    name: 'SYNTH-C0402-10P-SHUNT',
    circuit: { type: 'C', c: 10e-12, esl: 0.45e-9, esr: 0.2 },
    fixture: 'shunt',
  },
  {
    name: 'SYNTH-L0402-2N2',
    circuit: { type: 'L', l: 2.2e-9, cp: 0.06e-12, r: 0.1 },
    fixture: 'series',
  },
  {
    name: 'SYNTH-L0402-4N7',
    circuit: { type: 'L', l: 4.7e-9, cp: 0.07e-12, r: 0.2 },
    fixture: 'series',
  },
  {
    name: 'SYNTH-L0402-10N',
    circuit: { type: 'L', l: 10e-9, cp: 0.08e-12, r: 0.35 },
    fixture: 'series',
  },
  {
    name: 'SYNTH-L0402-22N',
    circuit: { type: 'L', l: 22e-9, cp: 0.1e-12, r: 0.7 },
    fixture: 'series',
  },
];

/** Frequencies of the synthetic files: 10 MHz to 10 GHz, 201 log-spaced points. */
export const SYNTHETIC_FREQUENCIES: readonly number[] = logFrequencies(10e6, 10e9, 201);

/** The manufacturer name of the synthetic examples. */
export const SYNTHETIC_MANUFACTURER = 'Synthetic (not a real part)';

/** The comment lines of a synthetic file. */
export function syntheticComments(spec: SyntheticPartSpec): string[] {
  const c = spec.circuit;
  const circuit =
    c.type === 'C'
      ? `C ${c.c} F, ESL ${c.esl} H, ESR ${c.esr} ohm in series`
      : `L ${c.l} H with R ${c.r} ohm in series, Cp ${c.cp} F across`;
  return [
    `Manufacturer: ${SYNTHETIC_MANUFACTURER}`,
    'Synthetic example generated by SmithChart.Online from an equivalent circuit.',
    'Not measured data and not a manufacturer file.',
    `Circuit: ${circuit}`,
    `Fixture: ${spec.fixture}-through`,
  ];
}

/** A synthetic example as a library part (the same data its file holds). */
export function syntheticPart(spec: SyntheticPartSpec): LibraryPart {
  return libraryPartFromData(
    partDataFromCircuit(spec.circuit, spec.fixture, SYNTHETIC_FREQUENCIES, 50),
    { manufacturer: SYNTHETIC_MANUFACTURER, partNumber: spec.name },
  );
}

/** The synthetic examples that ship as files (tests, the oracle): a subset of SYNTHETIC_PARTS. */
export const SYNTHETIC_FILES: readonly string[] = [
  'SYNTH-C0402-2P2',
  'SYNTH-C0402-10P',
  'SYNTH-C0402-10P-SHUNT',
  'SYNTH-L0402-4N7',
  'SYNTH-L0402-10N',
];

/** The .s2p text of a synthetic example: RI format, 10 significant digits, frequencies in MHz. */
export function syntheticFileText(spec: SyntheticPartSpec): string {
  const data = partDataFromCircuit(spec.circuit, spec.fixture, SYNTHETIC_FREQUENCIES, 50);
  const points = data.f.map((frequency, k) => {
    const o = 8 * k;
    const c = (i: number): Complex => complex(data.s[o + i] as number, data.s[o + i + 1] as number);
    return { frequency, s: [c(0), c(2), c(4), c(6)] };
  });
  return writeTouchstone(
    { ports: 2, z0: 50, points },
    { format: 'RI', frequencyUnit: 'MHZ', digits: 10, comments: syntheticComments(spec) },
  );
}
