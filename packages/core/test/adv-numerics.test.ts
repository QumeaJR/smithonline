/**
 * Adversarial tests, QA round 1: the numerical modules of the feature batch
 * (broadband, Monte Carlo, stress, winding, line dimensions, limit areas,
 * band optimizer with a custom cost and target).
 */
import { describe, expect, it } from 'vitest';
import {
  broadbandMatch,
  coaxRatio,
  complex,
  enumerateTopologies,
  feasibility,
  interpolatedLoad,
  ladderStress,
  limitCost,
  limitStatus,
  lineDimensions,
  microstripWidth,
  microstripZ0,
  monteCarlo,
  optimizeBand,
  seedValues,
  solenoidInductance,
  solenoidTurns,
  sweepFrequency,
  sweepPoints,
  sweepResponse,
  toroidTurns,
  vswrHistogram,
  worstVswr,
  OPTIMIZE_FAIL,
  type Ladder,
  type LimitArea,
} from '../src/index';

const ladder: Ladder = {
  z0: 50,
  frequency: 1e9,
  load: complex(20, -12),
  elements: [
    { kind: 'L', orientation: 'shunt', value: 8e-9 },
    { kind: 'C', orientation: 'series', value: 3e-12 },
  ],
};

describe('adv: broadband search', () => {
  it('a band given high to low is not silently answered with no candidates', () => {
    const asc = broadbandMatch([0.8e9, 0.9e9, 1e9, 1.1e9, 1.2e9], {
      load: complex(20, -12),
      z0: 50,
      maxElements: 2,
      evaluationsPerCandidate: 200,
    });
    const desc = broadbandMatch([1.2e9, 1.1e9, 1e9, 0.9e9, 0.8e9], {
      load: complex(20, -12),
      z0: 50,
      maxElements: 2,
      evaluationsPerCandidate: 200,
    });
    expect(asc.candidates.length).toBeGreaterThan(0);
    expect(desc.candidates.length).toBe(asc.candidates.length);
  });

  it('interpolatedLoad with duplicate frequencies never returns NaN', () => {
    const load = interpolatedLoad([
      { frequency: 1e9, z: complex(10, 0) },
      { frequency: 2e9, z: complex(20, 0) },
      { frequency: 2e9, z: complex(30, 0) },
      { frequency: 3e9, z: complex(40, 0) },
    ]);
    expect(typeof load).toBe('function');
    const f = load as (f: number) => { re: number; im: number };
    for (const x of [0.5e9, 1e9, 1.5e9, 2e9, 2.5e9, 3e9, 4e9]) {
      const z = f(x);
      expect(Number.isFinite(z.re), String(x)).toBe(true);
      expect(Number.isFinite(z.im), String(x)).toBe(true);
    }
  });

  it('seedValues for 8 slots chains sections and lands near the target at band centre', () => {
    const slots = enumerateTopologies(8).filter((t) => t.slots.length === 8)[0]!.slots;
    const seeded = seedValues(slots, complex(10, 0), complex(50, 0), 1e9);
    if (seeded) {
      expect(seeded).toHaveLength(8);
      expect(worstVswr(seeded, complex(10, 0), 50, [1e9])).toBeLessThan(1.5);
    }
  });

  it('a load with no resistance gives an empty table and a finite baseline, not a throw', () => {
    const r = broadbandMatch([0.9e9, 1e9, 1.1e9], {
      load: complex(0, 30),
      z0: 50,
      maxElements: 1,
      evaluationsPerCandidate: 100,
    });
    expect(r.baseline).toBe(OPTIMIZE_FAIL);
    expect(r.candidates).toEqual([]);
  });

  it('feasibility of a load function that returns NaN at one point is null, not NaN', () => {
    const load = (f: number) => (f === 1e9 ? complex(NaN, 0) : complex(20, 10 * (f / 1e9)));
    expect(feasibility(load, sweepPoints(0.8e9, 1.2e9, 9))).toBeNull();
  });
});

