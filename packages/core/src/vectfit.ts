/**
 * Vector fitting: a complex frequency response known at N points turned into
 * a rational model
 *
 *     H(s) = sum_n r_n / (s - a_n) + d + s e
 *
 * with real or complex conjugate poles a_n, matching residues r_n and real d
 * and e. Gustavsen and Semlyen, "Rational approximation of frequency domain
 * responses by vector fitting", IEEE Trans. Power Delivery 14(3), 1999, with
 * the relaxed non-triviality constraint of Gustavsen, "Improving the pole
 * relocating properties of vector fitting", IEEE Trans. Power Delivery 21(3),
 * 2006.
 *
 * Method, per model order:
 *
 * - Starting poles: complex pairs a = -0.01 b + j b with b spread over the
 *   band, logarithmically when the band spans a decade or more, linearly
 *   otherwise; an odd order adds one real pole at the geometric band centre.
 * - Pole relocation: with the weighting function sigma(s) = sum rt_n /
 *   (s - a_n) + dt, the linear problem (sigma H)(s_k) = sigma(s_k) H(s_k)
 *   is solved in the least squares sense for the residues of both, with the
 *   relaxed constraint Re sum_k sigma(s_k) = N (dt is free, which keeps the
 *   iteration from the trivial solution and makes it converge faster than the
 *   1999 form with dt = 1). The zeros of sigma, the eigenvalues of
 *   A - b rt^T / dt, are the new poles. An unstable pole (positive real
 *   part) is flipped into the left half plane.
 * - Residue identification: with the poles fixed, the residues, d and e by
 *   linear least squares over all points.
 * - The relocation repeats until the RMS residual stops changing.
 *
 * The order is chosen from 2 upward until the RMS residual is below a target
 * or has not improved by 10 percent for three orders in a row, capped at
 * 2N/3 and at 30; the lowest order within 10 percent of the best RMS wins.
 *
 * Conditioning: the fit works in normalized frequency (s / 2 pi fmax), each
 * least squares column is scaled to unit norm before a Householder QR, and
 * the pole relocation uses at most IDENTIFY_POINTS evenly picked points (the
 * residues and the residual always use all of them).
 *
 * Passivity of a one-port reflection model (|Gamma(jw)| <= 1): see
 * enforceReflectionPassivity below.
 *
 * Pure TypeScript, no dependency beyond the complex helpers.
 */
import { complex, type Complex } from './complex.js';

/** A pole of the normalized model: im > 0 stands for the pair re +- j im, im = 0 for a real pole. */
interface PoleEntry {
  readonly re: number;
  readonly im: number;
}

/** The model in normalized frequency, s_n = j f / scale. */
interface NormalizedModel {
  readonly entries: readonly PoleEntry[];
  /** Two coefficients per pair (residue c1 + j c2), one per real pole. */
  readonly c: readonly number[];
  readonly d: number;
  readonly e: number;
  /** Hz. */
  readonly scale: number;
}

/** The rational model in physical units: s in rad/s. */
export interface RationalModel {
  /** Every pole, conjugates included (the one with positive imaginary part first), rad/s. */
  readonly poles: readonly Complex[];
  /** The residue of each pole, same order. */
  readonly residues: readonly Complex[];
  readonly d: number;
  /** Coefficient of s, per rad/s. */
  readonly e: number;
}

export interface PassivityReport {
  /** Largest |H| on the check grid before enforcement. */
  readonly maxBefore: number;
  /** Largest |H| on the check grid after enforcement. */
  readonly maxAfter: number;
  /** 'none': already passive; 'perturbation': residues moved; 'scaling': the whole model scaled down. */
  readonly method: 'none' | 'perturbation' | 'scaling';
  /** Perturbation steps taken. */
  readonly iterations: number;
  /** Lowest and highest frequency of the check grid, Hz. */
  readonly grid: readonly [number, number];
  /** Points of the check grid. */
  readonly points: number;
}

export interface VectorFit {
  readonly model: RationalModel;
  /** Number of poles. */
  readonly order: number;
  /** RMS of |H(f_k) - data_k| over the points. */
  readonly rms: number;
  /** Largest |H(f_k) - data_k|. */
  readonly maxResidual: number;
  /** Lowest and highest frequency of the data, Hz: where the model is valid. */
  readonly band: readonly [number, number];
  /** Points fitted. */
  readonly points: number;
  /** Pole relocation steps at the chosen order. */
  readonly iterations: number;
  /** Set when passivity was checked (fitReflection). */
  readonly passivity?: PassivityReport;
  /** H at f, Hz. */
  readonly evaluate: (f: number) => Complex;
  /** dH/df at f, per Hz. */
  readonly derivative: (f: number) => Complex;
}

export interface VectorFitOptions {
  /** A fixed order; otherwise the order is chosen automatically. */
  readonly order?: number;
  /** Lowest order tried automatically. Default 2. */
  readonly minOrder?: number;
  /** Highest order tried automatically; never above 2N/3 or 30. */
  readonly maxOrder?: number;
  /** RMS residual at which the automatic order search stops. Default 1e-6 times the RMS of the data. */
  readonly target?: number;
  /** Pole relocation steps per order at most. Default 20. */
  readonly iterations?: number;
  /** Which constant terms the model has: none, d, or d and e (default 'de'). */
  readonly asymptote?: 'none' | 'd' | 'de';
  /** Spacing of the starting poles; 'auto' (default) is logarithmic for a band of a decade or more. */
  readonly spacing?: 'auto' | 'log' | 'linear';
}

/** Highest order the automatic search goes to. */
export const MAX_FIT_ORDER = 30;
/** Points the pole relocation uses at most. */
const IDENTIFY_POINTS = 300;

export class VectorFitError extends Error {
  override readonly name = 'VectorFitError';
}

/* ------------------------------------------------------------ linear algebra */

/**
 * Least squares solution of A x = b (A is m x n, row major, m >= n) by
 * Householder QR with the columns scaled to unit norm. A column that is
 * numerically dependent on the earlier ones gets x = 0. A and b are
 * overwritten.
 */
