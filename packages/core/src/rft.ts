/**
 * Broadband matching from data: the simplified real frequency technique.
 *
 * The topology search in broadband.ts tries ladder shapes one by one and asks
 * the band optimizer for each one's values. The real frequency technique
 * (Carlin, 1977; the simplified form of Yarman and Carlin, 1982) turns the
 * question around: it optimizes the transducer power gain of the whole
 * lossless equalizer directly, for every network of a given degree at once,
 * and only then builds the network that has that gain.
 *
 * What is parametrized. The equalizer is a lossless reciprocal two-port
 * between the source resistance R0 (port 1) and the load (port 2). In
 * Belevitch form, normalized to R0 at both ports and with p the complex
 * frequency divided by omega_n (the geometric band centre),
 *
 *   S11 = h(p) / g(p),  S21 = f(p) / g(p),  S22 = -(-1)^k h(-p) / g(p),
 *   g(p) g(-p) = h(p) h(-p) + f(p) f(-p),   f(p) = p^k.
 *
 * The unknowns are the n + 1 real coefficients of h(p), the numerator of the
 * front-end reflectance; n is the degree (the number of reactive parts) and
 * k the number of transmission zeros at DC (the rest, n - k, at infinity):
 * k = 0 is the lowpass prototype (series L, shunt C), k = n the highpass one
 * (series C, shunt L), anything between a bandpass ladder of both kinds.
 * g(p) is not free: it is the strictly Hurwitz factor of h h* + f f*, found
 * from the roots of that even polynomial (its left half plane roots), and
 * checked: g(p) g(-p) must give back h h* + f f* (to 1e-9 of its largest
 * coefficient), else the point has no equalizer and the optimizer is told
 * so. The back-end reflectance S22 then follows, and the transducer power
 * gain on the load Z_L (reflection Gamma_L towards R0) is
 *
 *   T(w) = |S21|^2 (1 - |Gamma_L|^2) / |1 - S22 Gamma_L|^2.
 *
 * What is optimized. Levenberg-Marquardt over the free coefficients of h, on
 * residuals |1 - T|^(m/2) at the band points (a gain above 1 is not physical
 * and counts as a loss), with m raised from 2 (Yarman's least squares
 * towards a flat gain of 1) to 1024: the cost tends to the worst point, so
 * the result is the flattest gain at the best level found (an equal-ripple
 * shape). Ten seeded random starts per prototype (the method is not convex),
 * the best three carried through every stage, and exact starts carried
 * through every stage regardless: the result one degree lower with the
 * added part at zero, and any ladder the caller gives (the topology search's
 * best of this size, its h from the ladder's reflectance). A lossless
 * equalizer has 1 - T = |Gamma_in|^2, so the lowest gain in the band is the
 * worst VSWR, the number the topology search ranks by.
 *
 * Synthesis. The input impedance of the equalizer terminated in R0,
 * Z = (g + h) / (g - h), or its admittance (a shunt part first), is expanded
 * as a continued fraction by removing its poles at infinity (series L,
 * shunt C) and at zero (series C, shunt L) in full, one part per step
 * (Darlington synthesis with every transmission zero at 0 or infinity, so no
 * zero shifting is needed); the expansion that ends nearer R0 is kept. What
 * is left is a resistance; a ladder without an ideal transformer needs it
 * equal to R0. For the lowpass prototype that is h(0) = 0, for the highpass
 * one the leading coefficient of h equal to zero, and both are imposed
 * exactly. A bandpass ladder has no such closed condition: its terminating
 * resistance is driven to R0 by a penalty in the optimization, for the two
 * orders of extraction (a pole at infinity first, or at zero first), and the
 * ladder is built without the transformer.
 *
 * Polish and checks. The synthesized ladder's gain is recomputed through the
 * app's own ABCD cascade on the same grid and the largest difference from
 * the optimized gain is reported (a loss of accuracy in the expansion shows
 * there). A part outside the topology search's part window (reactance Z0 / 25
 * to 10 Z0 at the band centre) is brought to its edge, and the values are
 * then refined against the worst VSWR on the dense grid with the band
 * optimizer inside that window, as the textbook's last step does: the result
 * is a ladder of parts the search would also allow, so the two are compared
 * like for like. The polished ladder can do better than the shape it was
 * built from, or worse when the window binds: the shape is the one found,
 * not a bound, and the panel states the gap.
 *
 * The best ends of each prototype's runs also go through a simplex on the
 * largest |1 - T| itself: the last stage of m only tends to the worst point.
 * The result is the best of this degree's ladders, the given ladders and the
 * lower degree's result: more parts are never worse (with no gain from the
 * added part, the answer has one part fewer and says so).
 *
 * Limits. Lumped parts only (no lines). Degree 1 to 8: the polynomial
 * coefficients of h and g, the roots of h h* + f f* and the continued
 * fraction all lose digits as the degree grows, so above about 6 parts a
 * synthesized ladder can differ from its gain shape; the difference is
 * measured and reported, never hidden. The source must be a resistance.
 */
import { complex, cabs, cdiv, cmul, csub, cadd, csqrt, type Complex } from './complex.js';
import { ladderAbcd, type Element } from './elements.js';
import { throughAbcd } from './abcd.js';
import {
  feasibility,
  nelderMead,
  optimizeBand,
  parameterBound,
  worstVswr,
  OPTIMIZE_FAIL,
  type Feasibility,
  type LoadModel,
} from './optimize.js';
import { scoringFrequencies } from './broadband.js';
import { seededRandom } from './montecarlo.js';

/* --------------------------------------------------------------- polynomials
 *
 * Real coefficients in ascending order: c[0] + c[1] p + c[2] p^2 + ...
 */
type Poly = number[];

function padd(a: readonly number[], b: readonly number[]): Poly {
  const out = new Array<number>(Math.max(a.length, b.length)).fill(0);
  a.forEach((c, i) => (out[i] = (out[i] as number) + c));
  b.forEach((c, i) => (out[i] = (out[i] as number) + c));
  return out;
}

function psub(a: readonly number[], b: readonly number[]): Poly {
  return padd(
    a,
    b.map((c) => -c),
  );
}

function pmul(a: readonly number[], b: readonly number[]): Poly {
  const out = new Array<number>(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++)
      out[i + j] = (out[i + j] as number) + (a[i] as number) * (b[j] as number);
  }
  return out;
}

/** a(-p). */
function pneg(a: readonly number[]): Poly {
  return a.map((c, i) => (i % 2 === 1 ? -c : c));
}

/** Drop leading coefficients whose magnitude is at most `tol`; at least one coefficient stays. */
function trim(a: readonly number[], tol = 0): Poly {
  let n = a.length;
  while (n > 1 && Math.abs(a[n - 1] as number) <= tol) n--;
  return a.slice(0, n);
}

function norm(a: readonly number[]): number {
  return a.reduce((m, c) => Math.max(m, Math.abs(c)), 0);
}

/** a(z) for a complex z, by Horner. */
function peval(a: readonly number[], z: Complex): Complex {
  let re = 0;
  let im = 0;
  for (let i = a.length - 1; i >= 0; i--) {
    const r = re * z.re - im * z.im + (a[i] as number);
    im = re * z.im + im * z.re;
    re = r;
  }
  return complex(re, im);
}

