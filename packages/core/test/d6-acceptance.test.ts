/**
 * Randomized acceptance of the closed loop (D6, fix round 3), the fail-safe rule: whenever a fit
 * is trusted and a retune is offered, the retune on the TRUE board does not leave it worse than
 * the board as it is; and every clean fit (no noise, a lab VNA, no plane) is exact. Fixed seeds
 * over drift sizes, reference planes (none, sub-millimetre, a cable of 50 to 300 ps), bands
 * (narrow, the design band only; wide), noise levels, and VNA classes, with the plane ticked as
 * the app advises for a large one. The long variant (600 cases) is skipped by default: run it
 * with `it.skip` changed to `it` when the fit or the retune changes.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BOARD,
  DEFAULT_PACKAGES,
  HOBBY_VNA_ACCURACY,
  MIN_NOISE_FLOOR,
  driftParameters,
  fitBuild,
  modelGammas,
  retuneCandidates,
  retunedWorst,
  suggestRetune,
  type BuildModel,
  type Drifts,
  type MeasuredReflection,
} from '../src/index';

const MODELS: BuildModel[] = [
  {
    z0: 50,
    frequency: 1e9,
    base: [
      { kind: 'L', orientation: 'shunt', value: 10e-9, package: '0402' },
      { kind: 'C', orientation: 'series', value: 2.7e-12, package: '0402' },
    ],
    table: DEFAULT_PACKAGES,
    board: { ...DEFAULT_BOARD, enabled: true },
    load: { re: 100, im: -50 },
  },
  {
    z0: 50,
    frequency: 1e9,
    base: [
      { kind: 'C', orientation: 'shunt', value: 1.5e-12, package: '0402' },
      { kind: 'L', orientation: 'series', value: 6.8e-9, package: '0402' },
      { kind: 'C', orientation: 'shunt', value: 2.2e-12, package: '0402' },
    ],
    table: DEFAULT_PACKAGES,
    board: { ...DEFAULT_BOARD, enabled: true },
    load: { re: 25, im: 15 },
  },
];
const grid = (n: number, a: number, b: number): number[] =>
  Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
const BAND = grid(11, 0.9e9, 1.1e9);
const E24 = { kind: 'series', series: 'E24' } as const;

function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}
function measure(
  model: BuildModel,
  d: Drifts,
  fs: number[],
  noise: number,
  u: () => number,
): MeasuredReflection[] {
  const n = (): number => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
  return modelGammas(model, d, fs).map((g, i) => ({
    frequency: fs[i] as number,
    gamma: { re: g.re + noise * n(), im: g.im + noise * n() },
  }));
}

interface Tally {
  cases: number;
  trusted: number;
  offered: number;
  worse: string[];
  clean: number;
  inexact: string[];
}

function run(count: number, seed0: number): Tally {
  const t: Tally = { cases: 0, trusted: 0, offered: 0, worse: [], clean: 0, inexact: [] };
  for (let k = 0; k < count; k++) {
    const u = rng(seed0 + k * 7919);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(u() * xs.length) % xs.length] as T;
    const g = (): number => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
    const model = pick(MODELS);
    const size = pick([0.5, 1, 2]);
    const truth: Record<string, number> = {};
    for (const p of driftParameters(model)) {
      if (p.kind === 'value') truth[p.id] = size * 0.08 * g();
      if (p.kind === 'pad') truth[p.id] = size * 0.1e-12 * g();
    }
    const clean = k % 5 === 0;
    const plane = clean ? 0 : pick([0, 0, 6e-12 * g(), (50e-12 + 250e-12 * u()) * pick([1, -1])]);
    if (plane !== 0) truth.plane = plane;
    const [n, a, b] = pick([
      [101, 0.9e9, 1.1e9],
      [121, 0.7e9, 1.3e9],
    ] as const);
    const noise = clean ? 0 : pick([5e-4, 1e-3, 3e-3]);
    const accuracy = clean ? MIN_NOISE_FLOOR : pick([MIN_NOISE_FLOOR, HOBBY_VNA_ACCURACY]);
    const defaults = driftParameters(model)
      .filter((p) => p.freeByDefault)
      .map((p) => p.id);
    const ticked = Math.abs(plane) > 20e-12 || (!clean && u() < 0.3);
    const m = measure(model, truth, grid(n, a, b), noise, u);
    const out = fitBuild(model, m, {
      accuracy,
      ...(ticked ? { free: [...defaults, 'plane'] } : {}),
    });
    t.cases++;
    if (!out.ok) continue;
    const fit = out.fit;
    const label = `case ${k} ${JSON.stringify(truth)} n ${n} ${a}-${b} noise ${noise} acc ${accuracy} ticked ${ticked}`;
    if (clean) {
      t.clean++;
      // Exact: the fit reaches the data (to 5 % of the floor: a pad set aside as acting like
      // its part value leaves a trace the value cannot take, up to 0.02 floors for a third of a pF in
      // the 600-case run), no plane is called, and
      // every drift the data resolves (stated sigma at most a third of its prior) is the truth.
      // A parameter set aside as acting like another (a shunt C's pad and its value) gives its
      // drift to that one, which is then not compared.
      const absorbs = new Set(
        fit.parameters.flatMap((p) => (p.why === 'like-another' && p.partner ? [p.partner] : [])),
      );
      const off = fit.parameters.filter(
        (p) =>
          p.status === 'fitted' &&
          !absorbs.has(p.id) &&
          p.sigma !== null &&
          p.sigma <= p.prior / 3 &&
          Math.abs(p.drift - (truth[p.id] ?? 0)) > 1e-4 * p.prior,
      );
      if (
        fit.rmsAfter > 5e-2 * fit.check.floorUsed ||
        off.length > 0 ||
        fit.check.plane?.better === true
      )
        t.inexact.push(`${label}: rms ${fit.rmsAfter}, off ${off.map((p) => p.id).join(',')}`);
    }
    if (!fit.check.trusted) continue;
    t.trusted++;
    const r = suggestRetune(model, fit.drifts, {
      band: BAND,
      limit: 1.38,
      candidates: retuneCandidates(E24, 1e9, BAND),
      alternatives: fit.alternatives,
    });
    const s = r.suggestion;
    if (!s || s.changes.length === 0) continue;
    t.offered++;
    const board: Record<string, number> = { ...truth };
    delete board.plane;
    const asIs = retunedWorst(model, board, new Map(), BAND).vswr;
    const real = retunedWorst(
      model,
      board,
      new Map(s.changes.map((c) => [c.index, c.to])),
      BAND,
    ).vswr;
    if (!(real <= asIs * (1 + 1e-9)))
      t.worse.push(`${label}: as is ${asIs.toFixed(4)}, after ${real.toFixed(4)}`);
  }
  return t;
}

const report = (t: Tally): void =>
  void process.stdout.write(
    `acceptance: ${t.cases} cases, ${t.trusted} trusted, ${t.offered} retunes offered, ${t.worse.length} worse on the true board; ${t.clean} clean, ${t.inexact.length} inexact\n`,
  );

describe('closed loop acceptance (randomized, fixed seeds)', () => {
  it('60 cases: no offered retune makes the true board worse; every clean fit is exact', () => {
    const t = run(60, 1);
    report(t);
    expect(t.worse).toEqual([]);
    expect(t.inexact).toEqual([]);
    expect(t.clean).toBeGreaterThan(5);
    expect(t.offered).toBeGreaterThan(0);
  }, 300000);

  // The long variant: 600 cases, several minutes. Skipped by default (runtime); run it by hand
  // after a change to the fit, the checks or the retune.
  it.skip('600 cases (long)', () => {
    const t = run(600, 100003);
    report(t);
    expect(t.worse).toEqual([]);
    expect(t.inexact).toEqual([]);
  }, 3600000);
});
