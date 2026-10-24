/**
 * QA round on the S-Plot network action and the shared export range
 * (lib/splotNetwork.ts, lib/simexport.ts): a design that cannot be
 * evaluated, a design switch under a live entry, the freeze naming, the
 * export range of a datapoint sweep for the .s2p, SPICE and LTspice exports,
 * and the network as built with packages, Realize and losses on. Expected
 * values from the user guide sections 6 and 9 (the sweep when a frequency
 * sweep is on, else 0.5 f to 2 f in 201 points; as built, with realized
 * values, losses and packages) and from two-port theory (a lossless
 * reciprocal network has |S11|^2 + |S21|^2 = 1). it.fails marks a finding.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cabs, DEFAULT_PACKAGES, readTouchstone, sIndex } from '@smithonline/core';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { designToLtspice, designToS2p, designToSpice, exportBand } from '../src/lib/simexport';
import {
  addNetworkToSPlot,
  freezeNetworkEntry,
  LIVE_NETWORK_DELAY_MS,
  networkSPlotFile,
  refreshLiveNetwork,
  snapshotName,
  startLiveNetworkSync,
} from '../src/lib/splotNetwork';
import { useDesignStore } from '../src/store/useDesignStore';
import { usePackages } from '../src/store/usePackages';
import { useSPlotStore, type SPlotEntry } from '../src/store/useSPlotStore';

const splot = useSPlotStore;
const store = useDesignStore;

const example5: Design = {
  ...emptyDesign(),
  name: 'Example 5',
  frequency: 450e6,
  load: { re: 20, im: -12 },
  elements: identify([
    { kind: 'L', orientation: 'shunt', value: 16.03e-9 },
    { kind: 'C', orientation: 'series', value: 21.84e-12 },
  ]),
};

const example7: Design = {
  ...emptyDesign(),
  name: 'Example 7',
  frequency: 900e6,
  load: { re: 100, im: 30 },
  elements: identify([{ kind: 'C', orientation: 'shunt', value: 2.2e-12 }]),
};

beforeEach(() => {
  splot.setState({ files: [], activeId: null, selected: null, cursor: null });
  store.getState().init(example5);
  store.setState({ view: 'chart', message: null });
  usePackages.setState({ table: DEFAULT_PACKAGES });
});

afterEach(() => {
  vi.useRealTimers();
});

function live(): SPlotEntry {
  const e = splot.getState().files.find((f) => f.network === 'live');
  if (!e) throw new Error('no live entry');
  return e;
}

describe('a design that cannot be evaluated', () => {
  const broken = (): void => {
    const el = store.getState().design.elements[1];
    if (!el) throw new Error('no element');
    store.getState().updateElement(1, { ...el, value: Number.NaN } as typeof el);
  };

  it('Add the network refuses with a message, adds nothing and stays in the view', () => {
    broken();
    expect(addNetworkToSPlot()).toMatch(/^Could not add the network to S-Plot: /);
    expect(splot.getState().files).toHaveLength(0);
    expect(store.getState().view).toBe('chart');
  });

  it('the live entry keeps its last curve and name, then follows again once the value is fixed', () => {
    vi.useFakeTimers();
    const stop = startLiveNetworkSync();
    try {
      addNetworkToSPlot();
      const before = live();
      broken();
      expect(() => vi.advanceTimersByTime(LIVE_NETWORK_DELAY_MS)).not.toThrow();
      expect(live().data).toBe(before.data);
      expect(live().fileName).toBe('Example 5 (network)');
      expect(refreshLiveNetwork()).toBe(false);
      store.getState().undo();
      store.getState().setFrequency(500e6);
      vi.advanceTimersByTime(LIVE_NETWORK_DELAY_MS);
      // 0.5 x 500 MHz.
      expect(live().data.points[0]?.frequency).toBeCloseTo(250e6, 0);
    } finally {
      stop();
    }
  });
});

describe('a design switch under a live entry', () => {
  it('the live entry follows the new design: name, range and data; id and colour stay', () => {
    vi.useFakeTimers();
    const stop = startLiveNetworkSync();
    try {
      addNetworkToSPlot();
      const { id, color } = live();
      store.getState().loadDesign(example7);
      vi.advanceTimersByTime(LIVE_NETWORK_DELAY_MS);
      const e = live();
      expect(splot.getState().files).toHaveLength(1);
      expect(e.id).toBe(id);
      expect(e.color).toBe(color);
      expect(e.fileName).toBe('Example 7 (network)');
      expect(e.description).toMatch(/^Network of Example 7, ideal values, Z0 50 Ω/);
      // 0.5 x 900 MHz to 2 x 900 MHz.
      expect(e.data.points[0]?.frequency).toBeCloseTo(450e6, 0);
      expect(e.data.points[200]?.frequency).toBeCloseTo(1800e6, 0);
    } finally {
      stop();
    }
  });

  it('a frozen snapshot of the old design is left alone; freezing the new one numbers from 1', () => {
    vi.useFakeTimers();
    const stop = startLiveNetworkSync();
    try {
      addNetworkToSPlot();
      const first = live();
      freezeNetworkEntry(first.id);
      addNetworkToSPlot();
      store.getState().loadDesign(example7);
      vi.advanceTimersByTime(LIVE_NETWORK_DELAY_MS);
      const frozen = splot.getState().files.find((f) => f.id === first.id);
      expect(frozen?.fileName).toBe('Example 5 (network snapshot 1)');
      expect(frozen?.data).toBe(first.data);
      expect(freezeNetworkEntry(live().id)).toMatch(/^Example 7 \(network snapshot 1\) keeps/);
    } finally {
      stop();
    }
  });

  it('a design with a blank name is called Design', () => {
    store.getState().loadDesign({ ...example7, name: '   ' });
    addNetworkToSPlot();
    expect(live().fileName).toBe('Design (network)');
    expect(live().description).toMatch(/^Network of the design, /);
    expect(freezeNetworkEntry(live().id)).toMatch(/^Design \(network snapshot 1\)/);
  });
});

describe('freeze naming', () => {
  it('takes the first free number, filling a gap', () => {
    expect(snapshotName('A (network)', ['A (network snapshot 1)', 'A (network snapshot 3)'])).toBe(
      'A (network snapshot 2)',
    );
  });

  it('a name without " (network)" gets a plain snapshot suffix', () => {
    expect(snapshotName('amp.s2p', [])).toBe('amp.s2p (snapshot 1)');
  });

  it('freeze, add, freeze: snapshot 1 and snapshot 2, the live entry last', () => {
    addNetworkToSPlot();
    freezeNetworkEntry(live().id);
    addNetworkToSPlot();
    freezeNetworkEntry(live().id);
    addNetworkToSPlot();
    expect(splot.getState().files.map((f) => [f.fileName, f.network])).toEqual([
      ['Example 5 (network snapshot 1)', 'frozen'],
      ['Example 5 (network snapshot 2)', 'frozen'],
      ['Example 5 (network)', 'live'],
    ]);
  });

  it('a frozen entry or an unknown id is not frozen again', () => {
    addNetworkToSPlot();
    const { id } = live();
    freezeNetworkEntry(id);
    const files = splot.getState().files;
    expect(freezeNetworkEntry(id)).toBe('');
    expect(freezeNetworkEntry('nope')).toBe('');
    expect(splot.getState().files).toBe(files);
  });
});

describe('the shared export range with a datapoint sweep', () => {
  const sweepOn = { enabled: true, start: 300e6, stop: 600e6, points: 31 };
  const twoUserPoints: Design = {
    ...example5,
    sweep: sweepOn,
    datapoints: [{ frequency: 460e6, z: { re: 25, im: 0 } }],
  };

  it('two user datapoints make a datapoint sweep: 0.5 f to 2 f in 201 points everywhere', () => {
    expect(exportBand(twoUserPoints)).toEqual({ start: 225e6, stop: 900e6, points: 201 });
    expect(designToSpice(twoUserPoints, null)).toContain('.ac lin 201 225000000 900000000');
    expect(designToLtspice(twoUserPoints, null)).toContain('!.ac lin 201 225000000 900000000');
    const s2p = readTouchstone(designToS2p(twoUserPoints, null), 2).points;
    expect(s2p).toHaveLength(201);
    expect(s2p[0]?.frequency).toBeCloseTo(225e6, 0);
    expect(networkSPlotFile(twoUserPoints, DEFAULT_PACKAGES).data.points).toHaveLength(201);
  });

  it('imported loads with the sweep set to frequency: the frequency range everywhere', () => {
    const d: Design = {
      ...example5,
      sweep: {
        ...sweepOn,
        mode: 'frequency',
        loads: [
          { frequency: 400e6, z: { re: 20, im: 0 } },
          { frequency: 500e6, z: { re: 30, im: 0 } },
        ],
      },
    };
    expect(exportBand(d)).toEqual({ start: 300e6, stop: 600e6, points: 31 });
    expect(designToSpice(d, null)).toContain('.ac lin 31 300000000 600000000');
    expect(networkSPlotFile(d, DEFAULT_PACKAGES).data.points).toHaveLength(31);
  });

  it('point counts: 1.4 rounds to 1 and is raised to 2; NaN points or an infinite stop fall back', () => {
    expect(exportBand({ ...example5, sweep: { ...sweepOn, points: 1.4 } }).points).toBe(2);
    expect(exportBand({ ...example5, sweep: { ...sweepOn, points: Number.NaN } })).toEqual({
      start: 225e6,
      stop: 900e6,
      points: 201,
    });
    expect(exportBand({ ...example5, sweep: { ...sweepOn, stop: Infinity } }).stop).toBe(900e6);
    expect(exportBand({ ...example5, sweep: { ...sweepOn, stop: 300e6 } }).points).toBe(201);
  });
});

describe('the network as built with packages on', () => {
  const packaged: Design = {
    ...example5,
    elements: example5.elements.map((el) =>
      el.kind === 'C' ? { ...el, package: '0603' as const } : el,
    ),
  };
  const power = (d: Design): number => {
    const p = networkSPlotFile(d, DEFAULT_PACKAGES).data.points[100];
    const s11 = cabs(p?.s[sIndex(2, 1, 1)] ?? { re: Number.NaN, im: 0 });
    const s21 = cabs(p?.s[sIndex(2, 2, 1)] ?? { re: Number.NaN, im: 0 });
    return s11 * s11 + s21 * s21;
  };

  it('Realize on: realized values and packages, and the package still changes the network', () => {
    const realize = { ...packaged.realize, enabled: true };
    const withPkg = networkSPlotFile({ ...packaged, realize }, DEFAULT_PACKAGES);
    const without = networkSPlotFile({ ...example5, realize }, DEFAULT_PACKAGES);
    expect(withPkg.description).toContain('realized values and packages');
    const a = withPkg.data.points[100]?.s[0];
    const b = without.data.points[100]?.s[0];
    expect(Math.abs((a?.re ?? 0) - (b?.re ?? 0))).toBeGreaterThan(1e-6);
  });

  it('Realize and Losses on: lossy (|S11|^2 + |S21|^2 < 1); off: lossless (= 1)', () => {
    const realize = { ...packaged.realize, enabled: true };
    // Packages carry ESR, so the lossless check runs without them.
    expect(power({ ...example5, realize })).toBeCloseTo(1, 9);
    const lossy = { ...packaged, realize, losses: { ...packaged.losses, enabled: true } };
    expect(power({ ...example5, realize, losses: lossy.losses })).toBeLessThan(0.9999);
    expect(networkSPlotFile(lossy, DEFAULT_PACKAGES).description).toContain(
      'realized values, losses and packages',
    );
  });

  it('the user package table, not the default one, reaches the entry and the .s2p alike', () => {
    const table = DEFAULT_PACKAGES.map((row) => (row.id === '0603' ? { ...row, esl: 5e-9 } : row));
    const entry = networkSPlotFile(packaged, table).data.points[100]?.s[0];
    const dflt = networkSPlotFile(packaged, DEFAULT_PACKAGES).data.points[100]?.s[0];
    const file = readTouchstone(designToS2p(packaged, null, table), 2).points[100]?.s[0];
    expect(Math.abs((entry?.re ?? 0) - (dflt?.re ?? 0))).toBeGreaterThan(1e-6);
    expect(file?.re).toBeCloseTo(entry?.re ?? Number.NaN, 8);
    expect(file?.im).toBeCloseTo(entry?.im ?? Number.NaN, 8);
  });

  // Corrected in the phase 3 QA fixes: the texts now differ by the one comment that says so.
  it('SPICE and LTspice carry no parasitics (user guide section 11): the same network, plus a note', () => {
    const spice = designToSpice(packaged, null).replace(/^\* Component package.*\n/m, '');
    const asc = designToLtspice(packaged, null).replace(/^TEXT .*Component package.*\r\n/m, '');
    expect(spice).toBe(designToSpice(example5, null));
    expect(asc).toBe(designToLtspice(example5, null));
  });
});
