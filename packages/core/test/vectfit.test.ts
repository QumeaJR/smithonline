/**
 * Vector fitting (D2): recovery of a known rational function, fits of
 * analytic loads with noise to the noise floor, stability, passivity
 * enforcement, the measured load built on it, and the Bode-Fano floor from
 * the fitted model against Fano's exact single-reactance bounds.
 */
import { describe, expect, it } from 'vitest';
import {
  beyondData,
  broadbandMatch,
  cadd,
  cdiv,
  cinv,
  complex,
  feasibility,
  fitReflection,
  FIT_MIN_POINTS,
  interpolatedLoad,
  leastSquares,
  measuredLoadInfo,
  monteCarlo,
  realEigenvalues,
  sweepFrequency,
  sweepPoints,
  vectorFit,
  VectorFitError,
  worstVswr,
  zToGamma,
  type Complex,
  type Element,
  type LoadModel,
  type VectorFit,
} from '../src/index';

const w = (f: number): number => 2 * Math.PI * f;
const Z0 = 50;
const gammaOf = (z: Complex): Complex => zToGamma(z, Z0);

/** Park-Miller, uniform in [-0.5, 0.5): the noise of a test is the same every run. */
function noise(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647 - 0.5;
  };
}

/** Complex noise of the given amplitude per part, and its RMS magnitude amplitude * sqrt(2 / 12). */
const noiseRms = (amplitude: number): number => amplitude * Math.sqrt(2 / 12);

function dist(a: Complex, b: Complex): number {
  return Math.hypot(a.re - b.re, a.im - b.im);
}

/** Largest |model - truth| on a dense grid over [lo, hi]. */
function maxError(fit: VectorFit, truth: (f: number) => Complex, lo: number, hi: number): number {
  let worst = 0;
  for (const f of sweepPoints(lo, hi, 4001))
    worst = Math.max(worst, dist(fit.evaluate(f), truth(f)));
  return worst;
}

/* --------------------------------------------------------------- loads */

const seriesRlc = (f: number): Complex => complex(20, w(f) * 10e-9 - 1 / (w(f) * 3e-12));
const parallelRlc = (f: number): Complex =>
  cinv(complex(1 / 200, w(f) * 2e-12 - 1 / (w(f) * 12e-9)));
/** Two series RLC branches in parallel behind a series 2 nH: a two-resonance antenna model. */
const antenna = (f: number): Complex => {
  const y1 = cinv(complex(30, w(f) * 20e-9 - 1 / (w(f) * 1.6e-12)));
  const y2 = cinv(complex(60, w(f) * 8e-9 - 1 / (w(f) * 1.0e-12)));
  const zp = cinv(cadd(y1, y2));
  return complex(zp.re, zp.im + w(f) * 2e-9);
};

function samples(
  z: (f: number) => Complex,
  lo: number,
  hi: number,
  n: number,
  amplitude: number,
  seed = 11,
): { f: number[]; g: Complex[] } {
  const rnd = noise(seed);
  const f = sweepPoints(lo, hi, n);
  const g = f.map((x) => {
    const v = gammaOf(z(x));
    return complex(v.re + amplitude * rnd(), v.im + amplitude * rnd());
  });
  return { f, g };
}

/* ---------------------------------------------------------- linear algebra */

