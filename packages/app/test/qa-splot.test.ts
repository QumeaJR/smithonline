/**
 * QA round 1: S-Plot helpers and actions at their edges. Hand values: with
 * s11 = s22 = 0, K = (1 + |s12 s21|^2) / (2 |s12 s21|), MAG = |s21/s12| (K - sqrt(K^2 - 1)),
 * mu = 1 / |s12 s21|.
 */
import { complex } from '@smithonline/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDesign, identify } from '../src/lib/design';
import {
  alignToGrid,
  analyze,
  nearestIndex,
  niceLimit,
  readSPlotFiles,
  reinterpretFrequencyUnit,
  suggestUnit,
  unionGrid,
} from '../src/lib/splot';
import {
  exportEntry,
  exportFileName,
  hasPort,
  referenceFrequency,
  sendLoadToChart,
  sendSweepToChart,
} from '../src/lib/splotActions';
import { useDesignStore } from '../src/store/useDesignStore';
import {
  activeEntry,
  FILE_COLORS,
  useSPlotStore,
  type SPlotEntry,
} from '../src/store/useSPlotStore';

const ONE_PORT = ['# GHZ S RI R 50', '1 0.5 0', '2 0.25 0'].join('\n');
const TWO_PORT = ['# GHZ S RI R 50', '1 0 0 10 0 0.1 0 0 0', '2 0 0 5 0 0.1 0 0 0'].join('\n');

function entryOf(name: string, text: string): SPlotEntry {
  const [id] = useSPlotStore.getState().addFiles(readSPlotFiles(name, text));
  return useSPlotStore.getState().files.find((f) => f.id === id)!;
}

beforeEach(() => {
  useSPlotStore.setState({ files: [], activeId: null, selected: null, cursor: null });
  useDesignStore.getState().init({ ...emptyDesign(), frequency: 1.4e9 });
});

describe('niceLimit and suggestUnit', () => {
  it('niceLimit: 0, negative, NaN and Infinity give 1; 0.3 -> 0.5; 1 -> 1; 2.5 -> 5; 10 -> 10', () => {
    expect(niceLimit(0)).toBe(1);
    expect(niceLimit(-2)).toBe(1);
    expect(niceLimit(NaN)).toBe(1);
    expect(niceLimit(Infinity)).toBe(1);
    expect(niceLimit(0.3)).toBeCloseTo(0.5, 12);
    expect(niceLimit(1)).toBe(1);
    expect(niceLimit(2.5)).toBe(5);
    expect(niceLimit(10)).toBe(10);
    expect(niceLimit(0.999999)).toBeCloseTo(1, 12);
  });

  it('suggestUnit switches at exactly 1e3, 1e6 and 1e9', () => {
    expect(suggestUnit(999)).toBe('HZ');
    expect(suggestUnit(1e3)).toBe('KHZ');
    expect(suggestUnit(999999)).toBe('KHZ');
    expect(suggestUnit(1e6)).toBe('MHZ');
    expect(suggestUnit(1e9)).toBe('GHZ');
    expect(suggestUnit(0)).toBe('HZ');
  });
});

describe('grid helpers', () => {
  it('alignToGrid: NaN, Infinity and missing samples are null; an empty grid is empty', () => {
    expect(alignToGrid([1, 2, 3, 4], [1, 2, 3], [5, NaN, Infinity])).toEqual([5, null, null, null]);
    expect(alignToGrid([], [1], [5])).toEqual([]);
  });

  it('unionGrid sorts numerically and removes duplicates', () => {
    expect(unionGrid([[10, 2], [2, 1e3], []])).toEqual([2, 10, 1e3]);
    expect(unionGrid([])).toEqual([]);
  });

  it('nearestIndex: empty is null, a tie takes the first', () => {
    expect(nearestIndex([], 5)).toBeNull();
    expect(nearestIndex([1, 3], 2)).toBe(0);
    expect(nearestIndex([1, 3], 2.0001)).toBe(1);
  });
});

