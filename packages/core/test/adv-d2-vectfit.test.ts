/**
 * Adversarial, QA round on depth phase D2 (measured load first): vector
 * fitting on hostile data, order selection, passivity enforcement, the
 * measured-load cache and extrapolation, and the floor from the fitted model.
 * A failing test is a defect, see the adversary report; the passing ones
 * document attacks the code survived.
 */
import { describe, expect, it } from 'vitest';
import {
  broadbandMatch,
  cadd,
  cdiv,
  cinv,
  complex,
  feasibility,
  fitReflection,
  interpolatedLoad,
  measuredLoadInfo,
  sweepDatapoints,
  sweepFrequency,
  sweepPoints,
  sweepPointsLog,
  vectorFit,
  zToGamma,
  type Complex,
  type SweepLoad,
} from '../src/index';

const w = (f: number): number => 2 * Math.PI * f;
const g50 = (z: Complex): Complex => zToGamma(z, 50);
const toZ = (g: Complex): Complex =>
  cdiv(complex(50 * (1 + g.re), 50 * g.im), complex(1 - g.re, -g.im));
const dist = (a: Complex, b: Complex): number => Math.hypot(a.re - b.re, a.im - b.im);
const mag = (a: Complex): number => Math.hypot(a.re, a.im);
const rot = (g: Complex, phase: number, k = 1): Complex =>
  complex(
    k * (g.re * Math.cos(phase) + g.im * Math.sin(phase)),
    k * (g.im * Math.cos(phase) - g.re * Math.sin(phase)),
  );

function noise(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647 - 0.5;
  };
}

const rlc = (f: number): Complex => complex(20, w(f) * 10e-9 - 1 / (w(f) * 3e-12));
const lossless = (f: number): Complex => complex(0, w(f) * 10e-9 - 1 / (w(f) * 3e-12));
const pts = (z: (f: number) => Complex, fs: readonly number[]): SweepLoad[] =>
  fs.map((f) => ({ frequency: f, z: z(f) }));

/* ------------------------------------------------------------- defects */

