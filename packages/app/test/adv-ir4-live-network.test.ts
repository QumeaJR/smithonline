/** Adversarial: the live S-Plot network entry, freeze, snapshots and the shared export band. */
import { DEFAULT_PACKAGES } from '@smithonline/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { designToLtspice, designToS2p, designToSpice, exportBand } from '../src/lib/simexport';
import {
  addNetworkToSPlot,
  freezeNetworkEntry,
  LIVE_NETWORK_DELAY_MS,
  networkSPlotFile,
  snapshotName,
  startLiveNetworkSync,
} from '../src/lib/splotNetwork';
import { useDesignStore } from '../src/store/useDesignStore';
import { usePackages } from '../src/store/usePackages';
import { useSPlotStore } from '../src/store/useSPlotStore';

const splot = useSPlotStore;
const store = useDesignStore;
const base: Design = {
  ...emptyDesign(),
  name: 'Example 5',
  frequency: 450e6,
  load: { re: 20, im: -12 },
  elements: identify([
    { kind: 'L', orientation: 'shunt', value: 16.03e-9 },
    { kind: 'C', orientation: 'series', value: 21.84e-12 },
  ]),
};
const live = () => splot.getState().files.find((f) => f.network === 'live');

beforeEach(() => {
  splot.setState({ files: [], activeId: null, selected: null, cursor: null });
  store.getState().init(base);
  store.setState({ view: 'chart', message: null });
  usePackages.setState({ table: DEFAULT_PACKAGES });
});
afterEach(() => vi.useRealTimers());

describe('live entry races', () => {
  it('freeze during the debounce: the snapshot keeps the old curves and no live entry appears', () => {
    vi.useFakeTimers();
    const stop = startLiveNetworkSync();
    try {
      addNetworkToSPlot();
      const { id, data } = live()!;
      store.getState().setFrequency(300e6);
      freezeNetworkEntry(id);
      vi.advanceTimersByTime(LIVE_NETWORK_DELAY_MS * 3);
      const f = splot.getState().files;
      expect(f).toHaveLength(1);
      expect(f[0]?.data).toBe(data);
      expect(f[0]?.network).toBe('frozen');
    } finally {
      stop();
    }
  });

  it('remove the live entry during the debounce, add again: the new one is current', () => {
    vi.useFakeTimers();
    const stop = startLiveNetworkSync();
    try {
      addNetworkToSPlot();
      store.getState().setFrequency(300e6);
      splot.getState().removeFile(live()!.id);
      addNetworkToSPlot();
      vi.advanceTimersByTime(LIVE_NETWORK_DELAY_MS * 3);
      expect(live()!.data.points[0]?.frequency).toBeCloseTo(150e6, 0);
      expect(splot.getState().files).toHaveLength(1);
    } finally {
      stop();
    }
  });

  it('stop() with a refresh pending: nothing changes afterwards', () => {
    vi.useFakeTimers();
    const stop = startLiveNetworkSync();
    addNetworkToSPlot();
    const before = live()!.data;
    store.getState().setFrequency(300e6);
    stop();
    vi.advanceTimersByTime(LIVE_NETWORK_DELAY_MS * 3);
    expect(live()!.data).toBe(before);
  });

  it('Realize toggled during the debounce: the refresh uses the toggled state', () => {
    vi.useFakeTimers();
    const stop = startLiveNetworkSync();
    try {
      addNetworkToSPlot();
      store.getState().setFrequency(300e6);
      const d = store.getState().design;
      store
        .getState()
        .update((x) => ({ ...x, realize: { ...x.realize, enabled: !d.realize.enabled } }));
      vi.advanceTimersByTime(LIVE_NETWORK_DELAY_MS);
      expect(live()!.description).toContain(d.realize.enabled ? 'ideal' : 'realized');
    } finally {
      stop();
    }
  });

  it('a part value made non-finite: the live entry must not hold NaN data', () => {
    vi.useFakeTimers();
    const stop = startLiveNetworkSync();
    try {
      addNetworkToSPlot();
      const before = live()!.data;
      const el = store.getState().design.elements[1]!;
      store.getState().updateElement(1, { ...el, value: Number.NaN } as never);
      const accepted = Number.isNaN(
        (store.getState().design.elements[1] as unknown as { value: number }).value,
      );
      vi.advanceTimersByTime(LIVE_NETWORK_DELAY_MS);
      const now = live()!.data;
      const nan = now.points.some((p) =>
        p.s.some((c) => !Number.isFinite(c.re) || !Number.isFinite(c.im)),
      );
      console.log(
        'NaN part accepted by store:',
        accepted,
        '| live data changed:',
        now !== before,
        '| NaN in live data:',
        nan,
      );
      expect(nan).toBe(false);
    } finally {
      stop();
    }
  });
});

