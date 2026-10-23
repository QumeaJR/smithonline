import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cabs, complex, readTouchstone, readXmlsc } from '@smithonline/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SWEEP,
  designFromXmlsc,
  emptyDesign,
  hasDatapointSweep,
  type Design,
} from '../src/lib/design';
import { designSweep, designToXmlsc } from '../src/lib/files';
import { decodeDesign, encodeDesign } from '../src/lib/share';
import { useDesignStore } from '../src/store/useDesignStore';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '..', '..', 'core', 'test', 'fixtures', 'xmlsc', name), 'utf8');
const amp = readTouchstone(
  readFileSync(
    join(__dirname, '..', '..', 'core', 'test', 'fixtures', 'sparams', 'amp-synthetic.s2p'),
    'utf8',
  ),
  2,
);
const store = useDesignStore;

const loads = [
  { frequency: 1e8, z: { re: 100, im: 0 } },
  { frequency: 2e8, z: { re: 50, im: 50 } },
  { frequency: 3e8, z: { re: 25, im: -25 } },
];

/** 50 ohm load at 1 GHz, no elements, the three loads kept, a 3-point frequency sweep 1 to 3 GHz. */
const both = (mode: 'frequency' | 'datapoints', enabled = true): Design => ({
  ...emptyDesign(),
  sweep: { enabled, start: 1e9, stop: 3e9, points: 3, loads, loadsName: 'ant.s1p', mode },
});

const dec = (json: string): Design | null => decodeDesign(btoa(json));

beforeEach(() => {
  store.getState().init(emptyDesign());
  store.setState({ twoPortFiles: {}, selected: null });
});

describe('qa3: hasDatapointSweep and designSweep follow the mode', () => {
  it('mode frequency with loads is a frequency sweep; datapoints or no mode is a datapoint sweep', () => {
    expect(hasDatapointSweep(both('frequency').sweep)).toBe(false);
    expect(hasDatapointSweep(both('datapoints').sweep)).toBe(true);
    expect(hasDatapointSweep({ ...DEFAULT_SWEEP, loads })).toBe(true);
    expect(hasDatapointSweep({ ...DEFAULT_SWEEP, loads: [], mode: 'datapoints' })).toBe(false);
    expect(hasDatapointSweep(DEFAULT_SWEEP)).toBe(false);
  });

  it('designSweep in mode frequency sweeps the design load over start to stop', () => {
    const pts = designSweep(both('frequency'))!;
    // No elements: the input impedance is the design load at every swept frequency.
    expect(pts.map((p) => p.frequency)).toEqual([1e9, 2e9, 3e9]);
    for (const p of pts) expect(p.zin).toEqual(complex(50, 0));
  });

  it('designSweep in mode datapoints applies the network to each load at its own frequency', () => {
    const pts = designSweep(both('datapoints'))!;
    expect(pts.map((p) => p.frequency)).toEqual([1e8, 2e8, 3e8]);
    expect(pts.map((p) => p.zin)).toEqual(loads.map((l) => l.z));
  });

  it('a disabled sweep yields nothing in either mode', () => {
    expect(designSweep(both('frequency', false))).toBeNull();
    expect(designSweep(both('datapoints', false))).toBeNull();
  });
});

