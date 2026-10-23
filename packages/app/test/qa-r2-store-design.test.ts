/**
 * QA round 2: the design store paths added or changed by the round 1 fix
 * (deviceFollows, updateFollowingDevice, addElements, setDatapoint on the
 * start), designFromXmlsc with more user datapoints than the application
 * keeps, and the match filter at its boundaries.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildXmlsc,
  complex,
  readTouchstone,
  writeXmlsc,
  type Element,
  type MatchSolution,
} from '@smithonline/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { userDatapoints } from '../src/lib/datapoints';
import { designFromXmlsc, emptyDesign } from '../src/lib/design';
import { buildable, lSolutions, minimumQ, negligibleElement } from '../src/lib/match';
import { useDesignStore } from '../src/store/useDesignStore';

const store = useDesignStore;
const ampText = readFileSync(
  join(__dirname, '..', '..', 'core', 'test', 'fixtures', 'sparams', 'amp-synthetic.s2p'),
  'utf8',
);
const amp = readTouchstone(ampText, 2);
const fileLow = amp.points[0]!.frequency;
const fileHigh = amp.points[amp.points.length - 1]!.frequency;

beforeEach(() => {
  store.getState().init(emptyDesign());
  store.setState({ twoPortFiles: {}, message: null });
});

describe('qa r2: deviceFollows through updateFollowingDevice', () => {
  it('a frequency outside the file sets the clamp message; back inside it is cleared, as setFrequency does', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp-synthetic.s2p');
    expect(store.getState().design.twoPort?.source?.frequency).toBe(1e9);
    s.updateFollowingDevice((d) => ({ ...d, frequency: fileHigh * 10 }));
    expect(store.getState().design.twoPort?.source?.clamped).toBe(true);
    expect(store.getState().message).toMatch(/outside the file/);
    s.updateFollowingDevice((d) => ({ ...d, frequency: (fileLow + fileHigh) / 2 }));
    expect(store.getState().design.twoPort?.source?.clamped).toBe(false);
    // setFrequency clears the clamp message once the frequency is back inside; this path must too.
    expect(store.getState().message ?? '').not.toMatch(/outside the file/);
  });

  it('a change that does not move the frequency leaves the device object untouched', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp-synthetic.s2p');
    const before = store.getState().design.twoPort;
    s.updateFollowingDevice((d) => ({ ...d, name: 'renamed' }));
    expect(store.getState().design.twoPort).toBe(before);
  });

  it('an identity update records no history entry', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp-synthetic.s2p');
    const depth = store.getState().past.length;
    s.updateFollowingDevice((d) => d);
    expect(store.getState().past.length).toBe(depth);
  });

  it('a hand-set device (no source) is not touched by a frequency move', () => {
    const s = store.getState();
    s.setTwoPort({ s: amp.points[0]!.s as never, noise: null } as never);
    const before = store.getState().design.twoPort;
    s.updateFollowingDevice((d) => ({ ...d, frequency: 2e9 }));
    expect(store.getState().design.twoPort).toBe(before);
    expect(store.getState().design.frequency).toBe(2e9);
  });

  it('a device whose file is no longer in memory keeps its old parameters and the old source frequency', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp-synthetic.s2p');
    store.setState({ twoPortFiles: {} });
    s.updateFollowingDevice((d) => ({ ...d, frequency: 2e9 }));
    expect(store.getState().design.twoPort?.source?.frequency).toBe(1e9);
  });
});

describe('qa r2: addElements', () => {
  const l: Element = { kind: 'L', orientation: 'series', value: 1e-9 };
  const c: Element = { kind: 'C', orientation: 'shunt', value: 1e-12 };

  it('two elements are one history entry, get distinct ids and colours, selection moves to the end', () => {
    const s = store.getState();
    const depth = store.getState().past.length;
    s.addElements([l, c]);
    const d = store.getState().design;
    expect(d.elements).toHaveLength(2);
    expect(store.getState().past.length).toBe(depth + 1);
    expect(d.elements[0]!.id).not.toBe(d.elements[1]!.id);
    expect(d.elements[0]!.color).not.toBe(d.elements[1]!.color);
    expect(store.getState().selected).toBe(2);
    s.undo();
    expect(store.getState().design.elements).toHaveLength(0);
  });

  it('an empty list changes nothing, not even the selection', () => {
    const s = store.getState();
    s.select(null);
    const depth = store.getState().past.length;
    s.addElements([]);
    expect(store.getState().past.length).toBe(depth);
    expect(store.getState().selected).toBeNull();
  });
});

describe('qa r2: datapoint store actions at the edges', () => {
  it('setStartDatapoint out of range changes nothing and announces nothing', () => {
    const s = store.getState();
    s.addDatapoint({ frequency: 2e9, z: complex(30, 10) });
    store.setState({ message: null });
    const before = store.getState().design;
    s.setStartDatapoint(7);
    expect(store.getState().design).toBe(before);
    expect(store.getState().message).toBeNull();
  });

  it('setDatapoint on the start with both z and frequency is one undo step', () => {
    const s = store.getState();
    s.addDatapoint({ frequency: 2e9, z: complex(30, 10) });
    const depth = store.getState().past.length;
    s.setDatapoint(0, { frequency: 3e9, z: complex(20, -5) });
    const d = store.getState().design;
    expect(d.frequency).toBe(3e9);
    expect(d.load).toEqual(complex(20, -5));
    expect(store.getState().past.length).toBe(depth + 1);
  });

  it('removing the only datapoint is a no-op that leaves the selection alone', () => {
    const s = store.getState();
    s.addElement({ kind: 'L', orientation: 'series', value: 1e-9 });
    expect(store.getState().selected).toBe(1);
    s.removeDatapoint(0);
    expect(userDatapoints(store.getState().design)).toHaveLength(1);
    expect(store.getState().selected).toBe(1);
  });
});

/** A project file of the original with `n` user datapoints, the start at `startAt`. */
function fileWith(n: number, startAt: number, frequencySweep?: number[]): string {
  const users = Array.from({ length: n }, (_, i) => ({
    frequency: 100e6 * (i + 1),
    z: complex(10 + i, -i),
  }));
  const start = users[startAt]!;
  return writeXmlsc(
    buildXmlsc(
      { z0: 50, frequency: start.frequency, load: start.z, elements: [] },
      {
        userDatapoints: users,
        startIndex: startAt,
        ...(frequencySweep ? { frequencySweep } : {}),
        guid: () => '00000000-0000-0000-0000-000000000000',
      },
    ),
  );
}

