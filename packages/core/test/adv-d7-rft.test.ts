/**
 * QA round 1 on D7 (the real frequency technique), adversarial. Each `it` is
 * one attack; a failing expectation is a defect kept in the report, a passing
 * one an attack the code survived.
 */
import { describe, expect, it } from 'vitest';
import {
  broadbandMatch,
  cabs,
  cadd,
  cdiv,
  complex,
  csub,
  feasibility,
  hurwitzFactor,
  interpolatedLoad,
  ladderAbcd,
  polynomialRoots,
  realFrequencyMatch,
  rftBandLimit,
  sweepPoints,
  synthesizeLadder,
  throughAbcd,
  type Element,
  type LoadModel,
  type RftProgress,
} from '../src/index.js';

function ladderGain(
  els: readonly Element[],
  load: LoadModel,
  r0: number,
  fs: readonly number[],
): number[] {
  return fs.map((f) => {
    const zl = typeof load === 'function' ? load(f) : load;
    const zin = throughAbcd(ladderAbcd(els, f), zl);
    const g = cabs(cdiv(csub(zin, complex(r0, 0)), cadd(zin, complex(r0, 0))));
    return 1 - g * g;
  });
}

/** A high-Q series RL load: 2 ohm and 200 nH, 100 to 150 MHz (Q 63 to 94). */
const HIGH_Q: LoadModel = (f) => complex(2, 2 * Math.PI * f * 200e-9);
const HIGH_Q_BAND = (n: number) => sweepPoints(100e6, 150e6, Math.max(21, 4 * n + 1));

describe('D7 adversarial: optimality claims', () => {
  it('a 2-part RFT ladder on a high-Q load is no worse than the 2-part search', () => {
    const freqs = HIGH_Q_BAND(2);
    const rft = realFrequencyMatch(freqs, { load: HIGH_Q, z0: 50, parts: 2 });
    const search = broadbandMatch(freqs, { load: HIGH_Q, z0: 50, maxElements: 2 });
    const same = Math.min(
      ...search.candidates.filter((c) => c.count === 2).map((c) => c.worstVswr),
    );
    // Observed: RFT 64.503 (shape 64.555, labelled "Best gain shape, 2 parts"), search 59.382.
    expect(rft.best!.worstVswr).toBeLessThanOrEqual(same * (1 + 1e-6));
  }, 120000);

  // QA fix: the app now runs every part count on the same band points (33 here), so a run of
  // n + 1 parts contains the run of n exactly. The round 1 version compared runs on different
  // point sets (21 against 29, 29 against 33), which no guarantee covers; and it compared the
  // larger run's gain shape, which is no longer called best (the row is "Gain shape found"),
  // where the claim is about the result, the ladder.
  const SAME_BAND = sweepPoints(100e6, 150e6, 33);

  it('the 5-part ladder is no worse than the 4-part ladder (high-Q load, same band)', () => {
    const four = realFrequencyMatch(SAME_BAND, { load: HIGH_Q, z0: 50, parts: 4 });
    const five = realFrequencyMatch(SAME_BAND, { load: HIGH_Q, z0: 50, parts: 5 });
    // Round 1: 4 parts ladder 31.049, 5 parts shape 31.883 and ladder 31.368.
    expect(five.best!.worstVswr).toBeLessThanOrEqual(four.best!.worstVswr * (1 + 1e-9));
  }, 300000);

  it('the 8-part ladder is no worse than the 7-part ladder (high-Q load, same band)', () => {
    // One 8-part run carries the 7-part run it started from (result.lower), the same run as on
    // its own (the 4 and 5 part test above runs them separately); a second 7-part run would only
    // double the time, which the full suite cannot spare.
    const eight = realFrequencyMatch(SAME_BAND, { load: HIGH_Q, z0: 50, parts: 8 });
    const seven = eight.lower!;
    expect(seven.parts).toBe(7);
    // Round 1: 7 parts ladder 26.480, 8 parts shape 26.947 and ladder 26.838.
    expect(eight.best!.worstVswr).toBeLessThanOrEqual(seven.best!.worstVswr * (1 + 1e-9));
  }, 900000);

  // Round 1 also asked that "the best gain shape" not be beaten by its own ladder (3 parts:
  // shape 50.004, polished ladder 41.669). Dropped: the row is now "Gain shape found", and the
  // panel says the ladder is polished after it; the plot test below checks the stated gap.
});

