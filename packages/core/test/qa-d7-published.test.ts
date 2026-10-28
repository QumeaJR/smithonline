/**
 * QA round 1, D7: the real frequency technique against a published, openly
 * accessible matching example with numbers.
 *
 * Source (public domain, a US government report, read on archive.org):
 *   G. L. Matthaei, L. Young, E. M. T. Jones, "Design of Microwave Filters,
 *   Impedance-Matching Networks, and Coupling Structures", Volume I,
 *   Stanford Research Institute, January 1963, DTIC AD 402852 (the report the
 *   McGraw-Hill book of 1964 grew from).
 *   https://archive.org/details/DTIC_AD0402852
 *   Sec. 4.09 "Prototype Tchebyscheff impedance-matching networks giving
 *   minimum reflection", report pp. 121 to 129 (PDF pages 135 to 143), the
 *   worked example on p. 125; Sec. 4.10, pp. 130 to 135, Eqs. (4.10-2) to
 *   (4.10-5), (4.10-17) and (4.10-20) and the example on p. 132.
 *
 * Printed there:
 * - Eqs. (4.10-3), (4.10-4): e = d - 2 delta sin(pi / 2n), the largest
 *   passband reflection |Gamma|max = cosh(n asinh e) / cosh(n asinh d), with
 *   delta = 1 / (R0 w1 C1) (RC load) or R / (w1 L) (series RL load) the
 *   decrement and n the number of reactive elements, the load's one included.
 * - Eq. (4.10-17), after Fano: (LA)max is smallest when
 *   tanh(n a) / cosh(a) = tanh(n b) / cosh(b), d = sinh a, e = sinh b.
 * - p. 132: delta = 0.10, n = 2: minimized (LA)max = 4.8 dB with 0.98 dB ripple.
 * - p. 125: a 50 ohm load in series with 39.8 nH, band to 1 GHz
 *   (delta = 0.20), n = 4: (LA)max = 1.9 dB, ripple about 0.25 dB; the
 *   network (from the load) shunt C2 = 1.415 pF, series L3 = 42.9 nH, shunt
 *   C4 = 0.652 pF, generator R5 = 195 ohm; with n = infinity (LA)max would
 *   still be about 1.46 dB.
 *
 * The same equations are those of the Chebyshev reference in rft.test.ts
 * (written there "from Chen 1976, not checked against the book's page"):
 * this file ties them to a printed source and reproduces its numbers.
 *
 * Not used as an expected value: p. 125 also says the n = 1 design (only the
 * generator resistance, about 256 ohm) gives "5.9 db loss at 1 Gc (a
 * reduction of 2.7 db)". By hand, 4 * 50 * 256 / ((50 + 256)^2 + 250^2) =
 * 51200 / 156136 = 0.3279, i.e. 4.84 dB, and Eq. (4.10-4) with n = 1 gives the
 * same; the printed 5.9 dB is inconsistent with the report's own equations
 * (asserted below as 4.84 dB from the hand calculation).
 */
import { describe, expect, it } from 'vitest';
import {
  cabs,
  cadd,
  cdiv,
  complex,
  csub,
  ladderAbcd,
  realFrequencyMatch,
  sweepPoints,
  throughAbcd,
  type Complex,
  type Element,
} from '../src/index.js';

const dB = (gain: number): number => -10 * Math.log10(gain);

/** |Gamma|max of Eq. (4.10-4) for a given d (Eq. 4.10-3 gives e). */
function gammaMax(n: number, delta: number, d: number): number {
  const e = d - 2 * delta * Math.sin(Math.PI / (2 * n));
  return Math.cosh(n * Math.asinh(e)) / Math.cosh(n * Math.asinh(d));
}

/** The optimum of Sec. 4.10: a from Fano's condition (4.10-17) by bisection. */
function fanoOptimum(n: number, delta: number): { a: number; b: number; gamma: number } {
  const c = 2 * delta * Math.sin(Math.PI / (2 * n));
  const bOf = (a: number) => Math.asinh(Math.sinh(a) - c);
  const F = (a: number) => {
    const b = bOf(a);
    return Math.tanh(n * a) / Math.cosh(a) - Math.tanh(n * b) / Math.cosh(b);
  };
  // F > 0 at b = 0 (a = asinh c), F < 0 for large a (b < a, so cosh b < cosh a).
  let lo = Math.asinh(c);
  let hi = 10;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (F(mid) > 0) lo = mid;
    else hi = mid;
  }
  const a = (lo + hi) / 2;
  const b = bOf(a);
  return { a, b, gamma: Math.cosh(n * b) / Math.cosh(n * a) };
}