describe('leastSquares and realEigenvalues', () => {
  it('solves an overdetermined consistent system exactly', () => {
    // x = (1, -2, 3) from 5 equations.
    const rows = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 1, 1],
      [2, -1, 0.5],
    ];
    const x = [1, -2, 3];
    const a = Float64Array.from(rows.flat());
    const b = Float64Array.from(
      rows.map((r) => r.reduce((s, v, i) => s + v * (x[i] as number), 0)),
    );
    const got = leastSquares(a, 5, 3, b);
    got.forEach((v, i) => expect(v).toBeCloseTo(x[i] as number, 12));
  });

  it('finds the roots of a polynomial from its companion matrix, complex pairs included', () => {
    // (x - 1)(x + 2)(x^2 + 2x + 5): roots 1, -2, -1 +- 2j.
    // x^4 + 3x^3 + 5x^2 + x - 10
    const c = [3, 5, 1, -10];
    const n = 4;
    const m = new Float64Array(n * n);
    for (let j = 0; j < n; j++) m[j] = -(c[j] as number);
    for (let i = 1; i < n; i++) m[i * n + i - 1] = 1;
    const roots = realEigenvalues(m, n).sort((a, b) => a.re - b.re || a.im - b.im);
    const want = [complex(-2, 0), complex(-1, -2), complex(-1, 2), complex(1, 0)];
    roots.forEach((r, i) => expect(dist(r, want[i] as Complex)).toBeLessThan(1e-12));
  });
});

/* ------------------------------------------------------------ recovery */

describe('vectorFit recovers a known rational impedance', () => {
  // Two complex pairs and a real pole, d = 20 ohm and e = 1 nH.
  const poles = [
    complex(-w(5e7), w(0.8e9)),
    complex(-w(5e7), -w(0.8e9)),
    complex(-w(1e8), w(1.5e9)),
    complex(-w(1e8), -w(1.5e9)),
    complex(-w(3e9), 0),
  ];
  const residues = [
    complex(3e9, 1e9),
    complex(3e9, -1e9),
    complex(5e9, -2e9),
    complex(5e9, 2e9),
    complex(2e10, 0),
  ];
  const d = 20;
  const e = 1e-9;
  const z = (f: number): Complex => {
    let v = complex(d, w(f) * e);
    poles.forEach((p, i) => {
      v = cadd(v, cdiv(residues[i] as Complex, complex(-p.re, w(f) - p.im)));
    });
    return v;
  };
  const freqs = sweepPoints(0.1e9, 3e9, 200);
  const values = freqs.map(z);
  const order = (list: readonly Complex[]): number[] =>
    list.map((_, i) => i).sort((a, b) => list[a]!.im - list[b]!.im || list[a]!.re - list[b]!.re);

  function expectRecovered(fit: VectorFit): void {
    expect(fit.order).toBe(5);
    const pi = order(fit.model.poles);
    const want = order(poles);
    pi.forEach((k, i) => {
      const p = fit.model.poles[k]!;
      const q = poles[want[i]!]!;
      expect(dist(p, q) / Math.hypot(q.re, q.im)).toBeLessThan(1e-9);
      const r = fit.model.residues[k]!;
      const s = residues[want[i]!]!;
      expect(dist(r, s) / Math.hypot(s.re, s.im)).toBeLessThan(1e-9);
    });
    expect(Math.abs(fit.model.d - d) / d).toBeLessThan(1e-9);
    expect(Math.abs(fit.model.e - e) / e).toBeLessThan(1e-9);
    expect(fit.rms).toBeLessThan(1e-9);
  }

  it('at the given order: poles, residues, d and e to 1e-9', () => {
    expectRecovered(vectorFit(freqs, values, { order: 5 }));
  });

  it('with the order chosen automatically', () => {
    expectRecovered(vectorFit(freqs, values));
  });

  it('the evaluator and its derivative agree with the function', () => {
    const fit = vectorFit(freqs, values, { order: 5 });
    for (const f of [0.15e9, 0.8e9, 2.2e9]) {
      const v = z(f);
      expect(dist(fit.evaluate(f), v) / Math.hypot(v.re, v.im)).toBeLessThan(1e-10);
      const h = f * 1e-6;
      const fd = cdiv(
        complex(z(f + h).re - z(f - h).re, z(f + h).im - z(f - h).im),
        complex(2 * h),
      );
      const der = fit.derivative(f);
      expect(dist(der, fd) / Math.hypot(fd.re, fd.im)).toBeLessThan(1e-6);
    }
  });

  it('refuses fewer than three distinct points', () => {
    expect(() => vectorFit([1e9, 1e9, 2e9], [complex(1), complex(2), complex(3)])).toThrow(
      VectorFitError,
    );
  });
});