describe('D7 adversarial: the plotted gain against the ladder that is applied', () => {
  it('the plot draws the applied ladder, and the stated gap is the real one', () => {
    const freqs = HIGH_Q_BAND(4);
    const r = realFrequencyMatch(freqs, { load: HIGH_Q, z0: 50, parts: 4 });
    const b = r.best!;
    const applied = ladderGain(b.elements, HIGH_Q, 50, r.scoringFrequencies);
    let worst = 0;
    applied.forEach((t, i) => {
      worst = Math.max(worst, Math.abs(t - (b.gain[i] as number)));
    });
    // Round 1: synthesisError 4.6e-8 (no gap stated), |T(applied) - T(shape)| 0.041 (the plot
    // drew -7.02 dB where the applied ladder gives -8.02 dB). The panel now plots ladderGain
    // and states the largest gap from the shape.
    applied.forEach((t, i) =>
      expect(Math.abs(t - (b.ladderGain[i] as number))).toBeLessThan(1e-12),
    );
    expect(Math.abs(worst - b.shapeGap)).toBeLessThan(1e-12);
  }, 120000);
});

describe('D7 adversarial: Bode-Fano', () => {
  // A measured parallel RC load (R 50 ohm, C 31.8 pF, omega R C = 10 at 1 GHz) fitted at 50 ohm,
  // matched over 0.6 to 1 GHz with a 50 ohm series resistor kept in the design (Keep on).
  const C = 10 / (2 * Math.PI * 1e9 * 50);
  const rc = (f: number) => cdiv(complex(50, 0), complex(1, 2 * Math.PI * f * 50 * C));
  const points = sweepPoints(0.5e9, 1.1e9, 61).map((f) => ({ frequency: f, z: rc(f) }));

  it('the ladder the panel shows never beats the Bode-Fano limit it shows beside it', () => {
    const model = interpolatedLoad(points, { z0: 50 });
    const freqs = sweepPoints(0.6e9, 1e9, 21);
    const prefix: Element[] = [{ kind: 'R', orientation: 'series', value: 50 }];
    const result = realFrequencyMatch(freqs, { load: model, z0: 50, prefix, parts: 2 });
    // Round 1: the worker sent the floor of the bare load, 2.676 (exact, from the fitted
    // model), beside a ladder of 1.007 (baseline 1.176). It now sends rftBandLimit: no limit
    // through a kept part with loss, and never one that the ladder or the load beats.
    expect(feasibility(model, result.scoringFrequencies)!.floor).toBeGreaterThan(2.6);
    const limit = rftBandLimit(result, model, prefix);
    expect(limit.floor).toBeNull();
    expect(limit.note).toMatch(/loss/);
    // Without the resistor the limit holds and is shown.
    const bare = realFrequencyMatch(freqs, { load: model, z0: 50, parts: 2 });
    const shown = rftBandLimit(bare, model);
    expect(shown.floor).not.toBeNull();
    expect(bare.best!.worstVswr).toBeGreaterThanOrEqual(shown.floor!.floor);
  }, 120000);
});