/** The Chebyshev ripple in dB: 10 log10(1 + eps^2), eps = 1 / sinh(n a). */
function rippleDb(n: number, a: number): number {
  return 10 * Math.log10(1 + 1 / Math.sinh(n * a) ** 2);
}

const seriesRL =
  (r: number, l: number) =>
  (f: number): Complex =>
    complex(r, 2 * Math.PI * f * l);

function transducerGain(elements: readonly Element[], zl: Complex, rg: number, f: number): number {
  const zin = throughAbcd(ladderAbcd(elements, f), zl);
  const g = cabs(cdiv(csub(zin, complex(rg)), cadd(zin, complex(rg))));
  return 1 - g * g;
}

describe('MYJ Sec. 4.10: the published equations reproduce the published numbers', () => {
  it('delta 0.10, n 2: (LA)max 4.8 dB with 0.98 dB ripple (p. 132)', () => {
    // Hand calculation: n = 2 gives cosh(2x) = 1 + 2 sinh^2 x, so |Gamma|max =
    // (1 + 2 e^2) / (1 + 2 d^2), smallest at d^2 - c d - 1/2 = 0, c = 0.2 sin(pi/4):
    // d = 0.781344, e = 0.639923, |Gamma|max = 0.819003, (LA)max = 4.825 dB,
    // ripple 10 log10(1 + 1 / (2 d sqrt(1 + d^2))^2) = 0.984 dB.
    const opt = fanoOptimum(2, 0.1);
    expect(Math.sinh(opt.a)).toBeCloseTo(0.781344, 5);
    expect(dB(1 - opt.gamma ** 2)).toBeCloseTo(4.825, 3);
    expect(Math.abs(dB(1 - opt.gamma ** 2) - 4.8)).toBeLessThan(0.05);
    expect(Math.abs(rippleDb(2, opt.a) - 0.98)).toBeLessThan(0.01);
  });

  it('delta 0.20, n 4: (LA)max 1.9 dB, ripple about 0.25 dB (p. 125)', () => {
    const opt = fanoOptimum(4, 0.2);
    expect(Math.abs(dB(1 - opt.gamma ** 2) - 1.9)).toBeLessThan(0.05);
    expect(Math.abs(rippleDb(4, opt.a) - 0.25)).toBeLessThan(0.03);
  });

  it('n infinity is Bode: 1 - exp(-2 pi delta), about 1.46 dB at delta 0.20 (p. 125)', () => {
    // Hand: exp(-0.4 pi) = 0.2846095, -10 log10(0.7153905) = 1.45457 dB.
    const bode = 1 - Math.exp(-2 * Math.PI * 0.2);
    expect(dB(bode)).toBeCloseTo(1.4546, 4);
    expect(Math.abs(dB(bode) - 1.46)).toBeLessThan(0.01);
    // The Chebyshev optimum tends to it from below as n grows.
    const g400 = 1 - fanoOptimum(400, 0.2).gamma ** 2;
    expect(g400).toBeLessThan(bode);
    expect(bode - g400).toBeLessThan(2e-4);
  });

  it('n 1: 4.84 dB by hand (the printed 5.9 dB does not follow from the report)', () => {
    // 50 ohm + j250 ohm at 1 GHz, generator 255 ohm (sqrt(50^2 + 250^2)).
    const t = (4 * 50 * 255) / ((50 + 255) ** 2 + 250 ** 2);
    expect(dB(t)).toBeCloseTo(4.842, 3);
    // Eq. (4.10-4) with n = 1: |Gamma|^2 = (1 + e^2) / (1 + d^2), optimum d = 0.2 + sqrt(1.04).
    const d = 0.2 + Math.sqrt(1.04);
    expect(dB(1 - gammaMax(1, 0.2, d) ** 2)).toBeCloseTo(4.842, 3);
  });

  it("Fano's condition (4.10-17) is the maximum of the lowest gain over d (the rft.test.ts reference)", () => {
    for (const [n, delta] of [
      [2, 0.5],
      [3, 0.5],
      [4, 0.5],
      [5, 0.5],
      [3, 0.2],
    ] as const) {
      const opt = fanoOptimum(n, delta);
      // A fine scan of d, as rft.test.ts's chebyshevRc does, never finds a smaller |Gamma|max.
      const c = 2 * delta * Math.sin(Math.PI / (2 * n));
      let best = Infinity;
      for (let i = 0; i <= 20000; i++) {
        const d = c + (i / 20000) * 10;
        best = Math.min(best, gammaMax(n, delta, d));
      }
      expect(opt.gamma).toBeLessThanOrEqual(best + 1e-9);
      expect(best - opt.gamma).toBeLessThan(1e-6);
    }
  });
});

