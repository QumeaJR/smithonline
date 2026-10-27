/**
 * D6 QA round 2 fixes: the reference plane as the bench's (its start, its range, the silent
 * comparison when it is not free), the F-test it rests on, the pairwise rule before the fit, the
 * instrument's accuracy, library parts in the fit, and a retune that is never worse than the
 * board as it is.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BOARD,
  DEFAULT_PACKAGES,
  HOBBY_VNA_ACCURACY,
  MAX_PLANE,
  SYNTHETIC_PARTS,
  driftParameters,
  fTestP,
  fitBuild,
  modelGammas,
  planeFromPhase,
  planeFromScan,
  retuneEvaluator,
  retunedWorst,
  suggestRetune,
  syntheticPart,
  type BuildFit,
  type BuildModel,
  type Drifts,
  type Element,
  type MeasuredReflection,
} from '../src/index';

const SAMPLE: BuildModel = {
  z0: 50,
  frequency: 1e9,
  base: [
    { kind: 'L', orientation: 'shunt', value: 10e-9, package: '0402' },
    { kind: 'C', orientation: 'series', value: 2.7e-12, package: '0402' },
  ],
  table: DEFAULT_PACKAGES,
  board: { ...DEFAULT_BOARD, enabled: true },
  load: { re: 100, im: -50 },
};
const TRUTH = { 'value:0': 0.08, 'pad:1': 0.3e-12 };
const FS = Array.from({ length: 121 }, (_, i) => 0.7e9 + (0.6e9 * i) / 120);
/** 5 mm of microstrip at an effective permittivity of 3.3, one way: 30.30 ps. */
const TAU_5MM = (5e-3 * Math.sqrt(3.3)) / 299792458;

function normal(seed: number): () => number {
  let s = seed;
  const u = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}
function measure(model: BuildModel, d: Drifts, noise = 1e-3, seed = 11): MeasuredReflection[] {
  const n = normal(seed);
  return modelGammas(model, d, FS).map((g, i) => ({
    frequency: FS[i] as number,
    gamma: { re: g.re + noise * n(), im: g.im + noise * n() },
  }));
}
function ok(out: ReturnType<typeof fitBuild>): BuildFit {
  if (!out.ok) throw new Error(out.reason);
  return out.fit;
}
const param = (fit: BuildFit, id: string) => {
  const p = fit.parameters.find((q) => q.id === id);
  if (!p) throw new Error(`no ${id}`);
  return p;
};
const within3 = (fit: BuildFit, id: string, truth: number): boolean => {
  const p = param(fit, id);
  return p.status === 'fitted' && Math.abs(p.drift - truth) <= 3 * (p.sigma as number);
};
const withPlane = [
  ...driftParameters(SAMPLE)
    .filter((p) => p.freeByDefault)
    .map((p) => p.id),
  'plane',
];

describe('the F-test of the reference plane', () => {
  it('matches the closed forms of F(1, 1) (a Cauchy t) and F(2, n)', () => {
    for (const t of [0.3, 1, 3, 30]) {
      expect(fTestP(t * t, 1, 1)).toBeCloseTo(1 - (2 / Math.PI) * Math.atan(t), 10);
    }
    for (const [f, n] of [
      [0.5, 7],
      [3, 20],
      [12, 200],
    ] as const) {
      expect(fTestP(f, 2, n)).toBeCloseTo((1 + (2 * f) / n) ** (-n / 2), 10);
    }
    // F(1, large) is chi-square with one degree of freedom: 10.828 is its 0.1 % point.
    expect(fTestP(10.828, 1, 1e7)).toBeCloseTo(0.001, 5);
  });
});

describe('a 5 mm reference-plane offset (30.3 ps), the reviewer case', () => {
  const m = measure(SAMPLE, { ...TRUTH, plane: TAU_5MM });
  it('the plane starts near the truth: the scan with the drifts, the phase slope without', () => {
    // The drifts turn the phase too (most near the match), so the phase slope of this board is
    // off by more than the scan; both are only starts, the fit takes it from there.
    expect(Math.abs(planeFromScan(SAMPLE, m) - TAU_5MM)).toBeLessThan(25e-12);
    const planeOnly = measure(SAMPLE, { plane: TAU_5MM });
    expect(Math.abs(planeFromPhase(SAMPLE, planeOnly) - TAU_5MM)).toBeLessThan(10e-12);
    expect(Math.abs(planeFromScan(SAMPLE, planeOnly) - TAU_5MM)).toBeLessThan(10e-12);
  });
  it('ticked: plane, the shunt L value and the series C pads within 3 sigma, the residual at the noise', () => {
    const fit = ok(fitBuild(SAMPLE, m, { free: withPlane }));
    expect(within3(fit, 'plane', TAU_5MM)).toBe(true);
    expect(within3(fit, 'value:0', 0.08)).toBe(true);
    // Before: "not resolved, acts like Shunt L 1 pads (correlation 0.9126)".
    expect(within3(fit, 'pad:1', 0.3e-12)).toBe(true);
    expect(fit.check.residual).toBe('noise');
    expect(fit.check.trusted).toBe(true);
  });
  it('unticked: the silent comparison finds the plane and the fit is not trusted', () => {
    const fit = ok(fitBuild(SAMPLE, m));
    const plane = fit.check.plane;
    expect(plane?.better).toBe(true);
    expect(plane?.p).toBeLessThan(1e-3);
    expect(Math.abs((plane?.drift ?? 0) - TAU_5MM)).toBeLessThan(3 * (plane?.sigma ?? 0));
    expect(fit.check.trusted).toBe(false);
  });
});