describe('adv: Monte Carlo', () => {
  it('a 500 percent tolerance keeps every part positive and the result finite', () => {
    const r = monteCarlo(ladder, { runs: 500, tolerance: 5, vswrLimit: 2, seed: 3 });
    expect(r.runs).toBe(500);
    expect(Array.from(r.re).every((v) => Number.isFinite(v))).toBe(true);
    expect(r.stats.min).toBeGreaterThanOrEqual(1);
  });

  it('bins of 0, NaN or Infinity do not crash the histogram', () => {
    for (const bins of [0, NaN, Infinity, -5]) {
      expect(() => vswrHistogram([1.1, 1.5, 3], bins), String(bins)).not.toThrow();
      expect(
        () => monteCarlo(ladder, { runs: 5, tolerance: 0.05, vswrLimit: 2, bins }),
        String(bins),
      ).not.toThrow();
    }
  });

  it('a VSWR limit of NaN or below 1 gives a yield of 0, not NaN', () => {
    const r = monteCarlo(ladder, { runs: 50, tolerance: 0.05, vswrLimit: NaN });
    expect(r.yield).toBe(0);
    expect(Number.isNaN(r.yield)).toBe(false);
  });

  it('the same seed reproduces the same cloud, and a different seed does not', () => {
    const a = monteCarlo(ladder, { runs: 100, tolerance: 0.1, vswrLimit: 2, seed: 42 });
    const b = monteCarlo(ladder, { runs: 100, tolerance: 0.1, vswrLimit: 2, seed: 42 });
    const c = monteCarlo(ladder, { runs: 100, tolerance: 0.1, vswrLimit: 2, seed: 43 });
    expect(Array.from(a.re)).toEqual(Array.from(b.re));
    expect(Array.from(a.re)).not.toEqual(Array.from(c.re));
  });

  it('an override of 0 keeps that part exact even with a default tolerance', () => {
    const r = monteCarlo(
      { ...ladder, elements: [{ kind: 'L', orientation: 'series', value: 8e-9 }] },
      { runs: 20, tolerance: 0.2, vswrLimit: 2, overrides: { 0: 0 } },
    );
    expect(new Set(Array.from(r.re)).size).toBe(1);
  });

  it('a band where every run is a total reflection reports worst = Infinity and yield 0', () => {
    const open: Ladder = { ...ladder, load: complex(0, 0), elements: [] };
    const r = monteCarlo(open, { runs: 10, tolerance: 0.05, vswrLimit: 2, band: [1e9, 2e9] });
    expect(r.yield).toBe(0);
    expect(r.nominal.worst).toBe(Infinity);
    expect(Array.from(r.worst).every((w) => w === Infinity)).toBe(true);
  });
});

describe('adv: stress', () => {
  it('matches a hand calculation: 1 W into 50 ohm through a series 50 ohm resistor', () => {
    const r = ladderStress(
      {
        z0: 50,
        frequency: 1e9,
        load: complex(50, 0),
        elements: [{ kind: 'R', orientation: 'series', value: 50 }],
      },
      1,
    );
    // Vs = sqrt(8 * 50 * 1) = 20 V peak; I = 20 / 150 A peak; V_R = 50 I.
    expect(r[0]!.vPeak).toBeCloseTo(50 * (20 / 150), 9);
    expect(r[0]!.iRms).toBeCloseTo(20 / 150 / Math.SQRT2, 9);
  });

  it('a short-circuit load with a shunt part gives finite zeros, not NaN', () => {
    const r = ladderStress(
      {
        ...ladder,
        load: complex(0, 0),
        elements: [{ kind: 'C', orientation: 'shunt', value: 3e-12 }],
      },
      1,
    );
    expect(Number.isFinite(r[0]!.vPeak)).toBe(true);
    expect(Number.isFinite(r[0]!.iRms)).toBe(true);
  });

  it('a series part with value 0 and an open load stay finite', () => {
    const r = ladderStress(
      {
        ...ladder,
        load: complex(1e12, 0),
        elements: [
          { kind: 'L', orientation: 'series', value: 0 },
          { kind: 'RLC', orientation: 'shunt', connection: 'series', r: 0, l: 0, c: 1e-12 },
        ],
      },
      10,
    );
    for (const s of r) {
      expect(s).not.toBeNull();
      expect(Number.isFinite(s!.vPeak)).toBe(true);
      expect(Number.isFinite(s!.iRms)).toBe(true);
      for (const p of s!.parts) {
        expect(Number.isFinite(p.vPeak)).toBe(true);
        expect(Number.isFinite(p.iRms)).toBe(true);
      }
    }
  });

  it('power of Infinity, NaN or negative gives zeros', () => {
    for (const p of [Infinity, NaN, -1]) {
      const r = ladderStress(ladder, p);
      expect(r[0]!.vPeak, String(p)).toBe(0);
      expect(r[0]!.iRms, String(p)).toBe(0);
    }
  });
});