describe('MYJ p. 125: the published network and the real frequency technique on its load', () => {
  // 50 ohm in series with 39.8 nH; delta = 50 / (2 pi 1e9 * 39.8e-9) = 0.19994.
  const load = seriesRL(50, 3.98e-8);
  const band = sweepPoints(1e6, 1e9, 41);
  const dense = sweepPoints(1e6, 1e9, 2001);
  let PRINTED_MAX = Infinity;

  it('the printed element values give about the printed (LA)max through the app cascade', () => {
    const published: Element[] = [
      { kind: 'C', orientation: 'shunt', value: 1.415e-12 },
      { kind: 'L', orientation: 'series', value: 4.29e-8 },
      { kind: 'C', orientation: 'shunt', value: 6.52e-13 },
    ];
    const loss = dense.map((f) => dB(transducerGain(published, load(f), 195, f)));
    // At DC only the resistances count: 4 * 50 * 195 / 245^2 = 0.64973, 1.873 dB; an even
    // order Chebyshev response has its largest loss at DC, (LA)max = 1.9 dB printed.
    expect(loss[0]).toBeCloseTo(1.873, 2);
    // The band edge is sensitive to the chart-read values (g3 / 10 = 0.54 read to two
    // digits): the largest loss within 0.15 dB of the printed 1.9 dB.
    expect(Math.abs(Math.max(...loss) - 1.9)).toBeLessThan(0.15);
    PRINTED_MAX = Math.max(...loss);
  });

  it('three parts and a transformer reach the published optimum (and stay under Bode)', () => {
    const res = realFrequencyMatch(band, {
      load,
      z0: 50,
      parts: 3,
      zerosAtDc: [0],
      transformer: true,
      polish: false,
    });
    const b = res.best!;
    expect(b).not.toBeNull();
    const delta = 50 / (2 * Math.PI * 1e9 * 3.98e-8);
    const cheb = 1 - fanoOptimum(4, delta).gamma ** 2;
    // The real frequency technique optimizes the lowest gain over every degree 3 network:
    // at least the Chebyshev optimum (1.9 dB printed).
    expect(b.minGain).toBeGreaterThan(cheb - 5e-4);
    expect(dB(b.minGain)).toBeLessThan(1.9 + 0.05);
    expect(b.minGain).toBeLessThan(1 - Math.exp(-2 * Math.PI * delta));
    expect(b.synthesisError).toBeLessThan(1e-9);
    // The ladder's own lowest gain on a 2001 point grid: the scoring grid misses the true
    // minimum between its points only by a sampling amount (1e-5 in gain).
    const lowest = Math.min(...dense.map((f) => transducerGain(b.synthesized, load(f), 50, f)));
    expect(lowest).toBeGreaterThan(b.minGain - 1e-5);
    // And it is better than the printed (chart-read) network on the same grid.
    expect(dB(lowest)).toBeLessThan(PRINTED_MAX);
  }, 120000);

  it('delta 0.10, one shunt part and a transformer: (LA)max 4.825 dB (p. 132: 4.8 dB)', () => {
    // L = 50 / (0.1 * 2 pi * 1 GHz) = 79.577 nH.
    const l = 50 / (0.1 * 2 * Math.PI * 1e9);
    const res = realFrequencyMatch(band, {
      load: seriesRL(50, l),
      z0: 50,
      parts: 1,
      zerosAtDc: [0],
      transformer: true,
      polish: false,
    });
    const b = res.best!;
    // Hand calculation above: lowest gain 1 - 0.819003^2 = 0.329234.
    expect(Math.abs(b.minGain - 0.329234)).toBeLessThan(5e-4);
    expect(b.synthesisError).toBeLessThan(1e-9);
  }, 60000);
});
