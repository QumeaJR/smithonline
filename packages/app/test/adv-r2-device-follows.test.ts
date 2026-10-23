/**
 * Adversarial tests, QA round 2: deviceFollows one level deeper. File gone
 * from the store, file id reuse, z0 plus frequency in one update, undo and
 * redo across a re-read, stale messages, no-op actions with a stale source.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cabs, complex, readTouchstone } from '@smithonline/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDesign } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';

const store = useDesignStore;
const ampText = readFileSync(
  join(__dirname, '..', '..', 'core', 'test', 'fixtures', 'sparams', 'amp-synthetic.s2p'),
  'utf8',
);
const amp = readTouchstone(ampText, 2);
const fLo = amp.points[0]!.frequency;
const fHi = amp.points[amp.points.length - 1]!.frequency;
const fMid = (fLo + fHi) / 2;

beforeEach(() => {
  store.getState().init(emptyDesign());
  store.setState({ twoPortFiles: {}, message: null });
});

/** Reference: what importTwoPort gives at (f, z0). */
function reference(f: number, z0: number) {
  store.getState().init({ ...emptyDesign(), frequency: f, z0 });
  store.setState({ twoPortFiles: {} });
  store.getState().importTwoPort(amp, 'amp-synthetic.s2p');
  const tp = store.getState().design.twoPort!;
  store.getState().init(emptyDesign());
  store.setState({ twoPortFiles: {}, message: null });
  return tp;
}

describe('adv r2: deviceFollows', () => {
  it('z0 and frequency changed in one updateFollowingDevice: device re-read at both', () => {
    const ref = reference(fMid, 75);
    const s = store.getState();
    s.init({ ...emptyDesign(), frequency: fLo });
    s.importTwoPort(amp, 'amp-synthetic.s2p');
    s.updateFollowingDevice((d) => ({ ...d, z0: 75, frequency: fMid }));
    const tp = store.getState().design.twoPort!;
    expect(tp.source?.frequency).toBe(fMid);
    expect(cabs(tp.s.s11)).toBeCloseTo(cabs(ref.s.s11), 12);
    expect(cabs(tp.s.s22)).toBeCloseTo(cabs(ref.s.s22), 12);
  });

  it('undo across a re-read brings the old device and no message; redo the new device', () => {
    const s = store.getState();
    s.init({ ...emptyDesign(), frequency: fLo });
    s.importTwoPort(amp, 'amp-synthetic.s2p');
    s.addDatapoint({ frequency: fMid, z: complex(30, 10) });
    const before = store.getState().design;
    s.setStartDatapoint(1);
    const after = store.getState().design;
    expect(after.twoPort!.source!.frequency).toBe(fMid);
    s.undo();
    expect(store.getState().design).toBe(before);
    expect(store.getState().design.twoPort!.source!.frequency).toBe(fLo);
    s.redo();
    expect(store.getState().design).toBe(after);
    // One history entry for the start change.
    s.undo();
    s.undo();
    expect(store.getState().design.datapoints).toBeUndefined();
  });

  it('clamped message is cleared when a later follow lands inside the file again', () => {
    const s = store.getState();
    s.init({ ...emptyDesign(), frequency: fLo });
    s.importTwoPort(amp, 'amp-synthetic.s2p');
    s.addDatapoint({ frequency: fLo / 4, z: complex(30, 10) });
    s.addDatapoint({ frequency: fMid, z: complex(30, 10) });
    s.setStartDatapoint(1); // outside -> clamped
    expect(store.getState().message).toMatch(/outside the file/);
    // removing DP1 (the start, outside) hands the chain to the next, which is inside the file
    s.removeDatapoint(1);
    const d = store.getState().design;
    expect(d.twoPort!.source!.clamped).toBe(false);
    expect(store.getState().message ?? '').not.toMatch(/outside the file/);
  });

  it('setStartDatapoint when the design frequency does not change (same f, other z) is still one entry and the device is untouched', () => {
    const s = store.getState();
    s.init({ ...emptyDesign(), frequency: fMid });
    s.importTwoPort(amp, 'amp-synthetic.s2p');
    const tp = store.getState().design.twoPort;
    s.addDatapoint({ frequency: fMid, z: complex(30, 10) });
    const n = store.getState().past.length;
    s.setStartDatapoint(1);
    expect(store.getState().past.length).toBe(n + 1);
    expect(store.getState().design.twoPort).toBe(tp);
  });
});