/**
 * The roots of a real polynomial (ascending coefficients, leading one nonzero)
 * by the Aberth-Ehrlich iteration, each then polished by two Newton steps on
 * the polynomial itself. Degree 0 has none. `start`, roots of a nearby
 * polynomial of the same degree, is tried first (the optimizer's small steps
 * make that a few iterations); the circle of Fujiwara's bound otherwise.
 */
export function polynomialRoots(
  coefficients: readonly number[],
  start?: readonly Complex[],
): Complex[] {
  return rootsOf(coefficients, start).roots;
}

/** polynomialRoots, with whether the iteration converged. */
function rootsOf(
  coefficients: readonly number[],
  start?: readonly Complex[],
): { roots: Complex[]; converged: boolean } {
  const a = trim(coefficients);
  const n = a.length - 1;
  if (n < 1) return { roots: [], converged: true };
  const lead = a[n] as number;
  const monic = a.map((c) => c / lead);
  const dmonic = monic.slice(1).map((c, i) => c * (i + 1));
  const iterate = (z: Complex[], cap: number): boolean => {
    for (let iter = 0; iter < cap; iter++) {
      let moved = 0;
      for (let k = 0; k < n; k++) {
        const zk = z[k] as Complex;
        const pv = peval(monic, zk);
        if (cabs(pv) === 0) continue;
        const ratio = cdiv(pv, peval(dmonic, zk));
        let s = complex(0, 0);
        for (let j = 0; j < n; j++) {
          if (j !== k) s = cadd(s, cdiv(complex(1, 0), csub(zk, z[j] as Complex)));
        }
        const w = cdiv(ratio, csub(complex(1, 0), cmul(ratio, s)));
        if (!Number.isFinite(w.re) || !Number.isFinite(w.im)) continue;
        z[k] = csub(zk, w);
        moved = Math.max(moved, cabs(w) / Math.max(1e-300, cabs(z[k] as Complex)));
      }
      if (moved < 1e-12) return true;
    }
    return false;
  };
  let z: Complex[] | null = null;
  let converged = true;
  if (start && start.length === n && start.every((s) => Number.isFinite(s.re + s.im))) {
    const warm = start.map((s) => complex(s.re, s.im));
    if (iterate(warm, 30)) z = warm;
  }
  if (!z) {
    // Fujiwara's bound on the root magnitudes, for the starting circle.
    let radius = 0;
    for (let i = 0; i < n; i++) {
      radius = Math.max(radius, Math.abs(monic[i] as number) ** (1 / (n - i)));
    }
    radius = Math.max(radius, 1e-3);
    z = Array.from({ length: n }, (_, k) => {
      const t = (2 * Math.PI * k) / n + 0.4;
      return complex(radius * Math.cos(t), radius * Math.sin(t));
    });
    converged = iterate(z, 500);
  }
  const roots = z.map((zk) => {
    let r = zk;
    for (let i = 0; i < 2; i++) {
      const dv = peval(dmonic, r);
      if (cabs(dv) === 0) break;
      const step = cdiv(peval(monic, r), dv);
      if (Number.isFinite(step.re) && Number.isFinite(step.im)) r = csub(r, step);
    }
    return r;
  });
  return { roots, converged: converged && roots.every((r) => Number.isFinite(r.re + r.im)) };
}

/* ------------------------------------------------------- Belevitch form */

/** A lossless equalizer in Belevitch form, normalized to R0 and omega_n. */
export interface Belevitch {
  /** Numerator of S11, ascending coefficients. */
  readonly h: readonly number[];
  /** Strictly Hurwitz denominator, ascending coefficients. */
  readonly g: readonly number[];
  /** Transmission zeros at DC: f(p) = p^k. */
  readonly k: number;
}

/** The last roots found per degree: the optimizer moves in small steps, so they start the next search. */
const warmRoots = new Map<number, Complex[]>();

/**
 * g(p) from h(p) and f(p) = p^k: the left half plane factor of
 * h(p) h(-p) + (-1)^k p^(2k), an even polynomial, so its roots come from a
 * polynomial of half the degree in q = p^2. Null when the factor does not
 * exist (a root on the imaginary axis, or a polynomial that is not
 * nonnegative on it).
 */
export function hurwitzFactor(h: readonly number[], k: number): number[] | null {
  const ff = new Array<number>(2 * k + 1).fill(0);
  ff[2 * k] = k % 2 === 0 ? 1 : -1;
  const big = padd(pmul(h, pneg(h)), ff);
  // Coefficients of q^j are those of p^(2j); the odd ones are zero.
  const q: number[] = [];
  for (let j = 0; 2 * j < big.length; j++) q.push(big[2 * j] as number);
  const qt = trim(q, 1e-300);
  const m = qt.length - 1;
  // g g* has leading coefficient (-1)^m g_m^2.
  const lead2 = (m % 2 === 0 ? 1 : -1) * (qt[m] as number);
  if (!(lead2 > 0)) return null;
  const { roots, converged } = rootsOf(qt, warmRoots.get(m));
  // An unconverged root set is never used, nor kept as the start of the next call.
  if (!converged) {
    warmRoots.delete(m);
    return null;
  }
  let re: number[] = [Math.sqrt(lead2)];
  let im: number[] = [0];
  for (const r of roots) {
    const s = csqrt(r);
    // The root of p^2 = r in the left half plane.
    const p = s.re > 0 ? complex(-s.re, -s.im) : s;
    if (!(p.re < 0)) {
      warmRoots.delete(m);
      return null;
    }
    // Multiply by (p - root).
    const nre = new Array<number>(re.length + 1).fill(0);
    const nim = new Array<number>(re.length + 1).fill(0);
    for (let i = 0; i < re.length; i++) {
      const a = re[i] as number;
      const b = im[i] as number;
      nre[i + 1] = (nre[i + 1] as number) + a;
      nim[i + 1] = (nim[i + 1] as number) + b;
      nre[i] = (nre[i] as number) - (a * p.re - b * p.im);
      nim[i] = (nim[i] as number) - (a * p.im + b * p.re);
    }
    re = nre;
    im = nim;
  }
  // Conjugate pairs leave only rounding noise in the imaginary parts.
  const g = re.slice();
  const n = h.length - 1;
  // Exact where exact arithmetic gives exact values, so the continued fraction cancels cleanly:
  // with zeros at infinity (k < n) |g_n| = |h_n|, with zeros at DC (k > 0) g(0) = |h(0)|.
  if (g.length - 1 === n && k < n) g[n] = Math.abs(h[n] as number);
  if (k > 0) g[0] = Math.abs(h[0] as number);
  // The factor is checked, not trusted: g(p) g(-p) must give back h h* + f f* to a relative
  // 1e-9 of its largest coefficient, else the roots were wrong (a nearly vanishing leading
  // coefficient sends one to infinity) and there is no g to use.
  if (!g.every(Number.isFinite) || !factorHolds(g, big)) {
    warmRoots.delete(m);
    return null;
  }
  warmRoots.set(m, roots);
  return g;
}

