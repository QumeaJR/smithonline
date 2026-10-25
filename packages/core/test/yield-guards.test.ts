/**
 * D3 QA round: the guards of design centring and of the corner search that
 * mutations survived (each case below was found by running the mutated code:
 * it fails there and passes here), the worst case as the largest of the
 * nominal network, the corners and the Monte Carlo runs, the significance of
 * a centring gain, the parts centring reports as moved, and the singular
 * points of the spread ranking.
 */
import { describe, expect, it } from 'vitest';
import {
  applyDeviations,
  bandSensitivity,
  centreDesign,
  complex,
  cornerCandidates,
  judgedVswr,
  lMatch,
  monteCarlo,
  parameterValue,
  scalarSpread,
  significantGain,
  sweepPoints,
  toleranceSlots,
  worstCorner,
  type CentreProgress,
  type Element,
  type Ladder,
  type YieldEstimate,
} from '../src/index';

const W = 2 * Math.PI * 1e9;

describe('design centring acceptance guards', () => {
  it('keeps the start when the Nelder-Mead point passes fewer search draws (shunt C + series L)', () => {
    // The smoothed yield the simplex walks on improves while the pass count drops (72 to 71 of
    // 100): accepting the last simplex point unchecked ends below the start.
    const ladder: Ladder = {
      z0: 50,
      frequency: 1e9,
      load: complex(96.21149455895647, -104.9967990629375),
      elements: [
        { kind: 'C', orientation: 'shunt', value: 4.964441451164946e-13 },
        { kind: 'L', orientation: 'series', value: 1.4270608493971023e-8 },
      ],
    };
    const r = centreDesign(ladder, {
      tolerance: 0.13277806064579636,
      vswrLimit: 1.3157223973085819,
      band: sweepPoints(0.95e9, 1.05e9, 5),
      maxEvaluations: 120,
      samples: 100,
      validationRuns: 100,
    });
    expect(r.searchBefore).toBeCloseTo(0.72, 12);
    expect(r.searchAfter).toBeGreaterThanOrEqual(r.searchBefore);
  });

  it('stops the mean shift when the centre of the passing draws passes fewer of them', () => {
    // 11 of 100 draws pass at the start; the centre of gravity of those 11 passes 10 when taken
    // unchecked, and the search must keep the better point (13 of 100).
    const ladder: Ladder = {
      z0: 50,
      frequency: 1e9,
      load: complex(91.6402913001366, 57.500943671911955),
      elements: [
        { kind: 'C', orientation: 'shunt', value: 2.3355091912132767e-12 },
        { kind: 'L', orientation: 'series', value: 9.92136978391613e-9 },
      ],
    };
    const r = centreDesign(ladder, {
      tolerance: 0.10135639063082635,
      vswrLimit: 1.05,
      maxEvaluations: 20,
      samples: 100,
      validationRuns: 100,
    });
    expect(r.searchBefore).toBeCloseTo(0.11, 12);
    expect(r.searchAfter).toBeGreaterThanOrEqual(r.searchBefore);
  });

  it('reports its progress at every evaluation, in order, and the check after the search', () => {
    const sol = lMatch(complex(100, -50), complex(50, 0), 1e9).find(
      (s) => s.description === 'shunt L + series C',
    );
    const ladder: Ladder = {
      z0: 50,
      frequency: 1e9,
      load: complex(100, -50),
      elements: (sol as { elements: readonly Element[] }).elements,
    };
    const seen: CentreProgress[] = [];
    centreDesign(ladder, {
      tolerance: 0.05,
      vswrLimit: 1.38,
      band: sweepPoints(0.9e9, 1.1e9, 11),
      maxEvaluations: 100,
      onProgress: (p) => seen.push(p),
    });
    expect(seen.length).toBeGreaterThan(40);
    const total = seen[0]?.total ?? 0;
    for (let k = 1; k < seen.length; k++) {
      expect(seen[k]?.total).toBe(total);
      expect(seen[k]?.done ?? 0).toBeGreaterThanOrEqual(seen[k - 1]?.done ?? 0);
    }
    expect(seen[seen.length - 1]?.stage).toBe('checking');
    expect(seen[seen.length - 1]?.done).toBeLessThanOrEqual(total);
  });
});