describe('qa r2: designFromXmlsc with more user datapoints than the application keeps', () => {
  it('70 points with a datapoint sweep reopen as an enabled 70-point datapoint sweep from DP6', () => {
    const d = designFromXmlsc(fileWith(70, 5), 'many');
    expect(d.datapoints).toBeUndefined();
    expect(d.startSlot).toBeUndefined();
    expect(userDatapoints(d)).toHaveLength(1);
    expect(d.frequency).toBe(600e6);
    expect(d.load).toEqual(complex(15, -5));
    expect(d.sweep.enabled).toBe(true);
    expect(d.sweep.mode).toBe('datapoints');
    expect(d.sweep.loads).toHaveLength(70);
    expect(d.sweep.loadsName).toBe('many');
    expect(d.sweep.loads![69]).toEqual({ frequency: 7000e6, z: complex(79, -69) });
    expect(d.sweep.start).toBe(300e6);
    expect(d.sweep.stop).toBe(1200e6);
  });

  it('exactly 64 points stay user datapoints; 65 become a sweep', () => {
    const at = designFromXmlsc(fileWith(64, 0), 'at');
    expect(userDatapoints(at)).toHaveLength(64);
    expect(at.sweep.loads).toBeUndefined();
    const over = designFromXmlsc(fileWith(65, 0), 'over');
    expect(userDatapoints(over)).toHaveLength(1);
    expect(over.sweep.loads).toHaveLength(65);
  });

  it('70 points with a frequency sweep record keep the frequency sweep and do not lose the points', () => {
    const d = designFromXmlsc(fileWith(70, 2, [200e6, 300e6, 400e6]), 'both');
    expect(d.sweep.enabled).toBe(true);
    expect(d.sweep.start).toBe(200e6);
    expect(d.sweep.stop).toBe(400e6);
    expect(d.sweep.points).toBe(3);
    expect(d.sweep.mode).toBe('frequency');
    // The 70 datapoints of the file must survive the open: the limit says "as a datapoint sweep".
    expect(d.sweep.loads).toHaveLength(70);
  });
});

