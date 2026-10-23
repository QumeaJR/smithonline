import { describe, expect, it } from 'vitest';
import {
  complex,
  lMatch,
  limitCost,
  limitScale,
  limitStatus,
  OPTIMIZE_FAIL,
  optimizeBand,
  sweepFrequency,
  sweepPoints,
  sweepResponse,
  violationOf,
  type Element,
  type Ladder,
  type LimitArea,
} from '../src/index';

const F = 140e6;
const LOAD = complex(25, -18);
const BAND = sweepPoints(0.9 * F, 1.1 * F, 41);

function matched(): Ladder {
  const sols = lMatch(LOAD, complex(50, 0), F);
  return { z0: 50, frequency: F, load: LOAD, elements: sols[0]!.elements.slice() };
}

function area(over: Partial<LimitArea> = {}): LimitArea {
  return { id: 'a', quantity: 'vswr', f1: 0.9 * F, f2: 1.1 * F, kind: 'max', value: 1.5, ...over };
}

describe('violationOf', () => {
  it('is positive above a max and below a min', () => {
    expect(violationOf({ kind: 'max', value: 2 }, 3)).toBe(1);
    expect(violationOf({ kind: 'max', value: 2 }, 1.5)).toBe(-0.5);
    expect(violationOf({ kind: 'min', value: -10 }, -12)).toBe(2);
    expect(violationOf({ kind: 'min', value: -10 }, -8)).toBe(-2);
  });
});

describe('limitStatus', () => {
  const response = sweepResponse(sweepFrequency(matched(), BAND));

  it('reports the worst sample inside the range and where it is', () => {
    const s = limitStatus(area(), response)!;
    const worstVswr = Math.max(...response.vswr);
    expect(s.worst).toBeCloseTo(worstVswr - 1.5, 9);
    expect(s.samples).toBe(41);
    expect(response.vswr[response.frequency.indexOf(s.frequency)]).toBeCloseTo(worstVswr, 9);
  });

  it('only looks inside the frequency range, whichever order the edges come in', () => {
    const inner = limitStatus(area({ f1: 1.02 * F, f2: 0.98 * F }), response)!;
    expect(inner.samples).toBeLessThan(41);
    expect(inner.worst).toBeLessThan(limitStatus(area(), response)!.worst);
  });

  it('is null when no sample lies inside', () => {
    expect(limitStatus(area({ f1: 2 * F, f2: 3 * F }), response)).toBeNull();
  });

  it('reads a min limit on the return loss column', () => {
    // |S11| must be at or below -10 dB: as a max limit on s11Db.
    const s = limitStatus(area({ quantity: 's11Db', value: -10 }), response)!;
    expect(s.worst).toBeCloseTo(Math.max(...response.s11Db) + 10, 9);
    const s21 = limitStatus(area({ quantity: 's21Db', kind: 'min', value: -0.5 }), response)!;
    expect(s21.worst).toBeCloseTo(-0.5 - Math.min(...response.s21Db), 9);
  });

  it('counts an infinite VSWR as an infinite breach and skips NaN', () => {
    const r = { ...response, vswr: response.vswr.map((v, i) => (i === 3 ? Infinity : v)) };
    expect(limitStatus(area(), r)!.worst).toBe(Infinity);
    const n = { ...response, vswr: response.vswr.map(() => NaN) };
    expect(limitStatus(area(), n)).toBeNull();
  });
});

describe('limitScale', () => {
  it('weights the quantities so a mix of areas is comparable', () => {
    expect(limitScale('s21Db', 50)).toBe(1);
    expect(limitScale('vswr', 50)).toBe(0.1);
    expect(limitScale('r', 50)).toBe(5);
    expect(limitScale('groupDelay', 50)).toBe(1e-9);
  });
});

describe('limitCost', () => {
  it('is the worst normalized violation, 0 when every area holds', () => {
    const ladder = matched();
    const cost = limitCost(ladder, [area({ value: 1.1 })], BAND);
    const worst = Math.max(...sweepResponse(sweepFrequency(ladder, BAND)).vswr);
    expect(cost(ladder.elements)).toBeCloseTo((worst - 1.1) / 0.1, 9);
    const loose = limitCost(ladder, [area({ value: 10 })], BAND);
    expect(loose(ladder.elements)).toBe(0);
  });

  it('adds the area edges to the grid so a narrow area is seen', () => {
    const ladder = matched();
    const f = 1.0234 * F; // between two sweep points
    const narrow = limitCost(ladder, [area({ f1: f, f2: f, value: 1.0 })], BAND);
    expect(narrow(ladder.elements)).toBeGreaterThan(0);
  });

  it('takes the worst of several areas', () => {
    const ladder = matched();
    const cost = limitCost(
      ladder,
      [area({ value: 5 }), area({ id: 'b', quantity: 's21Db', kind: 'min', value: 0 })],
      BAND,
    );
    // The ladder is lossless, so S21 sits at or just below 0 dB: the second area binds.
    expect(cost(ladder.elements)).toBeGreaterThanOrEqual(0);
  });

  it('fails a candidate that reflects everything', () => {
    const ladder: Ladder = { ...matched(), load: complex(0, 30) };
    const cost = limitCost(ladder, [area()], BAND);
    expect(cost([])).toBe(OPTIMIZE_FAIL);
  });

  it('is zero without areas', () => {
    const ladder = matched();
    expect(limitCost(ladder, [], BAND)(ladder.elements)).toBe(0);
  });
});

describe('optimizeBand with a limit cost', () => {
  it('drives the worst violation down, never up, and reports the cost values', () => {
    const ladder = matched();
    const areas = [area({ value: 1.05 })];
    const cost = limitCost(ladder, areas, BAND);
    const before = cost(ladder.elements);
    expect(before).toBeGreaterThan(0);
    const out = optimizeBand(ladder, BAND, { cost, restarts: 4, iterations: 150 });
    expect(out.before).toBeCloseTo(before, 12);
    expect(out.after).toBeLessThanOrEqual(out.before);
    expect(out.after).toBeCloseTo(cost(out.elements as Element[]), 12);
  });

  it('leaves a design that already meets the limits untouched', () => {
    const ladder = matched();
    const cost = limitCost(ladder, [area({ value: 10 })], BAND);
    const out = optimizeBand(ladder, BAND, { cost, restarts: 2 });
    expect(out.before).toBe(0);
    expect(out.after).toBe(0);
    expect(out.elements).toBe(ladder.elements);
  });

  it('keeps the old behaviour without a cost option', () => {
    const ladder = matched();
    const a = optimizeBand(ladder, BAND, { restarts: 2, iterations: 80 });
    expect(a.before).toBeGreaterThan(1);
  });
});