describe('adv: winding', () => {
  it('Wheeler at the rounded turns reproduces the wanted inductance within the rounding', () => {
    const r = solenoidTurns({ inductance: 1e-6, diameter: 0.01, length: 0.02 })!;
    expect(r).not.toBeNull();
    expect(solenoidInductance(r.turns, 0.01, 0.02)).toBeCloseTo(r.inductance, 15);
    expect(Math.abs(r.exactTurns - r.turns)).toBeLessThanOrEqual(0.5);
  });

  it('leads of NaN or negative do not poison the wire length', () => {
    for (const leads of [NaN, -1, Infinity]) {
      const r = solenoidTurns({ inductance: 1e-6, diameter: 0.01, pitch: 0.001, leads });
      expect(r, String(leads)).not.toBeNull();
      expect(Number.isFinite(r!.wireLength), String(leads)).toBe(true);
      const t = toroidTurns({ inductance: 1e-6, al: 10, turnLength: 0.02, leads });
      expect(t!.wireLength === null || Number.isFinite(t!.wireLength), String(leads)).toBe(true);
    }
  });

  it('a tiny inductance that needs less than half a turn says so rather than promising one turn', () => {
    const r = solenoidTurns({ inductance: 1e-12, diameter: 0.05, length: 0.001 })!;
    expect(r.turns).toBe(1);
    // One turn is at least 100 times the wanted inductance: the result should carry a warning.
    expect(r.inductance / 1e-12).toBeGreaterThan(100);
    expect(r.warning ?? '').not.toBe('');
  });
});

describe('adv: line dimensions', () => {
  it('microstrip width round trip is within 1 percent over the buildable range, thick or thin', () => {
    let worst = 0;
    for (const t of [0, 0.02, 0.1]) {
      for (const er of [1, 2.2, 4.4, 10.2]) {
        for (let z0 = 10; z0 <= 150; z0 += 2.5) {
          const w = microstripWidth(z0, er, t);
          if (!w) continue;
          worst = Math.max(worst, Math.abs(microstripZ0(w.wOverH, er, t) - z0) / z0);
        }
      }
    }
    expect(worst).toBeLessThan(0.01);
  });

  it('a substrate with er below 1 is refused, not answered with a velocity above c', () => {
    const d = lineDimensions({ medium: 'microstrip', er: 0.5, h: 1e-3 }, 50, 0.25, 1e9);
    expect(d === null || d.eeff >= 1).toBe(true);
  });

  it('coax: an impedance that needs an impossible ratio is null; 50 ohm air is 2.30', () => {
    expect(coaxRatio(50, 1).ratio).toBeCloseTo(2.302, 2);
    expect(
      lineDimensions({ medium: 'coax', er: 1, given: 'inner', diameter: 1e-3 }, 1e6, 0.25, 1e9),
    ).toBeNull();
    expect(
      lineDimensions({ medium: 'coax', er: 1, given: 'inner', diameter: 1e-3 }, 0, 0.25, 1e9),
    ).toBeNull();
  });

  it('thickness larger than the substrate height does not produce NaN', () => {
    const d = lineDimensions({ medium: 'microstrip', er: 4.4, h: 1e-4, t: 1e-3 }, 50, 0.25, 1e9);
    expect(d === null || (Number.isFinite(d.width!) && Number.isFinite(d.length))).toBe(true);
  });
});

