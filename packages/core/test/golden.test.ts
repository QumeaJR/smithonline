/**
 * Published answers as golden tests (phase D1 of docs/08-depth-plan.md).
 *
 * Each case names its source and compares the app's computation with the
 * printed value, to the printed precision: a value printed as 0.29 is
 * checked to +/- 0.005, one printed as 46.1 nH to +/- 0.05 nH. Where a book
 * computes a printed value from an intermediate it rounded first, the test
 * says so and checks the value against that rounded intermediate instead of
 * pretending the book carried full precision.
 *
 * Sources:
 * - Pozar, D. M., Microwave Engineering, 4th edition, Wiley 2012, chapter 5
 *   (impedance matching and tuning) and tables 8.3 and 8.4. The values below
 *   are the printed ones as the author of this test knows them, and each one
 *   is also re-derived here from the example's data, which is what makes
 *   them safe to assert.
 * - Matthaei, Young and Jones, Microwave Filters, Impedance-Matching Networks,
 *   and Coupling Structures, McGraw-Hill 1964, table 4.05-2(a) (Chebyshev
 *   prototype element values, 0.10 dB ripple).
 * - Hewlett-Packard Application Note 95-1, S-Parameter Techniques for Faster,
 *   More Accurate Network Design (1997 reprint of the 1967 HP Journal article
 *   by R. W. Anderson), `original/AN-95-1.PDF`, sections 7 and 8, read from
 *   the PDF text.
 * - Dellsperger, F., Smith Chart Examples, Smith V4.1 (5.2010 / 10.2016 /
 *   1.2018), `original/Examples V4.1.pdf`, read from the PDF text; the
 *   example projects are the fixtures in `fixtures/xmlsc/`. The PDF text
 *   layer drops the plus and minus glyphs of its equations; where a sign
 *   matters it is taken from the fixture or follows from the printed data.
 * - Bowick, C., RF Circuit Design: the L-network and Pi-network design
 *   procedures (chapter 4). The printed answers of Bowick's examples are not
 *   asserted, because they cannot be quoted here with certainty; the cases
 *   apply his procedure to stated data and check the app against the exact
 *   result of that procedure.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyElement,
  bodeFano,
  cabs,
  cadd,
  cargDeg,
  cdiv,
  cinv,
  cmul,
  complex,
  csub,
  evaluateAt,
  evaluateLadder,
  gmaxDb,
  ladderFromXmlsc,
  lMatch,
  lowpassPrototype,
  multisectionTransformer,
  nearestInSeries,
  noiseFigureDb,
  piMatch,
  qFactor,
  readXmlsc,
  seriesElementFor,
  shuntElementFor,
  stubAdmittance,
  sToAbcd,
  sweepDatapoints,
  unilateralGain,
  zToGamma,
  type Complex,
  type Element,
  type MatchSolution,
  type StubElement,
} from '../src/index';

const FIXTURES = join(__dirname, 'fixtures', 'xmlsc');
const project = (name: string) => readXmlsc(readFileSync(join(FIXTURES, name), 'utf8'));

/** |actual - printed| within half a unit of the last printed digit. */
function printed(actual: number, value: number, decimals: number): void {
  const half = 0.5 * 10 ** -decimals;
  // A hair over half a unit for the binary representation of the printed value.
  expect(Math.abs(actual - value)).toBeLessThanOrEqual(half * (1 + 1e-9));
}

const valueOf = (el: Element): number => {
  if (el.kind !== 'L' && el.kind !== 'C') throw new Error(`not a part: ${el.kind}`);
  return el.value;
};

/** Normalized reactance x of a series part, or susceptance b of a shunt part, at f. */
function normalizedAmount(el: Element, f: number, z0: number): number {
  const w = 2 * Math.PI * f;
  if (el.kind === 'L')
    return el.orientation === 'series' ? (w * el.value) / z0 : -z0 / (w * el.value);
  if (el.kind === 'C')
    return el.orientation === 'series' ? -1 / (w * el.value * z0) : w * el.value * z0;
  throw new Error(`not a part: ${el.kind}`);
}