/* ------------------------------------------------- analytic loads, noise */

describe('fits of analytic loads with noise reach the noise floor', () => {
  const cases: [string, (f: number) => Complex, number, number][] = [
    ['series RLC', seriesRlc, 0.5e9, 1.5e9],
    ['parallel RLC', parallelRlc, 0.5e9, 1.5e9],
    ['two-resonance antenna', antenna, 0.6e9, 2.4e9],
  ];
  for (const [name, z, lo, hi] of cases) {
    it(`${name}: clean data to machine precision`, () => {
      const s = samples(z, lo, hi, 201, 0);
      const fit = fitReflection(s.f, s.g);
      expect(fit.maxResidual).toBeLessThan(1e-12);
      expect(maxError(fit, (f) => gammaOf(z(f)), lo, hi)).toBeLessThan(1e-11);
    });
    for (const amplitude of [1e-4, 1e-3, 1e-2]) {
      it(`${name}: noise ${amplitude} gives a residual at the noise floor and a model closer to the truth`, () => {
        const s = samples(z, lo, hi, 401, amplitude);
        const fit = fitReflection(s.f, s.g);
        const floor = noiseRms(amplitude);
        // The residual is the noise: within 10 percent of its RMS (a few poles absorb a little of it).
        expect(fit.rms).toBeGreaterThan(0.9 * floor);
        expect(fit.rms).toBeLessThan(1.1 * floor);
        // The model sits nearer the truth than the noise does.
        expect(maxError(fit, (f) => gammaOf(z(f)), lo, hi)).toBeLessThan(0.5 * amplitude);
        expect(fit.order).toBeLessThanOrEqual(8);
      });
    }
  }
  // Observed (seed 11, 401 points): series RLC order 2, parallel RLC 2, antenna 4; at noise 1e-3
  // the RMS is 4.00e-4, 4.00e-4 and 3.99e-4 (noise RMS 4.08e-4) and the worst error to the
  // truth 4.5e-5, 4.5e-5 and 7.0e-5; clean data 1e-15.
});

/* ----------------------------------------------------------- stability */

describe('stability', () => {
  it('every pole of every fit has a negative real part', () => {
    for (const z of [seriesRlc, parallelRlc, antenna]) {
      const s = samples(z, 0.5e9, 2.5e9, 301, 1e-3);
      const fit = fitReflection(s.f, s.g);
      for (const p of fit.model.poles) expect(p.re).toBeLessThan(0);
    }
  });

  it('data from a function with a pole in the right half plane still gives stable poles', () => {
    // H = 1 / (s - a) with a = +0.1 w0 + j w0: an unstable resonance.
    const a = complex(0.1 * w(1e9), w(1e9));
    const h = (f: number): Complex => cdiv(complex(w(1e9)), complex(-a.re, w(f) - a.im));
    const freqs = sweepPoints(0.5e9, 1.5e9, 101);
    const fit = vectorFit(freqs, freqs.map(h), { order: 2 });
    for (const p of fit.model.poles) expect(p.re).toBeLessThan(0);
    // The flipped pole gives the same magnitude on the axis; the fit stays finite.
    expect(Number.isFinite(fit.rms)).toBe(true);
  });
});

/* ----------------------------------------------------------- passivity */

