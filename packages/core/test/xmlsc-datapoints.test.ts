import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildXmlsc,
  complex,
  ladderFromXmlsc,
  readXmlsc,
  writeXmlsc,
  type Ladder,
} from '../src/index';

const FIXTURES = join(__dirname, 'fixtures', 'xmlsc');
const guid = (() => {
  let n = 0;
  return () => `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`;
})();

/** Three user datapoints, not in frequency order, the middle one is the chain start. */
const ladder: Ladder = {
  z0: 50,
  frequency: 100e6,
  load: complex(30, 15),
  elements: [{ kind: 'C', orientation: 'series', value: 20e-12 }],
};
const users = [
  { frequency: 150e6, z: complex(60, -10) },
  { frequency: 100e6, z: complex(30, 15) },
  { frequency: 120e6, z: complex(45, 5) },
];

describe('several user datapoints in .xmlsc', () => {
  it('writes them in DP order with the start marked and reads them back', () => {
    const xml = writeXmlsc(buildXmlsc(ladder, { userDatapoints: users, startIndex: 1, guid }));
    const d = readXmlsc(xml);
    const real = d.datapoints.filter((p) => p.isReal);
    expect(real.map((p) => [p.index, p.isStart, p.frequency, p.r, p.x])).toEqual([
      [0, false, 150e6, 60, -10],
      [1, true, 100e6, 30, 15],
      [2, false, 120e6, 45, 5],
    ]);
    // Transformed points follow the user datapoints.
    expect(d.datapoints.filter((p) => !p.isReal).map((p) => p.index)).toEqual([3]);
    const back = ladderFromXmlsc(d);
    expect(back.startIndex).toBe(1);
    expect(back.frequency).toBe(100e6);
    expect(back.load).toEqual(complex(30, 15));
    expect(back.sweepLoads).toEqual(users);
    // The datapoint sweep spans the lowest and highest frequency whatever the order.
    expect(d.sweep).toMatchObject({
      sweepType: 'datapoint',
      startFrequency: 100e6,
      stopFrequency: 150e6,
    });
    expect(d.sweepDatapoints).toHaveLength(3);
  });

  it('is stable: reading and writing again gives the same text', () => {
    const xml = writeXmlsc(buildXmlsc(ladder, { userDatapoints: users, startIndex: 2, guid }));
    expect(writeXmlsc(readXmlsc(xml))).toBe(xml);
    expect(ladderFromXmlsc(readXmlsc(xml)).startIndex).toBe(2);
  });

  it('keeps the start when it is the first of several, and falls back to the first on a bad index', () => {
    const first = readXmlsc(
      writeXmlsc(buildXmlsc(ladder, { userDatapoints: users, startIndex: 0, guid })),
    );
    // The ladder's own load replaces the entry at the start index.
    expect(first.datapoints[0]).toMatchObject({ isStart: true, frequency: 100e6, r: 30 });
    const bad = readXmlsc(
      writeXmlsc(buildXmlsc(ladder, { userDatapoints: users, startIndex: 9, guid })),
    );
    expect(bad.datapoints.filter((p) => p.isStart)).toHaveLength(1);
    expect(ladderFromXmlsc(bad).startIndex).toBe(0);
  });

  it('writes a sweepEnabled false list without sweep records', () => {
    const d = readXmlsc(
      writeXmlsc(
        buildXmlsc(ladder, { userDatapoints: users, startIndex: 1, sweepEnabled: false, guid }),
      ),
    );
    expect(d.sweep).toBeUndefined();
    expect(d.sweepDatapoints).toHaveLength(0);
    expect(d.datapoints.filter((p) => p.isReal)).toHaveLength(3);
  });

  it('reports the start the file marks for every example', () => {
    for (const name of readdirSync(FIXTURES).filter((n) => n.endsWith('.xmlsc'))) {
      const lad = ladderFromXmlsc(readXmlsc(readFileSync(join(FIXTURES, name), 'utf8')));
      expect(lad.sweepLoads[lad.startIndex]?.frequency).toBe(lad.frequency);
    }
  });
});
