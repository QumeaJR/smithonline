import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cabs,
  cadd,
  cdiv,
  cmul,
  complex,
  csub,
  DEFAULT_PACKAGES,
  sIndex,
  zToGamma,
  type Complex,
  type TouchstonePoint,
} from '@smithonline/core';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { exportFileName, exportTouchstoneText } from '../src/lib/splotActions';
import {
  addNetworkToSPlot,
  freezeNetworkEntry,
  LIVE_NETWORK_DELAY_MS,
  networkBand,
  networkSPlotFile,
  refreshLiveNetwork,
  snapshotName,
  startLiveNetworkSync,
} from '../src/lib/splotNetwork';
import { useDesignStore } from '../src/store/useDesignStore';
import { usePackages } from '../src/store/usePackages';
import { activeEntry, useSPlotStore, type SPlotEntry } from '../src/store/useSPlotStore';

const splot = useSPlotStore;
const store = useDesignStore;

/** A two-element network at 450 MHz, named like the example it comes from. */
const lNetwork: Design = {
  ...emptyDesign(),
  name: 'Example 5',
  frequency: 450e6,
  load: { re: 20, im: -12 },
  elements: identify([
    { kind: 'L', orientation: 'shunt', value: 16.03e-9 },
    { kind: 'C', orientation: 'series', value: 21.84e-12 },
  ]),
};

beforeEach(() => {
  splot.setState({ files: [], activeId: null, selected: null, cursor: null });
  store.getState().init(lNetwork);
  store.setState({ view: 'chart', message: null });
  usePackages.setState({ table: DEFAULT_PACKAGES });
});

afterEach(() => {
  vi.useRealTimers();
});

function s(point: TouchstonePoint | undefined, i: 1 | 2, j: 1 | 2): Complex {
  const v = point?.s[sIndex(2, i, j)];
  if (!v) throw new Error('missing point');
  return v;
}

function liveEntry(): SPlotEntry {
  const e = splot.getState().files.find((f) => f.network === 'live');
  if (!e) throw new Error('no live entry');
  return e;
}

describe('the network as S-parameters', () => {
  it('gives S11 = 1/3 and S21 = 2/3 for a series 50 Ω resistor on 50 Ω', () => {
    const d: Design = {
      ...emptyDesign(),
      frequency: 100e6,
      elements: identify([{ kind: 'R', orientation: 'series', value: 50 }]),
    };
    const file = networkSPlotFile(d, DEFAULT_PACKAGES);
    expect(file.data.ports).toBe(2);
    expect(file.data.z0).toBe(50);
    for (const p of [file.data.points[0], file.data.points[100]]) {
      expect(s(p, 1, 1).re).toBeCloseTo(1 / 3, 8);
      expect(s(p, 1, 1).im).toBeCloseTo(0, 8);
      expect(s(p, 2, 1).re).toBeCloseTo(2 / 3, 8);
      expect(s(p, 1, 2).re).toBeCloseTo(2 / 3, 8);
      expect(s(p, 2, 2).re).toBeCloseTo(1 / 3, 8);
    }
  });

  it('matches a lossless L-network at its design frequency when port 2 sees the load', () => {
    // 10 Ω to 50 Ω at 100 MHz, Q = 2: series L of 20 Ω at the load, shunt C of 0.04 S.
    const w = 2 * Math.PI * 100e6;
    const d: Design = {
      ...emptyDesign(),
      frequency: 100e6,
      load: { re: 10, im: 0 },
      elements: identify([
        { kind: 'L', orientation: 'series', value: 20 / w },
        { kind: 'C', orientation: 'shunt', value: 0.04 / w },
      ]),
      sweep: { enabled: true, start: 50e6, stop: 150e6, points: 11 },
    };
    const file = networkSPlotFile(d, DEFAULT_PACKAGES);
    const gammaIn = (p: TouchstonePoint | undefined): Complex => {
      const gl = zToGamma(d.load, d.z0);
      const loop = cdiv(
        cmul(cmul(s(p, 1, 2), s(p, 2, 1)), gl),
        csub(complex(1), cmul(s(p, 2, 2), gl)),
      );
      return cadd(s(p, 1, 1), loop);
    };
    const atF = file.data.points[5];
    expect(atF?.frequency).toBeCloseTo(100e6, 0);
    expect(cabs(gammaIn(atF))).toBeLessThan(1e-6);
    // Lossless: |S11|² + |S21|² = 1.
    expect(cabs(s(atF, 1, 1)) ** 2 + cabs(s(atF, 2, 1)) ** 2).toBeCloseTo(1, 6);
    // Away from f the match is gone.
    expect(cabs(gammaIn(file.data.points[0]))).toBeGreaterThan(0.05);
  });

  it('uses the realized values when Realize is on and the packages when parts name one', () => {
    const ideal = networkSPlotFile(lNetwork, DEFAULT_PACKAGES);
    const realized = networkSPlotFile(
      { ...lNetwork, realize: { ...lNetwork.realize, enabled: true, series: 'E6' } },
      DEFAULT_PACKAGES,
    );
    const packaged = networkSPlotFile(
      {
        ...lNetwork,
        elements: lNetwork.elements.map((el) =>
          el.kind === 'C' ? { ...el, package: '0603' as const } : el,
        ),
      },
      DEFAULT_PACKAGES,
    );
    const s11 = (f: typeof ideal): number => cabs(s(f.data.points[60], 1, 1));
    expect(s11(realized)).not.toBeCloseTo(s11(ideal), 4);
    expect(s11(packaged)).not.toBeCloseTo(s11(ideal), 4);
    expect(realized.description).toContain('realized values');
    expect(packaged.description).toContain('packages');
    expect(ideal.description).toContain('ideal values');
  });
});