export function leastSquares(a: Float64Array, m: number, n: number, b: Float64Array): Float64Array {
  const scale = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    let s = 0;
    for (let i = 0; i < m; i++) s += (a[i * n + j] as number) ** 2;
    s = Math.sqrt(s);
    scale[j] = s > 0 ? 1 / s : 0;
    for (let i = 0; i < m; i++) a[i * n + j] = (a[i * n + j] as number) * (scale[j] as number);
  }
  const diag = new Float64Array(n);
  const steps = Math.min(m, n);
  for (let k = 0; k < steps; k++) {
    let norm = 0;
    for (let i = k; i < m; i++) norm += (a[i * n + k] as number) ** 2;
    norm = Math.sqrt(norm);
    if (norm === 0) {
      diag[k] = 0;
      continue;
    }
    const akk = a[k * n + k] as number;
    const alpha = akk > 0 ? -norm : norm;
    // v = x - alpha e1, stored in place of column k.
    a[k * n + k] = akk - alpha;
    let vv = 0;
    for (let i = k; i < m; i++) vv += (a[i * n + k] as number) ** 2;
    diag[k] = alpha;
    if (vv === 0) continue;
    for (let j = k + 1; j < n; j++) {
      let dot = 0;
      for (let i = k; i < m; i++) dot += (a[i * n + k] as number) * (a[i * n + j] as number);
      const f = (2 * dot) / vv;
      for (let i = k; i < m; i++)
        a[i * n + j] = (a[i * n + j] as number) - f * (a[i * n + k] as number);
    }
    let dot = 0;
    for (let i = k; i < m; i++) dot += (a[i * n + k] as number) * (b[i] as number);
    const f = (2 * dot) / vv;
    for (let i = k; i < m; i++) b[i] = (b[i] as number) - f * (a[i * n + k] as number);
  }
  let rmax = 0;
  for (let k = 0; k < steps; k++) rmax = Math.max(rmax, Math.abs(diag[k] as number));
  const x = new Float64Array(n);
  for (let k = steps - 1; k >= 0; k--) {
    const r = diag[k] as number;
    if (!(Math.abs(r) > rmax * 1e-14)) {
      x[k] = 0;
      continue;
    }
    let s = b[k] as number;
    for (let j = k + 1; j < n; j++) s -= (a[k * n + j] as number) * (x[j] as number);
    x[k] = s / r;
  }
  for (let j = 0; j < n; j++) x[j] = (x[j] as number) * (scale[j] as number);
  return x;
}

/** Solve the small dense system A x = b by Gaussian elimination with partial pivoting; null when singular. */
function solveDense(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i] as number]);
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) {
      if (Math.abs((m[i] as number[])[k] as number) > Math.abs((m[p] as number[])[k] as number))
        p = i;
    }
    const pivot = (m[p] as number[])[k] as number;
    if (!(Math.abs(pivot) > 0) || !Number.isFinite(pivot)) return null;
    [m[k], m[p]] = [m[p] as number[], m[k] as number[]];
    const rk = m[k] as number[];
    for (let i = k + 1; i < n; i++) {
      const ri = m[i] as number[];
      const f = (ri[k] as number) / pivot;
      if (f === 0) continue;
      for (let j = k; j <= n; j++) ri[j] = (ri[j] as number) - f * (rk[j] as number);
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let k = n - 1; k >= 0; k--) {
    const rk = m[k] as number[];
    let s = rk[n] as number;
    for (let j = k + 1; j < n; j++) s -= (rk[j] as number) * (x[j] as number);
    x[k] = s / (rk[k] as number);
  }
  return x.every(Number.isFinite) ? x : null;
}

/**
 * Eigenvalues of a real square matrix (row major, n x n): balancing, reduction
 * to Hessenberg form by elimination and the shifted QR algorithm (the EISPACK
 * balanc, elmhes and hqr procedures). Complex eigenvalues come in conjugate
 * pairs. Throws VectorFitError when the QR iteration does not converge.
 */
