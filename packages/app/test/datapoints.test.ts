import { complex, readXmlsc } from '@smithonline/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_DATAPOINTS,
  designHasDatapointSweep,
  startIndex,
  sweepLoadsOf,
  userDatapoints,
} from '../src/lib/datapoints';
import { DEFAULT_SWEEP, designFromXmlsc, emptyDesign } from '../src/lib/design';
import { datapointLabel } from '../src/lib/format';
import { designSweep, designToAscii, designToXmlsc, ladderOf } from '../src/lib/files';
import { decodeDesign, encodeDesign } from '../src/lib/share';
import { useDesignStore } from '../src/store/useDesignStore';
import { evaluateLadder } from '@smithonline/core';

const store = useDesignStore;
const dp = (frequency: number, re: number, im = 0) => ({ frequency, z: complex(re, im) });

beforeEach(() => {
  store.getState().init({ ...emptyDesign(), frequency: 100e6, load: complex(30, 15) });
});

describe('user datapoints in the store', () => {
  it('starts with the load as the only datapoint', () => {
    const d = store.getState().design;
    expect(userDatapoints(d)).toEqual([dp(100e6, 30, 15)]);
    expect(startIndex(d)).toBe(0);
    expect(designHasDatapointSweep(d)).toBe(false);
  });

  it('adds datapoints as DP2, DP3 in order; the start stays DP1', () => {
    const s = store.getState();
    s.addDatapoint(dp(150e6, 60, -10));
    s.addDatapoint(dp(120e6, 45, 5));
    const d = store.getState().design;
    expect(userDatapoints(d).map((p) => p.frequency)).toEqual([100e6, 150e6, 120e6]);
    expect(d.load).toEqual(complex(30, 15));
    expect(d.frequency).toBe(100e6);
    expect(startIndex(d)).toBe(0);
  });

  it('selecting a start moves load and frequency, keeps the numbering, and undoes', () => {
    const s = store.getState();
    s.addDatapoint(dp(150e6, 60, -10));
    s.addDatapoint(dp(120e6, 45, 5));
    s.setStartDatapoint(2);
    let d = store.getState().design;
    expect(d.load).toEqual(complex(45, 5));
    expect(d.frequency).toBe(120e6);
    expect(startIndex(d)).toBe(2);
    expect(userDatapoints(d).map((p) => p.frequency)).toEqual([100e6, 150e6, 120e6]);
    expect(datapointLabel(0, 3, startIndex(d))).toBe('DP3');
    expect(datapointLabel(1, 3, startIndex(d))).toBe('TP4');
    expect(store.getState().selected).toBe(0);
    s.undo();
    d = store.getState().design;
    expect(startIndex(d)).toBe(0);
    expect(d.load).toEqual(complex(30, 15));
  });

  it('lines and stubs keep their electrical length at the new start frequency', () => {
    const s = store.getState();
    s.addElement({ kind: 'line', z0: 50, length: 0.1, refFrequency: 100e6 });
    s.addDatapoint(dp(200e6, 60));
    s.setStartDatapoint(1);
    const el = store.getState().design.elements[0]!;
    expect(el.kind === 'line' && el.refFrequency).toBe(200e6);
  });

  it('removes a datapoint; removing the start hands the chain to its neighbour; the last one stays', () => {
    const s = store.getState();
    s.addDatapoint(dp(150e6, 60, -10));
    s.addDatapoint(dp(120e6, 45, 5));
    s.setStartDatapoint(1); // DP2 at 150 MHz
    s.removeDatapoint(0);
    let d = store.getState().design;
    expect(userDatapoints(d).map((p) => p.frequency)).toEqual([150e6, 120e6]);
    expect(startIndex(d)).toBe(0);
    expect(d.load).toEqual(complex(60, -10));
    s.removeDatapoint(0); // the start itself
    d = store.getState().design;
    expect(userDatapoints(d)).toEqual([dp(120e6, 45, 5)]);
    expect(d.load).toEqual(complex(45, 5));
    expect(d.datapoints).toBeUndefined();
    s.removeDatapoint(0); // refused: the last datapoint stays
    expect(userDatapoints(store.getState().design)).toHaveLength(1);
  });

  it('edits other datapoints in the list and the start through load and frequency', () => {
    const s = store.getState();
    s.addDatapoint(dp(150e6, 60, -10));
    s.setDatapoint(1, { z: complex(70, 0) });
    expect(userDatapoints(store.getState().design)[1]).toEqual(dp(150e6, 70, 0));
    s.setDatapoint(0, { z: complex(25, 5), frequency: 90e6 });
    const d = store.getState().design;
    expect(d.load).toEqual(complex(25, 5));
    expect(d.frequency).toBe(90e6);
    expect(userDatapoints(d)[0]).toEqual(dp(90e6, 25, 5));
  });

  it('follows a load edited elsewhere, so the list cannot go stale', () => {
    const s = store.getState();
    s.addDatapoint(dp(150e6, 60, -10));
    s.setLoad(complex(10, 10));
    expect(userDatapoints(store.getState().design)[0]).toEqual(dp(100e6, 10, 10));
  });

  it('stops at the limit with a message', () => {
    const s = store.getState();
    for (let i = 1; i < MAX_DATAPOINTS; i++) s.addDatapoint(dp(1e9 + i, 50));
    expect(userDatapoints(store.getState().design)).toHaveLength(MAX_DATAPOINTS);
    s.addDatapoint(dp(2e9, 50));
    expect(userDatapoints(store.getState().design)).toHaveLength(MAX_DATAPOINTS);
    expect(store.getState().message).toMatch(/remove one first/);
  });

  it('a running frequency sweep keeps running when the second datapoint arrives', () => {
    const s = store.getState();
    s.setSweep({ enabled: true });
    s.addDatapoint(dp(150e6, 60));
    const d = store.getState().design;
    expect(d.sweep.mode).toBe('frequency');
    expect(designHasDatapointSweep(d)).toBe(false);
    expect(designSweep(d)).toHaveLength(d.sweep.points);
  });

  it('with two or more datapoints the datapoint sweep runs over all of them', () => {
    const s = store.getState();
    s.addDatapoint(dp(150e6, 60, -10));
    s.addDatapoint(dp(120e6, 45, 5));
    s.setSweep({ enabled: true });
    const d = store.getState().design;
    expect(designHasDatapointSweep(d)).toBe(true);
    expect(sweepLoadsOf(d)).toHaveLength(3);
    expect(designSweep(d)!.map((p) => p.frequency)).toEqual([100e6, 150e6, 120e6]);
  });

  it('an imported file sweep takes precedence over the user datapoints', () => {
    const d = {
      ...store.getState().design,
      datapoints: [dp(150e6, 60)],
      sweep: { ...DEFAULT_SWEEP, enabled: true, loads: [dp(1e9, 10), dp(2e9, 20)] },
    };
    expect(sweepLoadsOf(d)).toHaveLength(2);
  });
});

