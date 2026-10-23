/**
 * QA round 3: one level under the round 2 fixes. negligibleEffect and
 * buildable on multi-part solutions, the clamp message riding along with
 * repeated start changes, record() and the error message, setDatapoint
 * no-ops on the start, and the designToXmlsc startRow path (imported sweep
 * loads with the start among them, not among them, with a frequency sweep
 * and with the sweep off).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  complex,
  readTouchstone,
  readXmlsc,
  teeMatch,
  type Element,
  type SweepLoad,
} from '@smithonline/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { startIndex, userDatapoints } from '../src/lib/datapoints';
import { designFromXmlsc, emptyDesign, type Design } from '../src/lib/design';
import { designToXmlsc } from '../src/lib/files';
import { matchSolutions, negligibleEffect, negligibleElement } from '../src/lib/match';
import { useDesignStore } from '../src/store/useDesignStore';

const store = useDesignStore;
const ampText = readFileSync(
  join(__dirname, '..', '..', 'core', 'test', 'fixtures', 'sparams', 'amp-synthetic.s2p'),
  'utf8',
);
const amp = readTouchstone(ampText, 2);
const fLo = amp.points[0]!.frequency;

const F = 1e9;
const W = 2 * Math.PI * F;
const seriesL = (x: number): Element => ({ kind: 'L', orientation: 'series', value: x / W });

beforeEach(() => {
  store.getState().init(emptyDesign());
  store.setState({ twoPortFiles: {}, message: null });
});

describe('qa r3: negligibleEffect at the 1e-3 chart boundary (Z0 50, start 50 + j0)', () => {
  const zin = complex(50, 0);

  it('no parts move nothing: false', () => {
    expect(negligibleEffect([], zin, 50, F)).toBe(false);
  });

  it('a series 0.06 ohm from the centre moves |Gamma| by 0.0006: negligible; 0.2 ohm (0.002) is not', () => {
    // Gamma after a series jX from 50 ohm is jX / (100 + jX); |Gamma| = X / 100 to first order.
    expect(negligibleEffect([seriesL(0.06)], zin, 50, F)).toBe(true);
    expect(negligibleEffect([seriesL(0.2)], zin, 50, F)).toBe(false);
  });

  it('a part that moves little late in the chain is judged from where the chain is, not from the start', () => {
    // 50 -> series 150 ohm (Gamma 0.6 + j0.6, far away) -> series 0.3 ohm at 50 + j150: the second part
    // moves |Gamma| by about 0.3 * 100 / |200 + j150|^2 = 0.00048 < 1e-3.
    expect(negligibleEffect([seriesL(150), seriesL(0.3)], zin, 50, F)).toBe(true);
    // Reversed, the 0.3 ohm part moves 0.003 from the centre: kept.
    expect(negligibleEffect([seriesL(0.3), seriesL(150)], zin, 50, F)).toBe(false);
  });

  it('a non-finite start is never negligible (chartDistance reports 2)', () => {
    expect(negligibleEffect([seriesL(0.001)], complex(NaN, 0), 50, F)).toBe(false);
    expect(negligibleEffect([seriesL(0.001)], complex(Infinity, 0), 50, F)).toBe(false);
  });
});

describe('qa r3: a T-network at a Q just above the minimum', () => {
  // 50 -> 200 ohm. Q^2 = 3.000009 puts the virtual resistance at 200.00045 ohm, so the third
  // part is a series 0.3 ohm (q2 = 0.0015, x3 = 0.3). 0.3 ohm is six times the part threshold
  // (0.05 ohm) and the synthesis is exact; its effect at 200 ohm is 0.3 * 100 / 250^2 = 0.00048.
  const q = Math.sqrt(3.000009);
  const zin = complex(50, 0);
  const target = complex(200, 0);

  it('the solver offers both signs with a 0.3 ohm last part that is not a negligible element', () => {
    const sols = teeMatch(zin, target, F, q);
    expect(sols).toHaveLength(2);
    for (const s of sols) {
      const last = s.elements[2]!;
      const x = last.kind === 'L' ? W * last.value : last.kind === 'C' ? 1 / (W * last.value) : NaN;
      expect(x).toBeCloseTo(0.3, 3);
      expect(negligibleElement(last, 50, F)).toBe(false);
    }
  });

  it('matchSolutions keeps the two exact T-networks the user asked for at this Q', () => {
    // Observed: [] because negligibleEffect drops a solution whose last part moves under 1e-3.
    expect(matchSolutions('T', zin, target, 50, F, q)).toHaveLength(2);
  });
});

describe('qa r3: the clamp message riding along with repeated start changes', () => {
  it('two starts at the same frequency outside the file: the status line is composed once, not twice', () => {
    const s = store.getState();
    s.init({ ...emptyDesign(), frequency: fLo });
    s.importTwoPort(amp, 'amp-synthetic.s2p');
    s.addDatapoint({ frequency: fLo / 4, z: complex(30, 10) });
    s.addDatapoint({ frequency: fLo / 4, z: complex(40, -10) });
    s.setStartDatapoint(1);
    const first = store.getState().message ?? '';
    expect(first.startsWith('The network starts at DP2;')).toBe(true);
    expect(first).toMatch(/outside the file/);
    // DP3 sits at the same frequency: the device is not re-read, the warning still holds.
    s.setStartDatapoint(2);
    const second = store.getState().message ?? '';
    expect(second.startsWith('The network starts at DP3;')).toBe(true);
    expect(second).not.toContain('DP2');
    expect(second.split('outside the file')).toHaveLength(2);
  });

  it('start change to a point inside the file after a clamped one: no warning in the status line', () => {
    const s = store.getState();
    s.init({ ...emptyDesign(), frequency: fLo });
    s.importTwoPort(amp, 'amp-synthetic.s2p');
    s.addDatapoint({ frequency: fLo / 4, z: complex(30, 10) });
    s.setStartDatapoint(1);
    s.setStartDatapoint(0);
    const msg = store.getState().message ?? '';
    expect(msg.startsWith('The network starts at DP1;')).toBe(true);
    expect(msg).not.toMatch(/outside the file/);
    expect(store.getState().design.twoPort!.source!.clamped).toBe(false);
  });
});

describe('qa r3: record() and the status message', () => {
  it('an error message does not outlive the next recorded change', () => {
    const s = store.getState();
    store.setState({ message: 'Could not read x.s2p' });
    s.addElement({ kind: 'L', orientation: 'series', value: 1e-9 });
    expect(store.getState().message).toBeNull();
  });

  it('an identity update records nothing and leaves the error message alone', () => {
    const s = store.getState();
    store.setState({ message: 'Could not read x.s2p' });
    const depth = store.getState().past.length;
    s.update((d) => d);
    expect(store.getState().past.length).toBe(depth);
    expect(store.getState().message).toBe('Could not read x.s2p');
  });
});

describe('qa r3: setDatapoint on the start with nothing to change', () => {
  it('an empty patch and a patch with the same frequency record no history entry', () => {
    const s = store.getState();
    s.addDatapoint({ frequency: 2e9, z: complex(30, 10) });
    const before = store.getState().design;
    const depth = store.getState().past.length;
    s.setDatapoint(0, {});
    expect(store.getState().design).toBe(before);
    s.setDatapoint(0, { frequency: before.frequency });
    expect(store.getState().design).toBe(before);
    expect(store.getState().past.length).toBe(depth);
  });

  it('a frequency-only patch keeps the load and moves the line reference as one entry', () => {
    const s = store.getState();
    s.addElement({ kind: 'line', z0: 50, length: 0.125 } as Element);
    s.addDatapoint({ frequency: 2e9, z: complex(30, 10) });
    const load = store.getState().design.load;
    const depth = store.getState().past.length;
    s.setDatapoint(0, { frequency: 3e9 });
    const d = store.getState().design;
    expect(d.frequency).toBe(3e9);
    expect(d.load).toBe(load);
    expect((d.elements[0] as { refFrequency?: number }).refFrequency).toBe(3e9);
    expect(store.getState().past.length).toBe(depth + 1);
  });
});

describe('qa r3: designToXmlsc with imported sweep loads and no user datapoint list (startRow path)', () => {
  // Rows out of frequency order so that a re-sort would show.
  const rows: SweepLoad[] = [
    { frequency: 300e6, z: complex(30, -3) },
    { frequency: 100e6, z: complex(10, -1) },
    { frequency: 200e6, z: complex(20, -2) },
  ];
  const base = (over: Partial<Design> = {}): Design => ({
    ...emptyDesign(),
    frequency: 100e6,
    load: complex(10, -1),
    ...over,
  });
  const withLoads = (sweep: Partial<Design['sweep']>, over: Partial<Design> = {}): Design =>
    base({
      ...over,
      sweep: {
        ...emptyDesign().sweep,
        enabled: true,
        loads: rows,
        loadsName: 'rows.s1p',
        ...sweep,
      },
    });

  it('the start among the rows: rows written in file order, the start marked, a datapoint sweep record', () => {
    const xml = designToXmlsc(withLoads({}));
    const parsed = readXmlsc(xml);
    const users = parsed.datapoints.filter((d) => d.isReal);
    expect(users.map((d) => d.frequency)).toEqual([300e6, 100e6, 200e6]);
    expect(users.map((d) => d.isStart)).toEqual([false, true, false]);
    expect(parsed.sweep?.sweepType).toBe('datapoint');
    const back = designFromXmlsc(xml, 'back');
    expect(back.frequency).toBe(100e6);
    expect(back.load).toEqual(complex(10, -1));
    expect(startIndex(back)).toBe(1);
    expect(userDatapoints(back).map((u) => u.frequency)).toEqual([300e6, 100e6, 200e6]);
    expect(back.sweep.enabled).toBe(true);
  });

  it('the start not among the rows: rows plus the start, sorted by frequency, the start marked', () => {
    const xml = designToXmlsc(withLoads({}, { frequency: 250e6, load: complex(25, 5) }));
    const parsed = readXmlsc(xml);
    const users = parsed.datapoints.filter((d) => d.isReal);
    expect(users.map((d) => d.frequency)).toEqual([100e6, 200e6, 250e6, 300e6]);
    expect(users.map((d) => d.isStart)).toEqual([false, false, true, false]);
    const back = designFromXmlsc(xml, 'back');
    expect(back.frequency).toBe(250e6);
    expect(back.load).toEqual(complex(25, 5));
    expect(startIndex(back)).toBe(2);
    expect(userDatapoints(back)).toHaveLength(4);
  });

  it('mode frequency with the start among the rows: frequency sweep record, rows kept as datapoints', () => {
    const xml = designToXmlsc(
      withLoads({ mode: 'frequency', start: 100e6, stop: 300e6, points: 3 }),
    );
    const parsed = readXmlsc(xml);
    expect(parsed.sweep?.sweepType).toBe('frequency');
    expect(parsed.sweep?.startFrequency).toBe(100e6);
    expect(parsed.sweep?.stopFrequency).toBe(300e6);
    const users = parsed.datapoints.filter((d) => d.isReal);
    expect(users.map((d) => d.isStart)).toEqual([false, true, false]);
    const back = designFromXmlsc(xml, 'back');
    expect(userDatapoints(back).map((u) => u.frequency)).toEqual([300e6, 100e6, 200e6]);
    expect(startIndex(back)).toBe(1);
    expect(back.sweep.mode).toBe('frequency');
    expect(back.sweep.enabled).toBe(true);
    expect(back.sweep.start).toBe(100e6);
    expect(back.sweep.stop).toBe(300e6);
  });

  it('sweep off with the start among the rows: rows kept, no sweep record, reopens with the sweep off', () => {
    const xml = designToXmlsc(withLoads({ enabled: false }));
    const parsed = readXmlsc(xml);
    expect(parsed.sweep).toBeUndefined();
    expect(parsed.datapoints.filter((d) => d.isReal)).toHaveLength(3);
    const back = designFromXmlsc(xml, 'back');
    expect(userDatapoints(back)).toHaveLength(3);
    expect(back.sweep.enabled).toBe(false);
  });

  it('a user datapoint list present: rows equal to a user datapoint are not written twice', () => {
    const d = withLoads(
      {},
      {
        frequency: 100e6,
        load: complex(10, -1),
        datapoints: [{ frequency: 200e6, z: complex(20, -2) }],
        startSlot: 0,
      },
    );
    const parsed = readXmlsc(designToXmlsc(d));
    const users = parsed.datapoints.filter((u) => u.isReal);
    // DP1 (start), DP2, then the one file row that is not a user datapoint.
    expect(users.map((u) => u.frequency)).toEqual([100e6, 200e6, 300e6]);
    expect(users.map((u) => u.isStart)).toEqual([true, false, false]);
  });
});