export function realEigenvalues(matrix: Float64Array, n: number): Complex[] {
  // 1-based copy, as the classic procedures are written.
  const a: number[][] = [];
  for (let i = 0; i <= n; i++) a.push(new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= n; j++) (a[i] as number[])[j] = matrix[(i - 1) * n + (j - 1)] as number;
  const at = (i: number, j: number): number => (a[i] as number[])[j] as number;
  const put = (i: number, j: number, v: number): void => {
    (a[i] as number[])[j] = v;
  };

  // balanc
  const RADIX = 2;
  const sqrdx = RADIX * RADIX;
  let done = false;
  while (!done) {
    done = true;
    for (let i = 1; i <= n; i++) {
      let r = 0;
      let c = 0;
      for (let j = 1; j <= n; j++) {
        if (j !== i) {
          c += Math.abs(at(j, i));
          r += Math.abs(at(i, j));
        }
      }
      if (c && r) {
        let g = r / RADIX;
        let f = 1;
        const s = c + r;
        while (c < g) {
          f *= RADIX;
          c *= sqrdx;
        }
        g = r * RADIX;
        while (c > g) {
          f /= RADIX;
          c /= sqrdx;
        }
        if ((c + r) / f < 0.95 * s) {
          done = false;
          g = 1 / f;
          for (let j = 1; j <= n; j++) put(i, j, at(i, j) * g);
          for (let j = 1; j <= n; j++) put(j, i, at(j, i) * f);
        }
      }
    }
  }

  // elmhes
  for (let m = 2; m < n; m++) {
    let x = 0;
    let i = m;
    for (let j = m; j <= n; j++) {
      if (Math.abs(at(j, m - 1)) > Math.abs(x)) {
        x = at(j, m - 1);
        i = j;
      }
    }
    if (i !== m) {
      for (let j = m - 1; j <= n; j++) {
        const t = at(i, j);
        put(i, j, at(m, j));
        put(m, j, t);
      }
      for (let j = 1; j <= n; j++) {
        const t = at(j, i);
        put(j, i, at(j, m));
        put(j, m, t);
      }
    }
    if (x) {
      for (let ii = m + 1; ii <= n; ii++) {
        let y = at(ii, m - 1);
        if (y !== 0) {
          y /= x;
          put(ii, m - 1, y);
          for (let j = m; j <= n; j++) put(ii, j, at(ii, j) - y * at(m, j));
          for (let j = 1; j <= n; j++) put(j, m, at(j, m) + y * at(j, ii));
        }
      }
    }
  }
  for (let i = 1; i <= n; i++) for (let j = 1; j < i - 1; j++) put(i, j, 0);

  // hqr
  const wr = new Array<number>(n + 1).fill(0);
  const wi = new Array<number>(n + 1).fill(0);
  let anorm = 0;
  for (let i = 1; i <= n; i++)
    for (let j = Math.max(i - 1, 1); j <= n; j++) anorm += Math.abs(at(i, j));
  let nn = n;
  let t = 0;
  let p = 0;
  let q = 0;
  let r = 0;
  // Assigned before every use inside the iteration, as in the EISPACK original.
  let s: number;
  let w: number;
  let x: number;
  let y: number;
  let z: number;
  while (nn >= 1) {
    let its = 0;
    let l: number;
    do {
      for (l = nn; l >= 2; l--) {
        s = Math.abs(at(l - 1, l - 1)) + Math.abs(at(l, l));
        if (s === 0) s = anorm;
        if (Math.abs(at(l, l - 1)) + s === s) {
          put(l, l - 1, 0);
          break;
        }
      }
      x = at(nn, nn);
      if (l === nn) {
        wr[nn] = x + t;
        wi[nn] = 0;
        nn--;
      } else {
        y = at(nn - 1, nn - 1);
        w = at(nn, nn - 1) * at(nn - 1, nn);
        if (l === nn - 1) {
          p = 0.5 * (y - x);
          q = p * p + w;
          z = Math.sqrt(Math.abs(q));
          x += t;
          if (q >= 0) {
            z = p + (p >= 0 ? Math.abs(z) : -Math.abs(z));
            wr[nn - 1] = wr[nn] = x + z;
            if (z) wr[nn] = x - w / z;
            wi[nn - 1] = wi[nn] = 0;
          } else {
            wr[nn - 1] = wr[nn] = x + p;
            wi[nn] = z;
            wi[nn - 1] = -z;
          }
          nn -= 2;
        } else {
          if (its === 60) throw new VectorFitError('The eigenvalue iteration did not converge');
          if (its === 10 || its === 20 || its === 40) {
            t += x;
            for (let i = 1; i <= nn; i++) put(i, i, at(i, i) - x);
            s = Math.abs(at(nn, nn - 1)) + Math.abs(at(nn - 1, nn - 2));
            y = x = 0.75 * s;
            w = -0.4375 * s * s;
          }
          ++its;
          let m: number;
          for (m = nn - 2; m >= l; m--) {
            z = at(m, m);
            r = x - z;
            s = y - z;
            p = (r * s - w) / at(m + 1, m) + at(m, m + 1);
            q = at(m + 1, m + 1) - z - r - s;
            r = at(m + 2, m + 1);
            s = Math.abs(p) + Math.abs(q) + Math.abs(r);
            p /= s;
            q /= s;
            r /= s;
            if (m === l) break;
            const u = Math.abs(at(m, m - 1)) * (Math.abs(q) + Math.abs(r));
            const v =
              Math.abs(p) * (Math.abs(at(m - 1, m - 1)) + Math.abs(z) + Math.abs(at(m + 1, m + 1)));
            if (u + v === v) break;
          }
          for (let i = m + 2; i <= nn; i++) {
            put(i, i - 2, 0);
            if (i !== m + 2) put(i, i - 3, 0);
          }
          for (let k = m; k <= nn - 1; k++) {
            if (k !== m) {
              p = at(k, k - 1);
              q = at(k + 1, k - 1);
              r = 0;
              if (k !== nn - 1) r = at(k + 2, k - 1);
              x = Math.abs(p) + Math.abs(q) + Math.abs(r);
              if (x !== 0) {
                p /= x;
                q /= x;
                r /= x;
              }
            }
            const norm = Math.sqrt(p * p + q * q + r * r);
            s = p >= 0 ? norm : -norm;
            if (s !== 0) {
              if (k === m) {
                if (l !== m) put(k, k - 1, -at(k, k - 1));
              } else {
                put(k, k - 1, -s * x);
              }
              p += s;
              x = p / s;
              y = q / s;
              z = r / s;
              q /= p;
              r /= p;
              for (let j = k; j <= nn; j++) {
                p = at(k, j) + q * at(k + 1, j);
                if (k !== nn - 1) {
                  p += r * at(k + 2, j);
                  put(k + 2, j, at(k + 2, j) - p * z);
                }
                put(k + 1, j, at(k + 1, j) - p * y);
                put(k, j, at(k, j) - p * x);
              }
              const mmin = nn < k + 3 ? nn : k + 3;
              for (let i = l; i <= mmin; i++) {
                p = x * at(i, k) + y * at(i, k + 1);
                if (k !== nn - 1) {
                  p += z * at(i, k + 2);
                  put(i, k + 2, at(i, k + 2) - p * r);
                }
                put(i, k + 1, at(i, k + 1) - p * q);
                put(i, k, at(i, k) - p);
              }
            }
          }
        }
      }
    } while (l < nn - 1);
  }
  const out: Complex[] = [];
  for (let i = 1; i <= n; i++) out.push(complex(wr[i] as number, wi[i] as number));
  if (!out.every((c) => Number.isFinite(c.re) && Number.isFinite(c.im))) {
    throw new VectorFitError('The eigenvalues are not finite');
  }
  return out;
}

/* ----------------------------------------------------------------- the model */

/** Number of poles the entries stand for. */
function orderOf(entries: readonly PoleEntry[]): number {
  return entries.reduce((n, p) => n + (p.im > 0 ? 2 : 1), 0);
}