describe('qa3: the mode through the project file', () => {
  it('mode frequency: frequency sweep records, the loads stored as user datapoints, reopened in mode frequency', () => {
    const text = designToXmlsc(both('frequency'));
    const parsed = readXmlsc(text);
    expect(parsed.sweep?.sweepType).toBe('frequency');
    expect(parsed.sweepDatapoints.map((p) => p.frequency)).toEqual([1e9, 2e9, 3e9]);
    const users = parsed.datapoints.filter((p) => p.isReal);
    expect(users.map((p) => p.frequency)).toEqual([1e8, 2e8, 3e8, 1e9]);
    expect(users.filter((p) => p.isStart).map((p) => p.frequency)).toEqual([1e9]);

    const back = designFromXmlsc(text, 'x');
    expect(back.frequency).toBe(1e9);
    expect(back.load).toEqual(complex(50, 0));
    expect(back.sweep).toMatchObject({
      enabled: true,
      start: 1e9,
      stop: 3e9,
      points: 3,
      mode: 'frequency',
      loadsName: 'x',
    });
    expect(back.sweep.loads).toEqual([...loads, { frequency: 1e9, z: complex(50, 0) }]);
    expect(hasDatapointSweep(back.sweep)).toBe(false);
    expect(designSweep(back)!.map((p) => p.frequency)).toEqual([1e9, 2e9, 3e9]);
    // Stable over a second save.
    expect(designFromXmlsc(designToXmlsc(back), 'x').sweep).toEqual(back.sweep);
  });

  it('mode datapoints: datapoint sweep records, reopened as a datapoint sweep without a mode key', () => {
    const text = designToXmlsc(both('datapoints'));
    const parsed = readXmlsc(text);
    expect(parsed.sweep?.sweepType).toBe('datapoint');
    expect(parsed.sweepDatapoints).toHaveLength(4);
    const back = designFromXmlsc(text, 'x');
    expect(back.sweep.enabled).toBe(true);
    expect(back.sweep.mode).toBeUndefined();
    expect(back.sweep.loads).toHaveLength(4);
    expect(hasDatapointSweep(back.sweep)).toBe(true);
    expect(designSweep(back)!.map((p) => p.frequency)).toEqual([1e8, 2e8, 3e8, 1e9]);
  });

  it('mode frequency switched off: no sweep records, the loads survive, the design is untouched', () => {
    const text = designToXmlsc(both('frequency', false));
    const parsed = readXmlsc(text);
    expect(parsed.sweep).toBeUndefined();
    expect(parsed.sweepDatapoints).toHaveLength(0);
    expect(parsed.datapoints.filter((p) => p.isReal)).toHaveLength(4);
    const back = designFromXmlsc(text, 'x');
    expect(back.sweep.enabled).toBe(false);
    expect(back.sweep.loads).toHaveLength(4);
    expect(back.frequency).toBe(1e9);
    expect(back.load).toEqual(complex(50, 0));
    expect(designSweep(back)).toBeNull();
  });

  it('Example 16 and Example 17 open as before', () => {
    const d16 = designFromXmlsc(fixture('Example16.xmlsc'), 'Example 16');
    expect(d16.sweep).toEqual({ enabled: true, start: 10e6, stop: 450e6, points: 45 });
    expect('loads' in d16.sweep).toBe(false);
    expect('mode' in d16.sweep).toBe(false);
    expect(hasDatapointSweep(d16.sweep)).toBe(false);
    const s16 = designSweep(d16)!;
    expect(s16).toHaveLength(45);
    expect(s16[0]!.frequency).toBe(10e6);
    expect(s16[44]!.frequency).toBe(450e6);

    const d17 = designFromXmlsc(fixture('Example17.xmlsc'), 'Example 17');
    expect(d17.frequency).toBe(145e6);
    expect(d17.load).toEqual({ re: 106.9, im: 41.7 });
    expect(d17.sweep.enabled).toBe(true);
    expect(d17.sweep.mode).toBeUndefined();
    expect(hasDatapointSweep(d17.sweep)).toBe(true);
    // The stored user datapoints in index order: 140 MHz 100.8 + j24.2 first, the start second.
    expect(d17.sweep.loads![0]).toEqual({ frequency: 140e6, z: { re: 100.8, im: 24.2 } });
    expect(d17.sweep.loads![1]).toEqual({ frequency: 145e6, z: { re: 106.9, im: 41.7 } });
    expect(designSweep(d17)!.map((p) => p.frequency)).toEqual([140e6, 145e6, 150e6]);
  });
});