describe('adv: limit areas and the band optimizer', () => {
  const freqs = sweepPoints(0.5e9, 1.5e9, 41);
  const response = sweepResponse(sweepFrequency(ladder, freqs));

  it('an area whose range holds no sample is null and does not count in the cost', () => {
    const area: LimitArea = {
      id: 'a',
      quantity: 'vswr',
      f1: 1.0001e9,
      f2: 1.0002e9,
      kind: 'max',
      value: 1.1,
    };
    expect(limitStatus(area, response)).toBeNull();
    // The cost adds the edges to the grid, so the same area is then judged at its edges.
    const cost = limitCost(ladder, [area], freqs)(ladder.elements);
    expect(Number.isFinite(cost)).toBe(true);
  });

  it('a min limit on s11Db over a perfect match (-Infinity dB) is a breach, not a NaN', () => {
    const through: Ladder = { ...ladder, load: complex(50, 0), elements: [] };
    const resp = sweepResponse(sweepFrequency(through, freqs));
    const area: LimitArea = {
      id: 'a',
      quantity: 's11Db',
      f1: 0.5e9,
      f2: 1.5e9,
      kind: 'min',
      value: -40,
    };
    const st = limitStatus(area, resp)!;
    expect(st.worst).toBe(Infinity);
    expect(limitCost(through, [area], freqs)([])).toBe(OPTIMIZE_FAIL);
    const maxArea: LimitArea = { ...area, kind: 'max' };
    expect(limitCost(through, [maxArea], freqs)([])).toBe(0);
  });

  it('a custom cost that returns NaN leaves the design unchanged rather than adopting garbage', () => {
    const r = optimizeBand(ladder, freqs, { cost: () => NaN, restarts: 2, iterations: 20 });
    expect(r.elements).toBe(ladder.elements);
    expect(Number.isNaN(r.after) || r.after === r.before).toBe(true);
  });

  it('maxEvaluations is honoured within one simplex step and 0 means no search', () => {
    let calls = 0;
    const r = optimizeBand(ladder, freqs, {
      cost: (els) => {
        calls++;
        return worstVswr(els, ladder.load, 50, freqs);
      },
      maxEvaluations: 50,
      restarts: 100,
      iterations: 300,
    });
    expect(r.evaluations).toBeLessThanOrEqual(51);
    expect(calls).toBeLessThanOrEqual(51);
    const none = optimizeBand(ladder, freqs, { maxEvaluations: 0, restarts: 5 });
    expect(none.elements).toBe(ladder.elements);
  });

  it('a target with zero or negative resistance does not crash and never reports a VSWR below 1', () => {
    for (const target of [complex(0, 0), complex(-50, 0), complex(0, 30)]) {
      const r = optimizeBand(ladder, freqs, { target, restarts: 2, iterations: 30 });
      expect(r.after >= 1 || r.after === OPTIMIZE_FAIL, JSON.stringify(target)).toBe(true);
    }
  });

  it('a bounds override with lo > hi or lo = hi is survived', () => {
    for (const b of [
      { lo: 1e-9, hi: 1e-9 },
      { lo: 1e-8, hi: 1e-9 },
      { lo: 0, hi: 1e-9 },
    ]) {
      const r = optimizeBand(ladder, freqs, { bounds: { 0: b }, restarts: 2, iterations: 30 });
      expect(
        r.elements.every((e) => e.kind !== 'L' || Number.isFinite(e.value)),
        JSON.stringify(b),
      ).toBe(true);
    }
  });

  it('the custom cost sees the whole ladder with the varied values in place, and before equals cost(original)', () => {
    const cost = (els: readonly { kind: string }[]): number =>
      els.length === 2 ? worstVswr(els as never, ladder.load, 50, freqs) : 1e9;
    const r = optimizeBand(ladder, freqs, { cost: cost as never, restarts: 3, iterations: 100 });
    expect(r.before).toBeCloseTo(worstVswr(ladder.elements, ladder.load, 50, freqs), 12);
    expect(r.after).toBeLessThanOrEqual(r.before);
    expect(r.after).toBeLessThan(1e9);
  });
});