describe('the frequency range', () => {
  it('is half to twice f in 201 points without a sweep', () => {
    expect(networkBand(lNetwork)).toEqual({ start: 225e6, stop: 900e6, points: 201 });
    const file = networkSPlotFile(lNetwork, DEFAULT_PACKAGES);
    expect(file.data.points).toHaveLength(201);
    expect(file.data.points[0]?.frequency).toBeCloseTo(225e6, 0);
    expect(file.data.points[200]?.frequency).toBeCloseTo(900e6, 0);
  });

  it('is the sweep range when a frequency sweep is on', () => {
    const on = { ...lNetwork, sweep: { enabled: true, start: 900e6, stop: 100e6, points: 31 } };
    expect(networkBand(on)).toEqual({ start: 100e6, stop: 900e6, points: 31 });
    // A sweep that is set up but off does not count.
    expect(networkBand({ ...on, sweep: { ...on.sweep, enabled: false } }).points).toBe(201);
    // A measured load gives the band of its rows; an unusable range does not count.
    const datapoints = {
      ...on,
      sweep: {
        ...on.sweep,
        loads: [
          { frequency: 1e8, z: complex(10, 0) },
          { frequency: 2e8, z: complex(20, 0) },
        ],
      },
    };
    expect(networkBand(datapoints)).toEqual({ start: 1e8, stop: 2e8, points: 201 });
    expect(networkBand({ ...on, sweep: { ...on.sweep, start: 0 } }).start).toBe(225e6);
    expect(networkBand({ ...on, sweep: { ...on.sweep, points: 1e6 } }).points).toBe(2001);
  });
});