/**
 * The basis functions at normalized s = j x, column by column (one per real
 * pole, two per pair: 1/(s-a) + 1/(s-a*) and j/(s-a) - j/(s-a*)), as real and
 * imaginary parts.
 */
function basisRow(
  entries: readonly PoleEntry[],
  x: number,
  re: Float64Array,
  im: Float64Array,
): void {
  let col = 0;
  for (const p of entries) {
    if (p.im > 0) {
      // 1/(s - a) with s = jx: (-ar - j(x - ai)) / (ar^2 + (x - ai)^2)
      const d1 = p.re * p.re + (x - p.im) ** 2;
      const u1r = -p.re / d1;
      const u1i = -(x - p.im) / d1;
      const d2 = p.re * p.re + (x + p.im) ** 2;
      const u2r = -p.re / d2;
      const u2i = -(x + p.im) / d2;
      re[col] = u1r + u2r;
      im[col] = u1i + u2i;
      // j (u1 - u2)
      re[col + 1] = -(u1i - u2i);
      im[col + 1] = u1r - u2r;
      col += 2;
    } else {
      const d = p.re * p.re + x * x;
      re[col] = -p.re / d;
      im[col] = -x / d;
      col += 1;
    }
  }
}

function evaluateNormalized(m: NormalizedModel, x: number): Complex {
  let re = m.d;
  let im = m.e * x;
  let k = 0;
  for (const p of m.entries) {
    if (p.im > 0) {
      const c1 = m.c[k] as number;
      const c2 = m.c[k + 1] as number;
      // (c1 + j c2) / (jx - a) + (c1 - j c2) / (jx - a*)
      const d1 = p.re * p.re + (x - p.im) ** 2;
      const u1r = -p.re / d1;
      const u1i = -(x - p.im) / d1;
      const d2 = p.re * p.re + (x + p.im) ** 2;
      const u2r = -p.re / d2;
      const u2i = -(x + p.im) / d2;
      re += c1 * u1r - c2 * u1i + c1 * u2r + c2 * u2i;
      im += c1 * u1i + c2 * u1r + c1 * u2i - c2 * u2r;
      k += 2;
    } else {
      const c = m.c[k] as number;
      const d = p.re * p.re + x * x;
      re += (c * -p.re) / d;
      im += (c * -x) / d;
      k += 1;
    }
  }
  return complex(re, im);
}

/** dH/ds_n at s_n = j x. */
function derivativeNormalized(m: NormalizedModel, x: number): Complex {
  let re = m.e;
  let im = 0;
  let k = 0;
  // -r / (s - a)^2 for each pole.
  const add = (rr: number, ri: number, ar: number, ai: number): void => {
    // s - a = -ar + j(x - ai)
    const ur = -ar;
    const ui = x - ai;
    const sqr = ur * ur - ui * ui;
    const sqi = 2 * ur * ui;
    const den = sqr * sqr + sqi * sqi;
    // r / sq
    const qr = (rr * sqr + ri * sqi) / den;
    const qi = (ri * sqr - rr * sqi) / den;
    re -= qr;
    im -= qi;
  };
  for (const p of m.entries) {
    if (p.im > 0) {
      const c1 = m.c[k] as number;
      const c2 = m.c[k + 1] as number;
      add(c1, c2, p.re, p.im);
      add(c1, -c2, p.re, -p.im);
      k += 2;
    } else {
      add(m.c[k] as number, 0, p.re, 0);
      k += 1;
    }
  }
  return complex(re, im);
}

function physical(m: NormalizedModel): RationalModel {
  const wn = 2 * Math.PI * m.scale;
  const poles: Complex[] = [];
  const residues: Complex[] = [];
  let k = 0;
  for (const p of m.entries) {
    if (p.im > 0) {
      const c1 = m.c[k] as number;
      const c2 = m.c[k + 1] as number;
      poles.push(complex(p.re * wn, p.im * wn), complex(p.re * wn, -p.im * wn));
      residues.push(complex(c1 * wn, c2 * wn), complex(c1 * wn, -c2 * wn));
      k += 2;
    } else {
      poles.push(complex(p.re * wn, 0));
      residues.push(complex((m.c[k] as number) * wn, 0));
      k += 1;
    }
  }
  return { poles, residues, d: m.d, e: m.e / wn };
}

/* ---------------------------------------------------------------- the fitting */

interface Samples {
  /** Normalized frequencies f / scale. */
  readonly x: readonly number[];
  readonly hr: readonly number[];
  readonly hi: readonly number[];
}

function startingPoles(order: number, xlo: number, xhi: number, log: boolean): PoleEntry[] {
  const pairs = Math.floor(order / 2);
  const out: PoleEntry[] = [];
  for (let i = 0; i < pairs; i++) {
    const t = pairs === 1 ? 0.5 : i / (pairs - 1);
    const b = log ? xlo * (xhi / xlo) ** t : xlo + t * (xhi - xlo);
    out.push({ re: -0.01 * b, im: b });
  }
  if (order % 2 === 1) out.push({ re: -Math.sqrt(xlo * xhi), im: 0 });
  return out;
}

/** The poles stable: a pole in the right half plane is mirrored into the left. */
function stabilize(poles: readonly Complex[], xhi: number): PoleEntry[] {
  const out: PoleEntry[] = [];
  for (const p of poles) {
    if (p.im < 0) continue;
    let re = p.re > 0 ? -p.re : p.re;
    // A pole exactly on the axis is moved off it by a hair, so the basis stays finite.
    if (re === 0) re = -1e-12 * Math.max(Math.abs(p.im), xhi);
    out.push({ re, im: p.im });
  }
  return out;
}

const TOL_LOW = 1e-18;
const TOL_HIGH = 1e18;

