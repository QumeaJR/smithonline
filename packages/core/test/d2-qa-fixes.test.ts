/**
 * Depth phase D2, the QA round's fixes: the order search, the guards against
 * a model that fits the points and not the load, the exact passivity check,
 * the fit carried across a worker boundary, and broadband candidates without
 * idle parts.
 */
import { describe, expect, it } from 'vitest';
import {
  broadbandMatch,
  complex,
  fitReflection,
  maxFitOrder,
  measuredFitOf,
  measuredLoad,
  measuredLoadFromFit,
  measuredLoadInfo,
  parameterBound,
  pendingMeasuredLoad,
  sweepPoints,
  unitCrossingFrequencies,
  vectorFitFromData,
  zToGamma,
  type Complex,
  type RationalModel,
} from '../src/index';

const w = (f: number): number => 2 * Math.PI * f;
const dist = (a: Complex, b: Complex): number => Math.hypot(a.re - b.re, a.im - b.im);
const rlc = (f: number): Complex => complex(20, w(f) * 10e-9 - 1 / (w(f) * 3e-12));

describe('the order cap for few points', () => {
  it('N/3 below 20 points, 2N/3 from 20, at most 30', () => {
    expect(maxFitOrder(6)).toBe(2);
    expect(maxFitOrder(8)).toBe(2);
    expect(maxFitOrder(19)).toBe(6);
    expect(maxFitOrder(20)).toBe(13);
    expect(maxFitOrder(201)).toBe(30);
  });
});

describe('a model that fits the points and not the load is not used', () => {
  // 26 rows of a series RLC rounded to 3 decimals in R and X (noise of about 0.1 ohm).
  const fs = sweepPoints(0.8e9, 1.4e9, 26);
  const rows = fs.map((f) => {
    const z = rlc(f);
    return { frequency: f, z: complex(Number(z.re.toFixed(3)), Number(z.im.toFixed(3))) };
  });

  it('the model follows the load between the rows, checked between the points', () => {
    const load = measuredLoad(rows);
    const info = measuredLoadInfo(load)!;
    expect(info.mode).toBe('fitted');
    expect(info.fit!.validation?.passed).toBe(true);
    let worst = 0;
    for (const f of sweepPoints(0.8e9, 1.4e9, 20001))
      worst = Math.max(worst, dist(zToGamma(load(f), 50), zToGamma(rlc(f), 50)));
    expect(worst).toBeLessThan(0.01);
  });

  it('a resonance between two rows no data resolves is dropped (no pole narrower than the spacing)', () => {
    const fit = measuredLoadInfo(measuredLoad(rows))!.fit!;
    const spacing = w(fs[1]! - fs[0]!);
    for (const p of fit.model.poles) {
      if (p.im === 0) continue;
      const inside = Math.abs(p.im) >= w(0.8e9) * 0.9 && Math.abs(p.im) <= w(1.4e9) * 1.1;
      if (inside) expect(-p.re).toBeGreaterThanOrEqual(0.5 * spacing * (1 - 1e-9));
    }
  });
});

