import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildXmlsc,
  cabs,
  cargDeg,
  complex,
  readTouchstone,
  readXmlsc,
  sweepPoints,
  writeXmlsc,
} from '@smithonline/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SWEEP, designFromXmlsc, emptyDesign, type Design } from '../src/lib/design';
import { designSweep, designToXmlsc } from '../src/lib/files';
import { twoPortFromFile } from '../src/lib/import';
import { decodeDesign, encodeDesign } from '../src/lib/share';
import { useDesignStore } from '../src/store/useDesignStore';

const store = useDesignStore;
const amp = readTouchstone(
  readFileSync(
    join(__dirname, '..', '..', 'core', 'test', 'fixtures', 'sparams', 'amp-synthetic.s2p'),
    'utf8',
  ),
  2,
);
const guid = (): string => '00000000-0000-4000-8000-000000000000';

const loads = [
  { frequency: 1e8, z: { re: 100, im: 0 } },
  { frequency: 2e8, z: { re: 50, im: 50 } },
  { frequency: 3e8, z: { re: 25, im: -25 } },
];

/** What main.tsx does with the autosaved design: JSON round trip, no validation. */
const fromStorage = (d: Design): Design => ({
  ...emptyDesign(),
  ...(JSON.parse(JSON.stringify(d)) as Design),
});

beforeEach(() => {
  store.getState().init(emptyDesign());
  store.setState({ twoPortFiles: {}, selected: null });
});

describe('qa2: a disabled datapoint sweep through the project file', () => {
  it('designFromXmlsc of several user datapoints without a sweep record gives a disabled datapoint sweep', () => {
    const ladder = { z0: 50, frequency: 1e9, load: complex(50, 0), elements: [] };
    const text = writeXmlsc(
      buildXmlsc(ladder, { datapointSweep: loads, sweepEnabled: false, guid }),
    );
    const d = designFromXmlsc(text, 'antenna');
    expect(d.frequency).toBe(1e9);
    expect(d.load).toEqual({ re: 50, im: 0 });
    expect(d.sweep.enabled).toBe(false);
    expect(d.sweep.loadsName).toBe('antenna');
    // The start datapoint joins the loads at its own frequency, in frequency order (Example 17's layout).
    expect(d.sweep.loads).toEqual([...loads, { frequency: 1e9, z: { re: 50, im: 0 } }]);
    expect(designSweep(d)).toBeNull();
  });

  it('is stable over a second save and open, on and off', () => {
    for (const enabled of [false, true]) {
      const first: Design = { ...emptyDesign(), sweep: { ...DEFAULT_SWEEP, enabled, loads } };
      const once = designFromXmlsc(designToXmlsc(first), 'x');
      expect(once.sweep.enabled).toBe(enabled);
      expect(once.sweep.loads).toHaveLength(4);
      const twice = designFromXmlsc(designToXmlsc(once), 'x');
      expect(twice.sweep).toEqual(once.sweep);
      const parsed = readXmlsc(designToXmlsc(twice));
      expect(parsed.datapoints.filter((p) => p.isReal)).toHaveLength(4);
      expect(parsed.datapoints.filter((p) => p.isStart)).toHaveLength(1);
      expect(parsed.sweepDatapoints).toHaveLength(enabled ? 4 : 0);
      expect(parsed.sweep?.sweepType).toBe(enabled ? 'datapoint' : undefined);
    }
  });

  it('a file holding a frequency sweep and several user datapoints keeps the datapoints when saved again', () => {
    const ladder = { z0: 50, frequency: 1e9, load: complex(50, 0), elements: [] };
    const text = writeXmlsc(
      buildXmlsc(ladder, {
        frequencySweep: [1e9, 2e9],
        datapointSweep: [{ frequency: 2e9, z: complex(20, 10) }],
        guid,
      }),
    );
    expect(readXmlsc(text).datapoints.filter((p) => p.isReal)).toHaveLength(2);
    const d = designFromXmlsc(text, 'x');
    expect(d.sweep.enabled).toBe(true);
    const again = readXmlsc(designToXmlsc(d));
    expect(again.datapoints.filter((p) => p.isReal)).toHaveLength(2);
  });
});

describe('qa2: frequency sweep limits through files and links', () => {
  it('a sweep with start equal to stop reopens with at least the two points the panel allows', () => {
    const d: Design = {
      ...emptyDesign(),
      sweep: { enabled: true, start: 1e9, stop: 1e9, points: 5 },
    };
    const text = designToXmlsc(d);
    expect(readXmlsc(text).sweepDatapoints).toHaveLength(5);
    const back = designFromXmlsc(text, 'x');
    expect(back.sweep.enabled).toBe(true);
    expect(back.sweep.points).toBeGreaterThanOrEqual(2);
  });

  it('a link cannot carry a sweep start or stop below the 1 Hz the panel enforces', () => {
    const d = decodeDesign(
      btoa(
        JSON.stringify({ elements: [], sweep: { enabled: true, start: 0, stop: -1e9, points: 3 } }),
      ),
    )!;
    expect(d.sweep.start).toBeGreaterThanOrEqual(1);
    expect(d.sweep.stop).toBeGreaterThanOrEqual(1);
  });

  it('sweepPoints with start equal to stop is what the file stores', () => {
    expect(sweepPoints(1e9, 1e9, 3)).toEqual([1e9, 1e9, 1e9]);
  });
});

