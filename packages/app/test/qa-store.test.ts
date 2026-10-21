import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cabs, cargDeg, readTouchstone } from '@smithonline/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDesign } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';

const store = useDesignStore;
const amp = readTouchstone(
  readFileSync(
    join(__dirname, '..', '..', 'core', 'test', 'fixtures', 'sparams', 'amp-synthetic.s2p'),
    'utf8',
  ),
  2,
);

beforeEach(() => {
  store.getState().init(emptyDesign());
  store.setState({ twoPortFile: null });
});

describe('qa: two-port file in the store', () => {
  it('fills the device at the design frequency and follows frequency changes', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp-synthetic.s2p');
    let d = store.getState().design;
    // The file holds S11 = 0.55 at -55 degrees at 1 GHz and 0.5 at -80 degrees at 2 GHz.
    expect(cabs(d.twoPort!.s.s11)).toBeCloseTo(0.55, 12);
    expect(cargDeg(d.twoPort!.s.s11)).toBeCloseTo(-55, 10);
    expect(d.twoPort!.source).toMatchObject({ fileName: 'amp-synthetic.s2p', frequency: 1e9 });
    expect(d.showStability).toBe(true);
    expect(store.getState().twoPortFile?.fileName).toBe('amp-synthetic.s2p');

    s.setFrequency(2e9);
    d = store.getState().design;
    expect(cabs(d.twoPort!.s.s11)).toBeCloseTo(0.5, 12);
    expect(cargDeg(d.twoPort!.s.s11)).toBeCloseTo(-80, 10);
    expect(d.twoPort!.source?.frequency).toBe(2e9);
    expect(d.twoPort!.noise?.nfMinDb).toBeCloseTo(1.2, 12);

    s.setFrequency(20e9);
    expect(store.getState().design.twoPort!.source?.clamped).toBe(true);
  });

  it('detaches the file when the device is set by hand', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp-synthetic.s2p');
    const manual = {
      s11: { re: 0.1, im: 0 },
      s12: { re: 0.1, im: 0 },
      s21: { re: 0.1, im: 0 },
      s22: { re: 0.1, im: 0 },
    };
    s.setTwoPort({ s: manual, noise: null });
    // The file stays in memory for undo; the design no longer points at it.
    expect(store.getState().design.twoPort).toEqual({ s: manual, noise: null });
    s.setFrequency(3e9);
    expect(store.getState().design.twoPort).toEqual({ s: manual, noise: null });
    s.setTwoPort(null);
    expect(store.getState().design.twoPort).toBeNull();
  });

  it('ignores a one-port and does not revive the device after load and new', () => {
    const s = store.getState();
    const one = readTouchstone('# MHZ S RI R 50\n130 0.405405 -0.432432\n', 1);
    s.importTwoPort(one, 'dipole.s1p');
    expect(store.getState().twoPortFile).toBeNull();
    expect(store.getState().design.twoPort).toBeNull();

    // The file stays in memory for undo, but a loaded or new design does not point at it,
    // so a frequency change must not bring the device back.
    s.importTwoPort(amp, 'amp-synthetic.s2p');
    s.loadDesign(emptyDesign());
    expect(store.getState().design.twoPort).toBeNull();
    s.setFrequency(2e9);
    expect(store.getState().design.twoPort).toBeNull();
    s.importTwoPort(amp, 'amp-synthetic.s2p');
    s.newDesign();
    expect(store.getState().design.twoPort).toBeNull();
    s.setFrequency(3e9);
    expect(store.getState().design.twoPort).toBeNull();
  });

  it('re-references the device when Z0 changes', () => {
    // S11 at 1 GHz is 0.55 at -55 degrees against 50 ohm; against 100 ohm it is the
    // reflection of the same impedance, so it must differ from the 50 ohm value.
    const s = store.getState();
    s.importTwoPort(amp, 'amp-synthetic.s2p');
    const before = store.getState().design.twoPort!.s.s11;
    s.setZ0(100);
    const after = store.getState().design.twoPort!.s.s11;
    expect(after).not.toEqual(before);
  });

  it('forgets the file when the import is undone', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp-synthetic.s2p');
    s.undo();
    expect(store.getState().design.twoPort).toBeNull();
    s.setFrequency(2e9);
    expect(store.getState().design.twoPort).toBeNull();
  });
});