describe('the reference plane is the bench: never judged against a board built as designed', () => {
  it('a plane of 1.5 ns is outside the range (MAX_PLANE), not "large"', () => {
    const fit = ok(
      fitBuild(SAMPLE, measure(SAMPLE, { ...TRUTH, plane: 1.5e-9 }), { free: withPlane }),
    );
    const p = param(fit, 'plane');
    const flagged = fit.check.implausible.filter((x) => x.id === 'plane');
    if (Math.abs(p.drift) > MAX_PLANE) expect(flagged).toEqual([{ id: 'plane', why: 'range' }]);
    expect(flagged.every((x) => x.why === 'range')).toBe(true);
  });
  it('a plane of 200 ps (10 typical) is fitted and trusted', () => {
    const fit = ok(
      fitBuild(SAMPLE, measure(SAMPLE, { ...TRUTH, plane: 200e-12 }), { free: withPlane }),
    );
    expect(within3(fit, 'plane', 200e-12)).toBe(true);
    expect(fit.check.implausible).toEqual([]);
    expect(fit.check.trusted).toBe(true);
  });
});

describe('the floor: scatter or the instrument accuracy, whichever is larger', () => {
  it('a lab VNA (default 0.002) and a hobby VNA (0.02) are named as the floor', () => {
    const m = measure(SAMPLE, TRUTH);
    const lab = ok(fitBuild(SAMPLE, m)).check;
    expect(lab.accuracy).toBe(0.002);
    expect(lab.floorFrom).toBe('accuracy');
    expect(lab.floorUsed).toBe(0.002);
    const hobby = ok(fitBuild(SAMPLE, m, { accuracy: HOBBY_VNA_ACCURACY })).check;
    expect(hobby.floorUsed).toBe(0.02);
    const noisy = ok(fitBuild(SAMPLE, measure(SAMPLE, TRUTH, 0.01))).check;
    expect(noisy.floorFrom).toBe('scatter');
    expect(noisy.floorUsed).toBe(noisy.noiseFloor);
  });
});

describe('a library part in the fit and the retune', () => {
  const parts = SYNTHETIC_PARTS.map(syntheticPart);
  const l10 = parts.find((p) => p.partNumber === 'SYNTH-L0402-10N');
  const others = parts.filter((p) => p.type === 'L' && p !== l10);
  if (!l10) throw new Error('no SYNTH-L0402-10N');
  const model: BuildModel = {
    ...SAMPLE,
    base: [
      { kind: 'part', orientation: 'shunt', part: l10 },
      { kind: 'C', orientation: 'series', value: 2.7e-12, package: '0402' },
    ],
  };
  const drifts = { 'value:0': 0.04, 'pad:0': 0.1e-12, 'value:1': -0.03, 'pad:1': 0.2e-12 };
  it('the fast evaluator equals the full model with a part changed (its pad drift kept)', () => {
    const band = [0.9e9, 1e9, 1.1e9];
    const ev = retuneEvaluator(model, drifts, band);
    for (const p of others.slice(0, 4)) {
      const to: Element = { kind: 'part', orientation: 'shunt', part: p };
      const a = ev(new Map([[0, to]]));
      const b = retunedWorst(model, drifts, new Map([[0, to]]), band);
      expect(Math.abs(a.vswr - b.vswr)).toBeLessThan(1e-9 * b.vswr);
    }
  });
});

describe('a retune is never worse than the board as it is', () => {
  it('when every option in reach is worse: no suggestion, noImprovement', () => {
    const drifts = { 'value:0': 0.15, 'value:1': 0.1 };
    const band = [0.9e9, 1e9, 1.1e9];
    const far = (_i: number, el: Element): Element[] =>
      el.kind === 'L' || el.kind === 'C' ? [{ ...el, value: el.value * 30 }] : [];
    const r = suggestRetune(SAMPLE, drifts, { band, limit: 1.01, candidates: far });
    expect(r.suggestion).toBeNull();
    expect(r.noImprovement).toBe(true);
    expect(r.first).toBeNull();
  });
  it('the bound gives the same answer wherever it is not passed', () => {
    const band = Array.from({ length: 41 }, (_, i) => 0.9e9 + i * 5e6);
    const ev = retuneEvaluator(SAMPLE, TRUTH, band);
    for (const v of [6.8e-9, 8.2e-9, 9.1e-9, 12e-9]) {
      const m = new Map<number, Element>([
        [0, { ...(SAMPLE.base[0] as Element), value: v } as Element],
      ]);
      const full = ev(m);
      const bound = 1.3;
      const quick = ev(m, bound);
      if (full.vswr <= bound) expect(quick).toEqual(full);
      else expect(quick.vswr).toBeGreaterThan(bound);
    }
  });
});