/** One pole relocation step: the zeros of sigma become the new poles. */
function relocate(
  entries: readonly PoleEntry[],
  data: Samples,
  withD: boolean,
  withE: boolean,
  xhi: number,
): PoleEntry[] {
  const n = orderOf(entries);
  const k = data.x.length;
  const nc = n + (withD ? 1 : 0) + (withE ? 1 : 0);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  let hnorm = 0;
  for (let i = 0; i < k; i++) hnorm += (data.hr[i] as number) ** 2 + (data.hi[i] as number) ** 2;
  const weight = Math.sqrt(hnorm) / k || 1;

  const build = (
    relaxed: boolean,
  ): { a: Float64Array; b: Float64Array; rows: number; cols: number } => {
    const cols = nc + n + (relaxed ? 1 : 0);
    const rows = 2 * k + (relaxed ? 1 : 0);
    const a = new Float64Array(rows * cols);
    const b = new Float64Array(rows);
    for (let i = 0; i < k; i++) {
      basisRow(entries, data.x[i] as number, re, im);
      const hr = data.hr[i] as number;
      const hi = data.hi[i] as number;
      const r0 = 2 * i * cols;
      const r1 = (2 * i + 1) * cols;
      for (let j = 0; j < n; j++) {
        a[r0 + j] = re[j] as number;
        a[r1 + j] = im[j] as number;
        // -H phi
        a[r0 + nc + j] = -(hr * (re[j] as number) - hi * (im[j] as number));
        a[r1 + nc + j] = -(hr * (im[j] as number) + hi * (re[j] as number));
      }
      let c = n;
      if (withD) {
        a[r0 + c] = 1;
        a[r1 + c] = 0;
        c++;
      }
      if (withE) {
        a[r0 + c] = 0;
        a[r1 + c] = data.x[i] as number;
      }
      if (relaxed) {
        a[r0 + cols - 1] = -hr;
        a[r1 + cols - 1] = -hi;
      }
    }
    if (relaxed) {
      // Re sum_k sigma(s_k) = k, weighted like the data rows.
      const r = 2 * k * cols;
      for (let i = 0; i < k; i++) {
        basisRow(entries, data.x[i] as number, re, im);
        for (let j = 0; j < n; j++)
          a[r + nc + j] = (a[r + nc + j] as number) + weight * (re[j] as number);
      }
      a[r + cols - 1] = weight * k;
      b[2 * k] = weight * k;
    }
    return { a, b, rows, cols };
  };

  const relaxed = build(true);
  let sol = leastSquares(relaxed.a, relaxed.rows, relaxed.cols, relaxed.b);
  let dt = sol[relaxed.cols - 1] as number;
  let ct = sol.slice(nc, nc + n);
  if (!(Math.abs(dt) >= TOL_LOW && Math.abs(dt) <= TOL_HIGH)) {
    // sigma's constant came out degenerate: fix it and solve the 1999 form.
    dt =
      dt === 0 || !Number.isFinite(dt)
        ? TOL_LOW
        : Math.abs(dt) < TOL_LOW
          ? Math.sign(dt) * TOL_LOW
          : Math.sign(dt) * TOL_HIGH;
    const fixed = build(false);
    for (let i = 0; i < k; i++) {
      fixed.b[2 * i] = (data.hr[i] as number) * dt;
      fixed.b[2 * i + 1] = (data.hi[i] as number) * dt;
    }
    sol = leastSquares(fixed.a, fixed.rows, fixed.cols, fixed.b);
    ct = sol.slice(nc, nc + n);
  }
  if (!ct.every(Number.isFinite) || !Number.isFinite(dt)) {
    throw new VectorFitError('The pole relocation has no finite solution');
  }
  // H = A - b ct^T / dt in the real form of the basis.
  const h = new Float64Array(n * n);
  const bv = new Float64Array(n);
  let col = 0;
  for (const p of entries) {
    if (p.im > 0) {
      h[col * n + col] = p.re;
      h[col * n + col + 1] = p.im;
      h[(col + 1) * n + col] = -p.im;
      h[(col + 1) * n + col + 1] = p.re;
      bv[col] = 2;
      bv[col + 1] = 0;
      col += 2;
    } else {
      h[col * n + col] = p.re;
      bv[col] = 1;
      col += 1;
    }
  }
  for (let i = 0; i < n; i++) {
    const bi = bv[i] as number;
    if (bi === 0) continue;
    for (let j = 0; j < n; j++)
      h[i * n + j] = (h[i * n + j] as number) - (bi * (ct[j] as number)) / dt;
  }
  return stabilize(realEigenvalues(h, n), xhi);
}

/** Residues, d and e for fixed poles, with the RMS and largest residual over all points. */
function identifyResidues(
  entries: readonly PoleEntry[],
  data: Samples,
  withD: boolean,
  withE: boolean,
  scale: number,
): { model: NormalizedModel; rms: number; max: number } {
  const n = orderOf(entries);
  const k = data.x.length;
  const cols = n + (withD ? 1 : 0) + (withE ? 1 : 0);
  const rows = 2 * k;
  const a = new Float64Array(rows * cols);
  const b = new Float64Array(rows);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < k; i++) {
    basisRow(entries, data.x[i] as number, re, im);
    const r0 = 2 * i * cols;
    const r1 = (2 * i + 1) * cols;
    for (let j = 0; j < n; j++) {
      a[r0 + j] = re[j] as number;
      a[r1 + j] = im[j] as number;
    }
    let c = n;
    if (withD) {
      a[r0 + c] = 1;
      c++;
    }
    if (withE) a[r1 + c] = data.x[i] as number;
    b[2 * i] = data.hr[i] as number;
    b[2 * i + 1] = data.hi[i] as number;
  }
  const x = leastSquares(a, rows, cols, b);
  if (!x.every(Number.isFinite)) throw new VectorFitError('The residues are not finite');
  const model: NormalizedModel = {
    entries,
    c: Array.from(x.slice(0, n)),
    d: withD ? (x[n] as number) : 0,
    e: withE ? (x[n + (withD ? 1 : 0)] as number) : 0,
    scale,
  };
  const { rms, max } = residualOf(model, data);
  return { model, rms, max };
}