describe('selected gain table row across a refresh', () => {
  // Corrected in the phase 3 QA fixes: the row nearest the picked frequency is kept when it lies
  // within half a step of it (the new grid need not hold the exact frequency), else none.
  it('a refresh that moves the frequencies keeps the nearest frequency, not the row index', () => {
    vi.useFakeTimers();
    const stop = startLiveNetworkSync();
    try {
      addNetworkToSPlot();
      splot.getState().select(100);
      const picked = live()!.data.points[100]!.frequency;
      store.getState().setFrequency(300e6);
      vi.advanceTimersByTime(LIVE_NETWORK_DELAY_MS);
      const sel = splot.getState().selected;
      const points = live()!.data.points;
      const now = sel === null ? null : points[sel]!.frequency;
      console.log('picked', picked, 'Hz; after the refresh the selected row is', now, 'Hz');
      expect(sel).not.toBe(100);
      if (sel !== null && now !== null) {
        const step = Math.abs((points[sel + 1] ?? points[sel - 1])!.frequency - now);
        expect(Math.abs(now - picked)).toBeLessThanOrEqual(step / 2);
        for (const p of points) {
          expect(Math.abs(p.frequency - picked)).toBeGreaterThanOrEqual(Math.abs(now - picked));
        }
      }
    } finally {
      stop();
    }
  });
});

describe('a 2001-point sweep', () => {
  it('one refresh stays under 100 ms', () => {
    const d: Design = {
      ...base,
      sweep: { ...base.sweep, enabled: true, start: 100e6, stop: 1e9, points: 2001 },
      elements: identify(
        Array.from({ length: 8 }, (_, i) =>
          i % 2
            ? {
                kind: 'C' as const,
                orientation: 'series' as const,
                value: 10e-12,
                package: '0603' as const,
              }
            : {
                kind: 'L' as const,
                orientation: 'shunt' as const,
                value: 10e-9,
                package: '0603' as const,
              },
        ),
      ),
    };
    networkSPlotFile(d, DEFAULT_PACKAGES);
    const t0 = performance.now();
    const file = networkSPlotFile(d, DEFAULT_PACKAGES);
    const ms = performance.now() - t0;
    console.log('2001 points, 8 packaged parts:', ms.toFixed(1), 'ms');
    expect(file.data.points).toHaveLength(2001);
    expect(ms).toBeLessThan(100);
  });
});

describe('snapshot names', () => {
  it('300 freezes give 300 distinct names', () => {
    for (let i = 0; i < 300; i++) {
      addNetworkToSPlot();
      freezeNetworkEntry(live()!.id);
    }
    const names = splot.getState().files.map((f) => f.fileName);
    expect(new Set(names).size).toBe(300);
  });

  it('a loaded file that already has the snapshot name is skipped', () => {
    expect(snapshotName('A (network)', ['A (network snapshot 1)'])).toBe('A (network snapshot 2)');
  });
});

describe('export band, degenerate sweeps', () => {
  const sweep = (patch: Partial<Design['sweep']>): Design => ({
    ...base,
    sweep: { ...base.sweep, enabled: true, start: 100e6, stop: 1e9, points: 101, ...patch },
  });
  const cases: [string, Partial<Design['sweep']>][] = [
    ['start = stop', { start: 500e6, stop: 500e6 }],
    ['start > stop', { start: 1e9, stop: 100e6 }],
    ['zero points', { points: 0 }],
    ['one point', { points: 1 }],
    ['NaN points', { points: Number.NaN }],
    ['huge points', { points: 1e9 }],
    ['negative start', { start: -1e6 }],
    ['zero start', { start: 0 }],
  ];
  for (const [name, patch] of cases) {
    it(`${name}: s2p rows match the band and nothing is non-finite`, () => {
      const d = sweep(patch);
      const band = exportBand(d);
      const s2p = designToS2p(d, null);
      const cir = designToSpice(d, null);
      const asc = designToLtspice(d, null);
      const rows = s2p.split('\n').filter((l) => /^[0-9]/.test(l));
      expect(rows.length).toBe(band.points);
      for (const t of [s2p, cir, asc]) expect(t).not.toMatch(/NaN|Infinity/);
      expect(band.start).toBeGreaterThan(0);
      expect(band.stop).toBeGreaterThan(band.start);
    });
  }

  it('datapoint mode with zero loads keeps the frequency sweep for the export', () => {
    const d = sweep({ mode: 'datapoints', loads: [] } as never);
    expect(exportBand(d)).toMatchObject({ start: 100e6, stop: 1e9, points: 101 });
  });
});
