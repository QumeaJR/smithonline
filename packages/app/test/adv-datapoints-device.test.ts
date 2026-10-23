/**
 * Adversarial tests, QA round 1: user datapoints with a chain start against
 * a file-bound two-port, the S-Plot hand-over to the chart, and the .xmlsc
 * round trip of a design that holds both user datapoints and an imported
 * datapoint sweep.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cabs, cargDeg, complex, readTouchstone, writeTouchstone } from '@smithonline/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { userDatapoints } from '../src/lib/datapoints';
import { designFromXmlsc, emptyDesign } from '../src/lib/design';
import { designSweep, designToXmlsc } from '../src/lib/files';
import { decodeDesign, encodeDesign } from '../src/lib/share';
import { readSPlotFiles } from '../src/lib/splot';
import { exportTouchstoneText, sendLoadToChart, sendSweepToChart } from '../src/lib/splotActions';
import { useDesignStore } from '../src/store/useDesignStore';
import { useSPlotStore } from '../src/store/useSPlotStore';

const store = useDesignStore;
const ampText = readFileSync(
  join(__dirname, '..', '..', 'core', 'test', 'fixtures', 'sparams', 'amp-synthetic.s2p'),
  'utf8',
);
const amp = readTouchstone(ampText, 2);

beforeEach(() => {
  store.getState().init(emptyDesign());
  store.setState({ twoPortFiles: {}, message: null });
  useSPlotStore.setState({ files: [], activeId: null, selected: null, cursor: null });
});

/** The device the store would show for the file at frequency f. */
function s11At(f: number): { mag: number; deg: number } {
  const d = emptyDesign();
  store.getState().init({ ...d, frequency: f });
  store.getState().importTwoPort(amp, 'amp-synthetic.s2p');
  const s = store.getState().design.twoPort!.s.s11;
  return { mag: cabs(s), deg: cargDeg(s) };
}

describe('adv: a file-bound device must follow every path that changes the design frequency', () => {
  it('start from another datapoint: the device is re-read at the new frequency', () => {
    const at2 = s11At(2e9);
    store.getState().init(emptyDesign());
    store.setState({ twoPortFiles: {} });
    const s = store.getState();
    s.importTwoPort(amp, 'amp-synthetic.s2p');
    s.addDatapoint({ frequency: 2e9, z: complex(30, 10) });
    s.setStartDatapoint(1);
    const d = store.getState().design;
    expect(d.frequency).toBe(2e9);
    expect(d.twoPort!.source?.frequency).toBe(2e9);
    expect(cabs(d.twoPort!.s.s11)).toBeCloseTo(at2.mag, 12);
    expect(cargDeg(d.twoPort!.s.s11)).toBeCloseTo(at2.deg, 10);
  });

  it('removing the start datapoint hands the chain to the next one and the device follows', () => {
    const at2 = s11At(2e9);
    store.getState().init(emptyDesign());
    store.setState({ twoPortFiles: {} });
    const s = store.getState();
    s.importTwoPort(amp, 'amp-synthetic.s2p');
    s.addDatapoint({ frequency: 2e9, z: complex(30, 10) });
    s.removeDatapoint(0);
    const d = store.getState().design;
    expect(d.frequency).toBe(2e9);
    expect(userDatapoints(d)).toHaveLength(1);
    expect(d.twoPort!.source?.frequency).toBe(2e9);
    expect(cabs(d.twoPort!.s.s11)).toBeCloseTo(at2.mag, 12);
  });

  it('S-Plot "send to chart" sets the frequency and the device follows', () => {
    const at2 = s11At(2e9);
    store.getState().init(emptyDesign());
    store.setState({ twoPortFiles: {} });
    const s = store.getState();
    s.importTwoPort(amp, 'amp-synthetic.s2p');
    const ids = useSPlotStore.getState().addFiles(readSPlotFiles('amp-synthetic.s2p', ampText));
    const entry = useSPlotStore.getState().files.find((f) => f.id === ids[0])!;
    sendLoadToChart(entry, 1, 2e9);
    const d = store.getState().design;
    expect(d.frequency).toBe(2e9);
    expect(d.twoPort!.source?.frequency).toBe(2e9);
    expect(cabs(d.twoPort!.s.s11)).toBeCloseTo(at2.mag, 12);
  });

  it('S-Plot "sweep" sets DP1 at the nearest row and the device follows that frequency', () => {
    const at15 = s11At(1.5e9);
    store.getState().init({ ...emptyDesign(), frequency: 1.4e9 });
    store.setState({ twoPortFiles: {} });
    const s = store.getState();
    s.importTwoPort(amp, 'amp-synthetic.s2p');
    const ids = useSPlotStore.getState().addFiles(readSPlotFiles('amp-synthetic.s2p', ampText));
    const entry = useSPlotStore.getState().files.find((f) => f.id === ids[0])!;
    sendSweepToChart(entry, 1);
    const d = store.getState().design;
    expect(d.frequency).toBe(1.5e9);
    expect(d.twoPort!.source?.frequency).toBe(1.5e9);
    expect(cabs(d.twoPort!.s.s11)).toBeCloseTo(at15.mag, 12);
  });

  it('a datapoint edit of the start frequency is one undo step', () => {
    const s = store.getState();
    s.addDatapoint({ frequency: 2e9, z: complex(30, 10) });
    const depth = store.getState().past.length;
    s.setDatapoint(0, { frequency: 1.2e9 });
    expect(store.getState().design.frequency).toBe(1.2e9);
    expect(store.getState().past.length).toBe(depth + 1);
    s.undo();
    expect(store.getState().design.frequency).toBe(1e9);
    expect(userDatapoints(store.getState().design)).toHaveLength(2);
  });
});

