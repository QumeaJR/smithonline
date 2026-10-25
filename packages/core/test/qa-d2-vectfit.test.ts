/**
 * QA round on depth phase D2 (measured load first): vector fitting, the
 * measured load and the floor from the fitted model. Every expected value
 * comes from a closed form or a hand bound stated next to it. it.fails marks
 * a finding.
 */
import { describe, expect, it } from 'vitest';
import {
  bodeFano,
  cadd,
  cdiv,
  cinv,
  complex,
  feasibility,
  fitReflection,
  leastSquares,
  measuredLoad,
  measuredLoadInfo,
  realEigenvalues,
  sweepPoints,
  vectorFit,
  VectorFitError,
  zToGamma,
  type Complex,
  type MeasuredPoint,
} from '../src/index';

const w = (f: number): number => 2 * Math.PI * f;
const Z0 = 50;
const dist = (a: Complex, b: Complex): number => Math.hypot(a.re - b.re, a.im - b.im);

/** Park-Miller, uniform in [-0.5, 0.5). */
function noise(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647 - 0.5;
  };
}

/** Rows of a load with uniform noise of `amplitude` (peak to peak) per part of Gamma. */
function rowsOf(
  z: (f: number) => Complex,
  freqs: readonly number[],
  amplitude = 0,
  seed = 3,
): MeasuredPoint[] {
  const rnd = noise(seed);
  return freqs.map((f) => {
    const g = zToGamma(z(f), Z0);
    const gr = g.re + amplitude * rnd();
    const gi = g.im + amplitude * rnd();
    return {
      frequency: f,
      z: cdiv(complex(Z0 * (1 + gr), Z0 * gi), complex(1 - gr, -gi)),
    };
  });
}

/* ------------------------------------------------------- linear algebra */

describe('leastSquares and realEigenvalues edges', () => {
  it('a column that repeats an earlier one gets x = 0 (documented)', () => {
    // [1 1; 1 1; 1 1] x = [2 2 2]: the first column carries it, x = (2, 0).
    const x = leastSquares(
      Float64Array.from([1, 1, 1, 1, 1, 1]),
      3,
      2,
      Float64Array.from([2, 2, 2]),
    );
    expect(x[0]).toBeCloseTo(2, 12);
    expect(x[1]).toBe(0);
  });

  it('a zero column gets x = 0', () => {
    const x = leastSquares(
      Float64Array.from([1, 0, 2, 0, 3, 0]),
      3,
      2,
      Float64Array.from([1, 2, 3]),
    );
    expect(x[0]).toBeCloseTo(1, 12);
    expect(x[1]).toBe(0);
  });

  it('1 x 1, 2 x 2 real and 2 x 2 complex eigenvalues', () => {
    expect(realEigenvalues(Float64Array.from([3]), 1)).toEqual([complex(3, 0)]);
    // [0 1; -2 -3]: s^2 + 3 s + 2 = (s + 1)(s + 2).
    const r = realEigenvalues(Float64Array.from([0, 1, -2, -3]), 2).sort((a, b) => a.re - b.re);
    expect(dist(r[0]!, complex(-2, 0))).toBeLessThan(1e-14);
    expect(dist(r[1]!, complex(-1, 0))).toBeLessThan(1e-14);
    // [0 -1; 1 0]: +- j.
    const c = realEigenvalues(Float64Array.from([0, -1, 1, 0]), 2).sort((a, b) => a.im - b.im);
    expect(dist(c[0]!, complex(0, -1))).toBeLessThan(1e-14);
    expect(dist(c[1]!, complex(0, 1))).toBeLessThan(1e-14);
  });
});

/* ----------------------------------------------------- vectorFit inputs */

describe('vectorFit input edges', () => {
  it('no points, and points that are all non-finite or at f <= 0, throw VectorFitError', () => {
    expect(() => vectorFit([], [])).toThrow(VectorFitError);
    expect(() =>
      vectorFit([-1e9, 0, Number.NaN, 1e9], [complex(1), complex(1), complex(1), complex(1)]),
    ).toThrow(VectorFitError);
  });

  it('non-finite values and non-positive frequencies are dropped, not fitted', () => {
    // H = 1 / (1 + j f / 1 GHz): one real pole at -2 pi 1e9 rad/s, residue 2 pi 1e9.
    const h = (f: number): Complex => cinv(complex(1, f / 1e9));
    const f = sweepPoints(0.2e9, 2e9, 30);
    const values = f.map(h);
    const fit = vectorFit(
      [...f, -5e8, 0, 1.5e9 + 1],
      [...values, complex(9, 9), complex(9, 9), complex(Number.NaN, 0)],
      { order: 1, asymptote: 'none' },
    );
    expect(fit.points).toBe(30);
    expect(dist(fit.model.poles[0]!, complex(-w(1e9), 0)) / w(1e9)).toBeLessThan(1e-9);
    expect(dist(fit.model.residues[0]!, complex(w(1e9), 0)) / w(1e9)).toBeLessThan(1e-9);
  });
});