describe('user datapoints in files and links', () => {
  const several = () => {
    const s = store.getState();
    s.addDatapoint(dp(150e6, 60, -10));
    s.addDatapoint(dp(120e6, 45, 5));
    s.setStartDatapoint(1);
    s.addElement({ kind: 'C', orientation: 'series', value: 20e-12 });
    return store.getState().design;
  };

  it('saves the datapoints in DP order with the start marked and opens them again', () => {
    const d = several();
    const text = designToXmlsc(d);
    const parsed = readXmlsc(text);
    expect(
      parsed.datapoints.filter((p) => p.isReal).map((p) => [p.index, p.isStart, p.frequency]),
    ).toEqual([
      [0, false, 100e6],
      [1, true, 150e6],
      [2, false, 120e6],
    ]);
    const back = designFromXmlsc(text, 'x');
    expect(userDatapoints(back)).toEqual(userDatapoints(d));
    expect(startIndex(back)).toBe(1);
    expect(back.load).toEqual(d.load);
    expect(back.frequency).toBe(150e6);
    // A second save gives the same text apart from the random GUIDs.
    const again = designToXmlsc(back).replace(/<GUID>[^<]*</g, '<GUID><');
    expect(again).toBe(text.replace(/<GUID>[^<]*</g, '<GUID><'));
  });

  it('survives a share link', () => {
    const d = several();
    const back = decodeDesign(encodeDesign(d))!;
    expect(userDatapoints(back)).toEqual(userDatapoints(d));
    expect(startIndex(back)).toBe(1);
  });

  it('a link with a bad start slot or bad points falls back safely', () => {
    const raw = {
      v: 1,
      elements: [],
      load: { re: 50, im: 0 },
      datapoints: [{ frequency: 0, z: { re: 1, im: 1 } }, dp(2e9, 10)],
      startSlot: 99,
    };
    const text = btoa(JSON.stringify(raw))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const d = decodeDesign(text)!;
    expect(d.datapoints).toHaveLength(1);
    expect(startIndex(d)).toBe(1);
  });

  it('lists every DP and the transformed points after them in the ASCII export', () => {
    const d = several();
    const text = designToAscii(d, evaluateLadder(ladderOf(d)), null, 'semicolon');
    const lines = text.split('\n');
    expect(lines.slice(1, 5).map((l) => l.split(';').slice(0, 2).join(' '))).toEqual([
      'false DP1',
      'true DP2',
      'false DP3',
      'false TP4',
    ]);
  });
});