describe('adding the network to S-Plot', () => {
  it('adds an entry named after the design and switches to the S-Plot view', () => {
    const message = addNetworkToSPlot();
    expect(message).toBe('Added Example 5 (network) to S-Plot: 201 points, 225 MHz to 900 MHz');
    expect(store.getState().view).toBe('splot');
    const entry = activeEntry(splot.getState());
    expect(entry?.fileName).toBe('Example 5 (network)');
    expect(entry?.network).toBe('live');
    expect(entry?.data.ports).toBe(2);
  });

  it('replaces the live entry instead of adding a duplicate', () => {
    addNetworkToSPlot();
    const first = liveEntry();
    store.getState().setFrequency(500e6);
    expect(addNetworkToSPlot()).toMatch(/^Updated Example 5 \(network\) in S-Plot: 201 points/);
    const files = splot.getState().files;
    expect(files).toHaveLength(1);
    expect(files[0]?.id).toBe(first.id);
    expect(files[0]?.color).toBe(first.color);
    expect(files[0]?.data.points[0]?.frequency).toBeCloseTo(250e6, 0);
  });

  it('adds a new live entry next to a frozen snapshot', () => {
    addNetworkToSPlot();
    const id = liveEntry().id;
    freezeNetworkEntry(id);
    addNetworkToSPlot();
    const files = splot.getState().files;
    expect(files.map((f) => f.network)).toEqual(['frozen', 'live']);
    expect(files.map((f) => f.fileName)).toEqual([
      'Example 5 (network snapshot 1)',
      'Example 5 (network)',
    ]);
    expect(files[0]?.color).not.toBe(files[1]?.color);
  });

  it('exports like any other file', () => {
    addNetworkToSPlot();
    const entry = liveEntry();
    const choice = { parameter: 'S', normalized: true, format: 'RI', unit: 'MHZ' } as const;
    expect(exportFileName(entry, choice)).toBe('Example_5_network.s2p');
    expect(exportFileName({ ...entry, fileName: 'Rev 1.2 (network)' }, choice)).toBe(
      'Rev_1.2_network.s2p',
    );
    expect(exportTouchstoneText(entry, choice)).toMatch(/# MHZ S RI R 50/i);
  });

  it('numbers snapshots so their names stay apart', () => {
    expect(snapshotName('A (network)', [])).toBe('A (network snapshot 1)');
    expect(snapshotName('A (network)', ['A (network snapshot 1)'])).toBe('A (network snapshot 2)');
  });
});

describe('the live entry', () => {
  it('follows the design after the debounce delay', () => {
    vi.useFakeTimers();
    const stop = startLiveNetworkSync();
    try {
      addNetworkToSPlot();
      const before = liveEntry().data;
      store.getState().setFrequency(300e6);
      vi.advanceTimersByTime(LIVE_NETWORK_DELAY_MS - 1);
      expect(liveEntry().data).toBe(before);
      vi.advanceTimersByTime(1);
      expect(liveEntry().data.points[0]?.frequency).toBeCloseTo(150e6, 0);
      expect(splot.getState().files).toHaveLength(1);
    } finally {
      stop();
    }
  });

  it('follows the package table', () => {
    vi.useFakeTimers();
    store.getState().setPackage(1, '0603');
    const stop = startLiveNetworkSync();
    try {
      addNetworkToSPlot();
      const before = liveEntry().data;
      usePackages.getState().setRow('0603', { esl: 5e-9 });
      vi.advanceTimersByTime(LIVE_NETWORK_DELAY_MS);
      expect(liveEntry().data).not.toBe(before);
    } finally {
      stop();
    }
  });

  it('stays as it is once frozen', () => {
    vi.useFakeTimers();
    const stop = startLiveNetworkSync();
    try {
      addNetworkToSPlot();
      const { id, data } = liveEntry();
      expect(freezeNetworkEntry(id)).toContain('Example 5 (network snapshot 1)');
      store.getState().setFrequency(300e6);
      vi.advanceTimersByTime(LIVE_NETWORK_DELAY_MS * 2);
      const frozen = splot.getState().files.find((f) => f.id === id);
      expect(frozen?.network).toBe('frozen');
      expect(frozen?.data).toBe(data);
      expect(refreshLiveNetwork()).toBe(false);
    } finally {
      stop();
    }
  });

  // Phase 3 QA fixes: the row nearest the selected frequency is kept, not the row index.
  it('keeps the selected frequency (the nearest row) and the active file on a refresh', () => {
    addNetworkToSPlot();
    const live = liveEntry();
    splot.getState().select(10);
    const picked = liveEntry().data.points[10]!.frequency;
    store.getState().setFrequency(460e6);
    expect(refreshLiveNetwork()).toBe(true);
    const points = liveEntry().data.points;
    const sel = splot.getState().selected;
    expect(sel).not.toBeNull();
    const nearest = points.reduce(
      (best, p, i) =>
        Math.abs(p.frequency - picked) < Math.abs(points[best]!.frequency - picked) ? i : best,
      0,
    );
    expect(sel).toBe(nearest);
    expect(splot.getState().activeId).toBe(live.id);
  });

  it('clears the selected row when no row of the new data lies within half a step of it', () => {
    addNetworkToSPlot();
    splot.getState().select(0);
    // The band moves far up: nothing near the old first frequency is left.
    store.getState().setFrequency(4.5e9);
    expect(refreshLiveNetwork()).toBe(true);
    expect(splot.getState().selected).toBeNull();
  });

  it('stops after the subscription ends', () => {
    vi.useFakeTimers();
    const stop = startLiveNetworkSync();
    addNetworkToSPlot();
    const before = liveEntry().data;
    store.getState().setFrequency(300e6);
    stop();
    vi.advanceTimersByTime(LIVE_NETWORK_DELAY_MS * 2);
    expect(liveEntry().data).toBe(before);
  });
});
