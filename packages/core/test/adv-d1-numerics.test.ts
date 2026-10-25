/**
 * Adversarial, QA round on depth phase D1: numerical regimes the D1
 * invariants do not reach, the Bode-Fano floor of the broadband search, and
 * the .s2p path after the S12 = S21 change. A failing test is a defect, see
 * the adversary report.
 */
import { describe, expect, it } from 'vitest';
import {
  broadbandMatch,
  cabs,
  cadd,
  cdiv,
  cinv,
  cmul,
  complex,
  convertS,
  convertToS,
  csub,
  DEFAULT_PACKAGES,
  evaluateAt,
  feasibility,
  interpolatedLoad,
  ladderAbcd,
  ladderSParameters,
  readTouchstone,
  sweepPoints,
  throughAbcd,
  twoPortPoint,
  withPackages,
  writeTouchstone,
  zToGamma,
  type Complex,
  type Element,
  type NetworkParameter,
} from '../src/index';

const vswrOfLn = (lnInvGamma: number): number => {
  const g = Math.exp(-lnInvGamma);
  return (1 + g) / (1 - g);
};

/** Parallel RC load R = 50 ohm with w0 R C = x at 1 GHz, and its exact Bode-Fano floor. */
function parallelRc(x: number) {
  const r = 50;
  const c = x / (2 * Math.PI * 1e9 * r);
  return {
    z: (f: number): Complex => cinv(complex(1 / r, 2 * Math.PI * f * c)),
    // Fano: (w2 - w1) ln(1/Gm) <= pi / (R C).
    exact: (lo: number, hi: number): number =>
      vswrOfLn(Math.PI / (2 * Math.PI * (hi - lo) * r * c)),
  };
}

function worstOnDenseGrid(
  elements: readonly Element[],
  z: (f: number) => Complex,
  lo: number,
  hi: number,
): number {
  let worst = 1;
  for (const f of sweepPoints(lo, hi, 801)) {
    const g = cabs(zToGamma(throughAbcd(ladderAbcd(elements, f), z(f)), 50));
    worst = Math.max(worst, (1 + g) / (1 - g));
  }
  return worst;
}

describe('adv D1: Bode-Fano floor and the broadband search on a sparse band', () => {
  it('the floor shown never claims more than physics: parallel RC, 0.5 to 1.5 GHz, 5, 9 and 21 band points', () => {
    // 5 is the fewest band points the app uses (BroadbandMatch bandPointCount).
    const load = parallelRc(4);
    const exact = load.exact(0.5e9, 1.5e9);
    // Observed before the fix: app 2.808, exact 2.676 at 5 points. Changed expectation (QA fix):
    // below FLOOR_MIN_POINTS (9) band points no floor is shown at all, so at 5 points the
    // test asserts that none is, and asserts the bound at 9 and 21 points instead.
    expect(feasibility(load.z, sweepPoints(0.5e9, 1.5e9, 5))).toBeNull();
    for (const n of [9, 21]) {
      const floor = feasibility(load.z, sweepPoints(0.5e9, 1.5e9, n))?.floor;
      expect(floor).toBeDefined();
      expect(floor as number).toBeLessThanOrEqual(exact * (1 + 1e-9));
    }
  }, 60_000);

  it('a broadband result never beats the exact floor of its load (datapoint load, 5 points, 8 parts)', () => {
    // The app flow: five datapoints of a parallel RC load (R 50, C 12.73 pF), band = the
    // datapoints, Max parts 8, default budget.
    const load = parallelRc(4);
    const lo = 0.25e9;
    const hi = 1.75e9;
    const freqs = sweepPoints(lo, hi, 5);
    const model = interpolatedLoad(freqs.map((f) => ({ frequency: f, z: load.z(f) })));
    const res = broadbandMatch(freqs, { load: model, z0: 50, maxElements: 8 });
    const best = res.candidates[0];
    expect(best).toBeDefined();
    const exact = load.exact(lo, hi);
    const dense = worstOnDenseGrid(best!.elements, load.z, lo, hi);
    // Observed: reported worst 3.667, app floor 4.549, exact floor 3.907, worst between points 992.
    const seen = {
      reported: +best!.worstVswr.toFixed(3),
      appFloor: +(res.floor?.floor ?? NaN).toFixed(3),
      exactFloor: +exact.toFixed(3),
      worstBetweenPoints: +dense.toFixed(1),
    };
    expect({
      ...seen,
      notBelowExact: best!.worstVswr >= exact,
      notBelowShownFloor: best!.worstVswr >= (res.floor?.floor ?? 0),
      denseWithin10pct: dense <= 1.1 * best!.worstVswr,
    }).toEqual({ ...seen, notBelowExact: true, notBelowShownFloor: true, denseWithin10pct: true });
  }, 300_000);

  it('the floor is within 10 % (in ln 1/Gamma) of the exact one for single-reactance loads, 21 points', () => {
    // Series RC, parallel RL: exact (1/w1 - 1/w2) ln(1/Gm) <= pi tau; parallel RC: (w2 - w1) ln(1/Gm) <= pi / RC.
    const r = 50;
    const w0 = 2 * Math.PI * 1e9;
    const cases = [
      {
        name: 'series RC x 4, octave',
        lo: 0.6667e9,
        hi: 1.3333e9,
        z: (f: number) => complex(r, -1 / (2 * Math.PI * f * (1 / (4 * w0 * r)))),
        ln: (w1: number, w2: number) => (Math.PI * r * (1 / (4 * w0 * r))) / (1 / w1 - 1 / w2),
      },
      {
        name: 'series RC x 2, 3:1',
        lo: 0.5e9,
        hi: 1.5e9,
        z: (f: number) => complex(r, -1 / (2 * Math.PI * f * (1 / (2 * w0 * r)))),
        ln: (w1: number, w2: number) => (Math.PI * r * (1 / (2 * w0 * r))) / (1 / w1 - 1 / w2),
      },
      {
        name: 'parallel RL x 4, 3:1',
        lo: 0.5e9,
        hi: 1.5e9,
        z: (f: number) => cinv(complex(1 / r, -1 / (2 * Math.PI * f * (r / (4 * w0))))),
        ln: (w1: number, w2: number) => (Math.PI * (r / (4 * w0) / r)) / (1 / w1 - 1 / w2),
      },
      {
        name: 'parallel RC x 1, 3:1',
        lo: 0.5e9,
        hi: 1.5e9,
        z: (f: number) => cinv(complex(1 / r, 2 * Math.PI * f * (1 / (w0 * r)))),
        ln: (w1: number, w2: number) => Math.PI / ((w2 - w1) * r * (1 / (w0 * r))),
      },
    ];
    const off = cases.map((c) => {
      const fe = feasibility(c.z, sweepPoints(c.lo, c.hi, 21))!;
      const exactLn = c.ln(2 * Math.PI * c.lo, 2 * Math.PI * c.hi);
      const appLn = Math.PI / (fe.q * fe.fractionalBandwidth);
      return {
        name: c.name,
        app: +fe.floor.toFixed(3),
        exact: +vswrOfLn(exactLn).toFixed(3),
        lnRatio: +(appLn / exactLn).toFixed(3),
      };
    });
    // Observed: series RC octave 1.900 vs 2.092; series RC 3:1 1.529 vs 1.890;
    // parallel RL 3:1 2.604 vs 3.493; parallel RC x 1 3:1 1.024 vs 1.090.
    expect(off.filter((o) => Math.abs(o.lnRatio - 1) > 0.1)).toEqual([]);
  });
});