describe('qa r2: negligibleElement boundaries (Z0 50, w = 1e9 rad/s)', () => {
  const z0 = 50;
  const f = 1e9 / (2 * Math.PI);
  const neg = (el: Element): boolean => negligibleElement(el, z0, f);

  it('series L: X < 0.05 ohm is negligible, X = 0.05 is not', () => {
    expect(neg({ kind: 'L', orientation: 'series', value: 4.9e-11 })).toBe(true);
    expect(neg({ kind: 'L', orientation: 'series', value: 5e-11 })).toBe(false);
  });

  it('shunt L: X > 50 kohm is negligible (value above 50 uH)', () => {
    expect(neg({ kind: 'L', orientation: 'shunt', value: 5.1e-5 })).toBe(true);
    expect(neg({ kind: 'L', orientation: 'shunt', value: 5e-5 })).toBe(false);
  });

  it('series C: X < 0.05 ohm (C > 20 nF) is negligible', () => {
    expect(neg({ kind: 'C', orientation: 'series', value: 2.1e-8 })).toBe(true);
    expect(neg({ kind: 'C', orientation: 'series', value: 2e-8 })).toBe(false);
  });

  it('shunt C: X > 50 kohm (C < 20 fF) is negligible', () => {
    expect(neg({ kind: 'C', orientation: 'shunt', value: 1.9e-14 })).toBe(true);
    expect(neg({ kind: 'C', orientation: 'shunt', value: 2e-14 })).toBe(false);
  });

  it('R: series below 0.05 ohm and shunt above 50 kohm', () => {
    expect(neg({ kind: 'R', orientation: 'series', value: 0.049 })).toBe(true);
    expect(neg({ kind: 'R', orientation: 'series', value: 0.05 })).toBe(false);
    expect(neg({ kind: 'R', orientation: 'shunt', value: 50001 })).toBe(true);
    expect(neg({ kind: 'R', orientation: 'shunt', value: 50000 })).toBe(false);
  });

  it('transformer within 1e-3 of 1; lines and stubs under 1e-3 wavelengths; RLC never', () => {
    expect(neg({ kind: 'transformer', n: 1.0009 })).toBe(true);
    expect(neg({ kind: 'transformer', n: 1.002 })).toBe(false);
    expect(neg({ kind: 'transformer', n: 0.998 })).toBe(false);
    expect(neg({ kind: 'line', z0: 50, length: 0.0009 })).toBe(true);
    expect(neg({ kind: 'line', z0: 50, length: 0.001 })).toBe(false);
    expect(neg({ kind: 'openStub', z0: 50, length: 0.0009 })).toBe(true);
    expect(neg({ kind: 'shortStub', z0: 50, length: 0.0009 })).toBe(true);
    expect(
      neg({ kind: 'RLC', orientation: 'series', r: 0, l: 0, c: 1e-12 } as unknown as Element),
    ).toBe(false);
  });

  it('a zero shunt L (a short) and a zero series C (an open) are not negligible', () => {
    expect(neg({ kind: 'L', orientation: 'shunt', value: 0 })).toBe(false);
    expect(neg({ kind: 'C', orientation: 'series', value: 0 })).toBe(false);
  });

  it('a NaN value is not filtered out as negligible', () => {
    expect(neg({ kind: 'L', orientation: 'series', value: NaN })).toBe(false);
    expect(neg({ kind: 'line', z0: 50, length: NaN })).toBe(false);
  });
});

describe('qa r2: buildable, lSolutions and minimumQ', () => {
  it('buildable keeps a solution only when every part counts; an empty list is empty', () => {
    const good: MatchSolution = {
      elements: [{ kind: 'L', orientation: 'series', value: 1e-9 }],
      q: 1,
    } as unknown as MatchSolution;
    const bad: MatchSolution = {
      elements: [
        { kind: 'L', orientation: 'series', value: 1e-9 },
        { kind: 'line', z0: 50, length: 1e-6 },
      ],
      q: 1,
    } as unknown as MatchSolution;
    const zin = { re: 20, im: 0 };
    expect(buildable([good, bad], zin, 50, 1e9)).toEqual([good]);
    expect(buildable([], zin, 50, 1e9)).toEqual([]);
  });

  it('Zin already on the target offers no solution', () => {
    expect(lSolutions(complex(50, 0), complex(50, 0), 50, 1e9)).toEqual([]);
  });

  it('minimumQ is 0 for equal resistances, Infinity for a non-positive one, sqrt(3) for 50 to 200', () => {
    expect(minimumQ('T', complex(50, 0), complex(50, 0))).toBe(0);
    expect(minimumQ('T', complex(0, 10), complex(50, 0))).toBe(Infinity);
    expect(minimumQ('T', complex(-5, 0), complex(50, 0))).toBe(Infinity);
    expect(minimumQ('T', complex(50, 0), complex(200, 0))).toBeCloseTo(Math.sqrt(3), 12);
    // Pi uses parallel resistances: 50 and 100 + j100 (Rp = 200) give sqrt(3) as well.
    expect(minimumQ('Pi', complex(50, 0), complex(100, 100))).toBeCloseTo(Math.sqrt(3), 12);
  });
});