describe('adv: datapoint sweep and user datapoints through .xmlsc and the share link', () => {
  it('user datapoints plus an imported 100-point sweep reopen below the datapoint limit', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      frequency: 0.5e9 + i * 1e7,
      z: complex(20 + i, -12),
    }));
    const s = store.getState();
    s.addDatapoint({ frequency: 2e9, z: complex(30, 10) });
    s.setSweep({ enabled: true, loads: rows, loadsName: 'file.s1p', mode: 'datapoints' });
    const d = store.getState().design;
    expect(designSweep(d)).toHaveLength(100);
    const text = designToXmlsc(d);
    const back = designFromXmlsc(text, 'back');
    const users = userDatapoints(back);
    // Whatever the file holds, the design that comes back must be one the app can carry on with.
    expect(users.length).toBeLessThanOrEqual(64);
    const link = decodeDesign(encodeDesign(back))!;
    expect(link).not.toBeNull();
    // Nothing the user keeps (their datapoints, the sweep) is lost between the file and the link.
    expect(userDatapoints(link)).toHaveLength(users.length);
    expect(designSweep(link)?.length ?? 0).toBe(designSweep(back)?.length ?? 0);
  });

  it('two user datapoints with the sweep off reopen with the sweep off and the same start', () => {
    const s = store.getState();
    s.addDatapoint({ frequency: 2e9, z: complex(30, 10) });
    s.setStartDatapoint(1);
    s.setSweep({ enabled: false });
    const d = store.getState().design;
    const back = designFromXmlsc(designToXmlsc(d), 'back');
    expect(back.sweep.enabled).toBe(false);
    expect(back.frequency).toBe(2e9);
    expect(back.startSlot).toBe(1);
    expect(userDatapoints(back).map((u) => u.frequency)).toEqual([1e9, 2e9]);
    expect(designToXmlsc(back)).toBe(designToXmlsc(d));
  });

  it('a user datapoint equal to the start in value is kept as its own point', () => {
    const s = store.getState();
    s.addDatapoint({ frequency: 1e9, z: complex(50, 0) });
    const d = store.getState().design;
    expect(userDatapoints(d)).toHaveLength(2);
    const back = designFromXmlsc(designToXmlsc(d), 'back');
    expect(userDatapoints(back)).toHaveLength(2);
  });

  it('the 65th datapoint is refused with a message and leaves history alone', () => {
    const s = store.getState();
    for (let i = 1; i < 64; i++)
      s.addDatapoint({ frequency: 1e9 + i * 1e6, z: complex(10 + i, 0) });
    expect(userDatapoints(store.getState().design)).toHaveLength(64);
    const depth = store.getState().past.length;
    s.addDatapoint({ frequency: 5e9, z: complex(1, 1) });
    expect(userDatapoints(store.getState().design)).toHaveLength(64);
    expect(store.getState().past.length).toBe(depth);
    expect(store.getState().message).toMatch(/64/);
  });
});

