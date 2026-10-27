/**
 * D6: the closed loop of closedloop.ts. On synthetic measurements of a known
 * board with known drifts (the network as built of the "Make it buildable"
 * workflow: shunt L 12 nH and series C 2.7 pF in 0402 on FR-4 1.6 mm at 1 GHz,
 * load 100 - j50 ohm, drifted by +8 % on the shunt L and +0.3 pF on the series
 * C's pads), the fit recovers the drifts exactly without noise and within its
 * own uncertainty with noise; parameters the data cannot resolve are flagged
 * rather than fitted; the fit refuses what the data cannot support; the retune
 * snaps to the source and brings the built board back inside the target.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  cabs,
  compareMeasurement,
  csub,
  DEFAULT_BOARD,
  DEFAULT_PACKAGES,
  driftedElements,
  driftParameters,
  nearestInSeries,
  fitBuild,
  maxUnknowns,
  modelGammas,
  parseStock,
  readTouchstone,
  retuneCandidates,
  retuneEvaluator,
  retunedWorst,
  sensitivityAt,
  singularValues,
  suggestRetune,
  syntheticPart,
  SYNTHETIC_PARTS,
  modelLoad,
  type BuildModel,
  type Complex,
  type Element,
  type MeasuredReflection,
} from '../src/index';

const MODEL: BuildModel = {
  z0: 50,
  frequency: 1e9,
  base: [
    { kind: 'L', orientation: 'shunt', value: 12e-9, package: '0402' },
    { kind: 'C', orientation: 'series', value: 2.7e-12, package: '0402' },
  ],
  table: DEFAULT_PACKAGES,
  board: { ...DEFAULT_BOARD, enabled: true },
  load: { re: 100, im: -50 },
};
const TRUTH = { 'value:0': 0.08, 'pad:1': 0.3e-12 };
const BAND = Array.from({ length: 11 }, (_, i) => 0.9e9 + 0.02e9 * i);

function frequencies(n: number, lo = 0.7e9, hi = 1.3e9): number[] {
  return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
}

/** A seeded normal generator (Park-Miller and Box-Muller). */
function normal(seed: number): () => number {
  let s = seed;
  const u = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

function measure(
  model: BuildModel,
  drifts: Record<string, number>,
  fs: readonly number[],
  noise = 0,
  seed = 7,
): MeasuredReflection[] {
  const g = modelGammas(model, drifts, fs);
  const n = normal(seed);
  return g.map((x, i) => ({
    frequency: fs[i] as number,
    gamma: { re: x.re + noise * n(), im: x.im + noise * n() },
  }));
}

const byId = (fit: { parameters: readonly { id: string }[] }, id: string) =>
  fit.parameters.find((p) => p.id === id) as ReturnType<typeof driftParameters>[number] & {
    status: string;
    drift: number;
    sigma: number | null;
    partner?: string;
    why?: string;
  };

describe('the parameters of a model', () => {
  it('offers part values, pads, the board and marks what a first fit tries', () => {
    const ids = driftParameters(MODEL).map((p) => `${p.id}${p.freeByDefault ? '*' : ''}`);
    expect(ids).toEqual([
      'value:0*',
      'value:1*',
      'pad:0*',
      'pad:1*',
      'padScale',
      'via*',
      'er',
      'h',
      'plane',
    ]);
  });

  it('a board off with no packages offers part values and the reference plane only', () => {
    const m: BuildModel = {
      ...MODEL,
      base: MODEL.base.map((el) => ({ ...el, package: undefined }) as never),
      board: DEFAULT_BOARD,
    };
    const ids = driftParameters(m).map((p) => `${p.id}${p.freeByDefault ? '*' : ''}`);
    // Fix round 2: no pad parameter where the network as built has no pads.
    expect(ids).toEqual(['value:0*', 'value:1*', 'plane']);
  });

  it('applies a drift where it belongs', () => {
    const els = driftedElements(MODEL, TRUTH);
    const nominal = driftedElements(MODEL, {});
    expect((els[0] as { value: number }).value).toBeCloseTo(12.96e-9, 20);
    const pad = (el: unknown): number => (el as { parasitics: { pad: number } }).parasitics.pad;
    expect(pad(els[1]) - pad(nominal[1])).toBeCloseTo(0.3e-12, 24);
    expect(pad(els[0])).toBe(pad(nominal[0]));
    const via = (el: unknown): number => (el as { board: { via: number } }).board.via;
    expect(via(driftedElements(MODEL, { via: 0.5 })[0]) / via(nominal[0])).toBeCloseTo(1.5, 12);
  });

  it("the Jacobian's part-value column is D3's analytic derivative (against central differences)", () => {
    const els = driftedElements(MODEL, {});
    const { at } = modelLoad(MODEL);
    for (const f of [0.8e9, 1e9, 1.2e9]) {
      const s = sensitivityAt(els, at(f), 50, f, {
        parameters: [{ index: 0, parameter: 'value' }],
      });
      const h = 1e-6;
      const gp = modelGammas(MODEL, { 'value:0': h }, [f])[0] as Complex;
      const gm = modelGammas(MODEL, { 'value:0': -h }, [f])[0] as Complex;
      const fd = { re: (gp.re - gm.re) / (2 * h * 12e-9), im: (gp.im - gm.im) / (2 * h * 12e-9) };
      const an = s.dGamma[0] as Complex;
      expect(cabs(csub(an, fd)) / cabs(an)).toBeLessThan(1e-6);
    }
  });
});

describe('fit what moved', () => {
  it('recovers +8 % on the shunt L and +0.3 pF on a pad exactly from clean data', () => {
    const out = fitBuild(MODEL, measure(MODEL, TRUTH, frequencies(121)));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const fit = out.fit;
    expect(byId(fit, 'value:0').drift).toBeCloseTo(0.08, 8);
    expect(byId(fit, 'pad:1').drift).toBeCloseTo(0.3e-12, 20);
    expect(Math.abs(byId(fit, 'value:1').drift)).toBeLessThan(1e-9);
    expect(Math.abs(byId(fit, 'pad:0').drift)).toBeLessThan(1e-20);
    expect(fit.rmsAfter).toBeLessThan(1e-9);
    expect(fit.rmsBefore).toBeGreaterThan(0.1);
  });

  it('flags the via: its effect cannot be told from the shunt L it is in series with', () => {
    const out = fitBuild(MODEL, measure(MODEL, TRUTH, frequencies(121)));
    if (!out.ok) throw new Error(out.reason);
    const via = byId(out.fit, 'via');
    expect(via.status).toBe('unresolved');
    expect(via.why).toBe('like-another');
    expect(via.partner).toBe('value:0');
    expect(via.drift).toBe(0);
    expect(via.sigma).toBeNull();
    // Without the via the set is well conditioned.
    expect(out.fit.condition).toBeLessThan(100);
  });

  it('with noise the drifts come back within their stated uncertainty, which is calibrated', () => {
    const fs = frequencies(121);
    const est: number[] = [];
    const sig: number[] = [];
    for (let seed = 1; seed <= 30; seed++) {
      // Fix round 3: the fit's own uncertainty (the plane check widens the stated one to cover
      // a plane not ticked, by design, so it is left out here).
      const out = fitBuild(MODEL, measure(MODEL, TRUTH, fs, 2e-3, seed * 7919), {
        planeCheck: false,
      });
      if (!out.ok) throw new Error(out.reason);
      const p = byId(out.fit, 'value:0');
      expect(p.status).toBe('fitted');
      expect(Math.abs(p.drift - 0.08)).toBeLessThan(4 * (p.sigma as number));
      const pad = byId(out.fit, 'pad:1');
      expect(Math.abs(pad.drift - 0.3e-12)).toBeLessThan(4 * (pad.sigma as number));
      est.push(p.drift);
      sig.push(p.sigma as number);
    }
    const mean = est.reduce((a, b) => a + b, 0) / est.length;
    const sd = Math.sqrt(est.reduce((a, b) => a + (b - mean) ** 2, 0) / (est.length - 1));
    const stated = sig.reduce((a, b) => a + b, 0) / sig.length;
    // The scatter of 30 fits and the stated sigma agree within a factor of 1.6.
    expect(sd / stated).toBeGreaterThan(1 / 1.6);
    expect(sd / stated).toBeLessThan(1.6);
  }, 60000);

  it('fixes a parameter the noise swamps instead of reporting noise', () => {
    // Few points over a narrow band and much noise: the C pads cannot be resolved.
    const fs = frequencies(5, 0.98e9, 1.02e9);
    const out = fitBuild(MODEL, measure(MODEL, TRUTH, fs, 0.02, 3), {
      free: ['value:0', 'value:1', 'pad:0'],
    });
    if (!out.ok) throw new Error(out.reason);
    const unresolved = out.fit.parameters.filter((p) => p.status === 'unresolved');
    expect(unresolved.length).toBeGreaterThan(0);
    for (const p of unresolved) expect(p.drift).toBe(0);
    for (const p of out.fit.parameters.filter((q) => q.status === 'fitted')) {
      expect(p.sigma as number).toBeLessThan(0.5 * p.prior);
    }
  });

  it('flags a pad scale that the per-part pads already span', () => {
    const out = fitBuild(MODEL, measure(MODEL, TRUTH, frequencies(121)), {
      free: ['value:0', 'value:1', 'pad:0', 'pad:1', 'padScale'],
    });
    if (!out.ok) throw new Error(out.reason);
    const s = byId(out.fit, 'padScale');
    expect(s.status).toBe('unresolved');
    expect(['pad:0', 'pad:1']).toContain(s.partner);
    expect(byId(out.fit, 'value:0').drift).toBeCloseTo(0.08, 8);
  });

  it('says a parameter has no effect when the network does not depend on it', () => {
    const m: BuildModel = {
      ...MODEL,
      base: [...MODEL.base, { kind: 'C', orientation: 'series', value: 1 }],
    };
    const out = fitBuild(m, measure(m, TRUTH, frequencies(41)), { free: ['value:0', 'value:2'] });
    if (!out.ok) throw new Error(out.reason);
    expect(byId(out.fit, 'value:2').status).toBe('no-effect');
    expect(byId(out.fit, 'value:0').status).toBe('fitted');
  });

  it('reports a correlated pair of fitted parameters', () => {
    // er and h move the pads and the via together; over a narrow band they correlate.
    const out = fitBuild(
      MODEL,
      measure(MODEL, { 'value:0': 0.02 }, frequencies(31, 0.95e9, 1.05e9)),
      {
        free: ['value:0', 'value:1', 'er', 'h'],
      },
    );
    if (!out.ok) throw new Error(out.reason);
    const flagged = out.fit.parameters.filter(
      (p) => p.status === 'unresolved' || p.partner !== undefined,
    );
    expect(flagged.length).toBeGreaterThan(0);
  });

  it('refuses more unknowns than the data supports', () => {
    const fs = frequencies(3);
    expect(maxUnknowns(3)).toBe(4);
    const out = fitBuild(MODEL, measure(MODEL, TRUTH, fs));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/5 unknowns from 3 frequencies .*at most 4/);
  });

  it('refuses too few points, no parameter, and points outside the measured load', () => {
    const two = fitBuild(MODEL, measure(MODEL, TRUTH, frequencies(2)));
    expect(two.ok).toBe(false);
    if (!two.ok) expect(two.reason).toMatch(/only 2 measured frequencies/);
    const none = fitBuild(MODEL, measure(MODEL, TRUTH, frequencies(11)), { free: [] });
    expect(none.ok).toBe(false);
    const measuredLoad: BuildModel = {
      ...MODEL,
      load: [
        { frequency: 2e9, z: { re: 100, im: -50 } },
        { frequency: 3e9, z: { re: 100, im: -50 } },
      ],
    };
    const outside = fitBuild(measuredLoad, measure(MODEL, TRUTH, frequencies(11)));
    expect(outside.ok).toBe(false);
    if (!outside.ok) expect(outside.reason).toMatch(/no measured frequency/);
  });

  it('works against a measured load, inside its band only', () => {
    const rows = frequencies(41, 0.8e9, 1.2e9).map((f) => ({
      frequency: f,
      z: { re: 100 + (f - 1e9) * 2e-8, im: -50 + (f - 1e9) * 5e-8 },
    }));
    const m: BuildModel = { ...MODEL, load: rows };
    const meas = measure(m, TRUTH, frequencies(121));
    const out = fitBuild(m, meas);
    if (!out.ok) throw new Error(out.reason);
    expect(out.fit.leftOut).toBeGreaterThan(0);
    expect(byId(out.fit, 'value:0').drift).toBeCloseTo(0.08, 6);
  });

  it('ignores points that are not numbers and hostile values', () => {
    const meas = measure(MODEL, TRUTH, frequencies(61));
    const bad = [
      ...meas,
      { frequency: NaN, gamma: { re: 0, im: 0 } },
      { frequency: 1e9, gamma: { re: Infinity, im: 0 } },
      { frequency: -5, gamma: { re: 0, im: 0 } },
      { frequency: 1.01e9, gamma: { re: 5, im: 0 } },
    ];
    const out = fitBuild(MODEL, bad);
    if (!out.ok) throw new Error(out.reason);
    expect(out.fit.leftOut).toBe(4);
    expect(byId(out.fit, 'value:0').drift).toBeCloseTo(0.08, 8);
  });
});

