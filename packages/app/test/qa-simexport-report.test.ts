/**
 * QA round 1: export band selection, the report selection store and the
 * datapoint table labels with several user datapoints.
 */
import { complex, evaluateLadder } from '@smithonline/core';
import { afterEach, describe, expect, it } from 'vitest';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { datapointTable, tableText } from '../src/lib/report';
import { ALL_PARTS, readReportSelection, storeReportSelection } from '../src/lib/reportParts';
import { designToS2p, designToSpice, exportBand } from '../src/lib/simexport';

// Phase 3 of the redesign: one range for the .s2p export and the S-Plot network entry, the
// sweep when a frequency sweep is on, else 0.5 f to 2 f (it was 0.5 f to 1.5 f, and the sweep
// range whether or not the sweep was on).
const base: Design = {
  ...emptyDesign(),
  frequency: 1e9,
  sweep: { ...emptyDesign().sweep, enabled: true },
};

describe('exportBand', () => {
  it('falls back to 0.5 f .. 2 f with 201 points for start = stop, negative or zero start', () => {
    const fallback = { start: 0.5e9, stop: 2e9, points: 201 };
    expect(exportBand({ ...base, sweep: { ...base.sweep, start: 2e9, stop: 2e9 } })).toEqual(
      fallback,
    );
    expect(exportBand({ ...base, sweep: { ...base.sweep, start: -1, stop: 2e9 } })).toEqual(
      fallback,
    );
    expect(exportBand({ ...base, sweep: { ...base.sweep, start: 0, stop: 2e9 } })).toEqual(
      fallback,
    );
    expect(exportBand({ ...base, sweep: { ...base.sweep, start: NaN, stop: 2e9 } })).toEqual(
      fallback,
    );
  });

  it('swaps a reversed range and clamps the points to 2..2001, rounding', () => {
    expect(
      exportBand({ ...base, sweep: { ...base.sweep, start: 3e9, stop: 1e9, points: 1 } }),
    ).toEqual({ start: 1e9, stop: 3e9, points: 2 });
    expect(
      exportBand({ ...base, sweep: { ...base.sweep, start: 1e9, stop: 3e9, points: 5000 } }),
    ).toEqual({ start: 1e9, stop: 3e9, points: 2001 });
    expect(
      exportBand({ ...base, sweep: { ...base.sweep, start: 1e9, stop: 3e9, points: 10.6 } }),
    ).toEqual({ start: 1e9, stop: 3e9, points: 11 });
  });

  it('the exports use the sweep range only while the sweep is on', () => {
    const d: Design = {
      ...base,
      elements: identify([{ kind: 'L', orientation: 'series', value: 1e-9 }]),
      sweep: { ...base.sweep, enabled: true, start: 1e9, stop: 2e9, points: 3 },
    };
    expect(designToSpice(d, null)).toContain('.ac lin 3 1000000000 2000000000');
    const s2p = designToS2p(d, null)
      .split('\n')
      .filter((l) => /^\d/.test(l));
    expect(s2p.map((l) => l.split(' ')[0])).toEqual(['1000', '1500', '2000']);
    const off: Design = { ...d, sweep: { ...d.sweep, enabled: false } };
    expect(designToSpice(off, null)).toContain('.ac lin 201 500000000 2000000000');
  });
});

describe('report selection', () => {
  const g = globalThis as { localStorage?: unknown };
  const original = g.localStorage;
  afterEach(() => {
    if (original === undefined) delete g.localStorage;
    else g.localStorage = original;
  });

  it('a partial stored selection keeps the untouched parts on; garbage and null give everything', () => {
    let stored: string | null = '{"chart":false,"circles":false}';
    g.localStorage = {
      getItem: () => stored,
      setItem: (_k: string, v: string) => {
        stored = v;
      },
    };
    expect(readReportSelection()).toEqual({
      chart: false,
      schematic: true,
      datapoints: true,
      circles: false,
    });
    stored = 'garbage';
    expect(readReportSelection()).toEqual(ALL_PARTS);
    stored = 'null';
    expect(readReportSelection()).toEqual(ALL_PARTS);
    stored = '"text"';
    expect(readReportSelection()).toEqual(ALL_PARTS);
    storeReportSelection({ chart: true, schematic: false, datapoints: true, circles: true });
    expect(readReportSelection()).toEqual({
      chart: true,
      schematic: false,
      datapoints: true,
      circles: true,
    });
  });

  it('without storage at all everything is selected and storing does not throw', () => {
    delete g.localStorage;
    expect(readReportSelection()).toEqual(ALL_PARTS);
    expect(() => storeReportSelection(ALL_PARTS)).not.toThrow();
  });
});

describe('datapoint table labels', () => {
  it('the first row is the start DP and the transformed points follow the user datapoints', () => {
    const result = evaluateLadder(
      {
        z0: 50,
        frequency: 1e9,
        load: complex(25, 0),
        elements: [{ kind: 'L', orientation: 'series', value: 1e-9 }],
      },
      { arcSteps: 0 },
    );
    const t = datapointTable(result, 'Datapoints', { count: 3, slot: 1 });
    expect(t.rows.map((r) => r[0])).toEqual(['DP2', 'TP4']);
    expect(t.title).toBe('Datapoints at 1 GHz');
    const text = tableText({
      title: 't',
      header: ['a', 'b'],
      rows: [
        ['1', '2'],
        ['3', '4'],
      ],
    });
    expect(text).toBe('a\tb\n1\t2\n3\t4');
  });
});
