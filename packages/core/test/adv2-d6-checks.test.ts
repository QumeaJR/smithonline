/**
 * Adversarial QA, D6 round 2 (verification of dc9603d): the plausibility checks of a fit, the
 * reference plane, and the fewest-changes retune. Each test states the correct behaviour; a
 * failing test is a reproduced defect.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BOARD,
  DEFAULT_PACKAGES,
  HOBBY_VNA_ACCURACY,
  driftParameters,
  fitBuild,
  modelGammas,
  retuneCandidates,
  retuneEvaluator,
  retunedWorst,
  suggestRetune,
  type BuildFit,
  type BuildModel,
  type Drifts,
  type Element,
  type MeasuredReflection,
} from '../src/index';

/** The sample board (scripts/synth-board.mjs): shunt L 10 nH, series C 2.7 pF, 0402, FR-4, 100 - j50 ohm. */
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
const TRUTH: Record<string, number> = { 'value:0': 0.08, 'pad:1': 0.3e-12 };
const grid = (n: number, a = 0.7e9, b = 1.3e9): number[] =>
  Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
const FS = grid(121);
const BAND = grid(11, 0.9e9, 1.1e9);
const E24 = { kind: 'series', series: 'E24' } as const;

function normal(seed: number): () => number {
  let s = seed;
  const u = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}
function measure(
  drifts: Drifts,
  fs = FS,
  noise = 1e-3,
  sys?: (f: number) => { re: number; im: number },
): MeasuredReflection[] {
  const n = normal(11);
  return modelGammas(SAMPLE, drifts, fs).map((g, i) => {
    const f = fs[i] as number;
    const e = sys ? sys(f) : { re: 0, im: 0 };
    return {
      frequency: f,
      gamma: { re: g.re + e.re + noise * n(), im: g.im + e.im + noise * n() },
    };
  });
}
function ok(out: ReturnType<typeof fitBuild>): BuildFit {
  if (!out.ok) throw new Error(out.reason);
  return out.fit;
}
const withPlane = [
  ...driftParameters(SAMPLE)
    .filter((p) => p.freeByDefault)
    .map((p) => p.id),
  'plane',
];

describe('Reference plane ticked: a real port extension is the bench, not the board', () => {
  it('80 ps (an SMA edge launch and a barrel outside the calibration) fits to the noise and is trusted', () => {
    const fit = ok(fitBuild(SAMPLE, measure({ ...TRUTH, plane: 80e-12 }), { free: withPlane }));
    const plane = fit.parameters.find((p) => p.id === 'plane');
    expect(Math.abs((plane?.drift ?? 0) - 80e-12)).toBeLessThan(15e-12);
    expect(fit.check.residual).toBe('noise');
    // Observed: implausible [{ id: 'plane', why: 'large' }], trusted false, the retune refused.
    expect(fit.check.implausible).toEqual([]);
    expect(fit.check.trusted).toBe(true);
  });

  it('300 ps (calibrated at the VNA port, about 6 cm of cable to the board) is found, not a local minimum', () => {
    const fit = ok(fitBuild(SAMPLE, measure({ ...TRUTH, plane: 300e-12 }), { free: withPlane }));
    const plane = fit.parameters.find((p) => p.id === 'plane');
    // Observed: plane -137 ps, value:0 +46.6 %, residual 107 floors ("unexplained").
    expect(plane?.status).toBe('fitted');
    expect(Math.abs((plane?.drift ?? 0) - 300e-12)).toBeLessThan(10e-12);
  });
});

describe('Reference plane unticked: a small plane error must not pass as noise with wrong drifts', () => {
  // Observed at dc9603d: verdict noise and trusted, Series C value -3.79 % +- 0.03 % (truth 0).
  // Now the silent fit with the plane (an F-test, p < 0.001) flags it and the fit is not trusted;
  // with Reference plane ticked the drifts match the truth.
  const inside3 = (fit: BuildFit, truth: Record<string, number>): string[] =>
    fit.parameters
      .filter((p) => p.status === 'fitted' && p.sigma !== null)
      .filter((p) => Math.abs(p.drift - (truth[p.id] ?? 0)) > 3 * (p.sigma as number))
      .map(
        (p) =>
          `${p.id}: fitted ${p.drift.toExponential(3)} +- ${(p.sigma as number).toExponential(2)}, truth ${truth[p.id] ?? 0}`,
      );

  it('-12 ps (1.8 mm of FR-4 microstrip): flagged with the plane it needs; ticked, the drifts match the truth', () => {
    const m = measure({ ...TRUTH, plane: -12e-12 });
    const fit = ok(fitBuild(SAMPLE, m));
    expect(fit.check.plane?.better).toBe(true);
    expect(fit.check.trusted).toBe(false);
    const plane = fit.check.plane;
    expect(Math.abs((plane?.drift ?? 0) + 12e-12)).toBeLessThan(3 * (plane?.sigma ?? 0));
    const ticked = ok(fitBuild(SAMPLE, m, { free: withPlane }));
    expect(ticked.check.trusted).toBe(true);
    expect(inside3(ticked, { ...TRUTH, plane: -12e-12 })).toEqual([]);
  });

  it('+8.8 ps with other plausible drifts: flagged; ticked, the retune reaches the target on the real board', () => {
    const truth = {
      'value:0': 0.10989700330416531,
      'value:1': -0.06106546689340167,
      'pad:1': 5.449653766327378e-14,
      'pad:0': 2.58646805313717e-13,
    };
    const m = measure({ ...truth, plane: 8.764268073143561e-12 });
    const fit = ok(fitBuild(SAMPLE, m));
    expect(fit.check.plane?.better).toBe(true);
    expect(fit.check.trusted).toBe(false);
    const ticked = ok(fitBuild(SAMPLE, m, { free: withPlane }));
    expect(ticked.check.trusted).toBe(true);
    const r = suggestRetune(SAMPLE, ticked.drifts, {
      band: BAND,
      limit: 1.38,
      candidates: retuneCandidates(E24, 1e9, BAND),
    });
    const s = r.suggestion;
    expect(s?.inside).toBe(true);
    const real = retunedWorst(SAMPLE, truth, new Map(s?.changes.map((c) => [c.index, c.to])), BAND);
    expect(real.vswr).toBeLessThanOrEqual(1.38);
  });

  it('no plane: the comparison does not call for one (p above 0.001)', () => {
    const fit = ok(fitBuild(SAMPLE, measure(TRUTH)));
    expect(fit.check.plane?.better).toBe(false);
    expect(fit.check.trusted).toBe(true);
  });
});