describe('compare', () => {
  it('reads |dGamma| per frequency and the worst VSWR measured against designed', () => {
    const meas = measure(MODEL, TRUTH, frequencies(121));
    const c = compareMeasurement(MODEL, meas, { band: [0.9e9, 1.1e9] });
    expect(c.points).toHaveLength(121);
    expect(c.worstDelta).toBeGreaterThan(0.1);
    expect(c.designedWorst?.vswr).toBeCloseTo(1.5909, 3);
    expect(c.measuredWorst?.vswr).toBeCloseTo(1.9399, 3);
    const same = compareMeasurement(MODEL, meas, { drifts: TRUTH });
    expect(same.worstDelta).toBeLessThan(1e-12);
  });
});

describe('suggest a retune', () => {
  const fitted = (() => {
    const out = fitBuild(MODEL, measure(MODEL, TRUTH, frequencies(121), 1e-3));
    if (!out.ok) throw new Error(out.reason);
    return out.fit.drifts;
  })();

  it('snaps to E24, brings the built board inside VSWR 1.38 and says one change is enough', () => {
    const source = { kind: 'series' as const, series: 'E24' as const };
    const r = suggestRetune(MODEL, fitted, {
      band: BAND,
      limit: 1.38,
      candidates: retuneCandidates(source, 1e9, BAND),
    });
    expect(r.before.vswr).toBeGreaterThan(1.9);
    expect(r.suggestion?.inside).toBe(true);
    expect(r.suggestion?.changes).toHaveLength(1);
    expect(r.first).toBe(0);
    const to = r.suggestion?.changes[0]?.to as { value: number; package: string };
    expect(nearestInSeries(to.value, 'E24') / to.value).toBeCloseTo(1, 12);
    expect(to.package).toBe('0402');
    // The expected result checked on its own: the true drifts with the suggested part.
    const truthWorst = retunedWorst(MODEL, TRUTH, new Map([[0, to as never]]), BAND);
    expect(truthWorst.vswr).toBeLessThanOrEqual(1.38 + 0.01);
  });

  it('snaps to a stock list and keeps locked parts', () => {
    // Values with their units: "L: 10n" read as nothing (fix round: the test checked nothing).
    const stock = parseStock('10 nH; 11 nH; 15 nH; 2.2 pF; 2.7 pF; 3.3 pF');
    expect(stock.L).toHaveLength(3);
    expect(stock.C).toHaveLength(3);
    const r = suggestRetune(MODEL, fitted, {
      band: BAND,
      limit: 1.38,
      candidates: retuneCandidates({ kind: 'stock', stock }, 1e9, BAND),
      locked: [1],
    });
    expect(r.suggestion?.changes.length ?? 0).toBeGreaterThan(0);
    for (const c of r.suggestion?.changes ?? []) {
      expect(c.index).toBe(0);
      expect(
        [10e-9, 11e-9, 15e-9].some((v) => Math.abs((c.to as { value: number }).value - v) < 1e-15),
      ).toBe(true);
    }
  });

  it('picks library parts that cover the band', () => {
    const parts = SYNTHETIC_PARTS.map(syntheticPart);
    const cands = retuneCandidates({ kind: 'library', parts }, 1e9, BAND);
    const opts = cands(0, MODEL.base[0] as never);
    expect(opts.length).toBeGreaterThan(0);
    for (const o of opts) {
      expect(o.kind).toBe('part');
      expect((o as { part: { type: string } }).part.type).toBe('L');
    }
    const r = suggestRetune(MODEL, fitted, { band: BAND, limit: 1.38, candidates: cands });
    expect(r.suggestion).not.toBeNull();
    expect(r.evaluated).toBeGreaterThan(opts.length);
  });

  it('suggests nothing to change when nothing may change', () => {
    const r = suggestRetune(MODEL, fitted, {
      band: BAND,
      limit: 1.38,
      candidates: () => [],
    });
    expect(r.suggestion).toBeNull();
    expect(r.first).toBeNull();
  });
});