function residualOf(model: NormalizedModel, data: Samples): { rms: number; max: number } {
  let sum = 0;
  let max = 0;
  for (let i = 0; i < data.x.length; i++) {
    const v = evaluateNormalized(model, data.x[i] as number);
    const e = Math.hypot(v.re - (data.hr[i] as number), v.im - (data.hi[i] as number));
    sum += e * e;
    if (e > max) max = e;
  }
  const rms = Math.sqrt(sum / data.x.length);
  return { rms: Number.isFinite(rms) ? rms : Infinity, max: Number.isFinite(max) ? max : Infinity };
}

/** Evenly picked samples for the pole relocation. */
function subsample(data: Samples, count: number): Samples {
  const k = data.x.length;
  if (k <= count) return data;
  const idx: number[] = [];
  for (let i = 0; i < count; i++) idx.push(Math.round((i * (k - 1)) / (count - 1)));
  return {
    x: idx.map((i) => data.x[i] as number),
    hr: idx.map((i) => data.hr[i] as number),
    hi: idx.map((i) => data.hi[i] as number),
  };
}

interface OrderFit {
  readonly model: NormalizedModel;
  readonly rms: number;
  readonly max: number;
  readonly iterations: number;
}

function fitOrder(
  order: number,
  data: Samples,
  ident: Samples,
  withD: boolean,
  withE: boolean,
  log: boolean,
  iterations: number,
  scale: number,
): OrderFit | null {
  const xlo = data.x[0] as number;
  const xhi = data.x[data.x.length - 1] as number;
  let entries = startingPoles(order, xlo, xhi, log);
  let best: OrderFit | null = null;
  let previous = Infinity;
  for (let it = 1; it <= iterations; it++) {
    try {
      entries = relocate(entries, ident, withD, withE, xhi);
      const got = identifyResidues(entries, data, withD, withE, scale);
      if (!best || got.rms < best.rms) best = { ...got, iterations: it };
      // Converged: the residual no longer moves (or there is nothing left to fit).
      if (it >= 3 && Math.abs(previous - got.rms) <= 1e-6 * previous) break;
      if (got.rms === 0) break;
      previous = got.rms;
    } catch (err) {
      if (err instanceof VectorFitError) break;
      throw err;
    }
  }
  return best;
}

function finish(
  model: NormalizedModel,
  rms: number,
  max: number,
  data: Samples,
  iterations: number,
  band: readonly [number, number],
): VectorFit {
  const scale = model.scale;
  return {
    model: physical(model),
    order: orderOf(model.entries),
    rms,
    maxResidual: max,
    band,
    points: data.x.length,
    iterations,
    evaluate: (f: number) => evaluateNormalized(model, f / scale),
    derivative: (f: number) => {
      const d = derivativeNormalized(model, f / scale);
      // d/df = (j / scale) d/ds_n
      return complex(-d.im / scale, d.re / scale);
    },
  };
}

/** The samples sorted by frequency, the non-finite and non-positive dropped, a repeated frequency kept once. */
function cleanSamples(
  frequencies: readonly number[],
  values: readonly Complex[],
): { f: number[]; v: Complex[] } {
  const pairs: { f: number; v: Complex }[] = [];
  const n = Math.min(frequencies.length, values.length);
  for (let i = 0; i < n; i++) {
    const f = frequencies[i] as number;
    const v = values[i] as Complex;
    if (f > 0 && Number.isFinite(f) && Number.isFinite(v.re) && Number.isFinite(v.im)) {
      pairs.push({ f, v });
    }
  }
  pairs.sort((a, b) => a.f - b.f);
  const out: { f: number[]; v: Complex[] } = { f: [], v: [] };
  for (const p of pairs) {
    if (out.f.length > 0 && out.f[out.f.length - 1] === p.f) continue;
    out.f.push(p.f);
    out.v.push(p.v);
  }
  return out;
}

/** Highest order the automatic search may use for `points` samples. */
export function maxFitOrder(points: number): number {
  return Math.max(0, Math.min(MAX_FIT_ORDER, Math.floor((2 * points) / 3)));
}

/**
 * Fit a rational model to the response `values` at `frequencies` (Hz). See the
 * header for the method. Throws VectorFitError when the data cannot be fitted
 * (fewer than three distinct points, or no order gave a finite model).
 */
export function vectorFit(
  frequencies: readonly number[],
  values: readonly Complex[],
  options: VectorFitOptions = {},
): VectorFit {
  const clean = cleanSamples(frequencies, values);
  const k = clean.f.length;
  if (k < 3) throw new VectorFitError('Vector fitting needs at least three distinct frequencies');
  const lo = clean.f[0] as number;
  const hi = clean.f[k - 1] as number;
  const scale = hi;
  const data: Samples = {
    x: clean.f.map((f) => f / scale),
    hr: clean.v.map((v) => v.re),
    hi: clean.v.map((v) => v.im),
  };
  const ident = subsample(data, IDENTIFY_POINTS);
  const asym = options.asymptote ?? 'de';
  const withD = asym !== 'none';
  const withE = asym === 'de';
  const spacing = options.spacing ?? 'auto';
  const log = spacing === 'log' || (spacing === 'auto' && hi / lo >= 10);
  const iterations = Math.max(1, Math.floor(options.iterations ?? 20));
  const cap = maxFitOrder(k);
  const band: readonly [number, number] = [lo, hi];

  if (options.order !== undefined) {
    const order = Math.max(
      1,
      Math.min(Math.floor(options.order), Math.max(1, k - 1), MAX_FIT_ORDER),
    );
    const got = fitOrder(order, data, ident, withD, withE, log, iterations, scale);
    if (!got) throw new VectorFitError(`No finite model of order ${order}`);
    return finish(got.model, got.rms, got.max, data, got.iterations, band);
  }

  let dataRms = 0;
  for (let i = 0; i < k; i++) dataRms += (data.hr[i] as number) ** 2 + (data.hi[i] as number) ** 2;
  dataRms = Math.sqrt(dataRms / k);
  const target = options.target ?? 1e-6 * dataRms;
  const minOrder = Math.max(1, Math.floor(options.minOrder ?? 2));
  const maxOrder = Math.min(cap, Math.floor(options.maxOrder ?? cap));
  const fits: { order: number; fit: OrderFit }[] = [];
  let bestRms = Infinity;
  let stale = 0;
  for (let order = minOrder; order <= maxOrder; order++) {
    const got = fitOrder(order, data, ident, withD, withE, log, iterations, scale);
    if (!got) continue;
    fits.push({ order, fit: got });
    if (got.rms <= target) break;
    if (got.rms < 0.9 * bestRms) stale = 0;
    else stale++;
    bestRms = Math.min(bestRms, got.rms);
    if (stale >= 3) break;
  }
  if (fits.length === 0) throw new VectorFitError('No order gave a finite model');
  const minRms = Math.min(...fits.map((f) => f.fit.rms));
  const chosen =
    fits.find((f) => f.fit.rms <= target) ??
    fits.find((f) => f.fit.rms <= 1.1 * minRms) ??
    (fits[0] as { order: number; fit: OrderFit });
  return finish(
    chosen.fit.model,
    chosen.fit.rms,
    chosen.fit.max,
    data,
    chosen.fit.iterations,
    band,
  );
}

