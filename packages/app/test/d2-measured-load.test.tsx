// @vitest-environment jsdom
/**
 * D2, the measured load first: the app's load model for an imported datapoint
 * sweep (fitted from six points, linear interpolation otherwise), the band
 * the band tools then work over, the usable band inside the data, and the
 * fit quality in the Import dialog, the Numbers panel and Optimize band.
 */
import {
  complex,
  evaluateLadder,
  measuredLoadInfo,
  sweepPoints,
  zToGamma,
  type Complex,
  type SweepLoad,
} from '@smithonline/core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BandOptimizer } from '../src/components/BandOptimizer';
import { ImportDialog } from '../src/components/ImportDialog';
import { RightPanel } from '../src/components/RightPanel';
import { ladderBandwidth } from '../src/lib/bandwidth';
import { emptyDesign, type Design } from '../src/lib/design';
import { ladderOf } from '../src/lib/files';
import {
  beyondDataText,
  designBand,
  designLoadModel,
  hasMeasuredLoad,
  loadModelText,
  sortedMeasured,
} from '../src/lib/measuredLoad';
import { bandFrequencies } from '../src/lib/tolerance';
import { useDesignStore } from '../src/store/useDesignStore';

const w = (f: number): number => 2 * Math.PI * f;
/** A series RLC load: 20 ohm, 10 nH, 3 pF (resonant near 919 MHz). */
const rlc = (f: number): Complex => complex(20, w(f) * 10e-9 - 1 / (w(f) * 3e-12));
const rows = (n: number, lo = 0.5e9, hi = 1.5e9): SweepLoad[] =>
  sweepPoints(lo, hi, n).map((f) => ({ frequency: f, z: rlc(f) }));

/** Rows with noise of `amplitude` in Gamma (deterministic). */
function noisy(n: number, amplitude: number): SweepLoad[] {
  let s = 9;
  const rnd = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647 - 0.5;
  };
  return rows(n).map((r) => {
    const g = zToGamma(r.z, 50);
    const gr = g.re + amplitude * rnd();
    const gi = g.im + amplitude * rnd();
    const d = (1 - gr) ** 2 + gi ** 2;
    return {
      frequency: r.frequency,
      z: complex((50 * (1 - gr * gr - gi * gi)) / d, (50 * 2 * gi) / d),
    };
  });
}

function withLoads(loads: SweepLoad[], extra: Partial<Design> = {}): Design {
  const base = emptyDesign();
  const start = loads[Math.floor(loads.length / 2)] as SweepLoad;
  return {
    ...base,
    frequency: start.frequency,
    load: start.z,
    elements: [
      { kind: 'C', orientation: 'shunt', value: 2e-12, id: 'c1', color: '#1c7ed6' },
      { kind: 'L', orientation: 'series', value: 4e-9, id: 'l1', color: '#d6336c' },
    ],
    sweep: {
      enabled: true,
      start: 1e8,
      stop: 3e8,
      points: 101,
      loads,
      loadsName: 'rlc.s1p',
      mode: 'datapoints',
    },
    ...extra,
  };
}

beforeAll(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  }));
});
beforeEach(() => useDesignStore.getState().init(emptyDesign()));
afterEach(cleanup);