describe('singular values', () => {
  it('match a known matrix', () => {
    const sv = singularValues([
      [3, 0, 0],
      [0, 4, 0],
    ]);
    expect(sv[0]).toBeCloseTo(4, 12);
    expect(sv[1]).toBeCloseTo(3, 12);
  });
});

describe('the synthetic sample (scripts/synth-board.mjs)', () => {
  it('fits back to the drifts it was written with, within the stated uncertainty', () => {
    const text = readFileSync(
      fileURLToPath(new URL('./fixtures/sparams/board-1g-synthetic.s1p', import.meta.url)),
      'utf8',
    );
    const data = readTouchstone(text, 1);
    const meas = data.points.map((p) => ({
      frequency: p.frequency,
      gamma: p.s[0] as Complex,
    }));
    expect(meas).toHaveLength(121);
    // The sample's board: the workflow's start, its shunt L re-centred to 10 nH for the parts
    // and the board, so it meets the target as built and the drift alone takes it out.
    const sample: BuildModel = {
      ...MODEL,
      base: [{ ...(MODEL.base[0] as object), value: 10e-9 } as Element, MODEL.base[1] as Element],
    };
    const band = Array.from({ length: 11 }, (_, i) => 0.9e9 + 0.02e9 * i);
    expect(retunedWorst(sample, {}, new Map(), band).vswr).toBeLessThan(1.38);
    expect(
      retunedWorst(sample, { 'value:0': 0.08, 'pad:1': 0.3e-12 }, new Map(), band).vswr,
    ).toBeGreaterThan(1.38);
    const out = fitBuild(sample, meas);
    if (!out.ok) throw new Error(out.reason);
    const l = byId(out.fit, 'value:0');
    const pad = byId(out.fit, 'pad:1');
    expect(Math.abs(l.drift - 0.08)).toBeLessThan(3 * (l.sigma as number));
    expect(Math.abs(pad.drift - 0.3e-12)).toBeLessThan(3 * (pad.sigma as number));
    expect(Math.abs(l.drift - 0.08)).toBeLessThan(0.005);
    expect(out.fit.rmsAfter).toBeLessThan(2e-3);
    // The checks: the residual is noise, the drifts plausible, the design frequency measured.
    expect(out.fit.check.residual).toBe('noise');
    expect(out.fit.check.trusted).toBe(true);
    expect(out.fit.check.noiseFloor).toBeGreaterThan(0.0012);
    expect(out.fit.check.noiseFloor).toBeLessThan(0.0017);
    // One change brings it back: 10 nH to 9.1 nH (E24), inside 1.38.
    const r = suggestRetune(sample, out.fit.drifts, {
      band,
      limit: 1.38,
      candidates: retuneCandidates({ kind: 'series', series: 'E24' }, 1e9, band),
    });
    expect(r.suggestion?.changes.map((c) => [c.index, (c.to as { value: number }).value])).toEqual([
      [0, 9.1e-9],
    ]);
    expect(r.suggestion?.inside).toBe(true);
  });
});

