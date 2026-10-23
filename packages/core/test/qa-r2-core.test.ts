/**
 * QA round 2: branches of the Touchstone option line reader, limitStatus and
 * limitCost, and usableBandwidth that the existing tests do not reach.
 * Expected values are hand calculations.
 */
import { describe, expect, it } from 'vitest';
import {
  complex,
  limitCost,
  limitStatus,
  readTouchstone,
  usableBandwidth,
  type Ladder,
  type LimitArea,
  type Response,
} from '../src/index.js';

const ONE_PORT = '1 0.5 0\n';

describe('qa r2: readOptionLine token handling', () => {
  it('reads unit, parameter, format and R in any order and case', () => {
    const d = readTouchstone(`# r 75 ri y khz\n${ONE_PORT}`, 1);
    expect(d.frequencyUnit).toBe('KHZ');
    expect(d.parameter).toBe('Y');
    expect(d.format).toBe('RI');
    expect(d.z0).toBe(75);
    expect(d.points[0]!.frequency).toBe(1e3);
  });

  it('R followed by a word is an unknown option, not a silent default', () => {
    expect(() => readTouchstone(`# GHZ S MA R XYZ\n${ONE_PORT}`, 1)).toThrow(
      /Unknown option "XYZ"/,
    );
  });

  it('R with a negative or zero value keeps 50 ohm and does not throw', () => {
    expect(readTouchstone(`# GHZ S MA R -50\n${ONE_PORT}`, 1).z0).toBe(50);
    expect(readTouchstone(`# GHZ S MA R 0\n${ONE_PORT}`, 1).z0).toBe(50);
  });

  it('a later token of the same kind wins (S then Z is Z, MA then DB is DB)', () => {
    const d = readTouchstone(`# S Z MA DB\n1 0 0\n`, 1);
    expect(d.parameter).toBe('Z');
    expect(d.format).toBe('DB');
  });

  it('the A (ABCD) parameter is accepted by the reader and labelled A', () => {
    expect(readTouchstone(`# GHZ A RI R 50\n1 1 0 0 0 0 0 1 0\n`, 2).parameter).toBe('A');
  });

  it('a token mixing letters and digits (R50, S2) is refused rather than dropped', () => {
    expect(() =>
      readTouchstone(
        `# GHZ S MA R50
${ONE_PORT}`,
        1,
      ),
    ).toThrow(/Unknown option/);
    expect(() =>
      readTouchstone(
        `# GHZ S2 MA
${ONE_PORT}`,
        1,
      ),
    ).toThrow(/Unknown option/);
  });

  it('an option line of only "#" and one with trailing spaces give the defaults', () => {
    const d = readTouchstone(`#   \n${ONE_PORT}`, 1);
    expect(d).toMatchObject({ frequencyUnit: 'GHZ', parameter: 'S', format: 'MA', z0: 50 });
  });
});

function response(frequency: number[], vswr: number[]): Response {
  const n = frequency.length;
  const zeros = new Array<number>(n).fill(0);
  return {
    frequency,
    vswr,
    s11Db: zeros,
    s21Db: zeros,
    r: zeros,
    x: zeros,
    phaseDeg: zeros,
    groupDelay: zeros,
  };
}

const area = (over: Partial<LimitArea>): LimitArea => ({
  id: 'a',
  quantity: 'vswr',
  f1: 1e9,
  f2: 2e9,
  kind: 'max',
  value: 2,
  ...over,
});

describe('qa r2: limitStatus', () => {
  it('f1 == f2 at a sample frequency is one sample', () => {
    const r = response([1e9, 1.5e9, 2e9], [1.1, 3, 1.2]);
    expect(limitStatus(area({ f1: 1.5e9, f2: 1.5e9 }), r)).toEqual({
      worst: 1,
      frequency: 1.5e9,
      samples: 1,
    });
  });

  it('a NaN first sample is skipped and a -Infinity second sample is reported at its frequency', () => {
    const r = response([1e9, 1.5e9, 2e9], [NaN, -Infinity, -Infinity]);
    const s = limitStatus(area({}), r)!;
    expect(s.samples).toBe(2);
    expect(s.worst).toBe(-Infinity);
    expect(s.frequency).toBe(1.5e9);
  });

  it('two equal worst samples report the first one', () => {
    const r = response([1e9, 1.5e9, 2e9], [3, 3, 1]);
    expect(limitStatus(area({}), r)!.frequency).toBe(1e9);
  });

  it('an Infinity upper edge covers every sample above f1', () => {
    const r = response([1e9, 5e9, 1e12], [1, 1, 4]);
    const s = limitStatus(area({ f1: 2e9, f2: Infinity }), r)!;
    expect(s.samples).toBe(2);
    expect(s.worst).toBe(2);
    expect(s.frequency).toBe(1e12);
  });

  it('NaN edges select nothing (null), as no frequency compares inside', () => {
    const r = response([1e9, 2e9], [1, 1]);
    expect(limitStatus(area({ f1: NaN, f2: 2e9 }), r)).toBeNull();
  });
});