describe('qa3: the mode through a share link', () => {
  it('keeps mode frequency and mode datapoints next to the loads', () => {
    for (const mode of ['frequency', 'datapoints'] as const) {
      const back = decodeDesign(encodeDesign(both(mode)))!;
      expect(back.sweep).toEqual(both(mode).sweep);
      expect(hasDatapointSweep(back.sweep)).toBe(mode === 'datapoints');
    }
  });

  it('drops an unknown mode and a mode without loads', () => {
    const odd = dec(
      `{"elements":[],"sweep":{"enabled":true,"start":1e9,"stop":3e9,"points":3,"mode":"foo","loads":${JSON.stringify(loads)}}}`,
    )!;
    expect(odd.sweep.mode).toBeUndefined();
    expect(odd.sweep.loads).toHaveLength(3);
    expect(hasDatapointSweep(odd.sweep)).toBe(true);
    const bare = dec('{"elements":[],"sweep":{"enabled":true,"mode":"frequency"}}')!;
    expect(bare.sweep).toEqual({ ...DEFAULT_SWEEP, enabled: true });
  });

  const S =
    '{"s11":{"re":0.1,"im":0},"s12":{"re":0.1,"im":0},"s21":{"re":2,"im":0},"s22":{"re":0.1,"im":0}}';

  it('non-finite noise parameters (1e999 in the JSON) do not reach the design', () => {
    const d = dec(
      `{"elements":[],"twoPort":{"s":${S},"noise":{"nfMinDb":1e999,"gammaOpt":{"re":0.1,"im":0},"rn":-1e999}}}`,
    )!;
    expect(d.twoPort).not.toBeNull();
    const noise = d.twoPort!.noise;
    if (noise) {
      expect(Number.isFinite(noise.nfMinDb)).toBe(true);
      expect(Number.isFinite(noise.rn)).toBe(true);
    }
  });

  it('a non-finite gain circle level is dropped like a non-finite VSWR or Q entry', () => {
    const d = dec(
      `{"elements":[],"twoPort":{"s":${S},"noise":null},"gainCircles":[{"type":"available","gainDb":1e999}],"vswrCircles":[1e999]}`,
    )!;
    expect(d.vswrCircles).toEqual([]);
    expect(d.gainCircles).toEqual([]);
  });
});

describe('qa3: file instances in the store', () => {
  it('two imports under one name get distinct ids and both stay in memory', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'dev.s2p');
    const first = store.getState().design.twoPort!.source!.fileId!;
    s.importTwoPort(amp, 'dev.s2p');
    const second = store.getState().design.twoPort!.source!.fileId!;
    expect(first).toMatch(/^dev\.s2p#\d+$/);
    expect(second).toMatch(/^dev\.s2p#\d+$/);
    expect(first).not.toBe(second);
    expect(Object.keys(store.getState().twoPortFiles).sort()).toEqual([first, second].sort());
  });

  it('a source whose instance id is unknown attaches to the open file of that name', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp-synthetic.s2p');
    const open = store.getState().design.twoPort!.source!.fileId!;
    const stale = store.getState().design.twoPort!;
    s.loadDesign({
      ...emptyDesign(),
      twoPort: {
        ...stale,
        source: { ...stale.source!, fileId: 'amp-synthetic.s2p#999' },
      },
    });
    s.setFrequency(2e9);
    const d = store.getState().design;
    // At 2 GHz the file holds |S11| 0.5; the device now names the open instance.
    expect(cabs(d.twoPort!.s.s11)).toBeCloseTo(0.5, 12);
    expect(d.twoPort!.source?.fileId).toBe(open);
  });

  it('a source fileId that is an Object.prototype key is treated as unknown, not as a file', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp-synthetic.s2p');
    const stale = store.getState().design.twoPort!;
    for (const fileId of ['__proto__', 'constructor', 'toString']) {
      s.loadDesign({
        ...emptyDesign(),
        twoPort: { ...stale, source: { ...stale.source!, fileName: 'other.s2p', fileId } },
      });
      // No file named other.s2p is open: the device must stay as it was, without an exception.
      expect(() => s.setFrequency(2e9)).not.toThrow();
      expect(store.getState().design.frequency).toBe(2e9);
      expect(cabs(store.getState().design.twoPort!.s.s11)).toBeCloseTo(0.55, 12);
    }
  });

  it('setFrequency reports when the file does not cover the design frequency, and clears it when it does', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp-synthetic.s2p');
    s.setFrequency(7e9);
    expect(store.getState().design.twoPort!.source?.clamped).toBe(true);
    expect(store.getState().message).toMatch(/outside the file/);
    // The file ends at 6 GHz: the device holds the 6 GHz row, |S11| 0.3.
    expect(cabs(store.getState().design.twoPort!.s.s11)).toBeCloseTo(0.3, 12);
    s.setFrequency(2e9);
    expect(store.getState().design.twoPort!.source?.clamped).toBe(false);
    expect(store.getState().message).toBeNull();
  });
});