/* ------------------------------------------------------------------ passivity
 *
 * A reflection coefficient of a passive one-port has |Gamma(jw)| <= 1. A fit
 * of measured data can break that slightly (noise on a low-loss load sits on
 * the rim of the chart, and the fit follows it), and a model that reflects
 * more than it receives makes the band tools promise matches that do not
 * exist. Method: iterative residue perturbation.
 *
 * - Evaluate |Gamma| on a dense check grid over the band and 10 percent past
 *   each end (the band tools use the model 5 percent past the data), and
 *   refine every local maximum of the grid by a golden-section search
 *   between its neighbours.
 * - At the local maxima of the violations (at most as many as there are free
 *   coefficients, worst first) ask for |Gamma| = 1 - 1e-10, linearized:
 *   Re(conj(u_i) dGamma_i) = 1 - 1e-10 - |Gamma_i| with u_i = Gamma_i / |Gamma_i|.
 * - Among the residue and d changes that meet those equalities, take the one
 *   that changes the model least over the data points (a weighted minimum
 *   norm solution), apply it, and check again; up to 50 times.
 * - If violations remain, scale the whole model by (1 - 1e-12) / max |Gamma|,
 *   which is passive on the grid by construction (and moves the fit by the
 *   size of the violation).
 *
 * Limits: passivity is checked at the refined grid maxima only, not proven
 * between them or beyond the grid (a resonance so narrow that it raises no
 * grid point above its neighbours is missed; the grid has 20 points per data
 * point and at least 2001);
 * the poles are not moved, so a violation the residues cannot remove ends in
 * the scaling; the perturbation adds to the fit's residual, which is
 * reported after enforcement.
 */

export interface PassivityOptions {
  /** Points of the check grid. Default max(2001, 20 per data point). */
  readonly points?: number;
  /** How far past the data the grid reaches, as a fraction of the band edges. Default 0.1. */
  readonly margin?: number;
}

/**
 * The local maxima of |H| over the grid, each refined by a golden-section
 * search between its two neighbours, so a peak narrower than the grid
 * spacing is measured at its top rather than at the nearest grid point.
 */
function peaksOf(
  m: NormalizedModel,
  grid: readonly number[],
): { x: number; v: Complex; a: number }[] {
  const mag = (x: number): number => {
    const v = evaluateNormalized(m, x);
    return Math.hypot(v.re, v.im);
  };
  const a = grid.map(mag);
  const out: { x: number; v: Complex; a: number }[] = [];
  const phi = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < grid.length; i++) {
    const ai = a[i] as number;
    const left = i > 0 ? (a[i - 1] as number) : -Infinity;
    const right = i < grid.length - 1 ? (a[i + 1] as number) : -Infinity;
    if (!(ai >= left && ai >= right) || !Number.isFinite(ai)) {
      if (!Number.isFinite(ai))
        out.push({ x: grid[i] as number, v: complex(Infinity, 0), a: Infinity });
      continue;
    }
    let lo = grid[Math.max(0, i - 1)] as number;
    let hi = grid[Math.min(grid.length - 1, i + 1)] as number;
    let bestX = grid[i] as number;
    let best = ai;
    if (hi > lo) {
      let x1 = hi - phi * (hi - lo);
      let x2 = lo + phi * (hi - lo);
      let f1 = mag(x1);
      let f2 = mag(x2);
      for (let k = 0; k < 40; k++) {
        if (f1 > f2) {
          hi = x2;
          x2 = x1;
          f2 = f1;
          x1 = hi - phi * (hi - lo);
          f1 = mag(x1);
        } else {
          lo = x1;
          x1 = x2;
          f1 = f2;
          x2 = lo + phi * (hi - lo);
          f2 = mag(x2);
        }
      }
      for (const [x, f] of [
        [x1, f1],
        [x2, f2],
      ] as const) {
        if (f > best) {
          best = f;
          bestX = x;
        }
      }
    }
    out.push({ x: bestX, v: evaluateNormalized(m, bestX), a: best });
  }
  return out;
}

