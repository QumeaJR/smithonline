/**
 * Adversarial tests, QA round 1: .xmlsc with several user datapoints and a
 * chain start, through buildXmlsc, writeXmlsc, readXmlsc and ladderFromXmlsc.
 */
import { describe, expect, it } from 'vitest';
import {
  buildXmlsc,
  complex,
  evaluateLadder,
  ladderFromXmlsc,
  readXmlsc,
  writeXmlsc,
  type Ladder,
  type SweepLoad,
} from '../src/index';

const guid = (): (() => string) => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
};

const ladder: Ladder = {
  z0: 50,
  frequency: 1e9,
  load: complex(20, -12),
  elements: [
    { kind: 'L', orientation: 'shunt', value: 8e-9 },
    { kind: 'C', orientation: 'series', value: 3e-12 },
  ],
};

const dp = (f: number, r: number, x: number): SweepLoad => ({ frequency: f, z: complex(r, x) });

describe('adv: several user datapoints with a chain start', () => {
  it('start at index 1 of three: the file marks it, the reader finds it, the write is stable', () => {
    const users = [dp(0.5e9, 10, 5), dp(1e9, 999, 999), dp(2e9, 30, -40)];
    const first = writeXmlsc(
      buildXmlsc(ladder, { userDatapoints: users, startIndex: 1, guid: guid() }),
    );
    const parsed = readXmlsc(first);
    const lad = ladderFromXmlsc(parsed);
    // The start takes the ladder's own load, not the placeholder in the list.
    expect(lad.startIndex).toBe(1);
    expect(lad.load).toEqual(complex(20, -12));
    expect(lad.frequency).toBe(1e9);
    expect(lad.sweepLoads.map((l) => l.frequency)).toEqual([0.5e9, 1e9, 2e9]);
    expect(parsed.datapoints.filter((d) => d.isReal && d.isStart)).toHaveLength(1);
    const second = writeXmlsc(
      buildXmlsc(
        { ...lad },
        {
          userDatapoints: lad.sweepLoads,
          startIndex: lad.startIndex,
          guid: guid(),
        },
      ),
    );
    expect(second).toBe(first);
  });

  it('startIndex out of range, negative, NaN or fractional falls back to 0 and the write stays readable', () => {
    const users = [dp(0.5e9, 10, 5), dp(2e9, 30, -40)];
    for (const startIndex of [5, -1, NaN, 1.5, Infinity]) {
      const text = writeXmlsc(
        buildXmlsc(ladder, { userDatapoints: users, startIndex, guid: guid() }),
      );
      const lad = ladderFromXmlsc(readXmlsc(text));
      expect(lad.load, String(startIndex)).toEqual(complex(20, -12));
      expect(lad.sweepLoads).toHaveLength(2);
    }
  });

  it('sweep disabled: no CSweepDatapoint records, the datapoints and start survive', () => {
    const users = [dp(0.5e9, 10, 5), dp(1e9, 0, 0), dp(2e9, 30, -40)];
    const text = writeXmlsc(
      buildXmlsc(ladder, {
        userDatapoints: users,
        startIndex: 1,
        sweepEnabled: false,
        guid: guid(),
      }),
    );
    const parsed = readXmlsc(text);
    expect(parsed.sweepDatapoints).toHaveLength(0);
    expect(parsed.sweep).toBeUndefined();
    expect(ladderFromXmlsc(parsed).startIndex).toBe(1);
  });

  it('two datapoints at the same frequency: the sweep record has a zero step and still reads', () => {
    const users = [dp(1e9, 10, 5), dp(1e9, 20, -12)];
    const text = writeXmlsc(
      buildXmlsc(ladder, { userDatapoints: users, startIndex: 1, guid: guid() }),
    );
    const parsed = readXmlsc(text);
    expect(parsed.sweep?.stepFrequency).toBe(0);
    expect(parsed.sweepDatapoints).toHaveLength(2);
    expect(ladderFromXmlsc(parsed).sweepLoads).toHaveLength(2);
  });

  it('64 user datapoints write and read back in order', () => {
    const users = Array.from({ length: 64 }, (_, i) => dp(1e8 * (i + 1), 10 + i, i - 30));
    const text = writeXmlsc(
      buildXmlsc(ladder, { userDatapoints: users, startIndex: 9, guid: guid() }),
    );
    const lad = ladderFromXmlsc(readXmlsc(text));
    expect(lad.sweepLoads).toHaveLength(64);
    expect(lad.startIndex).toBe(9);
    expect(lad.sweepLoads[63]!.z).toEqual(complex(73, 33));
  });

  it('the sweep points stored for a datapoint sweep equal the ladder applied to each datapoint', () => {
    const users = [dp(0.5e9, 10, 5), dp(1e9, 20, -12), dp(2e9, 30, -40)];
    const parsed = readXmlsc(
      writeXmlsc(buildXmlsc(ladder, { userDatapoints: users, startIndex: 1, guid: guid() })),
    );
    parsed.sweepDatapoints.forEach((sp, i) => {
      const u = users[i]!;
      const r = evaluateLadder({ ...ladder, frequency: u.frequency, load: u.z }, { arcSteps: 0 });
      expect(sp.frequency).toBe(u.frequency);
      expect(sp.r).toBeCloseTo(r.zin.re, 9);
      expect(sp.x).toBeCloseTo(r.zin.im, 9);
    });
  });

  it('a datapoint with a non-finite frequency or impedance cannot reach the file unnoticed', () => {
    const users = [dp(0.5e9, 10, 5), dp(NaN, 20, -12)];
    let text: string;
    try {
      text = writeXmlsc(buildXmlsc(ladder, { userDatapoints: users, startIndex: 0, guid: guid() }));
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      return;
    }
    // If the writer lets it through, the reader must refuse rather than open half a design.
    expect(() => readXmlsc(text)).toThrow();
  });

  it('the reader accepts two datapoints both marked start and takes the first', () => {
    const users = [dp(0.5e9, 10, 5), dp(2e9, 30, -40)];
    const text = writeXmlsc(
      buildXmlsc(ladder, { userDatapoints: users, startIndex: 1, guid: guid() }),
    ).replace('<StartDatapoint>0</StartDatapoint>', '<StartDatapoint>1</StartDatapoint>');
    const lad = ladderFromXmlsc(readXmlsc(text));
    expect(lad.startIndex).toBe(0);
    expect(lad.frequency).toBe(0.5e9);
  });

  it('a datapoint sweep record with a frequency sweep record present: frequency wins and the datapoints stay', () => {
    const users = [dp(0.5e9, 10, 5), dp(1e9, 0, 0), dp(2e9, 30, -40)];
    const text = writeXmlsc(
      buildXmlsc(ladder, {
        userDatapoints: users,
        startIndex: 1,
        frequencySweep: [0.8e9, 0.9e9, 1e9, 1.1e9, 1.2e9],
        guid: guid(),
      }),
    );
    const parsed = readXmlsc(text);
    expect(parsed.sweep?.sweepType).toBe('frequency');
    expect(parsed.sweepDatapoints).toHaveLength(5);
    expect(ladderFromXmlsc(parsed).sweepLoads).toHaveLength(3);
  });
});

describe('adv: elements the .xmlsc format cannot hold', () => {
  it('a lossy line keeps er and alpha through the round trip', () => {
    const line: Ladder = {
      ...ladder,
      elements: [
        { kind: 'line', z0: 60, length: 0.2, refFrequency: 1e9, er: 2.2, alphaDbPerM: 1.5 },
      ],
    };
    const back = ladderFromXmlsc(readXmlsc(writeXmlsc(buildXmlsc(line, { guid: guid() }))));
    expect(back.elements[0]).toMatchObject({
      kind: 'line',
      z0: 60,
      length: 0.2,
      er: 2.2,
      alphaDbPerM: 1.5,
    });
  });

  it('an R, RLC or transformer is refused with the message the user guide promises', () => {
    for (const el of [
      { kind: 'R', orientation: 'series', value: 10 },
      { kind: 'RLC', orientation: 'shunt', connection: 'parallel', r: 10, l: 1e-9, c: 1e-12 },
      { kind: 'transformer', n: 2 },
    ] as const) {
      expect(() => buildXmlsc({ ...ladder, elements: [el] }, { guid: guid() })).toThrow(/\.json/);
    }
  });
});