/* ------------------------------------------- automatic order: a finding */

/** K series RLC branches (50 ohm, 50 nH) in parallel, resonances evenly spread over [lo, hi]: rational of order 2K. */
function fosterLoad(k: number, lo: number, hi: number): (f: number) => Complex {
  const resonances = Array.from({ length: k }, (_, i) => lo + ((hi - lo) * (i + 0.5)) / k);
  return (f) => {
    let y = complex(0, 0);
    for (const fr of resonances) {
      const l = 50e-9;
      const c = 1 / (w(fr) ** 2 * l);
      y = cadd(y, cinv(complex(50, w(f) * l - 1 / (w(f) * c))));
    }
    return cinv(y);
  };
}

describe('the automatic order reaches the order of a rational load', () => {
  const lo = 0.5e9;
  const hi = 1.5e9;
  const z = fosterLoad(4, lo, hi);
  const f = sweepPoints(lo, hi, 401);
  const g = f.map((x) => zToGamma(z(x), Z0));

  it('four resonances at the given order 8: recovered to rounding (the fitter itself is right)', () => {
    const fit = vectorFit(f, g, { order: 8, asymptote: 'd' });
    expect(fit.maxResidual).toBeLessThan(1e-9);
  });

  // Gamma of four series RLC branches in parallel is rational of order 8 with a constant: an
  // order search that ends at the noise of the data must reach 8. Finding (fixed): the search
  // stopped after three orders without a 10 % gain and kept a model that missed by 0.2; it now
  // steps by pole pairs and goes on while no order meets the tolerance.
  it('four resonances, order chosen automatically: recovered to 1e-9 and used as fitted', () => {
    const fit = fitReflection(f, g);
    expect(fit.order).toBe(8);
    expect(fit.maxResidual).toBeLessThan(1e-9);
    const info = measuredLoadInfo(measuredLoad(f.map((x) => ({ frequency: x, z: z(x) }))))!;
    expect(info.mode).toBe('fitted');
  });
});

/* ------------------------------------------------ the fallback threshold */

describe('the 0.01 fallback threshold', () => {
  const rlc = (f: number): Complex => complex(20, w(f) * 10e-9 - 1 / (w(f) * 3e-12));
  const freqs = sweepPoints(0.5e9, 1.5e9, 401);

  it('a largest residual equal to the limit is used ("at most"), a hair above it is not', () => {
    const rows = rowsOf(rlc, freqs, 1e-3);
    const first = measuredLoadInfo(measuredLoad(rows))!;
    expect(first.mode).toBe('fitted');
    const maxResidual = first.fit!.maxResidual;
    expect(measuredLoadInfo(measuredLoad(rows, { maxResidual }))!.mode).toBe('fitted');
    expect(
      measuredLoadInfo(measuredLoad(rows, { maxResidual: maxResidual * (1 - 1e-9) }))!.reason,
    ).toBe('residual');
  });

  it('noise of +-0.006 per part (|noise| <= 0.0085): fitted with the default limit', () => {
    // The residual is the noise: at most sqrt(2) 0.006 = 0.0085 plus the model's own error.
    const info = measuredLoadInfo(measuredLoad(rowsOf(rlc, freqs, 0.012)))!;
    expect(info.fit!.maxResidual).toBeGreaterThan(0.005);
    expect(info.fit!.maxResidual).toBeLessThan(0.01);
    expect(info.mode).toBe('fitted');
  });

  it('noise of +-0.01 per part (|noise| up to 0.0141, above 0.01 at a fifth of the rows): linear', () => {
    // P(|n| > 0.01) for n uniform in the square of half side 0.01 is 1 - pi / 4 = 0.21.
    const info = measuredLoadInfo(measuredLoad(rowsOf(rlc, freqs, 0.02)))!;
    expect(info.fit!.maxResidual).toBeGreaterThan(0.01);
    expect(info.fit!.maxResidual).toBeLessThan(0.02);
    expect(info).toMatchObject({ mode: 'linear', reason: 'residual' });
  });
});

/* -------------------------------------------- extrapolation, derivative */