describe('the corners the sensitivities propose', () => {
  const ladder: Ladder = {
    z0: 50,
    frequency: 1e9,
    load: complex(33.607280233409256, 64.74103652872145),
    elements: [
      { kind: 'L', orientation: 'series', value: 3.007149862081358e-8 },
      { kind: 'C', orientation: 'series', value: 6.988748690153526e-13 },
      { kind: 'C', orientation: 'shunt', value: 6.228666253992736e-13 },
      { kind: 'L', orientation: 'shunt', value: 1.4692178908904307e-8 },
      { kind: 'C', orientation: 'series', value: 1.0173611660971283e-12 },
      { kind: 'L', orientation: 'shunt', value: 9.74154887308705e-9 },
    ],
  };
  const band = sweepPoints(0.9e9, 1.1e9, 5);
  const tolerance = 0.12175555292051286;

  it('include the gradient signs of the worst VSWR and the power mean, and each own direction', () => {
    const slots = toleranceSlots(
      ladder.elements,
      ladder.elements.map(() => tolerance),
    );
    const freqs = [1e9, ...band];
    const sens = bandSensitivity(ladder.elements, ladder.load, 50, freqs, {
      parameters: slots.map((s) => s.ref),
    });
    const scale = slots.map(
      (s) => parameterValue(ladder.elements[s.ref.index] as Element, s.ref.parameter) * tolerance,
    );
    const got = cornerCandidates(sens, scale).map((c) => c.join(','));
    const sign = (v: number): number => (v < 0 ? -1 : 1);
    // The gradient corners come first. The worst VSWR's one is also the own-direction corner at
    // the worst frequency (the same signs by construction), and the power mean's one never beat
    // the others in 4000 random networks: pinned here as proposed, not for what they add.
    expect(got[0]).toBe(sens.worst.dVswr.map(sign).join(','));
    expect(got[1]).toBe(sens.smooth.dValue.map(sign).join(','));
    // The corner that pushes Gamma furthest along its own direction: sign Re(conj(Gamma) a_i).
    for (const pt of sens.points) {
      const own = pt.dGamma.map((d, i) =>
        sign((pt.gamma.re * d.re + pt.gamma.im * d.im) * (scale[i] as number)),
      );
      expect(got).toContain(own.join(','));
    }
  });

  it('find the worst corner of a six-part ladder over a band (own direction needed)', () => {
    const c = worstCorner(ladder, { tolerance, band });
    expect(c?.exhaustive).toBe(true);
    // 50.5 at the worst corner; without the own direction the candidates reach 41.3 only.
    expect(c?.corner.vswr).toBeCloseTo(50.50251086344894, 6);
    expect(c?.fromSensitivity.vswr).toBe(c?.corner.vswr);
  });
});

describe('the worst case', () => {
  it('is the nominal network when every corner is better (a quarter-wave line, 5 % length)', () => {
    const ladder: Ladder = {
      z0: 50,
      frequency: 1e9,
      load: complex(50, 0),
      elements: [{ kind: 'line', z0: 100, length: 0.25 }],
    };
    const c = worstCorner(ladder, { tolerance: 0.05, overrides: { 0: 0.05 } });
    // Zin = 100^2 / 50 = 200 ohm: VSWR 4 at the nominal length, less at either end.
    expect(c?.worst.source).toBe('nominal');
    expect(c?.worst.vswr).toBeCloseTo(4, 9);
    expect(c?.worst.signs).toEqual([0]);
    expect(c?.corner.vswr).toBeLessThan(4);
    expect(c?.corner.source).toBe('corner');
  });

  it('is the worst Monte Carlo run when one beats every corner, the same run monteCarlo reports', () => {
    const ladder: Ladder = {
      z0: 50,
      frequency: 1e9,
      load: complex(9.68548103235662, -137.9726893734187),
      elements: [
        { kind: 'L', orientation: 'shunt', value: 2.3696526118933158e-8, q: 11.19047633651644 },
        { kind: 'R', orientation: 'series', value: 312.36498279960523 },
        { kind: 'C', orientation: 'series', value: 1.571968215922174e-11, q: 12.152605567127466 },
      ],
    };
    const opts = { tolerance: 0.2383270461112261, vswrLimit: 2, runs: 2000, seed: 1435 };
    const mc = monteCarlo(ladder, opts);
    let argmax = 0;
    for (let i = 1; i < mc.runs; i++)
      if ((mc.vswr[i] as number) > (mc.vswr[argmax] as number)) argmax = i;
    expect(mc.worstRun).toBe(argmax);
    const all = worstCorner(ladder, opts);
    expect(all?.worst.source).toBe('sample');
    expect(all?.worst.run).toBe(mc.worstRun);
    expect(all?.worst.vswr).toBe(mc.stats.max);
    expect(all?.worst.vswr).toBeGreaterThan(all?.corner.vswr ?? Infinity);
    // The worker's way: only the worst run, redrawn from the seed.
    const { runs: _runs, ...rest } = opts;
    void _runs;
    const one = worstCorner(ladder, { ...rest, worstRun: mc.worstRun });
    expect(one?.sample?.vswr).toBe(all?.sample?.vswr);
    expect(one?.sample?.signs).toEqual(all?.sample?.signs);
    expect(one?.evaluated).toBe(all?.evaluated);
  });

  it('is a corner for a monotonic network, with the run network named by its elements', () => {
    const sol = lMatch(complex(100, -50), complex(50, 0), 1e9)[0] as {
      elements: readonly Element[];
    };
    const ladder: Ladder = {
      z0: 50,
      frequency: 1e9,
      load: complex(100, -50),
      elements: sol.elements,
    };
    const c = worstCorner(ladder, { tolerance: 0.05, runs: 500, seed: 3 });
    expect(c?.worst).toBe(c?.corner);
    expect(c?.elements).toBe(ladder.elements);
    expect(c?.sample?.vswr ?? Infinity).toBeLessThanOrEqual(c?.corner.vswr ?? 0);
  });
});