/** g(p) g(-p) equals `even` coefficient by coefficient, to 1e-9 of the largest. */
function factorHolds(g: readonly number[], even: readonly number[]): boolean {
  const back = pmul(g, pneg(g));
  const scale = norm(even);
  if (!(scale > 0) || !Number.isFinite(scale)) return false;
  const len = Math.max(back.length, even.length);
  for (let i = 0; i < len; i++) {
    if (Math.abs((back[i] ?? 0) - (even[i] ?? 0)) > 1e-9 * scale) return false;
  }
  return true;
}

/** S22 and |S21|^2 of the equalizer at normalized angular frequency w. */
function backEnd(b: Belevitch, w: number): { s22: Complex; s21sq: number } {
  const p = complex(0, w);
  const hp = peval(b.h, p);
  const gp = peval(b.g, p);
  const sign = b.k % 2 === 0 ? -1 : 1;
  // h(-jw) is the conjugate of h(jw) for real coefficients.
  const s22 = cdiv(complex(sign * hp.re, -sign * hp.im), gp);
  const g2 = gp.re * gp.re + gp.im * gp.im;
  return { s22, s21sq: w ** (2 * b.k) / g2 };
}

/**
 * Transducer power gain of the equalizer on a load of normalized impedance zl
 * (Z_L / R0) at normalized angular frequency w.
 */
export function belevitchGain(b: Belevitch, w: number, zl: Complex): number {
  const { s22, s21sq } = backEnd(b, w);
  const gl = cdiv(csub(zl, complex(1, 0)), cadd(zl, complex(1, 0)));
  const gl2 = gl.re * gl.re + gl.im * gl.im;
  const den = csub(complex(1, 0), cmul(s22, gl));
  return (s21sq * (1 - gl2)) / (den.re * den.re + den.im * den.im);
}

/* ------------------------------------------------------------- synthesis */

/** One part of a synthesized ladder, normalized (R0 = 1, omega_n = 1), source side first. */
export interface NormalizedPart {
  readonly orientation: 'series' | 'shunt';
  readonly kind: 'L' | 'C';
  readonly value: number;
}

export interface Synthesis {
  /** Source side first. */
  readonly parts: readonly NormalizedPart[];
  /** The resistance left at the load end, normalized to R0: 1 for a ladder without a transformer. */
  readonly termination: number;
}

/** Which pole a continued fraction step removes when the function has both. */
export type ExtractionOrder = 'infinity-first' | 'zero-first';

/** num / den has a pole at infinity or at zero (coefficients below tol count as zero). */
function hasPole(num: readonly number[], den: readonly number[], tol: number): boolean {
  if (num.length - 1 === den.length) return true;
  return Math.abs(den[0] as number) <= tol && den.length > 1 && Math.abs(num[0] as number) > tol;
}

/**
 * Darlington synthesis by continued fraction: Z = (g + h) / (g - h), the
 * input impedance with the load end terminated in R0, has its poles at
 * infinity and zero removed in full, one part per step, switching between
 * impedance and admittance after each part when the reciprocal has a pole
 * (an alternating ladder), else when the function in hand has none left. Null
 * when a step needs a negative part or the expansion does not end in a
 * resistance (a function this method cannot build: zero shifting would be
 * needed, or rounding destroyed it).
 */
export function synthesizeLadder(
  b: Belevitch,
  order: ExtractionOrder = 'infinity-first',
): Synthesis | null {
  // From the impedance (a series part first) and from the admittance (a shunt part first): a
  // ladder that starts with a shunt part can leave an impedance with a removable pole that
  // leads elsewhere. The expansion that ends nearer R0 is the one kept.
  const a = expandLadder(b, order, 'series');
  const c = expandLadder(b, order, 'shunt');
  if (!a || !c) return a ?? c;
  return Math.abs(Math.log(c.termination)) < Math.abs(Math.log(a.termination)) - 1e-12 ? c : a;
}

function expandLadder(
  b: Belevitch,
  order: ExtractionOrder,
  first: 'series' | 'shunt',
): Synthesis | null {
  let num = first === 'series' ? padd(b.g, b.h) : psub(b.g, b.h);
  let den = first === 'series' ? psub(b.g, b.h) : padd(b.g, b.h);
  const tol = 1e-9 * Math.max(norm(num), norm(den));
  let mode: 'series' | 'shunt' = first;
  const parts: NormalizedPart[] = [];
  let inversions = 0;
  for (let step = 0; step < 4 * b.g.length + 4; step++) {
    num = trim(num, tol);
    den = trim(den, tol);
    const dn = num.length - 1;
    const dd = den.length - 1;
    const denZero = Math.abs(den[0] as number) <= tol;
    if (denZero && dd === 0) return null;
    const atInfinity = dn === dd + 1;
    const atZero = denZero && Math.abs(num[0] as number) > tol;
    if (atInfinity || atZero) {
      inversions = 0;
      const useInfinity = atInfinity && (!atZero || order === 'infinity-first');
      if (useInfinity) {
        const a = (num[dn] as number) / (den[dd] as number);
        if (!(a > 0)) return null;
        num = psub(num, [0, ...den.map((c) => c * a)]).slice(0, dn);
        parts.push({ orientation: mode, kind: mode === 'series' ? 'L' : 'C', value: a });
      } else {
        const d1 = den.slice(1);
        const res = (num[0] as number) / (d1[0] as number);
        if (!(res > 0)) return null;
        num = psub(
          num,
          d1.map((c) => c * res),
        ).slice(1);
        den = d1;
        // A pole res / p: series C = 1 / res (impedance), shunt L = 1 / res (admittance).
        parts.push({ orientation: mode, kind: mode === 'series' ? 'C' : 'L', value: 1 / res });
      }
      // Alternate series and shunt whenever the reciprocal has a pole to remove, so the ladder
      // takes the alternating form the topology search builds.
      num = trim(num, tol);
      den = trim(den, tol);
      if (hasPole(den, num, tol)) {
        [num, den] = [den, num];
        mode = mode === 'series' ? 'shunt' : 'series';
      }
      continue;
    }
    if (dn === 0 && dd === 0) {
      const r = (num[0] as number) / (den[0] as number);
      const termination = mode === 'series' ? r : 1 / r;
      return termination > 0 && Number.isFinite(termination) ? { parts, termination } : null;
    }
    if (dn > dd + 1 || ++inversions > 1) return null;
    [num, den] = [den, num];
    mode = mode === 'series' ? 'shunt' : 'series';
  }
  return null;
}

/**
 * The Belevitch form of a normalized LC ladder (source side first, both ends
 * terminated in 1): p^k times its ABCD matrix is polynomial, k the number of
 * series C and shunt L parts, and then g = (A + B + C + D) / 2 and
 * h = (A + B - C - D) / 2. The inverse of synthesizeLadder.
 */