describe('the exact passivity check', () => {
  it('the crossings of |Gamma| = 1 from the Hamiltonian are where |Gamma| is 1', () => {
    // A resonance whose peak rises above 1: H = r / (s - a) + d with a = -s0 + j w0.
    const w0 = w(1e9);
    const model: RationalModel = {
      poles: [complex(-0.05 * w0, w0), complex(-0.05 * w0, -w0)],
      residues: [complex(0.08 * w0, 0), complex(0.08 * w0, 0)],
      d: 0.3,
      e: 0,
    };
    const h = (f: number): Complex => {
      let re = model.d;
      let im = 0;
      model.poles.forEach((p, i) => {
        const r = model.residues[i]!;
        const dr = -p.re;
        const di = w(f) - p.im;
        const den = dr * dr + di * di;
        re += (r.re * dr + r.im * di) / den;
        im += (r.im * dr - r.re * di) / den;
      });
      return complex(re, im);
    };
    const peak = Math.hypot(h(1e9).re, h(1e9).im);
    expect(peak).toBeGreaterThan(1);
    const cross = unitCrossingFrequencies(model, 1e9);
    expect(cross.length).toBe(2);
    for (const f of cross) expect(Math.abs(Math.hypot(h(f).re, h(f).im) - 1)).toBeLessThan(1e-9);
    expect(cross[0]!).toBeLessThan(1e9);
    expect(cross[1]!).toBeGreaterThan(1e9);
  });

  it('a coarse check grid still finds every violation (crossings and the points between them)', () => {
    let s = 9;
    const rnd = (): number => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647 - 0.5;
    };
    const fs = sweepPoints(0.5e9, 1.5e9, 201);
    const g = fs.map((f) => {
      const v = zToGamma(complex(0, w(f) * 10e-9 - 1 / (w(f) * 3e-12)), 50);
      return complex(v.re + 2e-3 * rnd(), v.im + 2e-3 * rnd());
    });
    const fit = fitReflection(fs, g, { passivity: { points: 11 } });
    let worst = 0;
    for (const f of sweepPoints(0.45e9, 1.65e9, 100001)) {
      const v = fit.evaluate(f);
      worst = Math.max(worst, Math.hypot(v.re, v.im));
    }
    expect(worst).toBeLessThanOrEqual(1 + 1e-9);
    expect(fit.passivity?.atInfinity).toBeGreaterThanOrEqual(0);
  });
});

describe('the fit across a worker boundary', () => {
  const rows = sweepPoints(0.5e9, 1.5e9, 41).map((f) => ({ frequency: f, z: rlc(f) }));

  it('measuredFitOf, vectorFitFromData and measuredLoadFromFit give the load measuredLoad gives', () => {
    const direct = measuredLoad(rows, { z0: 50 });
    const data = measuredFitOf(rows, { z0: 50 });
    expect(data).not.toBeNull();
    // Plain data: it survives a structured clone (JSON here).
    const rebuilt = vectorFitFromData(JSON.parse(JSON.stringify(data)));
    const viaWorker = measuredLoadFromFit(rows, { z0: 50 }, rebuilt);
    expect(measuredLoadInfo(viaWorker)!.reason).toBe('fitted');
    for (const f of sweepPoints(0.45e9, 1.6e9, 101)) {
      const a = direct(f);
      const b = viaWorker(f);
      expect(dist(a, b) / Math.hypot(a.re, a.im)).toBeLessThan(1e-12);
    }
  });

  it('a failed fit (null) falls back to linear interpolation, and pending says it is pending', () => {
    expect(measuredLoadInfo(measuredLoadFromFit(rows, { z0: 50 }, null))!.reason).toBe('failed');
    const pending = pendingMeasuredLoad(rows, { z0: 50 });
    expect(measuredLoadInfo(pending)).toMatchObject({ mode: 'linear', reason: 'pending' });
    expect(pending(rows[3]!.frequency)).toEqual(rows[3]!.z);
  });
});

describe('broadband candidates have no idle part and appear once', () => {
  it('no listed part sits at the bound where it does next to nothing; each shape once', () => {
    const load = (f: number): Complex => complex(25, w(f) * 8e-9);
    const band = sweepPoints(0.8e9, 1.2e9, 21);
    const res = broadbandMatch(band, { load, z0: 50, maxElements: 3 });
    const f0 = 1e9;
    const keys = new Set<string>();
    for (const c of res.candidates) {
      expect(c.count).toBe(c.elements.length);
      for (const el of c.elements) {
        if (el.kind !== 'L' && el.kind !== 'C') continue;
        const b = parameterBound(el, 50, f0)!;
        const small = el.kind === 'L' ? b.lo : b.hi;
        const large = el.kind === 'L' ? b.hi : b.lo;
        const idle = el.orientation === 'series' ? small : large;
        expect(Math.abs(Math.log(el.value / idle))).toBeGreaterThan(1e-3);
      }
      const key = c.topology.label;
      expect(keys.has(key)).toBe(false);
      keys.add(key);
    }
  }, 120000);
});