describe('passivity enforcement', () => {
  const dense = (fit: VectorFit): number => {
    const lo = fit.band[0] * 0.9;
    const hi = fit.band[1] * 1.1;
    let worst = 0;
    for (const f of sweepPoints(lo, hi, 20001)) {
      const g = fit.evaluate(f);
      worst = Math.max(worst, Math.hypot(g.re, g.im));
    }
    return worst;
  };

  it('a lossless load with noise on the rim ends at |Gamma| <= 1 + 1e-9 on a dense grid', () => {
    const z = (f: number): Complex => complex(0, w(f) * 10e-9 - 1 / (w(f) * 3e-12));
    const s = samples(z, 0.5e9, 1.5e9, 201, 2e-3);
    const fit = fitReflection(s.f, s.g);
    expect(fit.passivity?.maxBefore).toBeGreaterThan(1);
    expect(fit.passivity?.method).toBe('perturbation');
    expect(dense(fit)).toBeLessThanOrEqual(1 + 1e-9);
    // The perturbation stays at the noise level.
    expect(fit.rms).toBeLessThan(2 * noiseRms(2e-3));
  });

  it('a clearly active data set is scaled down to passive (the residual then says it is no load)', () => {
    // |Gamma| = 1.2 everywhere: no passive model follows it.
    const freqs = sweepPoints(1e9, 2e9, 41);
    const g = freqs.map((f) => complex(1.2 * Math.cos(f / 1e8), 1.2 * Math.sin(f / 1e8)));
    const fit = fitReflection(freqs, g);
    expect(dense(fit)).toBeLessThanOrEqual(1 + 1e-9);
    expect(fit.maxResidual).toBeGreaterThan(0.1);
  });

  it('a passive fit is left alone', () => {
    const s = samples(seriesRlc, 0.5e9, 1.5e9, 101, 0);
    const fit = fitReflection(s.f, s.g);
    expect(fit.passivity?.method).toBe('none');
    expect(dense(fit)).toBeLessThan(1);
  });
});

/* --------------------------------------------------------- measured load */

const pointsOf = (z: (f: number) => Complex, freqs: readonly number[], amplitude = 0) => {
  const rnd = noise(5);
  return freqs.map((f) => {
    const v = z(f);
    // Noise in Gamma, converted back to an impedance as a VNA file would hold it.
    const g = gammaOf(v);
    const gn = complex(g.re + amplitude * rnd(), g.im + amplitude * rnd());
    const zz = cdiv(complex(Z0 * (1 + gn.re), Z0 * gn.im), complex(1 - gn.re, -gn.im));
    return { frequency: f, z: zz };
  });
};

describe('interpolatedLoad: fitted mode and fallbacks', () => {
  it(`fits from ${FIT_MIN_POINTS} points and follows the load between them`, () => {
    const freqs = sweepPoints(0.5e9, 1.5e9, FIT_MIN_POINTS);
    const load = interpolatedLoad(pointsOf(seriesRlc, freqs), { z0: Z0 }) as (f: number) => Complex;
    const info = measuredLoadInfo(load)!;
    expect(info.mode).toBe('fitted');
    expect(info.fit!.maxResidual).toBeLessThan(1e-9);
    // Between the points the model is the load; linear interpolation would be far off.
    for (const f of sweepPoints(0.5e9, 1.5e9, 37)) {
      const want = seriesRlc(f);
      expect(dist(load(f), want) / Math.hypot(want.re, want.im)).toBeLessThan(1e-6);
    }
  });

  it('five points stay linear', () => {
    const load = interpolatedLoad(pointsOf(seriesRlc, sweepPoints(0.5e9, 1.5e9, 5)));
    expect(measuredLoadInfo(load)).toMatchObject({ mode: 'linear', reason: 'few-points' });
  });

  it('a fit off by more than 1e-2 in Gamma falls back to linear interpolation of R and X', () => {
    const freqs = sweepPoints(0.5e9, 1.5e9, 41);
    const pts = pointsOf(seriesRlc, freqs, 0.1);
    const load = interpolatedLoad(pts) as (f: number) => Complex;
    const info = measuredLoadInfo(load)!;
    expect(info).toMatchObject({ mode: 'linear', reason: 'residual' });
    expect(info.fit!.maxResidual).toBeGreaterThan(1e-2);
    // Halfway between two points: the mean of their R and X.
    const a = pts[10]!;
    const b = pts[11]!;
    const mid = load((a.frequency + b.frequency) / 2);
    expect(mid.re).toBeCloseTo((a.z.re + b.z.re) / 2, 9);
    expect(mid.im).toBeCloseTo((a.z.im + b.z.im) / 2, 9);
  });

  it('fit: false keeps linear interpolation', () => {
    const load = interpolatedLoad(pointsOf(seriesRlc, sweepPoints(0.5e9, 1.5e9, 21)), {
      fit: false,
    });
    expect(measuredLoadInfo(load)).toMatchObject({ mode: 'linear', reason: 'disabled' });
  });

  it('the fitted model is followed 5 percent past the data and held there beyond', () => {
    const load = interpolatedLoad(pointsOf(seriesRlc, sweepPoints(1e9, 2e9, 21))) as (
      f: number,
    ) => Complex;
    const info = measuredLoadInfo(load)!;
    expect(info.range[0]).toBeCloseTo(0.95e9, 0);
    expect(info.range[1]).toBeCloseTo(2.1e9, 0);
    // Inside the 5 percent the model is still the load (it is exact here).
    const at = seriesRlc(2.05e9);
    expect(dist(load(2.05e9), at) / Math.hypot(at.re, at.im)).toBeLessThan(1e-6);
    // Beyond, held at the value at 2.1 GHz.
    expect(load(3e9)).toEqual(load(2.1e9));
    expect(load(0.5e9)).toEqual(load(0.95e9));
    expect(beyondData(info, 0.9e9, 2e9)).toEqual({ below: true, above: false });
    expect(beyondData(info, 1e9, 2e9)).toEqual({ below: false, above: false });
  });

  it('the fit runs once per point list and option set', () => {
    const pts = pointsOf(antenna, sweepPoints(0.6e9, 2.4e9, 101));
    expect(interpolatedLoad(pts, { z0: 50 })).toBe(interpolatedLoad(pts, { z0: 50 }));
    expect(interpolatedLoad(pts, { z0: 50 })).not.toBe(interpolatedLoad(pts, { z0: 75 }));
  });
});