export function ladderBelevitch(parts: readonly NormalizedPart[]): Belevitch {
  let m: Poly[] = [[1], [0], [0], [1]];
  let k = 0;
  for (const part of parts) {
    const atZero = (part.orientation === 'series') === (part.kind === 'C');
    if (atZero) k++;
    // Series: [[1, z], [0, 1]], shunt: [[1, 0], [y, 1]]; times p for a part with 1 / p.
    const one: Poly = atZero ? [0, 1] : [1];
    const x: Poly = atZero ? [1 / part.value] : [0, part.value];
    const e: Poly[] = part.orientation === 'series' ? [one, x, [0], one] : [one, [0], x, one];
    const [a, b, c, d] = m as [Poly, Poly, Poly, Poly];
    const [ea, eb, ec, ed] = e as [Poly, Poly, Poly, Poly];
    m = [
      padd(pmul(a, ea), pmul(b, ec)),
      padd(pmul(a, eb), pmul(b, ed)),
      padd(pmul(c, ea), pmul(d, ec)),
      padd(pmul(c, eb), pmul(d, ed)),
    ];
  }
  const [a, b, c, d] = m as [Poly, Poly, Poly, Poly];
  const n = parts.length;
  const fit = (v: Poly): number[] => Array.from({ length: n + 1 }, (_, i) => (v[i] ?? 0) / 2);
  return {
    g: fit(padd(padd(a, b), padd(c, d))),
    h: fit(psub(padd(a, b), padd(c, d))),
    k,
  };
}

/**
 * The synthesized ladder as app elements, load side first, at real scale:
 * L = l R0 / omega_n, C = c / (R0 omega_n). With a termination other than 1
 * and `transformer` true, an ideal transformer of ratio sqrt(termination)
 * sits next to the load (the ladder then sees termination times the load's
 * impedance); otherwise it is left out.
 */
export function ladderElements(
  s: Synthesis,
  r0: number,
  omega: number,
  transformer = false,
): Element[] {
  const parts: Element[] = s.parts.map((part) =>
    part.kind === 'L'
      ? { kind: 'L', orientation: part.orientation, value: (part.value * r0) / omega }
      : { kind: 'C', orientation: part.orientation, value: part.value / (r0 * omega) },
  );
  parts.reverse();
  if (transformer && Math.abs(s.termination - 1) > 1e-12) {
    return [{ kind: 'transformer', n: Math.sqrt(s.termination) }, ...parts];
  }
  return parts;
}

/* ------------------------------------------------------- gain and VSWR */

/** The worst VSWR a lossless equalizer shows where its transducer gain is `gain` (1 - T = |Gamma_in|^2). */
export function vswrOfGain(gain: number): number {
  if (!(gain > 0)) return Infinity;
  const g = Math.sqrt(Math.max(0, 1 - Math.min(1, gain)));
  return (1 + g) / (1 - g);
}

/** The transducer gain of a lossless equalizer at a VSWR. */
export function gainOfVswr(vswr: number): number {
  if (!(vswr >= 1)) return NaN;
  if (vswr === Infinity) return 0;
  const g = (vswr - 1) / (vswr + 1);
  return 1 - g * g;
}

/* ----------------------------------------------------- Levenberg-Marquardt */

/** Solve A x = b by Gaussian elimination with partial pivoting; null when singular. */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i] as number]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) {
      if (Math.abs((m[r] as number[])[c] as number) > Math.abs((m[piv] as number[])[c] as number))
        piv = r;
    }
    [m[c], m[piv]] = [m[piv] as number[], m[c] as number[]];
    const pr = m[c] as number[];
    const d = pr[c] as number;
    if (!(Math.abs(d) > 1e-300)) return null;
    for (let r = c + 1; r < n; r++) {
      const row = m[r] as number[];
      const f = (row[c] as number) / d;
      if (f === 0) continue;
      for (let j = c; j <= n; j++) row[j] = (row[j] as number) - f * (pr[j] as number);
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    const row = m[r] as number[];
    let s = row[n] as number;
    for (let j = r + 1; j < n; j++) s -= (row[j] as number) * (x[j] as number);
    x[r] = s / (row[r] as number);
  }
  return x.every(Number.isFinite) ? x : null;
}

const sumSq = (r: readonly number[]): number => r.reduce((s, v) => s + v * v, 0);

/** Minimize the sum of squares of `residuals` from x0; forward-difference Jacobian. */
function levenbergMarquardt(
  residuals: (x: readonly number[]) => number[],
  x0: readonly number[],
  iterations: number,
): number[] {
  let x = x0.slice();
  let r = residuals(x);
  let cost = sumSq(r);
  let lambda = 1e-3;
  const n = x.length;
  for (let it = 0; it < iterations && n > 0; it++) {
    const jac: number[][] = [];
    for (let j = 0; j < n; j++) {
      const step = 1e-7 * Math.max(1, Math.abs(x[j] as number));
      const xp = x.slice();
      xp[j] = (xp[j] as number) + step;
      const rp = residuals(xp);
      jac.push(rp.map((v, i) => (v - (r[i] as number)) / step));
    }
    const jtj = Array.from({ length: n }, (_, a) =>
      Array.from({ length: n }, (_, b) =>
        (jac[a] as number[]).reduce((s, v, i) => s + v * ((jac[b] as number[])[i] as number), 0),
      ),
    );
    const jtr = Array.from({ length: n }, (_, a) =>
      (jac[a] as number[]).reduce((s, v, i) => s + v * (r[i] as number), 0),
    );
    let improved = false;
    while (lambda < 1e12) {
      const damped = jtj.map((row, a) =>
        row.map((v, b) => (a === b ? v + lambda * Math.max(v, 1e-12) : v)),
      );
      const delta = solve(
        damped,
        jtr.map((v) => -v),
      );
      if (delta) {
        const xn = x.map((v, j) => v + (delta[j] as number));
        const rn = residuals(xn);
        const cn = sumSq(rn);
        if (Number.isFinite(cn) && cn < cost) {
          const gain = (cost - cn) / Math.max(cost, 1e-300);
          x = xn;
          r = rn;
          cost = cn;
          lambda = Math.max(lambda / 3, 1e-12);
          improved = true;
          if (gain < 1e-12) return x;
          break;
        }
      }
      lambda *= 4;
    }
    if (!improved) break;
  }
  return x;
}

/* ---------------------------------------------------------------- the search */

export const RFT_MAX_PARTS = 8;

export type RftPrototype = 'lowpass' | 'highpass' | 'bandpass';

/** k transmission zeros at DC of n: lowpass (none), highpass (all) or bandpass. */
export function prototypeOf(k: number, n: number): RftPrototype {
  return k === 0 ? 'lowpass' : k === n ? 'highpass' : 'bandpass';
}

export interface RftProgress {
  readonly done: number;
  readonly total: number;
}