describe('D7 adversarial: hostile loads and bands (survival)', () => {
  const band = sweepPoints(100e6, 200e6, 21);
  const loads: [string, LoadModel][] = [
    ['purely reactive', complex(0, 50)],
    ['short', complex(0, 0)],
    ['open (1e18 ohm)', complex(1e18, 0)],
    ['infinite', complex(Infinity, 0)],
    ['NaN', complex(NaN, 0)],
    ['negative R', complex(-10, 20)],
    ['negative R with L', (f) => complex(-10, 2 * Math.PI * f * 50e-9)],
  ];
  for (const [name, load] of loads) {
    it(`${name}: no throw, no NaN, no ladder or a finite one`, () => {
      const r = realFrequencyMatch(band, { load, z0: 50, parts: 2 });
      if (r.best) {
        expect(Number.isFinite(r.best.worstVswr)).toBe(true);
        expect(r.best.gain.every(Number.isFinite)).toBe(true);
      }
      expect(Number.isNaN(r.baseline)).toBe(false);
    }, 60000);
  }

  it('measured rows with negative resistance give no ladder rather than NaN', () => {
    const pts = band.map((f, i) => ({
      frequency: f,
      z: complex(i % 5 === 0 ? -3 : 8, 2 * Math.PI * f * 40e-9),
    }));
    const r = realFrequencyMatch(band, {
      load: interpolatedLoad(pts, { z0: 50 }),
      z0: 50,
      parts: 2,
    });
    expect(r.best === null || Number.isFinite(r.best.worstVswr)).toBe(true);
  }, 60000);

  it('zero-width, single-point and reversed bands', () => {
    const load: LoadModel = (f) => complex(10, 2 * Math.PI * f * 50e-9);
    expect(realFrequencyMatch([1e8, 1e8], { load, z0: 50, parts: 2 }).best).toBeNull();
    expect(realFrequencyMatch([1e8], { load, z0: 50, parts: 2 }).best).toBeNull();
    expect(realFrequencyMatch([], { load, z0: 50, parts: 2 }).best).toBeNull();
    const up = realFrequencyMatch(sweepPoints(70e6, 130e6, 21), { load, z0: 50, parts: 2 });
    const down = realFrequencyMatch(sweepPoints(130e6, 70e6, 21), { load, z0: 50, parts: 2 });
    expect(down.best!.worstVswr).toBe(up.best!.worstVswr);
  }, 60000);

  it('bands at 1 Hz and 100 GHz, and Z0 of 1, 75 and 1e4 ohm', () => {
    const lo = realFrequencyMatch(sweepPoints(1, 2, 21), {
      load: (f) => complex(10, 2 * Math.PI * f * 5),
      z0: 50,
      parts: 2,
    });
    const hi = realFrequencyMatch(sweepPoints(90e9, 110e9, 21), {
      load: (f) => complex(10, 2 * Math.PI * f * 50e-12),
      z0: 50,
      parts: 2,
    });
    expect(lo.best!.worstVswr).toBeLessThan(lo.baseline);
    expect(hi.best!.worstVswr).toBeLessThan(hi.baseline);
    for (const z0 of [1, 75, 1e4]) {
      const r = realFrequencyMatch(sweepPoints(70e6, 130e6, 21), {
        load: (f) => complex(10, 2 * Math.PI * f * 50e-9),
        z0,
        parts: 2,
      });
      expect(r.best!.worstVswr).toBeLessThan(r.baseline);
      expect(r.best!.synthesisError).toBeLessThan(1e-6);
    }
  }, 120000);

  it('part counts outside 1 to 8 are clamped', () => {
    const load: LoadModel = (f) => complex(10, 2 * Math.PI * f * 50e-9);
    const band2 = sweepPoints(70e6, 130e6, 21);
    expect(realFrequencyMatch(band2, { load, z0: 50, parts: 0 }).parts).toBe(1);
    expect(realFrequencyMatch(band2, { load, z0: 50, parts: -3 }).parts).toBe(1);
    expect(realFrequencyMatch(band2, { load, z0: 50, parts: 2.7 }).parts).toBe(2);
  }, 60000);

  it('progress never runs backwards and its total never changes', () => {
    const seen: RftProgress[] = [];
    realFrequencyMatch(sweepPoints(70e6, 130e6, 21), {
      load: (f) => complex(10, 2 * Math.PI * f * 50e-9),
      z0: 50,
      parts: 3,
      onProgress: (p) => seen.push(p),
    });
    const totals = new Set(seen.map((p) => p.total));
    expect(totals.size).toBe(1);
    seen.forEach((p, i) => {
      if (i) expect(p.done).toBeGreaterThan((seen[i - 1] as RftProgress).done);
    });
    expect(seen[seen.length - 1]!.done).toBe(seen[0]!.total);
  }, 60000);
});

describe('D7 adversarial: polynomial conditioning and the continued fraction (survival)', () => {
  it('roots with a near-zero leading coefficient and roots on the axis', () => {
    const r = polynomialRoots([1, 2, 1e-12]);
    const big = r.reduce((m, z) => (cabs(z) > cabs(m) ? z : m));
    expect(Math.abs(big.re + 2e12) / 2e12).toBeLessThan(1e-9);
    const axis = polynomialRoots([1, 0, 1]);
    for (const z of axis) expect(Math.abs(Math.abs(z.im) - 1)).toBeLessThan(1e-12);
  });

  it('no Hurwitz factor where h h* + f f* vanishes on the axis', () => {
    // k = 1 and h(0) = 0: a zero at p = 0.
    expect(hurwitzFactor([0, 1], 1)).toBeNull();
    // A leading coefficient whose square underflows.
    const g = hurwitzFactor([0, 1, 1e-170], 0);
    expect(g === null || g.length < 3).toBe(true);
  });

  it('the continued fraction refuses a negative element and a non-resistive end', () => {
    // Z = (1 + p) / (1 - p): no pole to remove and not a resistance.
    expect(synthesizeLadder({ h: [0, 1], g: [1, 0], k: 0 })).toBeNull();
    expect(synthesizeLadder({ h: [0, 0], g: [0, 0], k: 0 })).toBeNull();
  });
});