/* ----------------------------------------------------- fitted Fano floor */

describe('the Bode-Fano floor from the fitted model', () => {
  const vswrOfLn = (ln: number): number => {
    const g = Math.exp(-ln);
    return (1 + g) / (1 - g);
  };
  const lo = 0.6e9;
  const hi = 1.4e9;
  const w1 = w(lo);
  const w2 = w(hi);
  // Fano (1950); Pozar section 5.9: the exact bounds on ln(1/Gamma) over w1 to w2.
  const loads: [string, (f: number) => Complex, number][] = [
    ['series RL', (f) => complex(25, w(f) * 8e-9), (Math.PI * 25) / (8e-9 * (w2 - w1))],
    [
      'series RC',
      (f) => complex(25, -1 / (w(f) * 4e-12)),
      (Math.PI * 25 * 4e-12) / (1 / w1 - 1 / w2),
    ],
    [
      'parallel RC',
      (f) => cinv(complex(1 / 100, w(f) * 3e-12)),
      Math.PI / (100 * 3e-12 * (w2 - w1)),
    ],
    [
      'parallel RL',
      (f) => cinv(complex(1 / 100, -1 / (w(f) * 15e-9))),
      (Math.PI * 15e-9) / 100 / (1 / w1 - 1 / w2),
    ],
  ];
  for (const [name, z, ln] of loads) {
    for (const amplitude of [0, 1e-4]) {
      it(`${name}${amplitude ? ', noise 1e-4' : ''}: within 1 percent of Fano's exact bound`, () => {
        const pts = pointsOf(z, sweepPoints(lo, hi, 41), amplitude);
        const load = interpolatedLoad(pts, { z0: Z0 });
        expect(measuredLoadInfo(load)?.mode).toBe('fitted');
        const fe = feasibility(load, sweepPoints(lo, hi, 21))!;
        expect(fe.fromFit).toBe(true);
        expect(fe.method).toBe('exact');
        expect(fe.model).toBe(name);
        expect(Math.abs(fe.floor / vswrOfLn(ln) - 1)).toBeLessThan(0.01);
      });
    }
  }

  it('a two-resonance load gets the estimate from the analytic Q, with fewer than 9 band points too', () => {
    const load = interpolatedLoad(pointsOf(antenna, sweepPoints(0.6e9, 2.4e9, 101), 1e-3));
    const fe = feasibility(load, sweepPoints(1.1e9, 1.5e9, 5))!;
    expect(fe).not.toBeNull();
    expect(fe.fromFit).toBe(true);
    expect(fe.method).toBe('estimate');
    expect(fe.floor).toBeGreaterThan(1);
    expect(Number.isFinite(fe.q)).toBe(true);
  });

  it('a resonant series RLC: the analytic Q gives the textbook Q0 = w0 L / R at its centre', () => {
    // Resonance at the geometric centre of 0.9 to 1.1 GHz.
    const l = 40e-9;
    const f0 = Math.sqrt(0.9e9 * 1.1e9);
    const c = 1 / (w(f0) ** 2 * l);
    const z = (f: number): Complex => complex(30, w(f) * l - 1 / (w(f) * c));
    const load = interpolatedLoad(pointsOf(z, sweepPoints(0.8e9, 1.2e9, 41)), { z0: Z0 });
    const fe = feasibility(load, sweepPoints(0.9e9, 1.1e9, 21))!;
    expect(fe.method).toBe('estimate');
    expect(fe.q / ((w(f0) * l) / 30)).toBeCloseTo(1, 6);
  });
});