export interface RftOptions {
  readonly load: LoadModel;
  /** The source resistance R0, ohm (the design's Z0 or a real target). */
  readonly z0: number;
  /** Degree: the number of new parts, 1 to RFT_MAX_PARTS (anything else is held to that range). */
  readonly parts: number;
  /** Parts already in the design; the equalizer goes after them (towards the source). */
  readonly prefix?: readonly Element[];
  /** Which numbers of zeros at DC to try; default every one from 0 to parts. */
  readonly zerosAtDc?: readonly number[];
  /**
   * Allow an ideal transformer next to the load: h(0) is then free for the
   * lowpass prototype (the textbook's single matching with a free generator
   * resistance) and no penalty holds a bandpass ladder's termination at R0.
   * Default false.
   */
  readonly transformer?: boolean;
  /** Seeded starts per prototype. Default 10. */
  readonly starts?: number;
  readonly seed?: number;
  /**
   * Refine the synthesized ladder's values with the band optimizer, inside
   * the part window (see `windowZ0`). Default true.
   */
  readonly polish?: boolean;
  /**
   * Start also from the result one degree lower: exactly (the added part at
   * zero, kept through every stage) and with the part slightly grown. The
   * lower result itself stays a candidate, so more parts are never worse
   * (computed first, recursively). Default true.
   */
  readonly continuation?: boolean;
  /** Extra starting numerators h(p) (ascending, normalized), per number of zeros at DC. */
  readonly seeds?: readonly { readonly k: number; readonly h: readonly number[] }[];
  /**
   * Ladders of lumped L and C parts, load side first, to start from (the
   * topology search's best of this size, say): each becomes an exact start
   * (its h from its reflectance) and a candidate result, so the result is
   * never worse than any of them.
   */
  readonly ladders?: readonly (readonly Element[])[];
  /**
   * The reference of the part window: reactance from windowZ0 / 25 to
   * 10 windowZ0 at the band centre, the window the topology search uses.
   * Default z0.
   */
  readonly windowZ0?: number;
  readonly onProgress?: (p: RftProgress) => void;
}

/** Where a result's ladder came from. */
export type RftSource =
  /** Synthesized from this degree's gain shape (and polished). */
  | 'shape'
  /** The result one degree lower: an added part did not help. */
  | 'lower'
  /** One of the ladders given as starts (`RftOptions.ladders`). */
  | 'ladder';

export interface RftSolution {
  readonly zerosAtDc: number;
  readonly prototype: RftPrototype;
  readonly order: ExtractionOrder;
  /** The gain shape found, normalized to R0 and omega. */
  readonly belevitch: Belevitch;
  readonly r0: number;
  /** omega_n, rad/s: the geometric band centre. */
  readonly omega: number;
  /** The gain shape on the scoring grid: transducer gain of the equalizer `belevitch`. */
  readonly gain: readonly number[];
  readonly minGain: number;
  /** The worst VSWR the gain shape implies (from minGain). */
  readonly shapeVswr: number;
  /** Termination left by the synthesis, normalized to R0; 1 without a transformer. */
  readonly termination: number;
  /** The ladder as synthesized, load side first (with the transformer only when allowed). */
  readonly synthesized: readonly Element[];
  /** Worst VSWR of the synthesized ladder on the scoring grid, through the app's cascade. */
  readonly synthesizedVswr: number;
  /** Largest |T(synthesized ladder) - T(shape)| on the scoring grid: what the synthesis lost. */
  readonly synthesisError: number;
  /** The result: the synthesized ladder with its parts brought into the part window, or its polished values when they are better. */
  readonly elements: readonly Element[];
  readonly worstVswr: number;
  readonly polished: boolean;
  /** Transducer gain of the result (with the prefix) on the scoring grid: what Apply inserts. */
  readonly ladderGain: readonly number[];
  /** Largest |T(result) - T(shape)| on the scoring grid. */
  readonly shapeGap: number;
  /** Parts of the result outside the part window: none for a ladder the technique built (its parts are brought into the window), and none for the search's ladders. */
  readonly outsideWindow: number;
  readonly source: RftSource;
}

export interface RftResult {
  /** Best worst VSWR of the final ladder; null when no prototype gave a ladder. */
  readonly best: RftSolution | null;
  /** The best solution per number of zeros at DC, best first (all of `parts` parts). */
  readonly solutions: readonly RftSolution[];
  readonly parts: number;
  readonly frequencies: readonly number[];
  readonly scoringFrequencies: readonly number[];
  /** Worst VSWR with the prefix alone. */
  readonly baseline: number;
  /** Optimizations run, this degree and the lower ones of the continuation together. */
  readonly steps: number;
  /**
   * The run one part fewer that this one started from and is never worse than (null for one
   * part or without continuation): the same run as on its own, on the same grids.
   */
  readonly lower: RftResult | null;
  /** The part window: reactance from xLo to xHi ohm at f0, Hz. */
  readonly window: { readonly xLo: number; readonly xHi: number; readonly f0: number } | null;
}

const STAGES = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];
const ITERATIONS = 40;
/** Iterations of every stage but the last. */
const STAGE_ITERATIONS = 25;
/** Random starts carried past the first two stages (exact starts always go on). */
const KEEP = 3;
/** Solutions refined by the band optimizer. */
const POLISHED = 3;
/** The stage exact starts begin at: already near the worst point, so the least squares stages would only pull them away. */
const EXACT_FROM = 4;
/** Ends per prototype refined on the worst point itself, and the simplex iterations each. */
const MINIMAX_REFINED = 2;
const MINIMAX_ITERATIONS = 300;

function loadAt(load: LoadModel, f: number): Complex {
  return typeof load === 'function' ? load(f) : load;
}

function uniformBand(lo: number, hi: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => lo + ((hi - lo) * i) / (count - 1));
}

/** Normalized parts, source side first, of a ladder of L and C (load side first); null for any other part. */
function normalizedParts(
  elements: readonly Element[],
  r0: number,
  omega: number,
): NormalizedPart[] | null {
  const out: NormalizedPart[] = [];
  for (const el of elements) {
    if (el.kind !== 'L' && el.kind !== 'C') return null;
    const value = el.kind === 'L' ? (el.value * omega) / r0 : el.value * r0 * omega;
    if (!(value > 0) || !Number.isFinite(value)) return null;
    out.push({ orientation: el.orientation, kind: el.kind, value });
  }
  return out.reverse();
}

/**
 * The real frequency technique over the band `frequencies` (see the header):
 * for every prototype asked for, the gain of a degree `parts` equalizer
 * optimized for the flattest best level, synthesized as a ladder, checked
 * through the app's own cascade and polished inside the part window.
 */