describe('the significance of a centring gain', () => {
  const est = (passed: number, runs: number, lo: number, hi: number): YieldEstimate => ({
    passed,
    runs,
    yield: passed / runs,
    interval: { lo, hi },
  });
  it('needs the intervals apart or a gain above the two half-widths', () => {
    expect(significantGain(est(500, 1000, 0.47, 0.53), est(600, 1000, 0.57, 0.63))).toBe(true);
    expect(significantGain(est(500, 1000, 0.47, 0.53), est(520, 1000, 0.49, 0.55))).toBe(false);
    // Overlapping (Wilson intervals are not symmetric), but the gain, 0.12, exceeds the
    // half-widths together, 0.055 + 0.025.
    expect(significantGain(est(500, 1000, 0.49, 0.6), est(620, 1000, 0.59, 0.64))).toBe(true);
    expect(significantGain(est(600, 1000, 0.57, 0.63), est(500, 1000, 0.47, 0.53))).toBe(false);
  });
});

describe('what centring reports', () => {
  const sol = lMatch(complex(100, -50), complex(50, 0), 1e9).find(
    (s) => s.description === 'shunt L + series C',
  );
  const ideal: Ladder = {
    z0: 50,
    frequency: 1e9,
    load: complex(100, -50),
    elements: (sol as { elements: readonly Element[] }).elements,
  };
  const band = sweepPoints(0.9e9, 1.1e9, 11);

  it('lists as moved only the parts whose value changed, and the nominal VSWR before and after', () => {
    const r = centreDesign(ideal, { tolerance: 0.05, vswrLimit: 1.38, band });
    expect(r.movable).toEqual([0, 1]);
    for (const i of r.movable) {
      const moved =
        (r.elements[i] as { value: number }).value !==
        (ideal.elements[i] as { value: number }).value;
      expect(r.indices.includes(i)).toBe(moved);
    }
    expect(r.significant).toBe(true);
    expect(r.nominal.before).toBeCloseTo(judgedVswr(ideal.elements, ideal, { band }), 12);
    expect(r.nominal.after).toBeCloseTo(judgedVswr(r.elements, ideal, { band }), 12);
  });

  it('says which centred values sit at the edge of their range', () => {
    // Both values at a third: the centre lies about three times away, beyond twice the value.
    const off: Ladder = {
      ...ideal,
      elements: ideal.elements.map((el) => ({
        ...el,
        value: (el as { value: number }).value / 3,
      })) as Element[],
    };
    const r = centreDesign(off, { tolerance: 0.05, vswrLimit: 2.5 });
    expect(r.edges.length).toBeGreaterThan(0);
    for (const e of r.edges) {
      const ratio =
        (r.elements[e.index] as { value: number }).value /
        (off.elements[e.index] as { value: number }).value;
      expect(Math.abs(Math.log(ratio / e.factor))).toBeLessThanOrEqual(1e-3);
      expect(e.side).toBe(e.factor > 1 ? 'high' : 'low');
    }
  });

  it('is not significant when every run already passes', () => {
    const r = centreDesign(ideal, { tolerance: 0.05, vswrLimit: 5, maxEvaluations: 60 });
    expect(r.significant).toBe(false);
  });
});