describe('reinterpretFrequencyUnit', () => {
  it('returns the same object for the same unit and scales points and noise otherwise', () => {
    const data = readSPlotFiles('a.s2p', TWO_PORT)[0]!.data;
    expect(reinterpretFrequencyUnit(data, 'GHZ')).toBe(data);
    const asHz = reinterpretFrequencyUnit(data, 'HZ');
    expect(asHz.points.map((p) => p.frequency)).toEqual([1, 2]);
    expect(asHz.frequencyUnit).toBe('HZ');
    const asKhz = reinterpretFrequencyUnit(data, 'KHZ');
    expect(asKhz.points.map((p) => p.frequency)).toEqual([1e3, 2e3]);
  });
});

describe('analyze hand values', () => {
  it('s11 = s22 = 0, s21 = 10, s12 = 0.1: K = 1, MAG = MSG = 20 dB, mu = 1; s21 = 5: K = 1.25, MAG 13.979 dB, mu = 2', () => {
    const a = analyze(readSPlotFiles('a.s2p', TWO_PORT)[0]!.data);
    expect(a.k).toEqual([1, 1.25]);
    expect(a.mu![0]).toBeCloseTo(1, 12);
    expect(a.mu![1]).toBeCloseTo(2, 12);
    expect(a.msgDb![0]).toBeCloseTo(20, 12);
    expect(a.magDb![0]).toBeCloseTo(20, 12);
    expect(a.msgDb![1]).toBeCloseTo(10 * Math.log10(50), 12);
    expect(a.magDb![1]).toBeCloseTo(10 * Math.log10(25), 12);
    expect(a.db.s21).toEqual([20, 10 * Math.log10(25)]);
    expect(a.db.s12![0]).toBeCloseTo(-20, 12);
    expect(a.db.s11).toEqual([-Infinity, -Infinity]);
    expect(a.returnLoss1).toEqual([Infinity, Infinity]);
    expect(a.phase.s21).toEqual([0, 0]);
  });
});

describe('readSPlotFiles refusals', () => {
  it('an unknown extension is refused; a .txt that is not EZNEC throws', () => {
    expect(() => readSPlotFiles('a.bin', ONE_PORT)).toThrow(/Not an S-parameter/);
    expect(() => readSPlotFiles('a.txt', 'nothing here')).toThrow();
  });
});

describe('file names of the export', () => {
  const entry = (fileName: string, ports: number) => ({ fileName, data: { ports } }) as SPlotEntry;
  it('strips a CITI package tag, replaces odd characters, falls back to sparams', () => {
    const z = {
      parameter: 'Z' as const,
      normalized: true,
      format: 'RI' as const,
      unit: 'GHZ' as const,
    };
    expect(exportFileName(entry('amp.s2p [pkg 1]', 2), z)).toBe('amp-z-norm.s2p');
    expect(
      exportFileName(entry('my file.s2p', 2), { ...z, parameter: 'H', normalized: false }),
    ).toBe('my_file-h-ohm.s2p');
    expect(exportFileName(entry('.s2p', 2), { ...z, parameter: 'S' })).toBe('sparams.s2p');
    expect(exportFileName(entry('x.s1p', 1), { ...z, parameter: 'ABCD' })).toBe('x-abcd-norm.s1p');
  });
});

describe('store edges', () => {
  it('addFiles with nothing returns [] and changes nothing; the ninth file wraps to the first colour', () => {
    const before = useSPlotStore.getState();
    expect(useSPlotStore.getState().addFiles([])).toEqual([]);
    expect(useSPlotStore.getState().files).toBe(before.files);
    for (let i = 0; i < 9; i++) entryOf(`f${i}.s1p`, ONE_PORT);
    const files = useSPlotStore.getState().files;
    expect(files[0]!.color).toBe(FILE_COLORS[0]);
    expect(files[8]!.color).toBe(FILE_COLORS[0]);
    expect(files[7]!.color).toBe(FILE_COLORS[7]);
  });

  it('removing an unknown id or activating an unknown id leaves the state alone', () => {
    const e = entryOf('a.s1p', ONE_PORT);
    const files = useSPlotStore.getState().files;
    useSPlotStore.getState().removeFile('nope');
    expect(useSPlotStore.getState().files).toBe(files);
    useSPlotStore.getState().select(1);
    useSPlotStore.getState().setActive('nope');
    expect(useSPlotStore.getState().activeId).toBe(e.id);
    expect(useSPlotStore.getState().selected).toBe(1);
  });

  it('setUnit twice keeps the original numbers: GHz read as Hz then as MHz', () => {
    const e = entryOf('a.s1p', ONE_PORT);
    useSPlotStore.getState().setUnit(e.id, 'HZ');
    useSPlotStore.getState().setUnit(e.id, 'MHZ');
    const now = activeEntry(useSPlotStore.getState())!;
    expect(now.data.points.map((p) => p.frequency)).toEqual([1e6, 2e6]);
    expect(now.original.points.map((p) => p.frequency)).toEqual([1e9, 2e9]);
  });
});