export function realFrequencyMatch(frequencies: readonly number[], options: RftOptions): RftResult {
  const freqs = frequencies.filter((f) => f > 0 && Number.isFinite(f)).sort((a, b) => a - b);
  const n = Number.isFinite(options.parts)
    ? Math.min(RFT_MAX_PARTS, Math.max(1, Math.floor(options.parts)))
    : 1;
  const prefix = options.prefix ?? [];
  const r0 = options.z0;
  const target = complex(r0, 0);
  // The grids do not depend on the degree: the lower degrees run inside this one are then the
  // same runs as on their own, and the result never loses to them on the same band.
  const scoring = scoringFrequencies(freqs, prefix.length + RFT_MAX_PARTS);
  const baseline = worstVswr(prefix, options.load, r0, scoring, target);
  const empty: RftResult = {
    best: null,
    solutions: [],
    parts: n,
    frequencies: freqs,
    scoringFrequencies: scoring,
    baseline,
    steps: 0,
    lower: null,
    window: null,
  };
  const lo = freqs[0];
  const hi = freqs[freqs.length - 1];
  if (lo === undefined || hi === undefined || !(hi > lo) || !(r0 > 0)) return empty;
  // The geometric band centre; for a band of more than two octaves (a lowpass band from near DC)
  // half the upper edge, so the normalized band does not reach far above 1.
  const omega = 2 * Math.PI * (hi / lo > 4 ? hi / 2 : Math.sqrt(lo * hi));
  // The topology search's part window: reactance from Z0 / 25 to 10 Z0 at the band centre.
  const wz0 = options.windowZ0 !== undefined && options.windowZ0 > 0 ? options.windowZ0 : r0;
  const window = { xLo: wz0 / 25, xHi: 10 * wz0, f0: (lo + hi) / 2 };
  const boundOf = (el: Element) =>
    el.kind === 'L' || el.kind === 'C' ? parameterBound(el, wz0, window.f0) : null;
  const inWindow = (el: Element): boolean => {
    const b = boundOf(el);
    if (!b || (el.kind !== 'L' && el.kind !== 'C')) return true;
    return el.value >= b.lo * (1 - 1e-9) && el.value <= b.hi * (1 + 1e-9);
  };
  const clampToWindow = (el: Element): Element => {
    const b = boundOf(el);
    if (!b || (el.kind !== 'L' && el.kind !== 'C')) return el;
    return { ...el, value: Math.min(b.hi, Math.max(b.lo, el.value)) };
  };
  // The load as the equalizer sees it: through the prefix, normalized to R0.
  const zl = (f: number): Complex => {
    const z = throughAbcd(ladderAbcd(prefix, f), loadAt(options.load, f));
    return complex(z.re / r0, z.im / r0);
  };
  const opt = [...new Set([...freqs, ...uniformBand(lo, hi, 6 * RFT_MAX_PARTS + 1)])].sort(
    (a, b) => a - b,
  );
  const optW = opt.map((f) => (2 * Math.PI * f) / omega);
  const optZ = opt.map(zl);
  const scoreW = scoring.map((f) => (2 * Math.PI * f) / omega);
  const scoreZ = scoring.map(zl);
  /** 1 - |Gamma_in|^2 of a whole ladder (prefix included) on the scoring grid. */
  const gainsOf = (whole: readonly Element[]): number[] =>
    scoring.map((f) => {
      const zin = throughAbcd(ladderAbcd(whole, f), loadAt(options.load, f));
      const gam = cabs(cdiv(csub(zin, target), cadd(zin, target)));
      return Number.isFinite(gam) ? 1 - gam * gam : 0;
    });
  const gapOf = (a: readonly number[], b: readonly number[]): number =>
    a.reduce((m, t, i) => Math.max(m, Math.abs(t - (b[i] as number))), 0);
  const belevitchOf = (elements: readonly Element[]): Belevitch | null => {
    const parts = normalizedParts(elements, r0, omega);
    return parts ? ladderBelevitch(parts) : null;
  };
  const transformer = options.transformer ?? false;
  const ks = (options.zerosAtDc ?? Array.from({ length: n + 1 }, (_, k) => k)).filter(
    (k) => Number.isInteger(k) && k >= 0 && k <= n,
  );
  const configs: { k: number; order: ExtractionOrder }[] = [];
  for (const k of ks) {
    configs.push({ k, order: 'infinity-first' });
    if (k > 0 && k < n) configs.push({ k, order: 'zero-first' });
  }
  // The same answer for the same input: no root search starts from an earlier run.
  warmRoots.clear();
  const rand = seededRandom(options.seed ?? 20261028);
  const starts = Math.max(1, Math.floor(options.starts ?? 10));
  // Starts that compete in the first stages (the lower optimum with a part grown a little).
  const seeds: { k: number; h: number[] }[] = [...(options.seeds ?? [])].map((s) => ({
    k: s.k,
    h: [...s.h],
  }));
  // Exact starts, run through every later stage and never dropped: the given ladders, and the
  // lower result with the added part at zero (h (1 + 0 p): a zero at infinity) or nearly
  // (h (p + 1e-3): a zero at DC, which cannot be exactly zero for a strictly Hurwitz g).
  const exact: { k: number; h: number[] }[] = [];
  const given = (options.ladders ?? [])
    .filter((l) => l.length === n)
    .flatMap((l) => {
      const b = belevitchOf(l);
      return b ? [{ elements: l, b }] : [];
    });
  for (const { b } of given) exact.push({ k: b.k, h: [...b.h] });
  // Progress counts the optimizations of every degree run: the lower ones report with this
  // degree's added to their total, so the total never changes on the way.
  const report = options.onProgress;
  let base = 0;
  let lower: RftResult | null = null;
  if (n > 1 && (options.continuation ?? true)) {
    const asked = options.zerosAtDc;
    lower = realFrequencyMatch(freqs, {
      load: options.load,
      z0: options.z0,
      parts: n - 1,
      ...(options.prefix ? { prefix: options.prefix } : {}),
      ...(options.transformer !== undefined ? { transformer: options.transformer } : {}),
      ...(options.starts !== undefined ? { starts: options.starts } : {}),
      ...(options.seed !== undefined ? { seed: options.seed } : {}),
      ...(options.polish !== undefined ? { polish: options.polish } : {}),
      ...(options.windowZ0 !== undefined ? { windowZ0: options.windowZ0 } : {}),
      ...(options.ladders ? { ladders: options.ladders } : {}),
      ...(report
        ? {
            onProgress: (p: RftProgress) =>
              report({ done: p.done, total: p.total + configs.length }),
          }
        : {}),
      // The prototypes asked for and those one zero at DC short of them.
      ...(asked
        ? {
            zerosAtDc: [...new Set(asked.flatMap((k) => [k, k - 1]))].filter(
              (k) => k >= 0 && k <= n - 1,
            ),
          }
        : {}),
    });
    base = lower.steps;
    // The roots kept warm belong to the lower degree's last call; start this degree cold.
    warmRoots.clear();
    for (const s of lower.solutions) {
      const shapes = [s.belevitch.h];
      const built = belevitchOf(s.elements);
      if (built && built.k === s.zerosAtDc) shapes.unshift(built.h);
      shapes.forEach((h, i) => {
        exact.push({ k: s.zerosAtDc, h: pmul(h, [1, 0]) });
        if (Math.abs(h[0] as number) > 1e-9 * norm(h)) {
          exact.push({ k: s.zerosAtDc + 1, h: pmul(h, [1e-3, 1]) });
        }
        if (i === shapes.length - 1) {
          for (const e of [0.05, 0.3]) {
            seeds.push({ k: s.zerosAtDc, h: pmul(h, [1, e]) });
            seeds.push({ k: s.zerosAtDc + 1, h: pmul(h, [e, 1]) });
          }
        }
      });
    }
  }
  const solutions: RftSolution[] = [];
  let done = 0;
  for (const { k, order } of configs) {
    // Free coefficients of h: all but h(0) for lowpass and h_n for highpass without a transformer.
    const fixed = new Set<number>();
    if (!transformer && k === 0) fixed.add(0);
    if (!transformer && k === n) fixed.add(n);
    const free = Array.from({ length: n + 1 }, (_, i) => i).filter((i) => !fixed.has(i));
    const hOf = (x: readonly number[]): number[] => {
      const h = new Array<number>(n + 1).fill(0);
      free.forEach((i, j) => (h[i] = x[j] as number));
      return h;
    };
    const penalized = !transformer && k > 0 && k < n;
    const shapeOf = (x: readonly number[]): { b: Belevitch; t: number[] } | null => {
      const h = hOf(x);
      const g = hurwitzFactor(h, k);
      // A g of lower degree (h_n exactly 0) is the lower degree inside this one: kept, padded.
      if (!g || g.length > n + 1) return null;
      const b: Belevitch = { h, g: [...g, ...new Array<number>(n + 1 - g.length).fill(0)], k };
      return { b, t: optW.map((w, i) => belevitchGain(b, w, optZ[i] as Complex)) };
    };
    // |1 - T|: a gain above 1 is not physical, so it counts as a loss, never as a perfect point.
    const residualsFor =
      (m: number, rho: number, weight: number) =>
      (x: readonly number[]): number[] => {
        const s = shapeOf(x);
        const out = s ? s.t.map((t) => (Math.abs(1 - t) / rho) ** (m / 2)) : optW.map(() => 1e3);
        if (penalized) {
          const syn = s ? synthesizeLadder(s.b, order) : null;
          out.push(syn ? weight * Math.log(syn.termination) : 1e3);
        }
        return out;
      };
    const worstLoss = (x: readonly number[]): number => {
      const s = shapeOf(x);
      return s ? Math.max(...s.t.map((t) => Math.abs(1 - t))) : Infinity;
    };
    const run = (x0: readonly number[], stages: readonly number[], from: number): number[] => {
      let x = x0.slice();
      stages.forEach((m, i) => {
        const rho = Math.max(1e-12, Math.min(1, worstLoss(x)));
        const weight = 10 * 4 ** (from + i);
        const last = m === STAGES[STAGES.length - 1];
        x = levenbergMarquardt(
          residualsFor(m, Number.isFinite(rho) ? rho : 1, weight),
          x,
          last ? ITERATIONS : STAGE_ITERATIONS,
        );
      });
      return x;
    };
    const toX = (list: readonly { k: number; h: readonly number[] }[]): number[][] =>
      list
        .filter((s) => s.k === k && s.h.length === n + 1)
        .map((s) => free.map((i) => s.h[i] as number));
    const seeded = toX(seeds);
    const exactStarts = toX(exact);
    // A random start is a random alternating ladder without a transformer (k parts with a zero at
    // DC, values from 0.2 to 5) for a bandpass prototype: it starts where the penalty is met.
    const randomStart = (tries = 20): number[] => {
      if (!penalized) return free.map(() => 2 * rand() - 1);
      const atZero = new Set<number>();
      while (atZero.size < k) atZero.add(Math.floor(rand() * n));
      const seriesFirst = rand() < 0.5;
      const ladder: NormalizedPart[] = Array.from({ length: n }, (_, i) => {
        const orientation = (i % 2 === 0) === seriesFirst ? 'series' : 'shunt';
        const zero = atZero.has(i);
        const kind = (orientation === 'series') === zero ? 'C' : 'L';
        return { orientation, kind, value: Math.exp(Math.log(0.2) + rand() * Math.log(25)) };
      });
      const lb = ladderBelevitch(ladder);
      // A ladder whose parts merge at DC or at infinity (a capacitive T, say) has a lower degree.
      if (Math.abs(lb.g[0] as number) < 1e-9 || Math.abs(lb.g[n] as number) < 1e-9) {
        return tries > 0 ? randomStart(tries - 1) : free.map(() => 2 * rand() - 1);
      }
      return free.map((i) => lb.h[i] as number);
    };
    const firsts = [...seeded, ...Array.from({ length: starts }, () => randomStart())].map((x0) =>
      run(x0, STAGES.slice(0, 2), 0),
    );
    firsts.sort((a, b) => worstLoss(a) - worstLoss(b));
    const ends = [
      ...firsts.slice(0, KEEP).map((x0) => run(x0, STAGES.slice(2), 2)),
      ...exactStarts.map((x0) => run(x0, STAGES.slice(EXACT_FROM), EXACT_FROM)),
      // The exact starts as they are: an optimization never makes the result worse than its start.
      ...exactStarts,
    ];
    // The last stage of m only tends to the worst point; the best ends then go to the worst
    // point itself: a simplex on the largest |1 - T| (the termination held for a bandpass).
    const minimaxCost = (y: readonly number[]): number => {
      const worst = worstLoss(y);
      if (!Number.isFinite(worst) || !penalized) return worst;
      const s = shapeOf(y);
      const syn = s ? synthesizeLadder(s.b, order) : null;
      return syn ? worst + 100 * Math.abs(Math.log(syn.termination)) : Infinity;
    };
    const ranked = ends
      .map((x) => ({ x, cost: minimaxCost(x) }))
      .filter((e) => Number.isFinite(e.cost))
      .sort((a, b) => a.cost - b.cost);
    for (const { x, cost } of ranked.slice(0, MINIMAX_REFINED)) {
      const m = nelderMead(
        minimaxCost,
        x,
        x.map((v) => 0.01 * Math.max(Math.abs(v), 1e-3)),
        MINIMAX_ITERATIONS,
      );
      if (m.value < cost) ends.push(m.x);
    }
    let bestSolution: RftSolution | null = null;
    for (const x of ends) {
      const s = shapeOf(x);
      const syn = s ? synthesizeLadder(s.b, order) : null;
      if (!s || !syn || syn.parts.length !== n) continue;
      const sol = finish(s.b, syn, k, order, false);
      if (sol && (!bestSolution || sol.worstVswr < bestSolution.worstVswr)) bestSolution = sol;
    }
    if (bestSolution) solutions.push(bestSolution);
    report?.({ done: base + ++done, total: base + configs.length });
  }

  /** The gain shape of `b` on the scoring grid. */
  function shapeGain(b: Belevitch): { gain: number[]; minGain: number } {
    const gain = scoreW.map((w, i) => belevitchGain(b, w, scoreZ[i] as Complex));
    return { gain, minGain: Math.min(...gain) };
  }

  function finish(
    b: Belevitch,
    syn: Synthesis,
    k: number,
    order: ExtractionOrder,
    polish: boolean,
  ): RftSolution | null {
    const shape = { b, ...shapeGain(b) };
    const synthesized = ladderElements(syn, r0, omega, transformer);
    const whole = [...prefix, ...synthesized];
    const synthesisError = gapOf(gainsOf(whole), shape.gain);
    const synthesizedVswr = worstVswr(whole, options.load, r0, scoring, target);
    if (!Number.isFinite(synthesizedVswr) || synthesizedVswr >= OPTIMIZE_FAIL) return null;
    // A part outside the search's window is brought to its edge: the result is always a ladder
    // of parts the search would also allow, and it is scored (and ranked) as such.
    const clamped = synthesized.map(clampToWindow);
    const moved = !synthesized.every(inWindow);
    let elements: readonly Element[] = clamped;
    let worst = moved
      ? worstVswr([...prefix, ...clamped], options.load, r0, scoring, target)
      : synthesizedVswr;
    if (!Number.isFinite(worst) || worst >= OPTIMIZE_FAIL) return null;
    let polished = false;
    if (polish) {
      // The values are refined inside the part window (and within half to twice their start).
      const start = [...prefix, ...clamped];
      const indices = synthesized
        .map((el, i) => (el.kind === 'L' || el.kind === 'C' ? prefix.length + i : -1))
        .filter((i) => i >= 0);
      const centre = Math.sqrt((lo as number) * (hi as number));
      const r = optimizeBand(
        { z0: r0, frequency: centre, load: loadAt(options.load, centre), elements: start },
        scoring,
        {
          load: options.load,
          indices,
          bounds: Object.fromEntries(
            indices.map((i) => {
              const el = start[i] as Element & { value: number };
              const w = boundOf(el) as { lo: number; hi: number };
              return [i, { lo: Math.max(el.value / 2, w.lo), hi: Math.min(el.value * 2, w.hi) }];
            }),
          ),
          restarts: 0,
          iterations: 400,
          target,
          seed: options.seed ?? 20261028,
        },
      );
      if (r.after < worst - 1e-9) {
        elements = r.elements.slice(prefix.length);
        worst = r.after;
        polished = true;
      }
    }
    const ladderGain = gainsOf([...prefix, ...elements]);
    return {
      zerosAtDc: k,
      prototype: prototypeOf(k, n),
      order,
      belevitch: shape.b,
      r0,
      omega,
      gain: shape.gain,
      minGain: shape.minGain,
      shapeVswr: vswrOfGain(shape.minGain),
      termination: syn.termination,
      synthesized,
      synthesizedVswr,
      synthesisError,
      elements,
      worstVswr: worst,
      polished,
      ladderGain,
      shapeGap: gapOf(ladderGain, shape.gain),
      outsideWindow: elements.filter((el) => !inWindow(el)).length,
      source: 'shape',
    };
  }

  /** A given ladder (load side first, L and C only) as a result on this grid. */
  function fromLadder(elements: readonly Element[], source: RftSource): RftSolution | null {
    const b = belevitchOf(elements);
    if (!b) return null;
    const whole = [...prefix, ...elements];
    const worst = worstVswr(whole, options.load, r0, scoring, target);
    if (!Number.isFinite(worst) || worst >= OPTIMIZE_FAIL) return null;
    const { gain, minGain } = shapeGain(b);
    const ladderGain = gainsOf(whole);
    const gap = gapOf(ladderGain, gain);
    return {
      zerosAtDc: b.k,
      prototype: prototypeOf(b.k, elements.length),
      order: 'infinity-first',
      belevitch: b,
      r0,
      omega,
      gain,
      minGain,
      shapeVswr: vswrOfGain(minGain),
      termination: 1,
      synthesized: elements,
      synthesizedVswr: worst,
      synthesisError: gap,
      elements,
      worstVswr: worst,
      polished: false,
      ladderGain,
      shapeGap: gap,
      outsideWindow: elements.filter((el) => !inWindow(el)).length,
      source,
    };
  }

  // One per number of zeros at DC (the better extraction order), best first; the band optimizer
  // then refines the best POLISHED of them, the expensive step on the dense grid.
  const byK = new Map<number, RftSolution>();
  for (const s of solutions) {
    const was = byK.get(s.zerosAtDc);
    if (!was || s.worstVswr < was.worstVswr) byK.set(s.zerosAtDc, s);
  }
  const ranked = [...byK.values()].sort(
    (a, b) => a.worstVswr - b.worstVswr || a.zerosAtDc - b.zerosAtDc,
  );
  const finals = ranked.map((s, i) =>
    (options.polish ?? true) && i < POLISHED
      ? (finish(
          s.belevitch,
          synthesizeLadder(s.belevitch, s.order) as Synthesis,
          s.zerosAtDc,
          s.order,
          true,
        ) ?? s)
      : s,
  );
  // The given ladders are candidates as they are: the result is never worse than any of them.
  const perK = new Map<number, RftSolution>();
  for (const s of [...finals, ...given.flatMap((g) => fromLadder(g.elements, 'ladder') ?? [])]) {
    if (!ks.includes(s.zerosAtDc)) continue;
    const was = perK.get(s.zerosAtDc);
    if (!was || s.worstVswr < was.worstVswr) perK.set(s.zerosAtDc, s);
  }
  const all = [...perK.values()].sort(
    (a, b) => a.worstVswr - b.worstVswr || a.zerosAtDc - b.zerosAtDc,
  );
  let best = all[0] ?? null;
  // More parts are never worse: when no ladder of this degree beats the lower result (its ladder
  // scored on this grid), the lower result is the answer, with one part fewer.
  if (lower?.best && !options.zerosAtDc) {
    const kept = fromLadder(lower.best.elements, 'lower');
    if (kept && (!best || kept.worstVswr < best.worstVswr * (1 - 1e-9))) best = kept;
  }
  return { ...empty, best, solutions: all, steps: base + configs.length, lower, window };
}