describe('the measured load past the data and its derivative', () => {
  // Series RL: Z = 25 + j w 8 nH, dZ/df = j 2 pi 8 nH exactly.
  const rl = (f: number): Complex => complex(25, w(f) * 8e-9);
  const load = measuredLoad(rowsOf(rl, sweepPoints(1e9, 2e9, 21)));
  const info = measuredLoadInfo(load)!;

  it('inside the range: dZ/df = j 2 pi L', () => {
    expect(info.mode).toBe('fitted');
    for (const f of [0.96e9, 1.5e9, 2.09e9]) {
      const d = info.derivative!(f);
      expect(Math.abs(d.re)).toBeLessThan(1e-6 * 2 * Math.PI * 8e-9);
      expect(d.im / (2 * Math.PI * 8e-9)).toBeCloseTo(1, 6);
    }
  });

  it('where the load is held (beyond 5 percent): dZ/df = 0', () => {
    expect(info.derivative!(2.2e9)).toEqual(complex(0, 0));
    expect(info.derivative!(0.9e9)).toEqual(complex(0, 0));
    // The held value is the model at the range end.
    expect(load(5e9)).toEqual(load(2.1e9));
    expect(load(1)).toEqual(load(0.95e9));
  });

  it('a constant resistor (no reactance) is followed exactly and imposes no floor', () => {
    const r = measuredLoad(rowsOf(() => complex(75, 0), sweepPoints(1e9, 2e9, 11)));
    for (const f of [1e9, 1.234e9, 2e9]) expect(dist(r(f), complex(75, 0))).toBeLessThan(1e-9);
    // No reactance: Q = 0, and Bode-Fano restricts nothing (no floor, or a floor of VSWR 1).
    const fe = feasibility(r, sweepPoints(1.2e9, 1.8e9, 21));
    if (fe !== null) expect(fe.floor).toBeCloseTo(1, 9);
  });

  it('a lossless capacitor (|Gamma| = 1) never gets a negative resistance after enforcement', () => {
    const c = measuredLoad(
      rowsOf((f) => complex(0, -1 / (w(f) * 2e-12)), sweepPoints(1e9, 2e9, 41), 2e-3),
    );
    for (const f of sweepPoints(0.95e9, 2.1e9, 2001)) expect(c(f).re).toBeGreaterThanOrEqual(0);
  });
});

/* ------------------------------------------- the floor from the fitted Q */

describe('the estimate floor from the fitted model', () => {
  // Series RLC above its resonance: R = 30, L = 40 nH, resonance 0.5 GHz, band 0.9 to 1.1 GHz.
  // Yaghjian-Best with X' = L + 1 / (w^2 C) and |X| = w L - 1 / (w C) (X > 0):
  // Q = (w / 2R) (X' + |X| / w) = w L / R at the geometric centre.
  const r = 30;
  const l = 40e-9;
  const c = 1 / (w(0.5e9) ** 2 * l);
  const z = (f: number): Complex => complex(r, w(f) * l - 1 / (w(f) * c));
  const lo = 0.9e9;
  const hi = 1.1e9;
  const fg = Math.sqrt(lo * hi);
  const load = measuredLoad(rowsOf(z, sweepPoints(0.8e9, 1.2e9, 41)));
  const fe = feasibility(load, sweepPoints(lo, hi, 21))!;
  const qWant = (w(fg) * l) / r;

  it('is the estimate, with Q = w L / R at the geometric centre', () => {
    expect(fe.method).toBe('estimate');
    expect(fe.fromFit).toBe(true);
    expect(fe.q / qWant).toBeCloseTo(1, 6);
  });

  it('the floor is Bode-Fano with the bandwidth referred to the geometric centre', () => {
    const g = Math.exp(-Math.PI / (qWant * ((hi - lo) / fg)));
    expect(fe.floor / ((1 + g) / (1 - g))).toBeCloseTo(1, 6);
  });

  // Every other Feasibility has floor = bodeFano(q, fractionalBandwidth), and the panels print
  // "Bode-Fano floor F over B %" with fractionalBandwidth. Finding (fixed): B was referred to the
  // arithmetic centre while F was computed with the geometric one.
  it('floor, q and fractionalBandwidth agree as for every other floor', () => {
    expect(fe.floor / bodeFano(fe.q, fe.fractionalBandwidth)!).toBeCloseTo(1, 9);
  });
});

/* ------------------------------------------- passivity and optimality */