describe('actions', () => {
  it('referenceFrequency: a selected index out of range falls back to the cursor, then the first sample', () => {
    const e = entryOf('a.s1p', ONE_PORT);
    expect(referenceFrequency(e, 7, 1.9e9)).toBe(2e9);
    expect(referenceFrequency(e, 7, null)).toBe(1e9);
    expect(referenceFrequency({ ...e, data: { ...e.data, points: [] } }, null, 5)).toBeNull();
  });

  it('hasPort: a one-port has no port 2; a file without points has no port at all', () => {
    const e = entryOf('a.s1p', ONE_PORT);
    expect(hasPort(e, 1)).toBe(true);
    expect(hasPort(e, 2)).toBe(false);
    expect(hasPort({ ...e, data: { ...e.data, points: [] } }, 1)).toBe(false);
  });

  it('sendLoadToChart re-references lines and stubs to the new frequency and switches the view', () => {
    useDesignStore.getState().init({
      ...emptyDesign(),
      frequency: 1.4e9,
      elements: identify([
        { kind: 'line', z0: 50, length: 0.1, refFrequency: 1.4e9 },
        { kind: 'L', orientation: 'series', value: 1e-9 },
      ]),
    });
    useDesignStore.getState().setView('splot');
    const e = entryOf('a.s1p', ONE_PORT);
    const text = sendLoadToChart(e, 1, 2.2e9);
    const d = useDesignStore.getState().design;
    // s11 = 0.25 at 2 GHz: Z = 50 (1.25 / 0.75) = 83.333 ohm.
    expect(d.frequency).toBe(2e9);
    expect(d.load.re).toBeCloseTo(83.3333333, 6);
    expect(d.load.im).toBeCloseTo(0, 12);
    expect((d.elements[0] as { refFrequency: number }).refFrequency).toBe(2e9);
    expect(d.elements[1]).toMatchObject({ kind: 'L', value: 1e-9 });
    expect(useDesignStore.getState().view).toBe('chart');
    expect(text).toMatch(/^Load set from a\.s1p s11/);
  });

  it('sendSweepToChart marks the sweep as datapoints with the file name and keeps the others', () => {
    const e = entryOf('a.s1p', ONE_PORT);
    sendSweepToChart(e, 1);
    const d = useDesignStore.getState().design;
    expect(d.sweep.mode).toBe('datapoints');
    expect(d.sweep.enabled).toBe(true);
    expect(d.sweep.loadsName).toBe('a.s1p s11');
    expect(d.sweep.loads).toHaveLength(2);
    // The design frequency 1.4 GHz is nearer 1 GHz than 2 GHz: DP1 is the 1 GHz row, Z = 150 ohm.
    expect(d.frequency).toBe(1e9);
    expect(d.load.re).toBeCloseTo(150, 9);
  });

  it('exportEntry reports an impossible conversion instead of throwing', () => {
    const e = entryOf('a.s1p', ONE_PORT);
    const msg = exportEntry(e, { parameter: 'H', normalized: true, format: 'RI', unit: 'GHZ' });
    expect(msg).toBe(
      'Could not export a.s1p: H-parameters are defined for two-ports only; this file has 1 ports',
    );
  });
});

describe('complex import is used', () => {
  it('keeps the helper import live', () => {
    expect(complex(1, 2)).toEqual({ re: 1, im: 2 });
  });
});