describe('a smooth calibration residual is held against the instrument class', () => {
  const sys = (f: number): { re: number; im: number } => ({
    re: 0.03 * Math.cos(2 * Math.PI * f * 1e-9),
    im: 0.03 * Math.sin(2 * Math.PI * f * 1e-9),
  });
  it('0.03 directivity residual with a 1 ns ripple: trusted against a hobby VNA, and its retune is right', () => {
    // Observed at dc9603d: 10.2 floors, 'unexplained', the right retune refused. The floor was the
    // scatter (or 0.002) only; a hobby VNA's accuracy (0.02) is now a setting.
    const fit = ok(
      fitBuild(SAMPLE, measure(TRUTH, FS, 1e-3, sys), { accuracy: HOBBY_VNA_ACCURACY }),
    );
    expect(fit.check.floorFrom).toBe('accuracy');
    expect(fit.check.trusted).toBe(true);
    const r = suggestRetune(SAMPLE, fit.drifts, {
      band: BAND,
      limit: 1.38,
      candidates: retuneCandidates(E24, 1e9, BAND),
    });
    const real = retunedWorst(
      SAMPLE,
      TRUTH,
      new Map(r.suggestion?.changes.map((c) => [c.index, c.to])),
      BAND,
    );
    expect(real.vswr).toBeLessThanOrEqual(1.38);
  });
  it('the same against a lab VNA (the default, 0.002) is not explained', () => {
    const fit = ok(fitBuild(SAMPLE, measure(TRUTH, FS, 1e-3, sys)));
    expect(fit.check.residual).toBe('unexplained');
    expect(fit.check.trusted).toBe(false);
  });
});

describe('fewest changes: a pair outside the parts coordinate descent kept', () => {
  const ladder = (spec: [string, string, number][]): Element[] =>
    spec.map(([kind, orientation, value]) => ({ kind, orientation, value }) as Element);
  const cases = [
    {
      name: '5 parts, limit 1.8: three changes given where a pair reaches the target',
      base: ladder([
        ['C', 'shunt', 2.2e-12],
        ['L', 'series', 3.3e-9],
        ['C', 'shunt', 1e-12],
        ['L', 'series', 6.8e-9],
        ['C', 'shunt', 1e-12],
      ]),
      load: { re: 119.79185620313132, im: -23.272793972060455 },
      drifts: {
        'value:0': 0.18050570526649512,
        'value:1': -0.24061158601688762,
        'value:2': 0.041073814170003775,
        'value:3': -0.17240524474643415,
        'value:4': -0.11494845331876932,
      },
      limit: 1.8,
    },
    {
      name: '6 parts, limit 1.65: three changes and still outside, where a pair reaches the target',
      base: ladder([
        ['L', 'shunt', 6.8e-9],
        ['C', 'series', 2.2e-12],
        ['C', 'shunt', 4.7e-12],
        ['L', 'series', 1e-8],
        ['C', 'shunt', 3.3e-12],
        ['C', 'series', 1.5e-12],
      ]),
      load: { re: 152.58626388040665, im: 52.33703799421762 },
      drifts: {
        'value:0': 0.09532522938462218,
        'value:1': 0.1311302673449415,
        'value:2': -0.09359673356804846,
        'value:3': -0.08030107819023594,
        'value:4': -0.1202211432951601,
        'value:5': -0.05675536175573029,
      },
      limit: 1.65,
    },
  ];
  for (const c of cases)
    it(c.name, () => {
      const band = [0.97e9, 1e9, 1.03e9];
      const model: BuildModel = {
        z0: 50,
        frequency: 1e9,
        base: c.base,
        table: DEFAULT_PACKAGES,
        board: DEFAULT_BOARD,
        load: c.load,
      };
      const cands = retuneCandidates(E24, 1e9, band);
      const ev = retuneEvaluator(model, c.drifts, band);
      let best = { w: Infinity, at: '' };
      c.base.forEach((a, i) =>
        c.base.forEach((b, j) => {
          if (j <= i) return;
          for (const x of cands(i, a))
            for (const y of cands(j, b)) {
              const w = ev(
                new Map([
                  [i, x],
                  [j, y],
                ]),
              ).vswr;
              if (w < best.w)
                best = {
                  w,
                  at: `${i}->${(x as { value: number }).value}, ${j}->${(y as { value: number }).value}`,
                };
            }
        }),
      );
      expect(best.w).toBeLessThanOrEqual(c.limit);
      const r = suggestRetune(model, c.drifts, { band, limit: c.limit, candidates: cands });
      const got = r.suggestion?.changes.map(
        (ch) => `${ch.index}->${(ch.to as { value: number }).value}`,
      );
      expect({
        inside: r.suggestion?.inside,
        n: got?.length,
        got,
        worst: r.suggestion?.worst.vswr,
        pair: best,
      }).toMatchObject({ inside: true, n: 2 });
    });
});
