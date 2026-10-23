/**
 * QA round 2 on distributed synthesis: the exact band of the built lines,
 * inRange, the widened high-pass bracket and the Kuroda overflow guard.
 * Expected values are worked by hand from closed forms (Pozar 5.4 for the
 * exact single-section band), never pasted from the code under test.
 */
import { describe, expect, it } from 'vitest';
import {
  cabs,
  commensurateAbcd,
  commensurateS,
  designStubFilter,
  inRange,
  kuroda,
  multisectionTransformer,
  REALIZABLE_IMPEDANCE,
} from '../src/index';

const F = 1e9;

/** Exact band of one quarter-wave section: cos(theta_m) = Gm / sqrt(1 - Gm^2) * 2 sqrt(Z0 ZL) / |ZL - Z0|. */
function singleSectionBand(z0: number, zl: number, gm: number): number {
  const c = (gm / Math.sqrt(1 - gm * gm)) * ((2 * Math.sqrt(z0 * zl)) / Math.abs(zl - z0));
  return 2 - (4 * Math.acos(c)) / Math.PI;
}

describe('qa r2: exact transformer band', () => {
  it('one section: the exact band equals the closed form of Pozar 5.4 (0.180897 for 50 to 100 ohm at 0.05)', () => {
    for (const type of ['binomial', 'chebyshev'] as const) {
      const a = multisectionTransformer(50, 100, 1, { type, frequency: F, gammaMax: 0.05 });
      expect(a.bandwidth).toBeCloseTo(0.1808967355, 8);
      expect(a.bandwidth).toBeCloseTo(singleSectionBand(50, 100, 0.05), 8);
      const b = multisectionTransformer(50, 10, 1, { type, frequency: F, gammaMax: 0.05 });
      expect(b.bandwidth).toBeCloseTo(0.0713026548, 8);
      const c = multisectionTransformer(200, 50, 1, { type, frequency: F, gammaMax: 0.1 });
      expect(c.bandwidth).toBeCloseTo(singleSectionBand(50, 200, 0.1), 8);
    }
  });

  it('a step whose bare mismatch is under the limit is whole band, even where the first-order theory has an edge', () => {
    // 50 to 60 ohm: bare |Gamma| = 10 / 110 = 0.0909 < 0.091, but ln(1.2) / 2 = 0.09116 > 0.091,
    // so the theory finds an edge: theta_m = acos(0.091 / 0.09116), BW 1.92437.
    const t = multisectionTransformer(50, 60, 1, {
      type: 'binomial',
      frequency: F,
      gammaMax: 0.091,
    });
    expect(t.bandwidth).toBeNull();
    expect(t.theoryBandwidth).toBeCloseTo(1.9243692, 6);
    // Without a theory edge the peak is taken over the whole band: the bare mismatch at DC.
    const u = multisectionTransformer(50, 52, 3, {
      type: 'chebyshev',
      frequency: F,
      gammaMax: 0.05,
    });
    expect(u.bandwidth).toBeNull();
    expect(u.theoryBandwidth).toBeNull();
    expect(u.peakGamma).toBeCloseTo(2 / 102, 9);
    expect(u.centreGamma).toBeLessThan(1e-9);
  });

  it('an even-order Chebyshev centre reflection is tanh(gammaMax), just under the limit, so its band is not 0', () => {
    // At f0 the quarter waves of an even cascade map the load through exp(2 sum (+-Gamma_k)),
    // whose logarithm is exactly 2 A T_N(0) = +-2 gammaMax: |Gamma(f0)| = tanh(gammaMax).
    for (const n of [2, 4, 6]) {
      const t = multisectionTransformer(50, 150, n, {
        type: 'chebyshev',
        frequency: F,
        gammaMax: 0.05,
      });
      expect(t.centreGamma).toBeCloseTo(Math.tanh(0.05), 9);
      expect(t.bandwidth as number).toBeGreaterThan(0);
    }
  });

  it('more sections never narrow the reported band (6:1 and 5:1 steps, both types)', () => {
    // Pozar 5.6 and 5.7: each added section widens the band at a fixed limit.
    const bad: string[] = [];
    for (const zl of [300, 10]) {
      for (const type of ['binomial', 'chebyshev'] as const) {
        let prev = 0;
        for (let n = 1; n <= 6; n++) {
          const t = multisectionTransformer(50, zl, n, { type, frequency: F, gammaMax: 0.05 });
          const bw = t.bandwidth as number;
          if (bw < prev)
            bad.push(`50 to ${zl} ${type} N=${n}: ${bw.toFixed(3)} after ${prev.toFixed(3)}`);
          prev = bw;
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('qa r2: exact band at extreme steps', () => {
  // Known limit, QA round 2: at 100:1 the small-reflection synthesis is too coarse (see
  // adv-r2-distributed.test.ts); the bands are true for the lines built.
  it.fails(
    'a fifth Chebyshev section does not narrow the band of four at 100:1 and |Gamma| 0.01',
    () => {
      const bw = (n: number): number =>
        multisectionTransformer(50, 5000, n, { type: 'chebyshev', frequency: F, gammaMax: 0.01 })
          .bandwidth as number;
      expect(bw(5)).toBeGreaterThanOrEqual(bw(4));
    },
  );
});

describe('qa r2: inRange', () => {
  it('keeps values within 1e-9 relative of a limit and refuses those beyond, NaN and a reversed range', () => {
    const r = REALIZABLE_IMPEDANCE;
    expect(r).toEqual([15, 150]);
    expect(inRange(150, r)).toBe(true);
    expect(inRange(15, r)).toBe(true);
    expect(inRange(150 * (1 + 5e-10), r)).toBe(true);
    expect(inRange(15 * (1 - 5e-10), r)).toBe(true);
    expect(inRange(150 * (1 + 2e-9), r)).toBe(false);
    expect(inRange(15 * (1 - 2e-9), r)).toBe(false);
    expect(inRange(80, r)).toBe(true);
    expect(inRange(Number.NaN, r)).toBe(false);
    expect(inRange(Infinity, r)).toBe(false);
    expect(inRange(80, [150, 15])).toBe(false);
    expect(inRange(1e6, [0, Infinity])).toBe(true);
  });

  it('designStubFilter uses it: a 75 ohm Butterworth N = 3 has 150 ohm stubs and lines, none flagged', () => {
    const d = designStubFilter({
      kind: 'lowpass',
      response: 'butterworth',
      order: 3,
      cutoff: F,
      z0: 75,
    });
    expect(d.outOfRange).toEqual([]);
    expect(Math.max(...d.elements.map((el) => el.z0))).toBeCloseTo(150, 9);
  });
});

describe('qa r2: high-pass bracket', () => {
  it('very small ripples down to 1e-6 dB still land the cutoff loss exactly, or refuse with a RangeError', () => {
    // The cutoff loss of a lossless network between equal terminations is -20 log10 |S21|.
    for (const ripple of [1e-6, 1e-4, 0.001]) {
      for (let n = 1; n <= 9; n++) {
        let d;
        try {
          d = designStubFilter({
            kind: 'highpass',
            response: 'chebyshev',
            order: n,
            rippleDb: ripple,
            cutoff: F,
            z0: 50,
          });
        } catch (e) {
          expect(e).toBeInstanceOf(RangeError);
          continue;
        }
        const net = d.elements.map((el) =>
          el.kind === 'line'
            ? { kind: 'ue' as const, z: el.z0 / 50 }
            : { kind: 'shuntShort' as const, z: el.z0 / 50 },
        );
        const s21 = cabs(commensurateS(net, Math.PI / 4, 1)[2]!);
        expect(-20 * Math.log10(s21)).toBeCloseTo(ripple, 9);
      }
    }
  });

  it('every ripple the tool accepts (0.001 to 10 dB) designs without throwing', () => {
    for (const ripple of [0.001, 0.002, 0.005, 0.05, 1, 5, 10]) {
      for (let n = 1; n <= 9; n++) {
        expect(() =>
          designStubFilter({
            kind: 'highpass',
            response: 'chebyshev',
            order: n,
            rippleDb: ripple,
            cutoff: F,
            z0: 50,
          }),
        ).not.toThrow();
      }
    }
  });
});

describe('qa r2: Kuroda guard and theta = 0', () => {
  it('throws a RangeError when an identity overflows or underflows', () => {
    // (a): shunt Z = zu (zu + zs) / zs = 1e300 * 2e300 / 1e300 overflows in the product.
    expect(() => kuroda({ kind: 'ue', z: 1e300 }, { kind: 'seriesShort', z: 1e300 })).toThrow(
      RangeError,
    );
    // (a) backwards: UE zs zu / (zu + zs) = 1e-300 * 1e-300 / 2e-300 underflows to 0.
    expect(() => kuroda({ kind: 'shuntOpen', z: 1e-300 }, { kind: 'ue', z: 1e-300 })).toThrow(
      RangeError,
    );
    // Ordinary values still pass: (a) with 70 and 35 gives a 105 ohm UE.
    expect(kuroda({ kind: 'ue', z: 70 }, { kind: 'seriesShort', z: 35 })[1]).toEqual({
      kind: 'ue',
      z: 105,
    });
  });

  it('at theta = 0 a series open stub is an open and a shunt short a short: finite ABCD, S21 = 0', () => {
    for (const kind of ['seriesOpen', 'shuntShort'] as const) {
      for (const th of [0, -0]) {
        const m = commensurateAbcd({ kind, z: 50 }, th);
        for (const v of [m.a, m.b, m.c, m.d]) {
          expect(Number.isFinite(v.re) && Number.isFinite(v.im)).toBe(true);
        }
        const s = commensurateS([{ kind, z: 50 }], th, 50);
        expect(cabs(s[2]!)).toBeLessThan(1e-12);
        expect(cabs(s[0]!)).toBeCloseTo(1, 12);
      }
    }
    // The stubs that are a through at DC stay exact: a series short is 0 ohm, a shunt open 0 S.
    const t = commensurateS(
      [
        { kind: 'seriesShort', z: 50 },
        { kind: 'shuntOpen', z: 50 },
      ],
      0,
      50,
    );
    expect(cabs(t[2]!)).toBeCloseTo(1, 12);
  });
});