describe('adv D1: survived (kept as evidence)', () => {
  it('a non-reciprocal device file keeps its own S12 through write, read and every conversion', () => {
    const s = {
      s11: complex(0.6, -0.3),
      s12: complex(0.02, 0.05),
      s21: complex(-3.1, 2.4),
      s22: complex(0.4, -0.5),
    };
    const text = writeTouchstone(
      { ports: 2, z0: 50, points: [twoPortPoint(2e9, s)] },
      { format: 'RI', digits: 12 },
    );
    const back = readTouchstone(text, 2);
    const m = back.points[0]!.s;
    expect(cabs(csub(m[1]!, s.s12))).toBeLessThan(1e-11);
    for (const kind of ['Z', 'Y', 'H', 'ABCD'] as NetworkParameter[]) {
      const again = convertToS(convertS(m, kind, 50, false), kind, 50, false);
      expect(cabs(csub(again[1]!, s.s12))).toBeLessThan(1e-12);
      expect(cabs(csub(again[2]!, s.s21))).toBeLessThan(1e-12);
    }
  });

  it('packaged parts near self-resonance, Q 1 and 1e6, Z0 1 and 1000, 1 Hz to 100 GHz: passive, Zin = Zin from S11', () => {
    const bad: string[] = [];
    for (const q of [1, 1e6])
      for (const z0 of [1, 1000])
        for (const f of [1, 1e6, 1e9, 1e10, 3e10, 1e11]) {
          const els = withPackages(
            [
              { kind: 'L', orientation: 'series', value: 100e-9, q, package: '0402' },
              { kind: 'C', orientation: 'shunt', value: 100e-12, q, package: '0402' },
              { kind: 'L', orientation: 'shunt', value: 1e-9, q, package: '0201' },
            ] as Element[],
            DEFAULT_PACKAGES,
          );
          const ladder = { z0, frequency: f, load: complex(3 * z0, -z0), elements: els };
          const s = ladderSParameters(ladder, f);
          const gl = zToGamma(ladder.load, z0);
          const gin = cadd(
            s.s11,
            cdiv(cmul(cmul(s.s12, s.s21), gl), csub(complex(1), cmul(s.s22, gl))),
          );
          const zin = evaluateAt(ladder, f, ladder.load, { arcSteps: 0 }).zin;
          const diff = cabs(csub(zToGamma(zin, z0), gin));
          if (!(diff < 1e-9) || cabs(s.s11) > 1 + 1e-12)
            bad.push(`q ${q} z0 ${z0} f ${f}: ${diff}`);
        }
    expect(bad).toEqual([]);
  });
});