describe('qa2: a device source without its file in memory', () => {
  const withSource = (): Design => {
    const tp = twoPortFromFile(amp, 1e9, 'amp-synthetic.s2p', 50)!;
    return { ...emptyDesign(), twoPort: tp, showStability: true };
  };

  it('a reload from the autosave keeps the device and its source; f and Z0 changes leave it alone', () => {
    const restored = fromStorage(withSource());
    expect(restored.twoPort?.source?.fileName).toBe('amp-synthetic.s2p');
    store.getState().init(restored);
    const s = store.getState();
    s.setFrequency(2e9);
    let d = store.getState().design;
    expect(d.frequency).toBe(2e9);
    // The file is not in memory: the parameters stay those read at 1 GHz (|S11| 0.55 at -55 degrees).
    expect(cabs(d.twoPort!.s.s11)).toBeCloseTo(0.55, 12);
    expect(cargDeg(d.twoPort!.s.s11)).toBeCloseTo(-55, 10);
    expect(d.twoPort!.source).toMatchObject({ fileName: 'amp-synthetic.s2p', frequency: 1e9 });
    s.setZ0(75);
    d = store.getState().design;
    expect(cabs(d.twoPort!.s.s11)).toBeCloseTo(0.55, 12);
    expect(d.twoPort!.noise?.nfMinDb).toBeCloseTo(0.9, 12);
  });

  it('a share link keeps the source and the device only starts following f once the file is opened again', () => {
    const shared = decodeDesign(encodeDesign(withSource()))!;
    expect(shared.twoPort?.source?.fileName).toBe('amp-synthetic.s2p');
    store.getState().init(shared);
    const s = store.getState();
    s.setFrequency(2e9);
    expect(cabs(store.getState().design.twoPort!.s.s11)).toBeCloseTo(0.55, 5);
    s.importTwoPort(amp, 'amp-synthetic.s2p');
    let d = store.getState().design;
    // At 2 GHz the file holds |S11| 0.5 at -80 degrees and NFmin 1.2 dB.
    expect(cabs(d.twoPort!.s.s11)).toBeCloseTo(0.5, 12);
    expect(cargDeg(d.twoPort!.s.s11)).toBeCloseTo(-80, 10);
    expect(d.twoPort!.noise?.nfMinDb).toBeCloseTo(1.2, 12);
    s.setFrequency(3e9);
    d = store.getState().design;
    expect(cabs(d.twoPort!.s.s11)).toBeCloseTo(0.45, 12);
    expect(d.twoPort!.source?.frequency).toBe(3e9);
  });

  it('a design loaded later whose source names the file in memory follows that file', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp-synthetic.s2p');
    // A link made in an earlier session at 1 GHz, opened while the file is in memory.
    s.loadDesign({ ...decodeDesign(encodeDesign(withSource()))!, frequency: 1e9 });
    s.setFrequency(2e9);
    const d = store.getState().design;
    expect(cabs(d.twoPort!.s.s11)).toBeCloseTo(0.5, 12);
    expect(d.twoPort!.source?.frequency).toBe(2e9);
  });

  it('undo of a second import brings the first device back with its file binding', () => {
    // The store keeps one file; after undoing the second import the design points at the
    // first file, which must still drive the device when f changes.
    const other = readTouchstone(
      '# GHZ S RI R 50\n1 0.1 0 0.3 0 0.2 0 0.4 0\n2 0.2 0 0.3 0 0.2 0 0.4 0\n',
      2,
    );
    const s = store.getState();
    s.importTwoPort(amp, 'amp-synthetic.s2p');
    s.importTwoPort(other, 'other.s2p');
    s.undo();
    expect(store.getState().design.twoPort?.source?.fileName).toBe('amp-synthetic.s2p');
    s.setFrequency(2e9);
    const d = store.getState().design;
    expect(d.twoPort?.source).toMatchObject({ fileName: 'amp-synthetic.s2p', frequency: 2e9 });
    expect(cabs(d.twoPort!.s.s11)).toBeCloseTo(0.5, 12);
  });

  it('after undoing a re-import under the same name, f changes do not take the newer file', () => {
    const other = readTouchstone(
      '# GHZ S RI R 50\n1 0.1 0 0.3 0 0.2 0 0.4 0\n2 0.2 0 0.3 0 0.2 0 0.4 0\n',
      2,
    );
    const s = store.getState();
    s.importTwoPort(amp, 'dev.s2p');
    s.importTwoPort(other, 'dev.s2p');
    s.undo();
    expect(cabs(store.getState().design.twoPort!.s.s11)).toBeCloseTo(0.55, 12);
    s.setFrequency(2e9);
    // Either the undone device follows its own file (|S11| 0.5 at 2 GHz) or it stays as it was;
    // it must not become the other file's 0.2.
    expect(cabs(store.getState().design.twoPort!.s.s11)).not.toBeCloseTo(0.2, 6);
  });

  it('a hand edit after the reload detaches the stale source, and undo brings it back', () => {
    store.getState().init(fromStorage(withSource()));
    const s = store.getState();
    const tp = store.getState().design.twoPort!;
    s.setTwoPort({ ...tp, noise: null });
    expect(store.getState().design.twoPort?.source).toBeUndefined();
    expect(store.getState().design.twoPort?.noise).toBeNull();
    s.undo();
    expect(store.getState().design.twoPort?.source?.fileName).toBe('amp-synthetic.s2p');
    expect(store.getState().design.twoPort?.noise?.nfMinDb).toBeCloseTo(0.9, 12);
  });
});