describe('D2 defects', () => {
  it('[blocker] 8 clean points of a series RLC: the accepted fit invents a resonance between two points', () => {
    // 20 ohm, 10 nH, 3 pF sampled at 8 points from 0.8 to 1.4 GHz, R and X to 3 decimals
    // (noise of about 0.1 ohm, a good VNA measurement).
    const rows: [number, number, number][] = [
      [800000000, 19.887, -15.989],
      [885714285.7142857, 20.035, -4.132],
      [971428571.4285715, 19.966, 6.413],
      [1057142857.1428571, 19.891, 16.242],
      [1142857142.857143, 20.091, 25.402],
      [1228571428.5714285, 19.918, 34.038],
      [1314285714.2857141, 19.893, 42.159],
      [1400000000, 19.893, 50.057],
    ];
    const points = rows.map(([frequency, r, x]) => ({ frequency, z: complex(r, x) }));
    const model = interpolatedLoad(points, { z0: 50 }) as (f: number) => Complex;
    const linear = interpolatedLoad(points, { z0: 50, fit: false }) as (f: number) => Complex;
    const info = measuredLoadInfo(model)!;
    // Was accepted as "fitted, order 4, max residual 0.0017 in Gamma" (the overfit). The fit of
    // order 2 that follows the load misses the rounded rows by 0.002, inside the 0.01 limit.
    expect(info.reason).toBe('fitted');
    expect(info.fit!.maxResidual).toBeLessThan(0.01);
    let worst = 0;
    let at = 0;
    let worstLinear = 0;
    for (const f of sweepPoints(0.8e9, 1.4e9, 60001)) {
      const e = dist(g50(model(f)), g50(rlc(f)));
      if (e > worst) {
        worst = e;
        at = f;
      }
      worstLinear = Math.max(worstLinear, dist(g50(linear(f)), g50(rlc(f))));
    }
    // Linear interpolation follows the load to 0.006; the fit is off by 0.36 near 1.0935 GHz
    // (model 11.7 + j37.5 ohm against the load's 20 + j20.2 ohm).
    expect(worstLinear).toBeLessThan(0.01);
    // Observed: off by 0.365 at 1.09346 GHz.
    expect(worst, `model off the load by ${worst} at ${at} Hz`).toBeLessThan(0.02);
  });

  it('[blocker] the invented resonance drives the band tools: floor above the best listed match, the true best match rated 3.37', () => {
    const rows: [number, number, number][] = [
      [800000000, 19.887, -15.989],
      [885714285.7142857, 20.035, -4.132],
      [971428571.4285715, 19.966, 6.413],
      [1057142857.1428571, 19.891, 16.242],
      [1142857142.857143, 20.091, 25.402],
      [1228571428.5714285, 19.918, 34.038],
      [1314285714.2857141, 19.893, 42.159],
      [1400000000, 19.893, 50.057],
    ];
    const model = interpolatedLoad(
      rows.map(([frequency, r, x]) => ({ frequency, z: complex(r, x) })),
      { z0: 50 },
    );
    // Band 1.0 to 1.2 GHz, inside the data: the floor from the fitted model is 3.33 (the load's
    // own is 1.01) while the best listed candidate scores 1.93 on the same model.
    const wide = broadbandMatch(sweepPoints(1.0e9, 1.2e9, 21), {
      load: model,
      z0: 50,
      maxElements: 2,
    });
    const best = wide.candidates[0]!.worstVswr;
    expect
      .soft(wide.floor!.floor, `floor ${wide.floor!.floor} above the best match ${best}`)
      .toBeLessThanOrEqual(best);
    // Band 1.05 to 1.15 GHz: on the load itself the best two-part match reaches 1.33; the
    // search on the fitted model offers 2.19 (1.73 on the real load).
    const band = sweepPoints(1.05e9, 1.15e9, 21);
    const onModel = broadbandMatch(band, { load: model, z0: 50, maxElements: 2 }).candidates[0]!;
    const onLoad = broadbandMatch(band, { load: rlc, z0: 50, maxElements: 2 }).candidates[0]!;
    expect(onModel.worstVswr).toBeLessThan(onLoad.worstVswr * 1.05);
  }, 120000);

  it('[blocker] the same happens in 2.5 to 7.5 percent of noisy few-point sets', () => {
    // 40 data sets each: series RLC, 11 points, noise 2e-3 in Gamma per part.
    let bad = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const rnd = noise(seed * 977 + 11);
      const fs = sweepPoints(0.8e9, 1.4e9, 11);
      const p = fs.map((f) => {
        const g = g50(rlc(f));
        return { frequency: f, z: toZ(complex(g.re + 2e-3 * rnd(), g.im + 2e-3 * rnd())) };
      });
      const m = interpolatedLoad(p, { z0: 50 }) as (f: number) => Complex;
      if (measuredLoadInfo(m)?.mode !== 'fitted') continue;
      let e = 0;
      for (const f of sweepPoints(0.8e9, 1.4e9, 20001))
        e = Math.max(e, dist(g50(m(f)), g50(rlc(f))));
      if (e > 0.05) bad++;
    }
    expect(bad).toBe(0);
  }, 60000);

  it('[major] order search gives up at order 5 on a load behind a short cable: linear fallback where order 16 fits to 3e-4', () => {
    // A 3:1 mismatch at the end of a 50 ohm line of 1 ns (2 ns round trip), 0.5 to 3 GHz.
    const fs = sweepPoints(0.5e9, 3e9, 201);
    const g = fs.map((f) => complex(0.5 * Math.cos(w(f) * 2e-9), -0.5 * Math.sin(w(f) * 2e-9)));
    const forced = fitReflection(fs, g, { order: 16 });
    expect(forced.maxResidual).toBeLessThan(1e-3);
    const auto = fitReflection(fs, g);
    // Observed: order 2, max residual 0.6.
    expect(auto.maxResidual).toBeLessThan(1e-2);
    const m = interpolatedLoad(
      fs.map((f, i) => ({ frequency: f, z: toZ(g[i]!) })),
      { z0: 50 },
    );
    expect(measuredLoadInfo(m)?.reason).toBe('fitted');
  });

  it('[major] order search: a 1 ohm + 0.3 nH load behind 0.55 ns of line falls back to linear (residual 1.2)', () => {
    const tau = 0.55e-9;
    const gl = (f: number): Complex => rot(g50(complex(1, w(f) * 0.3e-9)), 2 * w(f) * tau);
    const fs = sweepPoints(0.5e9, 3e9, 201);
    const forced = fitReflection(fs, fs.map(gl), { order: 20 });
    expect(forced.maxResidual).toBeLessThan(1e-3);
    const m = interpolatedLoad(
      pts((f) => toZ(gl(f)), fs),
      { z0: 50 },
    );
    // Observed: residual, order 4, max residual 1.2 (0.50 ns fits at order 12 to 3e-7).
    expect(measuredLoadInfo(m)?.reason).toBe('fitted');
  });

  it('[major] passivity: 50 failed perturbations wreck a good fit, then the wrecked model is scaled', () => {
    // Lossless series LC behind 0.2 ns of line, noise 1e-3 in Gamma, 41 points.
    const n = 41;
    const rnd = noise(3 * 13 + n);
    const fs = sweepPoints(0.5e9, 1.5e9, n);
    const g = fs.map((f) => {
      const a = rot(g50(lossless(f)), 2 * w(f) * 0.2e-9);
      return complex(a.re + 1e-3 * rnd(), a.im + 1e-3 * rnd());
    });
    const raw = vectorFit(fs, g, { asymptote: 'd' });
    expect(raw.maxResidual).toBeLessThan(1e-3); // 6.4e-4
    const fit = fitReflection(fs, g);
    expect(fit.passivity?.maxBefore).toBeLessThan(1.0003); // a violation of 2.6e-4
    // Scaling the raw model by 1 / 1.00026 keeps the residual at 7.4e-4.
    let peak = 0;
    for (const f of sweepPoints(0.45e9, 1.65e9, 200001))
      peak = Math.max(peak, mag(raw.evaluate(f)));
    let scaled = 0;
    fs.forEach((f, i) => {
      const v = raw.evaluate(f);
      scaled = Math.max(scaled, dist(complex(v.re / peak, v.im / peak), g[i]!));
    });
    expect(scaled).toBeLessThan(1e-3);
    // Observed: method 'scaling' after 50 iterations, max residual 0.034, so the measured load
    // falls back to linear interpolation.
    expect(fit.maxResidual).toBeLessThan(1e-2);
    const m = interpolatedLoad(
      fs.map((f, i) => ({ frequency: f, z: toZ(g[i]!) })),
      { z0: 50 },
    );
    expect(measuredLoadInfo(m)?.reason).toBe('fitted');
  });

  it('[minor] a band past the data gets a floor from the held constant load', () => {
    // Series 10 ohm + 20 nH measured 0.5 to 1 GHz; band 1.1 to 2.2 GHz, entirely past the data.
    const rl = (f: number): Complex => complex(10, w(f) * 20e-9);
    const model = interpolatedLoad(pts(rl, sweepPoints(0.5e9, 1e9, 21)), { z0: 50 });
    expect(measuredLoadInfo(model)?.mode).toBe('fitted');
    const band = sweepPoints(1.1e9, 2.2e9, 21);
    const floor = feasibility(model, band);
    // Observed: 3.08 'estimate' with Q = |X| / 2R of the held value (derivative 0 there); the
    // load's own floor is 8.84. D1 refuses a floor for a fixed load; a held one is the same.
    expect(floor).toBeNull();
  });
});