describe('the load model of a design', () => {
  it('a datapoint sweep of six or more imported points is the fitted model', () => {
    const d = withLoads(rows(21));
    expect(hasMeasuredLoad(d)).toBe(true);
    const load = designLoadModel(d);
    const info = measuredLoadInfo(load)!;
    expect(info.mode).toBe('fitted');
    // Between the rows the model is the load itself.
    const f = 0.913e9;
    const z = (load as (f: number) => Complex)(f);
    expect(Math.hypot(z.re - rlc(f).re, z.im - rlc(f).im)).toBeLessThan(1e-6);
    expect(loadModelText(info)).toMatch(/^fitted, order 2, max residual below 0\.0001 in Γ$/);
  });

  it('Back to frequency sweep returns to the fixed load', () => {
    const d = withLoads(rows(21));
    const back: Design = { ...d, sweep: { ...d.sweep, mode: 'frequency' } };
    expect(hasMeasuredLoad(back)).toBe(false);
    expect(designLoadModel(back)).toBe(back.load);
    expect(designBand(back)).toEqual({ start: 1e8, stop: 3e8, measured: false });
  });

  it('five points: linear interpolation, and the words say why', () => {
    const info = measuredLoadInfo(designLoadModel(withLoads(rows(5))))!;
    expect(info.mode).toBe('linear');
    expect(loadModelText(info)).toBe('linear interpolation: 5 points (a fit needs 6)');
  });

  it('a fit off by more than 0.01 in Γ falls back and says the residual', () => {
    const info = measuredLoadInfo(designLoadModel(withLoads(noisy(41, 0.1))))!;
    expect(info.reason).toBe('residual');
    expect(loadModelText(info)).toMatch(
      /^linear interpolation: the fit's residual was 0\.\d+ in Γ \(above 0\.01\)$/,
    );
  });

  it('the band tools work over the measured band, and Tolerance over the band too', () => {
    const d = withLoads(rows(21, 0.6e9, 1.4e9));
    expect(designBand(d)).toEqual({ start: 0.6e9, stop: 1.4e9, measured: true });
    const band = bandFrequencies(d);
    expect(band[0]).toBe(0.6e9);
    expect(band[band.length - 1]).toBe(1.4e9);
  });

  it('flags a band that reaches past the data', () => {
    const info = measuredLoadInfo(designLoadModel(withLoads(rows(21))))!;
    expect(beyondDataText(info, 0.5e9, 1.5e9)).toBeNull();
    expect(beyondDataText(info, 0.4e9, 1.5e9)).toMatch(
      /^The band reaches below the measured 500 MHz to 1.5 GHz: the fitted model is followed 5 % past the data and held at its value there\.$/,
    );
    expect(beyondDataText(info, 0.4e9, 2e9)).toMatch(/past both ends of the measured/);
  });

  it('the measured points in frequency order, a repeated frequency once', () => {
    const r = rows(6);
    const d = withLoads([r[3]!, r[0]!, r[0]!, r[5]!, r[1]!, r[2]!, r[4]!]);
    expect(sortedMeasured(d.sweep)!.map((p) => p.frequency)).toEqual(r.map((p) => p.frequency));
  });
});

describe('usable bandwidth over a measured load', () => {
  it('reads the load per frequency and stays inside the data', () => {
    const d = withLoads(rows(41));
    const ladder = ladderOf(d);
    const load = designLoadModel(d);
    const fixed = ladderBandwidth(ladder, 50);
    const measured = ladderBandwidth(ladder, 50, load)!;
    expect(measured).not.toBeNull();
    // The fixed load sees the whole default range; the measured one ends at the data (+ 5 %).
    expect(fixed!.high).toBeGreaterThan(1.6e9);
    expect(measured.low).toBeGreaterThanOrEqual(0.475e9 - 1);
    expect(measured.high).toBeLessThanOrEqual(1.575e9 + 1);
  });

  it('no band when the design frequency lies outside the data', () => {
    const d = withLoads(rows(41));
    expect(ladderBandwidth({ ...ladderOf(d), frequency: 3e9 }, 2, designLoadModel(d))).toBeNull();
  });
});

describe('the fit quality in the UI', () => {
  it('the Import dialog says how the rows would be modelled', () => {
    render(
      <ImportDialog
        file={{
          kind: 'rows',
          fileName: 'rlc.s1p',
          rows: rows(41),
          description: 'Touchstone 1-port',
          sPlot: false,
        }}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByTestId('import-load-model').textContent).toMatch(
      /the 41 rows are fitted, order 2, max residual below 0\.0001 in Γ \(Γ at Z0 50 Ω\)/,
    );
  });

  it('the Import dialog with four rows says linear interpolation', () => {
    render(
      <ImportDialog
        file={{ kind: 'rows', fileName: 'few.s1p', rows: rows(4), description: 'x', sPlot: false }}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByTestId('import-load-model').textContent).toMatch(
      /linear interpolation: 4 points \(a fit needs 6\)/,
    );
  });

  it('the Numbers panel shows the load model of the datapoint sweep and the chart switch', () => {
    useDesignStore.getState().init(withLoads(noisy(81, 1e-3)));
    const d = useDesignStore.getState().design;
    render(<RightPanel result={evaluateLadder(ladderOf(d))} sweep={null} realized={null} />);
    const line = screen.getByTestId('load-model').textContent ?? '';
    expect(line).toMatch(/Load model: fitted, order \d+, max residual 0\.00\d+ in Γ/);
    expect(line).toMatch(/followed 5 % past the data/);
    expect(screen.getByText('Show the measured load on the chart')).toBeTruthy();
  });

  it('Optimize band names the measured load, its band and the floor from the fitted model', () => {
    useDesignStore.getState().init(withLoads(rows(41, 0.6e9, 1.4e9)));
    render(<BandOptimizer />);
    expect(screen.getByText(/the measured band of the datapoint sweep/)).toBeTruthy();
    expect(
      screen.getByText(
        /^Load: the 41 measured points of rlc\.s1p, 600 MHz to 1\.4 GHz, fitted, order 2/,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/from the fitted model/)).toBeTruthy();
  });
});