/* ------------------------------------------------ band tools use the model */

describe('band tools read the fitted model', () => {
  const freqs = sweepPoints(0.6e9, 1.4e9, 41);
  const pts = pointsOf(antenna, sweepPoints(0.6e9, 2.4e9, 81));
  const fitted = interpolatedLoad(pts, { z0: Z0 });
  const linear = interpolatedLoad(pts, { z0: Z0, fit: false });
  const network: Element[] = [
    { kind: 'C', orientation: 'shunt', value: 2e-12 },
    { kind: 'L', orientation: 'series', value: 5e-9 },
  ];

  it('worstVswr and the frequency sweep evaluate the model at every frequency', () => {
    const lad = { z0: Z0, frequency: 1e9, load: complex(50), elements: network };
    const sweep = sweepFrequency(lad, [0.77e9], fitted as LoadModel as (f: number) => Complex);
    const direct = sweepFrequency(
      { ...lad, load: (fitted as (f: number) => Complex)(0.77e9) },
      [0.77e9],
    );
    expect(sweep[0]!.zin).toEqual(direct[0]!.zin);
    expect(worstVswr(network, fitted, Z0, freqs)).not.toBe(worstVswr(network, linear, Z0, freqs));
  });

  it('broadbandMatch quotes the floor from the fitted model', () => {
    const res = broadbandMatch(sweepPoints(1.1e9, 1.5e9, 9), {
      load: fitted,
      z0: Z0,
      maxElements: 2,
    });
    expect(res.floor?.fromFit).toBe(true);
    // The linear fallback keeps D1's floor, from the band points.
    const lin = broadbandMatch(sweepPoints(1.1e9, 1.5e9, 9), {
      load: linear,
      z0: Z0,
      maxElements: 1,
    });
    expect(lin.floor?.fromFit).toBeUndefined();
  });

  it('monteCarlo judges the band with the given load', () => {
    const lad = {
      z0: Z0,
      frequency: 1e9,
      load: (fitted as (f: number) => Complex)(1e9),
      elements: network,
    };
    const base = { runs: 20, tolerance: 0.05, vswrLimit: 3, band: freqs };
    const withModel = monteCarlo(lad, { ...base, load: fitted });
    const fixed = monteCarlo(lad, base);
    expect(withModel.nominal.worst).toBeCloseTo(worstVswr(network, fitted, Z0, freqs), 12);
    expect(withModel.nominal.worst).not.toBe(fixed.nominal.worst);
  });
});
