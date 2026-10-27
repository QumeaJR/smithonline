/**
 * Adversarial QA, D6 round 1: closedloop.ts against hostile measurements and models other
 * than the sample board.
 */
import { describe, expect, it } from 'vitest';
import {
  compareMeasurement,
  DEFAULT_BOARD,
  DEFAULT_PACKAGES,
  driftParameters,
  fitBuild,
  modelGammas,
  retuneCandidates,
  suggestRetune,
  type BuildModel,
  type MeasuredReflection,
} from '../src/index';

const BASE: BuildModel = {
  z0: 50,
  frequency: 1e9,
  base: [
    { kind: 'L', orientation: 'shunt', value: 12e-9, package: '0402' },
    { kind: 'C', orientation: 'series', value: 2.7e-12, package: '0402' },
  ],
  table: DEFAULT_PACKAGES,
  board: { ...DEFAULT_BOARD, enabled: true },
  load: { re: 100, im: -50 },
};

const fs = (n: number, lo = 0.7e9, hi = 1.3e9): number[] =>
  Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));

const measure = (m: BuildModel, d: Record<string, number>, f: number[]): MeasuredReflection[] =>
  modelGammas(m, d, f).map((gamma, i) => ({ frequency: f[i] as number, gamma }));

function recovered(
  m: BuildModel,
  truth: Record<string, number>,
  free: string[],
): Record<string, number> {
  const out = fitBuild(m, measure(m, truth, fs(61)), { free });
  if (!out.ok) throw new Error(out.reason);
  return Object.fromEntries(
    out.fit.parameters.filter((p) => free.includes(p.id)).map((p) => [p.id, p.drift]),
  );
}

describe('noise-free recovery on models other than the sample', () => {
  const cases: [string, BuildModel][] = [
    [
      '0603 and 0805 packages',
      {
        ...BASE,
        base: [
          { kind: 'L', orientation: 'shunt', value: 12e-9, package: '0603' },
          { kind: 'C', orientation: 'series', value: 2.7e-12, package: '0805' },
        ],
      } as BuildModel,
    ],
    [
      'parts with their own Q',
      {
        ...BASE,
        base: [
          { kind: 'L', orientation: 'shunt', value: 12e-9, package: '0402', q: 30 },
          { kind: 'C', orientation: 'series', value: 2.7e-12, package: '0402', q: 200 },
        ],
      } as BuildModel,
    ],
    [
      'a line between the parts',
      {
        ...BASE,
        base: [
          { kind: 'L', orientation: 'shunt', value: 12e-9, package: '0402' },
          { kind: 'line', z0: 50, length: 0.05, refFrequency: 1e9 },
          { kind: 'C', orientation: 'series', value: 2.7e-12, package: '0402' },
        ],
      } as BuildModel,
    ],
    ['Z0 75', { ...BASE, z0: 75 }],
    [
      'three parts, board off, no packages',
      {
        ...BASE,
        board: { ...DEFAULT_BOARD, enabled: false },
        base: [
          { kind: 'C', orientation: 'shunt', value: 3.3e-12 },
          { kind: 'L', orientation: 'series', value: 6.8e-9 },
          { kind: 'C', orientation: 'shunt', value: 1.5e-12 },
        ],
      } as BuildModel,
    ],
    [
      'measured load at Z0 75',
      {
        ...BASE,
        z0: 75,
        load: fs(5, 0.6e9, 1.4e9).map((f, i) => ({
          frequency: f,
          z: { re: 90 + 5 * i, im: -40 + 3 * i },
        })),
      },
    ],
  ];
  for (const [name, m] of cases) {
    it(name, () => {
      const ids = driftParameters(m)
        .filter((p) => p.kind === 'value')
        .map((p) => p.id);
      const truth = Object.fromEntries(ids.map((id, i) => [id, i % 2 === 0 ? 0.06 : -0.04]));
      const got = recovered(m, truth, ids);
      for (const id of ids) expect(got[id], id).toBeCloseTo(truth[id] as number, 3);
    });
  }
});