/* ------------------------------------------------------------ the limit */

/** The Bode-Fano limit the real frequency result may be shown beside, or why there is none. */
export interface RftLimit {
  /** The limit to show; null when there is none to show. */
  readonly floor: Feasibility | null;
  /** Why no limit is shown, when one was computed or could not apply. */
  readonly note: string | null;
}

/** True when every part of the ladder is lossless at every frequency (A, D real; B, C imaginary). */
function losslessLadder(elements: readonly Element[], frequencies: readonly number[]): boolean {
  return frequencies.every((f) => {
    const m = ladderAbcd(elements, f);
    const scale = Math.max(cabs(m.a), cabs(m.b), cabs(m.c), cabs(m.d), 1e-300);
    const lossy = Math.max(Math.abs(m.a.im), Math.abs(m.b.re), Math.abs(m.c.re), Math.abs(m.d.im));
    return lossy <= 1e-9 * scale;
  });
}

/**
 * The Bode-Fano limit of the load over the result's grid, as the panel may
 * show it beside the result: the limit holds for lossless networks, so with
 * a kept part that has loss there is none; and a number that the ladder, the
 * kept parts alone or the bare load beats is not a limit for this load (an
 * estimate from the load Q can be off either way), so it is dropped with a
 * note rather than shown.
 */
export function rftBandLimit(
  result: RftResult,
  load: LoadModel,
  prefix: readonly Element[] = [],
): RftLimit {
  const grid = result.scoringFrequencies;
  if (prefix.length > 0 && !losslessLadder(prefix, grid)) {
    return {
      floor: null,
      note: 'the kept parts have loss, and the limit holds for lossless networks only',
    };
  }
  const floor = feasibility(load, grid);
  if (!floor) return { floor: null, note: null };
  const r0 = result.best?.r0 ?? null;
  const reached = [result.baseline, result.best?.worstVswr ?? Infinity];
  if (r0 !== null) reached.push(worstVswr([], load, r0, grid, complex(r0, 0)));
  const beaten = Math.min(...reached.filter((v) => Number.isFinite(v)));
  if (floor.floor > beaten * (1 + 1e-6)) {
    return {
      floor: null,
      note:
        floor.method === 'exact'
          ? 'the limit from the fitted model does not hold for this load'
          : 'the estimate does not hold for this load',
    };
  }
  return { floor, note: null };
}