describe('the fast retune evaluation', () => {
  it('equals the full model for value changes and library parts, with traces and vias', () => {
    const m: BuildModel = {
      ...MODEL,
      base: [...MODEL.base, { kind: 'L', orientation: 'shunt', value: 8.2e-9, package: '0603' }],
      board: { ...DEFAULT_BOARD, enabled: true, traceLength: 2e-3 },
    };
    const drifts = { 'value:0': 0.05, 'value:2': -0.03, 'pad:1': 0.1e-12, via: 0.2, trace: 0.5e-3 };
    const evaluate = retuneEvaluator(m, drifts, BAND);
    const part = syntheticPart(SYNTHETIC_PARTS.find((p) => p.circuit.type === 'L') as never);
    for (const replace of [
      new Map(),
      new Map([[0, { ...(m.base[0] as object), value: 10e-9 } as never]]),
      new Map([
        [1, { ...(m.base[1] as object), value: 3.3e-12 } as never],
        [2, { ...(m.base[2] as object), value: 6.8e-9 } as never],
      ]),
      new Map([[2, { kind: 'part', orientation: 'shunt', part } as never]]),
    ]) {
      const fast = evaluate(replace);
      const full = retunedWorst(m, drifts, replace, BAND);
      expect(fast.frequency).toBe(full.frequency);
      expect(Math.abs(fast.vswr - full.vswr) / full.vswr).toBeLessThan(1e-12);
    }
  });
});