describe('adv: S-Plot store', () => {
  it('the same file loaded twice gets two ids and removing the active one activates the other', () => {
    const parsed = readSPlotFiles('amp-synthetic.s2p', ampText);
    const a = useSPlotStore.getState().addFiles(parsed)[0]!;
    const b = useSPlotStore.getState().addFiles(parsed)[0]!;
    expect(a).not.toBe(b);
    expect(useSPlotStore.getState().activeId).toBe(b);
    useSPlotStore.getState().select(2);
    useSPlotStore.getState().removeFile(b);
    expect(useSPlotStore.getState().activeId).toBe(a);
    expect(useSPlotStore.getState().selected).toBeNull();
  });

  it('an ABCD export of the S-Plot is not accepted back into the S-Plot as S-parameters', () => {
    const parsed = readSPlotFiles('amp-synthetic.s2p', ampText);
    const id = useSPlotStore.getState().addFiles(parsed)[0]!;
    const entry = useSPlotStore.getState().files.find((f) => f.id === id)!;
    const text = exportTouchstoneText(entry, {
      parameter: 'ABCD',
      normalized: true,
      format: 'RI',
      unit: 'GHZ',
    });
    expect(() => readSPlotFiles('amp-abcd-norm.s2p', text)).toThrow();
  });

  it('a unit change keeps the selected row valid and the original data untouched', () => {
    const parsed = readSPlotFiles('amp-synthetic.s2p', ampText);
    const id = useSPlotStore.getState().addFiles(parsed)[0]!;
    useSPlotStore.getState().select(1);
    const before = useSPlotStore.getState().files[0]!.original.points[1]!.frequency;
    useSPlotStore.getState().setUnit(id, 'HZ');
    const e = useSPlotStore.getState().files[0]!;
    expect(e.original.points[1]!.frequency).toBe(before);
    expect(e.data.points[1]!.frequency).toBe(before / 1e9);
    expect(useSPlotStore.getState().selected).toBe(1);
    useSPlotStore.getState().setUnit(id, 'GHZ');
    expect(useSPlotStore.getState().files[0]!.data).toBe(
      useSPlotStore.getState().files[0]!.original,
    );
  });

  it('a one-port file with a single point can be sent to the chart but not swept', () => {
    const text = writeTouchstone(
      { ports: 1, z0: 50, points: [{ frequency: 1e9, s: [complex(0.2, 0.1)] }] },
      { format: 'RI' },
    );
    const id = useSPlotStore.getState().addFiles(readSPlotFiles('one.s1p', text))[0]!;
    const entry = useSPlotStore.getState().files.find((f) => f.id === id)!;
    expect(sendSweepToChart(entry, 1)).toMatch(/at least two/);
    expect(sendLoadToChart(entry, 2, 1e9)).toMatch(/no s22/);
    expect(sendLoadToChart(entry, 1, 5e9)).toMatch(/Load set/);
    expect(store.getState().design.frequency).toBe(1e9);
  });
});