function enforceOnModel(
  model: NormalizedModel,
  data: Samples,
  grid: readonly number[],
): { model: NormalizedModel; report: Omit<PassivityReport, 'grid' | 'points'> } {
  const n = orderOf(model.entries);
  const unknowns = n + 1; // residues and d
  const maxAbs = (m: NormalizedModel): number =>
    peaksOf(m, grid).reduce((worst, p) => (p.a <= worst ? worst : p.a), 0);
  const maxBefore = maxAbs(model);
  if (maxBefore <= 1) {
    return { model, report: { maxBefore, maxAfter: maxBefore, method: 'none', iterations: 0 } };
  }

  // The quadratic form of the change over the data points: Q = M^T M (+ a small ridge).
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const q: number[][] = Array.from({ length: unknowns }, () => new Array<number>(unknowns).fill(0));
  for (const x of data.x) {
    basisRow(model.entries, x, re, im);
    const rowRe = [...re, 1];
    const rowIm = [...im, 0];
    for (let i = 0; i < unknowns; i++) {
      for (let j = 0; j < unknowns; j++) {
        (q[i] as number[])[j] =
          ((q[i] as number[])[j] as number) +
          (rowRe[i] as number) * (rowRe[j] as number) +
          (rowIm[i] as number) * (rowIm[j] as number);
      }
    }
  }
  let trace = 0;
  for (let i = 0; i < unknowns; i++) trace += (q[i] as number[])[i] as number;
  const ridge = (1e-12 * trace) / unknowns || 1e-12;
  for (let i = 0; i < unknowns; i++)
    (q[i] as number[])[i] = ((q[i] as number[])[i] as number) + ridge;

  let current = model;
  let iterations = 0;
  for (let it = 0; it < 50; it++) {
    const all = peaksOf(current, grid);
    const worst = all.reduce((m, p) => Math.max(m, p.a), 0);
    if (worst <= 1) break;
    iterations++;
    // The violating maxima, worst first.
    const peaks = all
      .filter((p) => p.a > 1 - 1e-10)
      .sort((a, b) => b.a - a.a)
      .slice(0, Math.max(1, unknowns - 1));
    // Constraint rows B (peaks x unknowns) and targets t.
    const rows: number[][] = [];
    const t: number[] = [];
    for (const p of peaks) {
      basisRow(current.entries, p.x, re, im);
      const ur = p.v.re / p.a;
      const ui = p.v.im / p.a;
      // Re(conj(u) * (phi dc + dd)) = ur Re(.) + ui Im(.)
      const row = new Array<number>(unknowns).fill(0);
      for (let j = 0; j < n; j++) row[j] = ur * (re[j] as number) + ui * (im[j] as number);
      row[n] = ur;
      rows.push(row);
      t.push(1 - 1e-10 - p.a);
    }
    // dx = Q^-1 B^T (B Q^-1 B^T)^-1 t
    const qInvBt: number[][] = [];
    let ok = true;
    for (const row of rows) {
      const col = solveDense(q, row);
      if (!col) {
        ok = false;
        break;
      }
      qInvBt.push(col);
    }
    if (!ok) break;
    const g: number[][] = rows.map((ri) =>
      qInvBt.map((cj) => ri.reduce((s, v, k) => s + v * (cj[k] as number), 0)),
    );
    const lambda = solveDense(g, t);
    if (!lambda) break;
    const dx = new Array<number>(unknowns).fill(0);
    qInvBt.forEach((col, i) => {
      for (let k = 0; k < unknowns; k++)
        dx[k] = (dx[k] as number) + (lambda[i] as number) * (col[k] as number);
    });
    if (!dx.every(Number.isFinite)) break;
    current = {
      ...current,
      c: current.c.map((c, i) => c + (dx[i] as number)),
      d: current.d + (dx[n] as number),
    };
  }
  let maxAfter = maxAbs(current);
  let method: PassivityReport['method'] = 'perturbation';
  if (!(maxAfter <= 1)) {
    // The fallback: scale everything down, passive on the grid by construction.
    const base = maxAfter > 1 && Number.isFinite(maxAfter) ? current : model;
    const peak = base === current ? maxAfter : maxBefore;
    const k = (1 - 1e-12) / peak;
    current = { ...base, c: base.c.map((c) => c * k), d: base.d * k, e: base.e * k };
    maxAfter = maxAbs(current);
    method = 'scaling';
  }
  return { model: current, report: { maxBefore, maxAfter, method, iterations } };
}

export interface ReflectionFitOptions extends Omit<VectorFitOptions, 'asymptote'> {
  readonly passivity?: PassivityOptions;
}

/**
 * Fit a one-port reflection coefficient (complex Gamma at each frequency) and
 * make the model passive on a dense grid around the band (see the passivity
 * notes above). The model has a constant d and no s term, as a reflection
 * coefficient is bounded at every frequency. The RMS and largest residual are
 * those of the passive model.
 */
export function fitReflection(
  frequencies: readonly number[],
  gammas: readonly Complex[],
  options: ReflectionFitOptions = {},
): VectorFit {
  const raw = vectorFit(frequencies, gammas, { ...options, asymptote: 'd' });
  const clean = cleanSamples(frequencies, gammas);
  const scale = raw.band[1];
  const data: Samples = {
    x: clean.f.map((f) => f / scale),
    hr: clean.v.map((v) => v.re),
    hi: clean.v.map((v) => v.im),
  };
  // Rebuild the normalized model from the physical one (exact: the same numbers scaled).
  const wn = 2 * Math.PI * scale;
  const entries: PoleEntry[] = [];
  const c: number[] = [];
  raw.model.poles.forEach((p, i) => {
    if (p.im < 0) return;
    const r = raw.model.residues[i] as Complex;
    entries.push({ re: p.re / wn, im: p.im / wn });
    if (p.im > 0) c.push(r.re / wn, r.im / wn);
    else c.push(r.re / wn);
  });
  const model: NormalizedModel = { entries, c, d: raw.model.d, e: 0, scale };
  const margin = Math.max(0, options.passivity?.margin ?? 0.1);
  const lo = raw.band[0] * (1 - margin);
  const hi = raw.band[1] * (1 + margin);
  const points = Math.max(
    11,
    Math.floor(options.passivity?.points ?? Math.max(2001, 20 * data.x.length)),
  );
  const grid: number[] = [];
  for (let i = 0; i < points; i++) grid.push((lo + ((hi - lo) * i) / (points - 1)) / scale);
  // The data frequencies themselves are on the grid too.
  for (const x of data.x) grid.push(x);
  grid.sort((a, b) => a - b);
  const enforced = enforceOnModel(model, data, grid);
  const { rms, max } = residualOf(enforced.model, data);
  const fit = finish(enforced.model, rms, max, data, raw.iterations, raw.band);
  return {
    ...fit,
    passivity: { ...enforced.report, grid: [lo, hi], points: grid.length },
  };
}