/** The root of a continuous function with a sign change in [lo, hi], by bisection. */
function bisect(fn: (x: number) => number, lo: number, hi: number): number {
  let a = lo;
  let b = hi;
  const fa = fn(a);
  if (fa * fn(b) > 0) throw new Error('no sign change in the bracket');
  for (let i = 0; i < 200; i++) {
    const m = (a + b) / 2;
    if (fn(m) * fa > 0) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

/* ================================================================ Pozar */

describe('Pozar, Microwave Engineering, 4th ed., chapter 5', () => {
  it('Example 5.1: L-section match of ZL = 200 - j100 to 100 ohm at 500 MHz', () => {
    // Printed (analytic solution): b = 0.29, x = 1.22 and b = -0.69, x = -1.22;
    // C = 0.92 pF, L = 38.8 nH for the first, L = 46.1 nH, C = 2.61 pF for the second.
    const f = 500e6;
    const z0 = 100;
    const sols = lMatch(complex(200, -100), complex(z0), f);
    // RL > Z0: only the shunt-first networks exist (the load is inside the 1 + jx circle).
    expect(sols.map((s) => s.description).sort()).toEqual(
      ['shunt C + series L', 'shunt L + series C'].sort(),
    );
    const first = sols.find((s) => s.description === 'shunt C + series L') as MatchSolution;
    const second = sols.find((s) => s.description === 'shunt L + series C') as MatchSolution;
    const [c1, l1] = first.elements as [Element, Element];
    const [l2, c2] = second.elements as [Element, Element];
    printed(normalizedAmount(c1, f, z0), 0.29, 2);
    printed(normalizedAmount(l1, f, z0), 1.22, 2);
    printed(normalizedAmount(l2, f, z0), -0.69, 2);
    printed(normalizedAmount(c2, f, z0), -1.22, 2);
    printed(valueOf(c1) * 1e12, 0.92, 2);
    printed(valueOf(l2) * 1e9, 46.1, 1);
    // L = 38.8 nH and C = 2.61 pF are computed in the book from the rounded x = 1.22
    // (the exact x = 1.2247 gives 38.98 nH and 2.599 pF); the app's part for x = +/-1.22:
    printed(valueOf(seriesElementFor(1.22 * z0, f)) * 1e9, 38.8, 1);
    printed(valueOf(seriesElementFor(-1.22 * z0, f)) * 1e12, 2.61, 2);
    // And both networks land on 100 ohm.
    for (const s of sols) expect(cabs(csub(s.result, complex(z0)))).toBeLessThan(1e-9);
  });

  it('Example 5.2: single shorted shunt stub for ZL = 60 - j80 on 50 ohm', () => {
    // Printed: y = 1.00 +/- j1.47 at the stub; d1 = 0.110, d2 = 0.260 (read from the chart);
    // l1 = 0.095, l2 = 0.405 wavelength.
    const zl = complex(60, -80);
    const z0 = 50;
    const f = 2e9;
    const line = (d: number): Element => ({ kind: 'line', z0, length: d });
    const y = (d: number): Complex => cinv(applyElement(line(d), zl, f));
    const g = (d: number): number => y(d).re * z0 - 1;
    // The two distances where the line puts the load on the g = 1 circle.
    const d1 = bisect(g, 0.05, 0.2);
    const d2 = bisect(g, 0.2, 0.45);
    printed(y(d1).im * z0, 1.47, 2);
    printed(y(d2).im * z0, -1.47, 2);
    printed(d1, 0.11, 3);
    // d2 is a Smith chart reading (0.325 - 0.065); the exact distance is 0.2594 wavelength.
    // Checked to the chart's reading precision of 0.001 wavelength, not the printed 0.0005.
    expect(Math.abs(d2 - 0.26)).toBeLessThanOrEqual(0.001);
    // The shorted stub that cancels the susceptance, by the app's stub admittance.
    const stub = (l: number): StubElement => ({ kind: 'shortStub', z0, length: l });
    const lFor = (yy: Complex): number =>
      bisect((l) => stubAdmittance(stub(l), f).im + yy.im, 1e-6, 0.5 - 1e-6);
    const l1 = lFor(y(d1));
    const l2 = lFor(y(d2));
    printed(l1, 0.095, 3);
    printed(l2, 0.405, 3);
    for (const [d, l] of [
      [d1, l1],
      [d2, l2],
    ] as const) {
      const ladder = { z0, frequency: f, load: zl, elements: [line(d), stub(l)] };
      const zin = evaluateLadder(ladder).zin;
      expect(cabs(csub(zin, complex(z0)))).toBeLessThan(1e-6);
    }
  });

  it('Example 5.5 (section 5.4): quarter-wave transformer, 10 ohm to 50 ohm, SWR <= 1.5', () => {
    // Printed: Z1 = sqrt(50 x 10) = 22.36 ohm; bandwidth 29 percent (exact single-section formula).
    const d = multisectionTransformer(50, 10, 1, {
      type: 'binomial',
      frequency: 3e9,
      gammaMax: (1.5 - 1) / (1.5 + 1),
    });
    printed(d.impedances[0] as number, 22.36, 2);
    // The app takes the band from the exact line response, as the book's formula does.
    printed(d.bandwidth as number, 0.29, 2);
  });

  it('Example 5.6: three-section binomial transformer, 50 ohm load on a 100 ohm line, Gamma_m = 0.05', () => {
    // Printed: Z1 = 91.7, Z2 = 70.7, Z3 = 54.5 ohm; bandwidth 70 percent.
    const d = multisectionTransformer(100, 50, 3, {
      type: 'binomial',
      frequency: 1e9,
      gammaMax: 0.05,
    });
    // The app lists impedances load side first; the book numbers them from the line.
    const [z3, z2, z1] = d.impedances as [number, number, number];
    printed(z1, 91.7, 1);
    printed(z2, 70.7, 1);
    printed(z3, 54.5, 1);
    printed(d.theoryBandwidth as number, 0.7, 2);
  });

  it('Example 5.7: three-section Chebyshev transformer, 100 ohm load on a 50 ohm line, Gamma_m = 0.05', () => {
    // Printed: sec(theta_m) = 1.408, theta_m = 44.7 degrees, Z2 = 70.71 ohm, bandwidth 101 percent.
    // Not asserted: Gamma_0 = 0.0698 and Gamma_1 = 0.1037, which the book computes from the
    // rounded sec(theta_m) = 1.408 (the app's unrounded 1.40766 gives 0.0697 and 0.1036), and
    // Z1, Z3, whose printed values could not be confirmed against the book's formula here.
    const d = multisectionTransformer(50, 100, 3, {
      type: 'chebyshev',
      frequency: 1e9,
      gammaMax: 0.05,
    });
    const bw = d.theoryBandwidth as number;
    const thetaM = ((2 - bw) * Math.PI) / 4;
    printed(1 / Math.cos(thetaM), 1.408, 3);
    printed((thetaM * 180) / Math.PI, 44.7, 1);
    printed(d.impedances[1] as number, 70.71, 2);
    printed(bw, 1.01, 2);
    expect(d.designGamma).toBe(0.05);
  });

  it('Section 5.9: the Bode-Fano floor for a parallel RC load', () => {
    // Pozar eq. (5.89) for R || C: integral of ln(1 / |Gamma|) dw <= pi / RC; with |Gamma| = Gm
    // over the band, Gm >= exp(-pi / (dw R C)). With Q = w0 R C and BW = dw / w0 this is
    // exp(-pi / (Q BW)), which is what bodeFano computes. Derived, no printed number.
    const r = 100;
    const c = 2e-12;
    const f0 = 1e9;
    const bw = 0.25;
    const gm = Math.exp(-Math.PI / (2 * Math.PI * f0 * bw * r * c));
    const floor = bodeFano(2 * Math.PI * f0 * r * c, bw) as number;
    expect(Math.abs(floor - (1 + gm) / (1 - gm))).toBeLessThan(1e-12);
  });
});

describe('Pozar, Microwave Engineering, 4th ed., and Matthaei et al.: low-pass prototypes', () => {
  it('Table 8.3, maximally flat, N = 3 and N = 4', () => {
    const g3 = lowpassPrototype(3, { response: 'butterworth' });
    [1.0, 2.0, 1.0, 1.0].forEach((v, i) => printed(g3[i] as number, v, 4));
    const g4 = lowpassPrototype(4, { response: 'butterworth' });
    [0.7654, 1.8478, 1.8478, 0.7654, 1.0].forEach((v, i) => printed(g4[i] as number, v, 4));
  });

  it('Table 8.4, equal ripple 0.5 dB and 3.0 dB, N = 3', () => {
    const half = lowpassPrototype(3, { response: 'chebyshev', rippleDb: 0.5 });
    [1.5963, 1.0967, 1.5963, 1.0].forEach((v, i) => printed(half[i] as number, v, 4));
    const three = lowpassPrototype(3, { response: 'chebyshev', rippleDb: 3 });
    [3.3487, 0.7117, 3.3487, 1.0].forEach((v, i) => printed(three[i] as number, v, 4));
  });

  it('Matthaei, Young and Jones, table 4.05-2(a): 0.10 dB ripple, N = 3', () => {
    const g = lowpassPrototype(3, { response: 'chebyshev', rippleDb: 0.1 });
    [1.0316, 1.1474, 1.0316, 1.0].forEach((v, i) => printed(g[i] as number, v, 4));
  });
});

/* ============================================================ HP AN 95-1 */

describe('HP Application Note 95-1, S-Parameter Techniques', () => {
  it('section 7, 300 MHz amplifier (Fig. 7): parts from the normalized chart readings', () => {
    // Printed: C1 = 1 / (2 pi 0.3e9 x 0.42 x 50) = 25 pF; L1 = 50 / (2 pi 0.3e9 x 1.01) = 26 nH;
    // C2 = 1 / (2 pi 0.3e9 x 3.5 x 50) = 3 pF; XL2 = 50 / 0.32 = 156 ohm, L2 = 83 nH.
    const f = 0.3e9;
    printed(valueOf(seriesElementFor(-0.42 * 50, f)) * 1e12, 25, 0);
    printed(valueOf(shuntElementFor(-1.01 / 50, f)) * 1e9, 26, 0);
    printed(valueOf(seriesElementFor(-3.5 * 50, f)) * 1e12, 3, 0);
    printed(50 / 0.32, 156, 0);
    printed(valueOf(shuntElementFor(-0.32 / 50, f)) * 1e9, 83, 0);
  });

  it('section 8, broadband amplifier (Fig. 10b): the series and shunt inductors', () => {
    // Printed: j w Lseries / Z0 = j 3.2 at 700 MHz gives 36.4 nH; Z0 / (j w Lshunt) = -j 1.3
    // at 300 MHz gives 20.4 nH.
    printed(valueOf(seriesElementFor(3.2 * 50, 0.7e9)) * 1e9, 36.4, 1);
    printed(valueOf(shuntElementFor(-1.3 / 50, 0.3e9)) * 1e9, 20.4, 1);
  });

  it('section 8: |s22| = 0.85 gives G2max = (0.278)^-1 or 5.6 dB', () => {
    const g = unilateralGain({
      s11: complex(0),
      s12: complex(0),
      s21: complex(1),
      s22: complex(0.85),
    });
    printed(10 * Math.log10(g.glMax), 5.6, 1);
  });

  it('section 9: a 200 ohm load referred to 50 ohm has |Gamma_L| = 0.6', () => {
    printed(cabs(zToGamma(complex(200), 50)), 0.6, 1);
  });
});

/* ===================================================== Smith V4.1 examples */

describe('Smith V4.1 Examples (Dellsperger), against the fixture projects', () => {
  it('Example 5 and 6 (p. 6, 7): the antenna 20 - j12 has Qmax = X / R = 12 / 20 = 0.6, which the projects keep', () => {
    // The load sign comes from the fixtures (the PDF text drops it); Q is |X| / R either way.
    for (const name of ['Example5.xmlsc', 'Example6.xmlsc']) {
      const lad = ladderFromXmlsc(project(name));
      printed(qFactor(lad.load), 0.6, 1);
      // The design rule: no node above Qmax, to the printed precision.
      expect(evaluateLadder(lad).loadedQ).toBeLessThanOrEqual(0.6 + 0.05);
    }
  });

  it('Example 12 (p. 17): the nonsynchronous transformer length formula matches exactly', () => {
    // Printed: k = Z1 / Z2, L = lambda / (2 pi sqrt(er)) atan( 1 / sqrt(k + 1 + 1/k) ), each of
    // the two sections; the project steps 24.4 ohm (after its stub) up to 50 ohm.
    const z1 = 50;
    const z2 = 24.4;
    const k = z1 / z2;
    const length = Math.atan(1 / Math.sqrt(k + 1 + 1 / k)) / (2 * Math.PI);
    const lad = ladderFromXmlsc(project('Example12.xmlsc'));
    // The project's sections are this length rounded to three decimals (0.078 wavelength).
    const lines = lad.elements.filter((e) => e.kind === 'line');
    expect(lines).toHaveLength(2);
    for (const l of lines) printed(l.kind === 'line' ? l.length : NaN, length, 3);
    // With the exact length the two sections are an exact match of 24.4 ohm to 50 ohm.
    const exact = lines.map((l) => ({ ...l, length }));
    const zin = evaluateAt({ ...lad, elements: exact }, lad.frequency, complex(z2), {
      arcSteps: 0,
    }).zin;
    expect(cabs(csub(zin, complex(z1)))).toBeLessThan(1e-9 * z1);
  });

  describe('Example 13 (p. 21): LNA with BFG33G at 2 GHz, ZS = 50 + j30 ohm', () => {
    const design = project('Example13-input.xmlsc');
    const s = (design.stabilityCircles[0] as (typeof design.stabilityCircles)[number]).s;
    const zs = complex(50, 30);
    const gs = zToGamma(zs, 50);

    it('the S-parameters of the project are the printed polar values', () => {
      // Printed: S11 = 0.121 / -149 deg, S12 = 0.108 / 59.4, S21 = 3.756 / 78.9, S22 = 0.41 / -54.5.
      const polar: [Complex, number, number, number, number][] = [
        [s.s11, 0.121, 3, -149, 0],
        [s.s12, 0.108, 3, 59.4, 1],
        [s.s21, 3.756, 3, 78.9, 1],
        [s.s22, 0.41, 2, -54.5, 1],
      ];
      for (const [v, mag, md, ang, ad] of polar) {
        printed(cabs(v), mag, md);
        printed(cargDeg(v), ang, ad);
      }
    });

    it('Gamma_S = 0.083 + 0.275j, |Gamma_S| = 0.287, arg 73.301 deg', () => {
      printed(gs.re, 0.083, 3);
      printed(gs.im, 0.275, 3);
      printed(cabs(gs), 0.287, 3);
      printed(cargDeg(gs), 73.301, 3);
    });

    it('Gamma_2 = 0.136 - 0.392j and Z2 = 45.987 - j43.54 ohm at the output', () => {
      // Z2 through the app's S to ABCD conversion: the output impedance of a two-port with the
      // source zs at port 1 is (D zs + B) / (C zs + A). The project's load is this Z2.
      const [a, b, c, d] = sToAbcd([s.s11, s.s12, s.s21, s.s22]) as [
        Complex,
        Complex,
        Complex,
        Complex,
      ];
      const zsn = cdiv(zs, complex(50));
      const z2 = cmul(complex(50), cdiv(cadd(cmul(d, zsn), b), cadd(cmul(c, zsn), a)));
      const g2 = zToGamma(z2, 50);
      printed(g2.re, 0.136, 3);
      printed(g2.im, -0.392, 3);
      printed(z2.re, 45.987, 3);
      printed(z2.im, -43.54, 2);
      const output = ladderFromXmlsc(project('Example13-output1.xmlsc'));
      printed(output.load.re, z2.re, 2);
      printed(output.load.im, z2.im, 2);
    });

    it('the highest gain circle is Gmax = 12.94 dB (p. 19)', () => {
      printed(gmaxDb(s), 12.94, 2);
    });

    it('the noise figure at ZS is approximately 3.85 dB (p. 20)', () => {
      const n = design.noiseCircles[0] as (typeof design.noiseCircles)[number];
      // NFmin, Gamma_opt and rn come from the project (the device data at 2 GHz).
      printed(noiseFigureDb({ nfMinDb: n.nfMinDb, gammaOpt: n.gammaOpt, rn: n.rn }, gs), 3.85, 2);
    });
  });

  it('Example 14 (p. 28 to 30): both methods give the same network; method 2 lands on Z1*', () => {
    // Z1 = 10 - j10 ohm (sign from the fixture). Method 1 takes Z1 to 50 ohm; method 2 takes
    // 50 ohm to Z1* with the same two parts in the opposite order.
    const m1 = ladderFromXmlsc(project('Example14-1.xmlsc'));
    const m2 = ladderFromXmlsc(project('Example14-2.xmlsc'));
    expect(m1.load).toEqual(complex(10, -10));
    const z1 = evaluateLadder(m1).zin;
    const z2 = evaluateLadder(m2).zin;
    printed(z1.re, 50, 0);
    printed(z1.im, 0, 0);
    printed(z2.re, 10, 0);
    printed(z2.im, 10, 0);
    const parts = (els: readonly Element[]) =>
      els.map((e) => `${e.kind === 'L' || e.kind === 'C' ? e.orientation : ''} ${e.kind}`).sort();
    expect(parts(m1.elements)).toEqual(parts(m2.elements));
  });

  it('Example 16 (p. 32): 50 ohm Chebyshev low-pass, n = 3, 0.1 dB, 100 MHz, in E24 parts', () => {
    // The prototype scaled to 50 ohm and 100 MHz, snapped to E24, gives the project's parts.
    const g = lowpassPrototype(3, { response: 'chebyshev', rippleDb: 0.1 });
    const wc = 2 * Math.PI * 100e6;
    const l = nearestInSeries(((g[0] as number) * 50) / wc, 'E24');
    const c = nearestInSeries((g[1] as number) / (50 * wc), 'E24');
    const lad = ladderFromXmlsc(project('Example16.xmlsc'));
    expect(lad.elements.map((e) => e.kind)).toEqual(['L', 'C', 'L']);
    expect(valueOf(lad.elements[0] as Element)).toBeCloseTo(l, 18);
    expect(valueOf(lad.elements[1] as Element)).toBeCloseTo(c, 18);
    expect(valueOf(lad.elements[2] as Element)).toBeCloseTo(l, 18);
  });

  it('Example 17 (p. 33): the project keeps VSWR <= 1.2 at 140, 145 and 150 MHz', () => {
    const lad = ladderFromXmlsc(project('Example17.xmlsc'));
    // Loads as printed: 100.8 + j24.2, 106.9 + j41.7, 121.2 + j60 ohm.
    expect(lad.sweepLoads.map((p) => [p.frequency, p.z.re, p.z.im])).toEqual([
      [140e6, 100.8, 24.2],
      [145e6, 106.9, 41.7],
      [150e6, 121.2, 60],
    ]);
    for (const p of sweepDatapoints(lad, lad.sweepLoads)) {
      expect(p.info.vswr).toBeLessThanOrEqual(1.2);
    }
  });

  it('Example 18 (p. 34, 35): the project is the printed starting point, Qmax = 60 / 61', () => {
    // Printed: inductors fixed at 56 nH, "start with all capacitors 15 pF", Qmax = X / R = 60 / 61.
    // The project is that starting point (Zin 35.4 - j8.1 ohm), not one of the tuned solutions,
    // so no match is asserted. The problem statement prints the load as 61 j57 while Qmax and
    // the project use X = 60 ohm.
    const lad = ladderFromXmlsc(project('Example18.xmlsc'));
    expect(lad.load).toEqual(complex(61, 60));
    printed(qFactor(lad.load), 60 / 61, 9);
    expect(lad.elements.map((e) => `${e.kind} ${valueOf(e)}`)).toEqual([
      'C 1.5e-11',
      'L 5.6000000000000005e-8',
      'C 1.5e-11',
      'L 5.6000000000000005e-8',
      'C 1.5e-11',
    ]);
  });
});

/* =============================================================== Bowick */

describe('Bowick, RF Circuit Design, chapter 4: the design procedures', () => {
  it('L network, 100 ohm source to 1000 ohm load at 100 MHz: Q = 3, Xs = 300, Xp = 333.3 ohm', () => {
    // Bowick: Qs = Qp = sqrt(Rp / Rs - 1); Xs = Q Rs; Xp = Rp / Q. Derived, not a printed answer.
    const f = 100e6;
    const sols = lMatch(complex(1000), complex(100), f);
    expect(sols).toHaveLength(2);
    for (const s of sols) {
      expect(s.q).toBeCloseTo(3, 12);
      const [shunt, series] = s.elements as [Element, Element];
      expect(Math.abs(normalizedAmount(series, f, 1))).toBeCloseTo(300, 9);
      expect(Math.abs(1 / normalizedAmount(shunt, f, 1))).toBeCloseTo(1000 / 3, 9);
    }
  });

  it('Pi network by the virtual resistance, 1000 ohm to 100 ohm at Q = 15', () => {
    // Bowick: R = Rmax / (Q^2 + 1); each half an L network to R. Derived, not a printed answer.
    const f = 30e6;
    const q = 15;
    const rv = 1000 / (q * q + 1);
    const q2 = Math.sqrt(100 / rv - 1);
    const sols = piMatch(complex(1000), complex(100), f, q);
    expect(sols.length).toBeGreaterThan(0);
    for (const s of sols) {
      const [b1, x, b3] = s.elements.map((e) => normalizedAmount(e, f, 1)) as [
        number,
        number,
        number,
      ];
      expect(Math.abs(1 / b1)).toBeCloseTo(1000 / q, 9);
      expect(Math.abs(x)).toBeCloseTo((q + q2) * rv, 9);
      expect(Math.abs(1 / b3)).toBeCloseTo(100 / q2, 9);
      expect(s.q).toBeCloseTo(q, 9);
    }
  });
});