describe('singular points of the spread ranking', () => {
  it('gives a part typed as 0 (and a zero-length line) no slot', () => {
    const els: Element[] = [
      { kind: 'C', orientation: 'shunt', value: 0 },
      { kind: 'L', orientation: 'series', value: 5e-9 },
      { kind: 'line', z0: 50, length: 0 },
      { kind: 'RLC', orientation: 'shunt', connection: 'series', r: 0, l: 5e-9, c: 1e-12 },
    ];
    const slots = toleranceSlots(els, [0.05, 0.05, 0.05, 0.05]);
    expect(slots.map((s) => `${s.ref.index}:${s.ref.parameter}`)).toEqual([
      '1:value',
      '3:l',
      '3:c',
    ]);
  });

  it('leaves a totally reflected band point out of the power mean and its weights', () => {
    const els: Element[] = [{ kind: 'L', orientation: 'series', value: 5e-9 }];
    const load = (f: number) => (f > 1.05e9 ? complex(-10, 0) : complex(25, 0));
    const freqs = [0.95e9, 1e9, 1.1e9];
    const b = bandSensitivity(els, load, 50, freqs);
    expect(b.smooth.excluded).toBe(1);
    expect(b.smooth.weights[2]).toBe(0);
    expect(Number.isFinite(b.smooth.value)).toBe(true);
    expect(b.smooth.weights[0]! + b.smooth.weights[1]!).toBeGreaterThan(0.9);
    // The same as the power mean of the two finite points alone.
    const two = bandSensitivity(els, load, 50, freqs.slice(0, 2));
    expect(b.smooth.value).toBeCloseTo(two.smooth.value, 12);
    expect(b.smooth.dValue[0]).toBeCloseTo(two.smooth.dValue[0] as number, 12);
  });

  it('scalarSpread splits the variance of a real quantity by hand', () => {
    const els: Element[] = [
      { kind: 'L', orientation: 'series', value: 1 },
      { kind: 'C', orientation: 'series', value: 1 },
    ];
    const refs = [
      { index: 0, parameter: 'value' as const },
      { index: 1, parameter: 'value' as const },
    ];
    const s = 0.05 / Math.sqrt(3);
    const free = scalarSpread(
      [1, -0.5],
      refs,
      refs.map((ref) => ({ ref, tolerance: 0.05 })),
      els,
      'uniform',
    );
    expect(free.shares[0]?.share).toBeCloseTo(0.8, 12);
    expect(free.shares[1]?.share).toBeCloseTo(0.2, 12);
    expect(free.rms).toBeCloseTo(s * Math.sqrt(1.25), 12);
    // Correlated 0.6 in one group: Var = s^2 (1 + 0.25 - 2 * 0.6 * 0.5) = 0.65 s^2.
    const reel = scalarSpread(
      [1, -0.5],
      refs,
      refs.map((ref) => ({ ref, tolerance: 0.05, group: 'X', correlation: 0.6 })),
      els,
      'uniform',
    );
    expect(reel.rms).toBeCloseTo(s * Math.sqrt(0.65), 12);
    expect(reel.shares[0]?.share).toBeCloseTo(0.7 / 0.65, 12);
    expect(reel.shares[1]?.share).toBeCloseTo(-0.05 / 0.65, 12);
    // A non-finite derivative counts as 0.
    const nan = scalarSpread(
      [1, NaN],
      refs,
      refs.map((ref) => ({ ref, tolerance: 0.05 })),
      els,
      'uniform',
    );
    expect(nan.shares[0]?.share).toBe(1);
  });

  it('a 0 F part leaves the corners of the other parts alone', () => {
    const els: Element[] = [
      { kind: 'C', orientation: 'shunt', value: 0 },
      { kind: 'L', orientation: 'shunt', value: 12e-9 },
      { kind: 'C', orientation: 'series', value: 2.7e-12 },
    ];
    const ladder: Ladder = { z0: 50, frequency: 1e9, load: complex(100, -50), elements: els };
    const c = worstCorner(ladder, { tolerance: 0.05 });
    expect(c?.slots).toHaveLength(2);
    const slots = c?.slots ?? [];
    expect(judgedVswr(applyDeviations(els, slots, c?.corner.signs ?? []), ladder)).toBe(
      c?.corner.vswr,
    );
    expect(W).toBeGreaterThan(0);
  });
});
