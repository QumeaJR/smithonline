// @vitest-environment jsdom
/**
 * QA round on depth phase D2: every band tool judges the design against the
 * same load. The user guide: "Back to frequency sweep keeps the rows but
 * returns the band tools to the fixed load"; a datapoint sweep makes the rows
 * the load of every band tool. it.fails marks a finding.
 */
import { complex, lMatch, sweepPoints, type Complex, type SweepLoad } from '@smithonline/core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/** The last request the Broadband panel sent to its worker. */
const sent: { load?: unknown; frequencies?: number[] | undefined } = {};

vi.mock('../src/lib/broadband', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  startBroadband: (req: { load: unknown; frequencies: number[] }) => {
    sent.load = req.load;
    sent.frequencies = req.frequencies;
    return { result: new Promise(() => undefined), cancel: () => undefined };
  },
}));

import { BroadbandMatch } from '../src/components/BroadbandMatch';
import { ladderBandwidth } from '../src/lib/bandwidth';
import { emptyDesign, targetOf, type Design } from '../src/lib/design';
import { ladderOf } from '../src/lib/files';
import { designBand, designLoadModel } from '../src/lib/measuredLoad';
import { bandwidthText, hz } from '../src/lib/tourKit';
import { useDesignStore } from '../src/store/useDesignStore';
import { designVswrLimit } from '../src/lib/tolerance';

const w = (f: number): number => 2 * Math.PI * f;
/** Series RLC: 20 ohm, 10 nH, 3 pF. */
const rlc = (f: number): Complex => complex(20, w(f) * 10e-9 - 1 / (w(f) * 3e-12));
const ROWS: SweepLoad[] = sweepPoints(0.6e9, 1.4e9, 41).map((f) => ({ frequency: f, z: rlc(f) }));

function design(mode: 'datapoints' | 'frequency'): Design {
  return {
    ...emptyDesign(),
    frequency: 1e9,
    load: rlc(1e9),
    // An L-network that matches the load exactly at 1 GHz.
    elements: (lMatch(rlc(1e9), complex(50, 0), 1e9)[0]?.elements ?? []).map((el, i) => ({
      ...el,
      id: `e${i}`,
      color: '#1c7ed6',
    })),
    sweep: {
      enabled: true,
      start: 0.8e9,
      stop: 1.2e9,
      points: 41,
      loads: ROWS,
      loadsName: 'rlc.s1p',
      mode,
    },
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
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});
beforeEach(() => {
  sent.load = undefined;
  sent.frequencies = undefined;
});
afterEach(cleanup);

function runBroadband(d: Design): void {
  useDesignStore.getState().init(d);
  render(
    <BroadbandMatch
      elements={d.elements}
      target={targetOf(d)}
      onPreview={() => undefined}
      onClose={() => undefined}
    />,
  );
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
  });
}

describe('Broadband judges the same load as the other band tools', () => {
  it('datapoint sweep: the rows over the measured band, as Optimize band uses', () => {
    const d = design('datapoints');
    runBroadband(d);
    expect(sent.load).toBe(ROWS);
    expect(sent.frequencies![0]).toBe(designBand(d).start);
    expect(sent.frequencies![sent.frequencies!.length - 1]).toBe(designBand(d).stop);
  });

  // Back to frequency sweep: Optimize band, Tolerance, the usable bandwidth and the Response view
  // use the fixed load (designLoadModel). Finding (fixed): Broadband still sent the rows (its
  // checkbox defaulted on); it now follows designLoadModel.
  it('frequency sweep with rows kept: the fixed load, as every other band tool', () => {
    const d = design('frequency');
    expect(designLoadModel(d)).toBe(d.load);
    runBroadband(d);
    expect(sent.load).toEqual(d.load);
  });
});

describe('the tours read the usable band from the same load as the readout', () => {
  // Finding (fixed): bandwidthText (tourKit) called ladderBandwidth without a load (the fixed
  // load), while the Numbers readout and the Response view pass designLoadModel. Over a datapoint
  // sweep the two differ (the measured load also ends the band at the data).
  it('bandwidthText over a measured load quotes the readout band', () => {
    const d = design('datapoints');
    useDesignStore.getState().init(d);
    const limit = designVswrLimit(useDesignStore.getState().design);
    const readout = ladderBandwidth(ladderOf(d), limit, designLoadModel(d));
    const fixed = ladderBandwidth(ladderOf(d), limit);
    // Premise: the two loads give different bands for this design.
    expect(readout).not.toEqual(fixed);
    expect(readout).not.toBeNull();
    expect(bandwidthText(d)).toContain(`${hz(readout!.low)} to ${hz(readout!.high)}`);
  });
});