describe('qa r2: limitCost', () => {
  const ladder: Ladder = { z0: 50, frequency: 1e9, load: complex(50, 0), elements: [] };

  it('an empty ladder on Z0 meets a VSWR max of 2 everywhere: cost 0', () => {
    expect(limitCost(ladder, [area({})], [1e9, 1.5e9])([])).toBe(0);
  });

  it('a load of 150 ohm (VSWR 3) breaks a VSWR max of 2 by 1, scaled by 0.1 to 10', () => {
    const l = { ...ladder, load: complex(150, 0) };
    expect(limitCost(l, [area({})], [1e9])([])).toBeCloseTo(10, 9);
  });

  it('an area with an Infinity edge does not throw and leaves the cost of the finite samples', () => {
    const l = { ...ladder, load: complex(150, 0) };
    const cost = limitCost(l, [area({ f2: Infinity })], [1.5e9]);
    expect(cost([])).toBeCloseTo(10, 9);
  });

  it('an area with NaN edges contributes nothing and the band frequencies still count', () => {
    const l = { ...ladder, load: complex(150, 0) };
    expect(limitCost(l, [area({ f1: NaN, f2: NaN })], [1.5e9])([])).toBe(0);
  });

  it('a min area on VSWR of 1 at a matched ladder is a zero violation, not a breach', () => {
    expect(limitCost(ladder, [area({ kind: 'min', value: 1 })], [1e9])([])).toBe(0);
  });

  it('a VSWR min of 3 against a matched ladder (VSWR 1) costs (3 - 1) / 0.1 = 20', () => {
    expect(limitCost(ladder, [area({ kind: 'min', value: 3 })], [1e9])([])).toBeCloseTo(20, 9);
  });
});

describe('qa r2: usableBandwidth', () => {
  it('a VSWR that sits exactly on the limit everywhere is open at both ends of the range', () => {
    const b = usableBandwidth(() => 2, 1e9, 2)!;
    expect(b.low).toBe(1e9 / 8);
    expect(b.high).toBe(8e9);
    expect(b.lowOpen).toBe(true);
    expect(b.highOpen).toBe(true);
    expect(b.span).toBe(8e9 - 1e9 / 8);
  });

  it('centre at the top of a one-sided band: the upper edge equals the centre within one bisection', () => {
    // Inside at and below 1 GHz, outside above it.
    const b = usableBandwidth((f) => (f <= 1e9 ? 1 : 10), 1e9, 2, { steps: 10, bisections: 30 })!;
    expect(b.highOpen).toBe(false);
    expect(b.high).toBeGreaterThanOrEqual(1e9);
    expect(b.high - 1e9).toBeLessThan((7e9 / 10) * 2 ** -30 + 1);
    expect(b.lowOpen).toBe(true);
  });

  it('a search range of one step on each side (steps 1, bisections 1) still returns a band', () => {
    const b = usableBandwidth((f) => (f > 1.5e9 || f < 0.5e9 ? 5 : 1), 1e9, 2, {
      min: 0.25e9,
      max: 4e9,
      steps: 1,
      bisections: 1,
    })!;
    // Up: 4 GHz is outside; one bisection at 2.5 GHz is outside; inside stays at the centre.
    expect(b.high).toBe(1e9);
    // Down: 0.25 GHz is outside; bisection at 0.625 GHz is inside.
    expect(b.low).toBe(0.625e9);
    expect(b.lowOpen).toBe(false);
    expect(b.highOpen).toBe(false);
  });

  it('a large finite steps count is honoured as given (no cap); 1e5 steps complete', () => {
    let calls = 0;
    const b = usableBandwidth(
      () => {
        calls++;
        return 1;
      },
      1e9,
      2,
      { steps: 1e5, bisections: 1 },
    )!;
    expect(b.highOpen).toBe(true);
    // One call at the centre plus 1e5 per side.
    expect(calls).toBe(1 + 2 * 1e5);
  });

  it('min equal to max (both between centre and ends) falls back on the side that encloses nothing', () => {
    const b = usableBandwidth(() => 1, 1e9, 2, { min: 2e9, max: 2e9 })!;
    expect(b.low).toBe(1e9 / 8);
    expect(b.high).toBe(2e9);
  });
});
