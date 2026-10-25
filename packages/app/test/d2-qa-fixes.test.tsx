// @vitest-environment jsdom
/**
 * D2 QA round, the app side: DP1 follows the design frequency over a measured
 * load, Sweep all says when it moved the design frequency, the usable band
 * stays inside the data, the fit wording, and the Response readout lists the
 * load alone.
 */
import { complex, sweepPoints, type Complex, type SweepLoad } from '@smithonline/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ImportDialog } from '../src/components/ImportDialog';
import { ladderBandwidth } from '../src/lib/bandwidth';
import { emptyDesign, type Design } from '../src/lib/design';
import { ladderOf } from '../src/lib/files';
import { designLoadModel, loadModelText, nearestRow } from '../src/lib/measuredLoad';
import { measuredLoadInfo, pendingMeasuredLoad } from '@smithonline/core';
import { useDesignStore } from '../src/store/useDesignStore';

const w = (f: number): number => 2 * Math.PI * f;
const rlc = (f: number): Complex => complex(20, w(f) * 10e-9 - 1 / (w(f) * 3e-12));
const ROWS: SweepLoad[] = sweepPoints(0.6e9, 1.4e9, 41).map((f) => ({ frequency: f, z: rlc(f) }));

function measured(mode: 'datapoints' | 'frequency' = 'datapoints'): Design {
  return {
    ...emptyDesign(),
    frequency: 1e9,
    load: rlc(1e9),
    elements: [{ kind: 'C', orientation: 'shunt', value: 2e-12, id: 'c1', color: '#1c7ed6' }],
    sweep: {
      enabled: true,
      start: 1e8,
      stop: 3e8,
      points: 101,
      loads: ROWS,
      loadsName: 'rlc.s1p',
      mode,
    },
  };
}

afterEach(cleanup);

describe('DP1 follows the design frequency over a measured load', () => {
  it('a new f moves the load to the row nearest it and says which row', () => {
    useDesignStore.getState().init(measured());
    useDesignStore.getState().setFrequency(1.106e9);
    const d = useDesignStore.getState().design;
    const row = nearestRow(ROWS, 1.106e9)!;
    expect(row.frequency).toBeCloseTo(1.1e9, 0);
    expect(d.frequency).toBe(1.106e9);
    expect(d.load).toEqual(row.z);
    expect(useDesignStore.getState().message).toMatch(/DP1 is the 1\.1 GHz row/);
  });

  it('after Back to frequency sweep the fixed load stays as it is', () => {
    useDesignStore.getState().init(measured('frequency'));
    const before = useDesignStore.getState().design.load;
    useDesignStore.getState().setFrequency(1.106e9);
    expect(useDesignStore.getState().design.load).toEqual(before);
  });
});

describe('Sweep all says when it moved the design frequency', () => {
  it('"Design frequency set to ..., the nominal row"', () => {
    useDesignStore.getState().init({ ...measured('frequency'), sweep: emptyDesign().sweep });
    useDesignStore.getState().setFrequency(1.01e9);
    render(
      <ImportDialog
        file={{ kind: 'rows', fileName: 'rlc.s1p', rows: ROWS, description: 'x', sPlot: false }}
        onClose={() => undefined}
      />,
    );
    expect(screen.getByTestId('import-load-model').textContent).toMatch(/the usable bandwidth/);
    fireEvent.click(screen.getByRole('button', { name: /Sweep all/ }));
    expect(useDesignStore.getState().message).toMatch(
      /Design frequency set to 1 GHz, the nominal row$/,
    );
  });
});

describe('the usable band over a measured load', () => {
  it('is clamped to the measured data, not the 5 % the model is followed past it', () => {
    const d = measured();
    // A wide limit: the band reaches both ends of the data.
    const bw = ladderBandwidth(ladderOf(d), 50, designLoadModel(d))!;
    expect(bw.low).toBeGreaterThanOrEqual(0.6e9 - 1);
    expect(bw.high).toBeLessThanOrEqual(1.4e9 + 1);
    expect(bw.lowOpen || bw.highOpen).toBe(true);
  });
});

describe('the fit wording', () => {
  it('pending, few points and no double colon in the load line', () => {
    const pending = measuredLoadInfo(pendingMeasuredLoad(ROWS, { z0: 50 }))!;
    expect(loadModelText(pending)).toBe(
      'fitting the model, joined by linear interpolation of R and X until it is ready',
    );
    const few = measuredLoadInfo(
      designLoadModel({ ...measured(), sweep: { ...measured().sweep, loads: ROWS.slice(0, 3) } }),
    )!;
    expect(loadModelText(few)).toBe(
      'joined by linear interpolation of R and X; 3 points, a fit needs 6',
    );
    expect(loadModelText(few)).not.toContain(':');
  });
});