/* ------------------------------------------------------------- survived */

describe('D2 attacks survived', () => {
  const fs = sweepPoints(0.5e9, 1.5e9, 21);

  it('duplicate, unsorted and 1e-12-apart frequencies, NaN and Infinity rows', () => {
    const base = interpolatedLoad(pts(rlc, fs), { z0: 50 }) as (f: number) => Complex;
    const dup = interpolatedLoad(pts(rlc, [...fs, ...fs].reverse()), { z0: 50 }) as (
      f: number,
    ) => Complex;
    const near = interpolatedLoad(pts(rlc, [...fs, 1e9 * (1 + 1e-12)]), { z0: 50 }) as (
      f: number,
    ) => Complex;
    const bad = pts(rlc, fs);
    bad[5] = { frequency: bad[5]!.frequency, z: complex(NaN, 0) };
    bad[6] = { frequency: bad[6]!.frequency, z: complex(Infinity, 0) };
    const holes = interpolatedLoad(bad, { z0: 50 }) as (f: number) => Complex;
    for (const f of sweepPoints(0.5e9, 1.5e9, 101)) {
      for (const m of [base, dup, near, holes])
        expect(dist(g50(m(f)), g50(rlc(f)))).toBeLessThan(1e-9);
    }
    // Two points 1e-12 apart with different values: no spike between them.
    const step = [...pts(rlc, fs), { frequency: 1e9 * (1 + 1e-12), z: complex(21, rlc(1e9).im) }];
    const m = interpolatedLoad(step, { z0: 50 }) as (f: number) => Complex;
    for (const f of sweepPoints(0.5e9, 1.5e9, 2001))
      expect(dist(g50(m(f)), g50(rlc(f)))).toBeLessThan(0.02);
  });

  it('all points equal, R = 0 everywhere, a short, 2, 6 and 5000 points, 1 Hz to 100 GHz', () => {
    const flat = interpolatedLoad(
      fs.map((f) => ({ frequency: f, z: complex(30, 10) })),
      { z0: 50 },
    ) as (f: number) => Complex;
    for (const f of sweepPoints(0.5e9, 1.5e9, 2001))
      expect(dist(g50(flat(f)), g50(complex(30, 10)))).toBeLessThan(1e-3);
    const lc = interpolatedLoad(pts(lossless, fs), { z0: 50 }) as (f: number) => Complex;
    for (const f of sweepPoints(0.475e9, 1.575e9, 20001))
      expect(mag(g50(lc(f)))).toBeLessThanOrEqual(1);
    expect(measuredLoadInfo(interpolatedLoad(pts(() => complex(0, 0), fs)))?.mode).toBe('fitted');
    expect(measuredLoadInfo(interpolatedLoad(pts(rlc, [1e9, 2e9])))?.reason).toBe('few-points');
    expect(measuredLoadInfo(interpolatedLoad(pts(rlc, sweepPoints(0.5e9, 1.5e9, 6))))?.reason).toBe(
      'fitted',
    );
    const t0 = performance.now();
    expect(
      measuredLoadInfo(interpolatedLoad(pts(rlc, sweepPoints(0.5e9, 1.5e9, 5000))))?.reason,
    ).toBe('fitted');
    expect(performance.now() - t0).toBeLessThan(5000);
    const wide = sweepPointsLog(1, 1e11, 200);
    const rnd = noise(7);
    const wideRows = wide.map((f) => {
      const g = g50(lossless(f));
      return { frequency: f, z: toZ(complex(g.re + 2e-3 * rnd(), g.im + 2e-3 * rnd())) };
    });
    const wm = interpolatedLoad(wideRows, { z0: 50 }) as (f: number) => Complex;
    expect(measuredLoadInfo(wm)?.mode).toBe('fitted');
    for (const f of sweepPointsLog(0.95, 1.05e11, 200001))
      expect(mag(g50(wm(f)))).toBeLessThanOrEqual(1);
  }, 120000);

  it('narrow active resonances (|Gamma| up to 2) are made passive on a 400k-point grid', () => {
    for (const rneg of [-0.1, -2, -16.7]) {
      const L = 1e-3;
      const f0 = 1.234e6;
      const c0 = 1 / (w(f0) ** 2 * L);
      const z = (f: number): Complex =>
        cinv(cadd(cinv(complex(rneg, w(f) * L - 1 / (w(f) * c0))), complex(1e-5, 0)));
      for (const freqs of [sweepPointsLog(1e5, 1e10, 300), sweepPoints(1e6, 1.5e6, 300)]) {
        const fit = fitReflection(
          freqs,
          freqs.map((f) => g50(z(f))),
        );
        const lo = freqs[0]! * 0.95;
        const hi = freqs[freqs.length - 1]! * 1.05;
        const grid = hi / lo > 10 ? sweepPointsLog(lo, hi, 400001) : sweepPoints(lo, hi, 400001);
        let worst = 0;
        for (const f of grid) worst = Math.max(worst, mag(fit.evaluate(f)));
        expect(worst).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  }, 120000);

  it('extrapolation: followed to exactly 5 percent, held beyond', () => {
    const m = interpolatedLoad(pts(rlc, fs), { z0: 50 }) as (f: number) => Complex;
    const info = measuredLoadInfo(m)!;
    expect(info.range[1]).toBe(1.5e9 * 1.05);
    expect(dist(m(1.5e9 * 1.05), rlc(1.5e9 * 1.05))).toBeLessThan(1e-9);
    expect(m(1.5e9 * 1.2)).toEqual(m(1.5e9 * 1.05));
    expect(m(0.1e9)).toEqual(m(0.5e9 * 0.95));
  }, 120000);

  it('cache: equal content in two lists fits the same; Z0 is part of the key', () => {
    const a = interpolatedLoad(pts(rlc, fs), { z0: 50 }) as (f: number) => Complex;
    const b = interpolatedLoad(pts(rlc, fs), { z0: 50 }) as (f: number) => Complex;
    expect(a).not.toBe(b);
    expect(a(0.77e9)).toEqual(b(0.77e9));
    const list = pts(rlc, fs);
    expect(interpolatedLoad(list, { z0: 50 })).not.toBe(interpolatedLoad(list, { z0: 75 }));
    expect(measuredLoadInfo(interpolatedLoad(list, { z0: 75 }))?.z0).toBe(75);
  }, 120000);

  it('Response view: measured dots and the model agree within the fit residual at the measured frequencies', () => {
    const rnd = noise(4);
    const rows = fs.map((f) => {
      const g = g50(rlc(f));
      return { frequency: f, z: toZ(complex(g.re + 4e-3 * rnd(), g.im + 4e-3 * rnd())) };
    });
    const model = interpolatedLoad(rows, { z0: 50 }) as (f: number) => Complex;
    const info = measuredLoadInfo(model)!;
    expect(info.reason).toBe('fitted');
    const ladder = { z0: 50, frequency: 1e9, load: complex(50), elements: [] };
    const curve = sweepFrequency(ladder, fs, model);
    const dots = sweepDatapoints(ladder, rows);
    curve.forEach((c, i) => {
      expect(dist(g50(c.zin), g50(dots[i]!.zin))).toBeLessThanOrEqual(
        info.fit!.maxResidual + 1e-12,
      );
    });
  });

  it('no broadband candidate is listed below the exact floor of the same fitted model', () => {
    const rl = (f: number): Complex => complex(25, w(f) * 8e-9);
    const model = interpolatedLoad(pts(rl, sweepPoints(0.7e9, 1.3e9, 21)), { z0: 50 });
    for (const n of [5, 9, 21]) {
      const band = sweepPoints(0.7e9, 1.3e9, n);
      const res = broadbandMatch(band, { load: model, z0: 50, maxElements: 4 });
      expect(res.floor?.fromFit).toBe(true);
      for (const c of res.candidates)
        expect(c.worstVswr).toBeGreaterThanOrEqual(res.floor!.floor * (1 - 1e-3));
    }
  }, 300000);
});