describe('hostile measured reflections', () => {
  const good = measure(BASE, { 'value:0': 0.08 }, fs(21));
  it('NaN, Infinity, |Gamma| >= 2 and zero or negative frequencies are left out, not fitted', () => {
    const bad: MeasuredReflection[] = [
      ...good,
      { frequency: NaN, gamma: { re: 0, im: 0 } },
      { frequency: 1e9, gamma: { re: NaN, im: 0 } },
      { frequency: 1e9, gamma: { re: Infinity, im: 0 } },
      { frequency: 1e9, gamma: { re: 3, im: 0 } },
      { frequency: 0, gamma: { re: 0, im: 0 } },
      { frequency: -1e9, gamma: { re: 0, im: 0 } },
    ];
    const out = fitBuild(BASE, bad, { free: ['value:0', 'value:1'] });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.fit.leftOut).toBe(6);
      expect(out.fit.drifts['value:0']).toBeCloseTo(0.08, 4);
    }
  });

  it('one frequency repeated 21 times is one frequency, not 21', () => {
    const one = Array.from({ length: 21 }, () => good[10] as MeasuredReflection);
    const out = fitBuild(BASE, one, { free: ['value:0', 'value:1', 'pad:1', 'via'] });
    // Four unknowns from one frequency (two numbers): the data cannot support them.
    if (out.ok) {
      const fitted = out.fit.parameters.filter((p) => p.status === 'fitted');
      expect(fitted.length).toBeLessThanOrEqual(2);
      expect(out.fit.dof).toBeGreaterThanOrEqual(0);
    }
  });

  it('|Gamma| between 1 and 2 (an active or miscalibrated board) does not break compare', () => {
    const m = fs(11).map((f) => ({ frequency: f, gamma: { re: 1.4, im: 0.2 } }));
    const c = compareMeasurement(BASE, m, { band: [0.9e9, 1.1e9] });
    expect(c.points).toHaveLength(11);
    expect(Number.isNaN(c.rmsDelta)).toBe(false);
  });

  it('all-equal measurement (a flat 50 ohm) fits without throwing', () => {
    const m = fs(31).map((f) => ({ frequency: f, gamma: { re: 0, im: 0 } }));
    expect(() => fitBuild(BASE, m)).not.toThrow();
  });
});

describe('retune with nothing to snap to', () => {
  it('an empty stock list and an empty library give no suggestion, not a throw', () => {
    for (const source of [
      { kind: 'stock', stock: { L: [], C: [], R: [] } },
      { kind: 'library', parts: [] },
    ] as const) {
      const r = suggestRetune(
        BASE,
        { 'value:0': 0.08 },
        {
          band: fs(11, 0.9e9, 1.1e9),
          limit: 1.5,
          candidates: retuneCandidates(source as never, 1e9, fs(11, 0.9e9, 1.1e9)),
        },
      );
      expect(r.suggestion).toBeNull();
      expect(Number.isFinite(r.before.vswr)).toBe(true);
    }
  });
});

describe('time on the main thread', () => {
  it('suggestRetune for eight parts over 201 frequencies stays under a second', () => {
    const base = Array.from({ length: 8 }, (_, i) =>
      i % 2 === 0
        ? ({ kind: 'L', orientation: 'shunt', value: 10e-9 + i * 1e-9, package: '0402' } as const)
        : ({
            kind: 'C',
            orientation: 'series',
            value: 2e-12 + i * 0.3e-12,
            package: '0402',
          } as const),
    );
    const m: BuildModel = { ...BASE, base };
    const band = fs(201, 0.8e9, 1.2e9);
    const t0 = performance.now();
    suggestRetune(
      m,
      {},
      {
        band,
        limit: 1.01,
        candidates: retuneCandidates({ kind: 'series', series: 'E96' }, 1e9, band),
      },
    );
    const ms = performance.now() - t0;
    console.log('retune ms', ms);
    expect(ms).toBeLessThan(1000);
  });

  it('fitBuild over 2001 frequencies (in the worker) finishes', () => {
    const m = measure(BASE, { 'value:0': 0.08, 'pad:1': 0.3e-12 }, fs(2001));
    const t0 = performance.now();
    const out = fitBuild(BASE, m);
    console.log('fit ms', performance.now() - t0, out.ok);
    expect(out.ok).toBe(true);
  });
});

describe('Suggest retune runs on the main thread with no progress or Stop', () => {
  it('sixteen parts over 201 frequencies (E96) stays under two seconds', () => {
    const base = Array.from({ length: 16 }, (_, i) =>
      i % 2 === 0
        ? ({ kind: 'L', orientation: 'shunt', value: 10e-9 + i * 1e-9, package: '0402' } as const)
        : ({
            kind: 'C',
            orientation: 'series',
            value: 2e-12 + i * 0.3e-12,
            package: '0402',
          } as const),
    );
    const band = fs(201, 0.8e9, 1.2e9);
    const t0 = performance.now();
    suggestRetune(
      { ...BASE, base },
      {},
      {
        band,
        limit: 1.01,
        candidates: retuneCandidates({ kind: 'series', series: 'E96' }, 1e9, band),
      },
    );
    expect(performance.now() - t0).toBeLessThan(2000);
  }, 60000);
});