describe('passivity of an active load and the residue optimality', () => {
  it('a negative resistance (|Gamma| > 1 at every point) ends passive and is not used as the load', () => {
    // Z = -10 + j w 5 nH: Re Z < 0, so |Gamma| > 1; at 2 GHz (X = 62.8)
    // |Gamma|^2 = (60^2 + X^2) / (40^2 + X^2) = 7548 / 5548, |Gamma| = 1.166, its smallest in the band.
    const z = (f: number): Complex => complex(-10, w(f) * 5e-9);
    const f = sweepPoints(1e9, 2e9, 41);
    const fit = fitReflection(
      f,
      f.map((x) => zToGamma(z(x), Z0)),
    );
    let worst = 0;
    for (const x of sweepPoints(0.9e9, 2.2e9, 20001)) {
      const g = fit.evaluate(x);
      worst = Math.max(worst, Math.hypot(g.re, g.im));
    }
    expect(worst).toBeLessThanOrEqual(1 + 1e-9);
    // A passive model misses every row by at least |Gamma| - 1 >= 0.166.
    expect(fit.maxResidual).toBeGreaterThan(0.16);
    const info = measuredLoadInfo(measuredLoad(f.map((x) => ({ frequency: x, z: z(x) }))))!;
    expect(info).toMatchObject({ mode: 'linear', reason: 'residual' });
  });

  it('the residues and d are the least squares solution over all points (1601 rows, noise 1e-3)', () => {
    // With the poles fixed, the residual over all points is minimal for the all-points least
    // squares residues: solve it independently from the fit's poles and compare the RMS.
    const rlc = (f: number): Complex => complex(20, w(f) * 10e-9 - 1 / (w(f) * 3e-12));
    const rows = rowsOf(rlc, sweepPoints(0.5e9, 1.5e9, 1601), 1e-3, 17);
    const f = rows.map((r) => r.frequency);
    const g = rows.map((r) => zToGamma(r.z, Z0));
    const fit = vectorFit(f, g, { asymptote: 'd' });
    const poles = fit.model.poles;
    const cols = poles.length + 1;
    const a = new Float64Array(2 * f.length * cols);
    const b = new Float64Array(2 * f.length);
    f.forEach((x, i) => {
      const s = complex(0, w(x));
      let c = 0;
      for (let k = 0; k < poles.length; k++) {
        const p = poles[k]!;
        if (p.im < 0) continue;
        const u1 = cinv(complex(s.re - p.re, s.im - p.im));
        if (p.im === 0) {
          a[2 * i * cols + c] = u1.re;
          a[(2 * i + 1) * cols + c] = u1.im;
          c += 1;
          continue;
        }
        const u2 = cinv(complex(s.re - p.re, s.im + p.im));
        // 1/(s-a) + 1/(s-a*) and j/(s-a) - j/(s-a*)
        a[2 * i * cols + c] = u1.re + u2.re;
        a[(2 * i + 1) * cols + c] = u1.im + u2.im;
        a[2 * i * cols + c + 1] = -(u1.im - u2.im);
        a[(2 * i + 1) * cols + c + 1] = u1.re - u2.re;
        c += 2;
      }
      a[2 * i * cols + c] = 1;
      b[2 * i] = g[i]!.re;
      b[2 * i + 1] = g[i]!.im;
    });
    const bCopy = Float64Array.from(b);
    const aCopy = Float64Array.from(a);
    const x = leastSquares(a, 2 * f.length, cols, b);
    let sum = 0;
    for (let i = 0; i < 2 * f.length; i++) {
      let v = 0;
      for (let j = 0; j < cols; j++) v += (aCopy[i * cols + j] as number) * (x[j] as number);
      sum += (v - (bCopy[i] as number)) ** 2;
    }
    const best = Math.sqrt(sum / f.length);
    expect(fit.rms / best).toBeCloseTo(1, 7);
  });
});

/* ------------------------------------------- documented sizes and limits */

describe('documented sizes: six rows, the check grid', () => {
  const rlc = (f: number): Complex => complex(20, w(f) * 10e-9 - 1 / (w(f) * 3e-12));

  it('six rows are fitted, five are not (user guide: "from six rows up")', () => {
    expect(measuredLoadInfo(measuredLoad(rowsOf(rlc, sweepPoints(0.5e9, 1.5e9, 6))))!.mode).toBe(
      'fitted',
    );
    expect(measuredLoadInfo(measuredLoad(rowsOf(rlc, sweepPoints(0.5e9, 1.5e9, 5))))!.reason).toBe(
      'few-points',
    );
  });

  it('the check grid: max(2001, 20 per row) points plus the rows, 0.9 lo to 1.1 hi', () => {
    // 41 rows: 2001 + 41 = 2042 points; 201 rows: 20 x 201 = 4020, + 201 = 4221.
    const a = fitReflection(
      sweepPoints(1e9, 2e9, 41),
      sweepPoints(1e9, 2e9, 41).map((f) => zToGamma(rlc(f), Z0)),
    );
    expect(a.passivity!.points).toBe(2042);
    expect(a.passivity!.grid[0]).toBeCloseTo(0.9e9, 0);
    expect(a.passivity!.grid[1]).toBeCloseTo(2.2e9, 0);
    const b = fitReflection(
      sweepPoints(1e9, 2e9, 201),
      sweepPoints(1e9, 2e9, 201).map((f) => zToGamma(rlc(f), Z0)),
    );
    expect(b.passivity!.points).toBe(4221);
  });
});
