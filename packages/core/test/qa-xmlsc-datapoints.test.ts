/**
 * QA round 1: the userDatapoints / startIndex options of buildXmlsc and the
 * startIndex of ladderFromXmlsc at their edges.
 */
import { describe, expect, it } from 'vitest';
import {
  buildXmlsc,
  complex,
  ladderFromXmlsc,
  readXmlsc,
  writeXmlsc,
  type Ladder,
} from '../src/index';

const guid = (() => {
  let n = 0;
  return () => `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`;
})();

const ladder: Ladder = {
  z0: 50,
  frequency: 100e6,
  load: complex(30, 15),
  elements: [{ kind: 'L', orientation: 'series', value: 50e-9 }],
};
const users = [
  { frequency: 150e6, z: complex(60, -10) },
  { frequency: 100e6, z: complex(30, 15) },
  { frequency: 120e6, z: complex(45, 5) },
];

describe('buildXmlsc userDatapoints', () => {
  it('a negative start index falls back to 0 and the first entry takes the ladder load', () => {
    const d = buildXmlsc(ladder, { userDatapoints: users, startIndex: -1, guid });
    const real = d.datapoints.filter((p) => p.isReal);
    expect(real.map((p) => p.isStart)).toEqual([true, false, false]);
    expect(real[0]).toMatchObject({ frequency: 100e6, r: 30, x: 15 });
    // The remaining entries are stored as given, not sorted.
    expect(real.map((p) => p.frequency)).toEqual([100e6, 100e6, 120e6]);
  });

  it('a single user datapoint is stored as the only real point, not marked (plain file rule)', () => {
    const d = buildXmlsc(ladder, { userDatapoints: [users[1]!], startIndex: 0, guid });
    const real = d.datapoints.filter((p) => p.isReal);
    expect(real).toHaveLength(1);
    expect(real[0]!.isStart).toBe(false);
    expect(d.sweep).toBeUndefined();
    const back = ladderFromXmlsc(readXmlsc(writeXmlsc(d)));
    expect(back.startIndex).toBe(0);
    expect(back.sweepLoads).toHaveLength(1);
  });

  it('userDatapoints wins over datapointSweep when both are given', () => {
    const d = buildXmlsc(ladder, {
      userDatapoints: users,
      startIndex: 1,
      datapointSweep: [{ frequency: 5e9, z: complex(1, 1) }],
      guid,
    });
    const real = d.datapoints.filter((p) => p.isReal);
    expect(real).toHaveLength(3);
    expect(real.some((p) => p.frequency === 5e9)).toBe(false);
  });

  it('with a frequency sweep the user datapoints are kept with the start marked and the sweep is over frequency', () => {
    const d = buildXmlsc(ladder, {
      userDatapoints: users,
      startIndex: 2,
      frequencySweep: [80e6, 100e6, 120e6],
      guid,
    });
    expect(d.sweep).toMatchObject({
      sweepType: 'frequency',
      startFrequency: 80e6,
      stopFrequency: 120e6,
    });
    const real = d.datapoints.filter((p) => p.isReal);
    expect(real.map((p) => p.isStart)).toEqual([false, false, true]);
    expect(real[2]).toMatchObject({ frequency: 100e6, r: 30, x: 15 });
    expect(ladderFromXmlsc(readXmlsc(writeXmlsc(d))).startIndex).toBe(2);
  });

  it('the datapoint sweep records are one per user datapoint, in DP order, evaluated at each frequency', () => {
    const d = buildXmlsc(ladder, { userDatapoints: users, startIndex: 1, guid });
    expect(d.sweepDatapoints.map((p) => p.frequency)).toEqual([150e6, 100e6, 120e6]);
    // The start's record is the ladder's own Zin: 30 + j(15 + 2 pi 1e8 50e-9) = 30 + j46.416.
    expect(d.sweepDatapoints[1]!.r).toBeCloseTo(30, 9);
    expect(d.sweepDatapoints[1]!.x).toBeCloseTo(15 + 2 * Math.PI * 1e8 * 50e-9, 9);
    expect(d.sweep).toMatchObject({
      startFrequency: 100e6,
      stopFrequency: 150e6,
      stepFrequency: 50e6,
    });
  });

  it('an empty userDatapoints list behaves like none: the load alone, unmarked', () => {
    const d = buildXmlsc(ladder, { userDatapoints: [], startIndex: 0, guid });
    const real = d.datapoints.filter((p) => p.isReal);
    expect(real).toHaveLength(1);
    expect(real[0]!.isStart).toBe(false);
  });
});
