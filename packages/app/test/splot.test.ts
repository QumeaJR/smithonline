import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { complex, readTouchstone, stability, type Complex } from '@smithonline/core';
import { emptyDesign } from '../src/lib/design';
import {
  alignToGrid,
  analyze,
  analysisOf,
  isSPlotFile,
  nearestIndex,
  niceLimit,
  readSPlotFiles,
  reinterpretFrequencyUnit,
  unionGrid,
} from '../src/lib/splot';
import {
  exportFileName,
  exportTouchstoneText,
  fillDeviceFromFile,
  loadSPlotText,
  referenceFrequency,
  sendLoadToChart,
  sendSweepToChart,
} from '../src/lib/splotActions';
import { useDesignStore } from '../src/store/useDesignStore';
import { activeEntry, useSPlotStore, type SPlotEntry } from '../src/store/useSPlotStore';

const fixture = (name: string): string =>
  readFileSync(new URL(`../../core/test/fixtures/sparams/${name}`, import.meta.url), 'utf8');

const splot = useSPlotStore;
const design = useDesignStore;

beforeEach(() => {
  splot.setState({
    files: [],
    activeId: null,
    selected: null,
    cursor: null,
    logX: false,
    traces: { s11: true, s12: true, s21: true, s22: true },
  });
  design.getState().init(emptyDesign());
  design.setState({ view: 'splot', message: null });
});

function loadAmp(): SPlotEntry {
  loadSPlotText('amp-synthetic.s2p', fixture('amp-synthetic.s2p'));
  return activeEntry(splot.getState()) as SPlotEntry;
}

describe('reading files for the S-Plot list', () => {
  it('recognizes the file kinds by name', () => {
    expect(isSPlotFile('x.s2p')).toBe(true);
    expect(isSPlotFile('x.CITI')).toBe(true);
    expect(isSPlotFile('Lastz.txt')).toBe(true);
    expect(isSPlotFile('x.xmlsc')).toBe(false);
    expect(isSPlotFile('x.json')).toBe(false);
  });

  it('reads a Touchstone two-port', () => {
    const [f, ...rest] = readSPlotFiles('amp-synthetic.s2p', fixture('amp-synthetic.s2p'));
    expect(rest).toHaveLength(0);
    expect(f?.data.ports).toBe(2);
    expect(f?.data.points).toHaveLength(12);
    expect(f?.kind).toBe('touchstone');
  });

  it('gives a CITIfile one entry per S package', () => {
    const files = readSPlotFiles('twoport-synthetic.citi', fixture('twoport-synthetic.citi'));
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files.every((f) => f.kind === 'citi')).toBe(true);
    if (files.length > 1) expect(new Set(files.map((f) => f.fileName)).size).toBe(files.length);
  });

  it('turns an EZNEC table into a one-port s11 in Hz', () => {
    const [f] = readSPlotFiles('Lastz.txt', fixture('Lastz.txt'));
    expect(f?.data.ports).toBe(1);
    expect(f?.data.points[0]?.frequency).toBeGreaterThan(1e6);
    // 50 + j0 ohm is a perfect match: s11 = 0. Check the conversion on the first row.
    const row = f?.data.points[0]?.s[0] as Complex;
    expect(Math.hypot(row.re, row.im)).toBeLessThanOrEqual(1);
  });

  it('refuses unsupported names and non-S Touchstone data', () => {
    expect(() => readSPlotFiles('x.xmlsc', '')).toThrow(/Not an S-parameter/);
    expect(() => readSPlotFiles('x.s1p', '# GHZ Z RI R 50\n1 1 0\n')).toThrow(/not supported/);
  });
});

describe('analysis of a file', () => {
  const data = readTouchstone(fixture('amp-synthetic.s2p'));
  const a = analyze(data);

  it('matches the core stability figures at 2 GHz (index 3)', () => {
    const p = data.points[3] as { s: readonly Complex[] };
    const st = stability({ s11: p.s[0]!, s12: p.s[1]!, s21: p.s[2]!, s22: p.s[3]! });
    expect(a.k?.[3]).toBeCloseTo(st.k, 12);
    expect(a.mu?.[3]).toBeCloseTo(st.mu, 12);
    // From the file by hand: k = 1.313 at 2 GHz.
    expect(a.k?.[3]).toBeCloseTo(1.313, 3);
  });

  it('computes MSG = 10 log10 |s21/s12| and MAG only where K >= 1', () => {
    // 2 GHz: |s21| = 4.9246, |s12| = 0.05, so 98.492 and 19.934 dB.
    expect(a.msgDb?.[3]).toBeCloseTo(10 * Math.log10(4.9246 / 0.05), 9);
    // MAG = MSG (K - sqrt(K^2 - 1)): K 1.313 gives 98.492 x 0.4621 = 45.51, 16.58 dB.
    expect(a.magDb?.[3]).toBeCloseTo(16.58, 2);
    // 0.5 GHz has K < 1 in the fixture: no MAG, MSG only.
    expect(a.k?.[0]).toBeLessThan(1);
    expect(a.magDb?.[0]).toBeNaN();
    expect(Number.isFinite(a.msgDb?.[0])).toBe(true);
  });

  it('gives magnitude, phase and return loss per point', () => {
    // 0.5 GHz: |s11| = 0.575 at -42.5 degrees; RL = -20 log 0.575.
    expect(a.db.s11?.[0]).toBeCloseTo(20 * Math.log10(0.575), 9);
    expect(a.phase.s11?.[0]).toBeCloseTo(-42.5, 9);
    expect(a.returnLoss1[0]).toBeCloseTo(-20 * Math.log10(0.575), 9);
    expect(a.returnLoss2?.[0]).toBeCloseTo(-20 * Math.log10(0.485), 9);
    expect(a.db.s21?.[0]).toBeCloseTo(20 * Math.log10(12.996), 9);
  });

  it('leaves two-port columns empty for a one-port', () => {
    const one = analyze(readTouchstone(fixture('dipole-synthetic.s1p')));
    expect(one.ports).toBe(1);
    expect(one.s21).toBeNull();
    expect(one.k).toBeNull();
    expect(one.returnLoss2).toBeNull();
    expect(one.returnLoss1.length).toBe(one.frequency.length);
  });

  it('caches per data object', () => {
    expect(analysisOf(data)).toBe(analysisOf(data));
  });
});

describe('helpers', () => {
  it('builds a union grid and aligns samples without interpolating', () => {
    const grid = unionGrid([
      [1, 2, 3],
      [2, 2.5, 4],
    ]);
    expect(grid).toEqual([1, 2, 2.5, 3, 4]);
    expect(alignToGrid(grid, [1, 2, 3], [10, 20, NaN])).toEqual([10, 20, null, null, null]);
  });

  it('finds the nearest sample', () => {
    expect(nearestIndex([1, 2, 4], 3.2)).toBe(2);
    expect(nearestIndex([1, 2, 4], 1.4)).toBe(0);
    expect(nearestIndex([], 1)).toBeNull();
  });

  it('rounds polar limits up to 1, 2 or 5 times a power of ten', () => {
    expect(niceLimit(0.04)).toBe(0.05);
    expect(niceLimit(1)).toBe(1);
    expect(niceLimit(1.3)).toBe(2);
    expect(niceLimit(3.7)).toBe(5);
    expect(niceLimit(5.1)).toBe(10);
    expect(niceLimit(0)).toBe(1);
  });

  it('reads the frequency numbers of a file as another unit', () => {
    const data = readTouchstone(fixture('amp-synthetic.s2p')); // # GHZ: 0.5 is 5e8 Hz
    const asMhz = reinterpretFrequencyUnit(data, 'MHZ');
    expect(data.points[0]?.frequency).toBeCloseTo(5e8, 0);
    expect(asMhz.points[0]?.frequency).toBeCloseTo(5e5, 3);
    expect(asMhz.noise[0]?.frequency).toBeCloseTo(1e6, 3);
    expect(asMhz.frequencyUnit).toBe('MHZ');
    expect(reinterpretFrequencyUnit(data, 'GHZ')).toBe(data);
  });
});

describe('S-Plot file list store', () => {
  it('adds files, makes the last active and gives each a unique id and colour', () => {
    const first = loadAmp();
    loadSPlotText('amp-synthetic.s2p', fixture('amp-synthetic.s2p'));
    const s = splot.getState();
    expect(s.files).toHaveLength(2);
    expect(s.files[0]?.id).not.toBe(s.files[1]?.id);
    expect(s.files[0]?.color).not.toBe(s.files[1]?.color);
    expect(s.activeId).toBe(s.files[1]?.id);
    expect(first.visible).toBe(true);
    expect(first.unit).toBe('GHZ');
  });

  it('removes a file and moves the active one to the last remaining', () => {
    loadAmp();
    loadSPlotText('dipole-synthetic.s1p', fixture('dipole-synthetic.s1p'));
    const [a, b] = splot.getState().files as [SPlotEntry, SPlotEntry];
    splot.getState().select(2);
    splot.getState().removeFile(b.id);
    expect(splot.getState().files.map((f) => f.id)).toEqual([a.id]);
    expect(splot.getState().activeId).toBe(a.id);
    expect(splot.getState().selected).toBeNull();
    splot.getState().removeFile(a.id);
    expect(splot.getState().activeId).toBeNull();
    splot.getState().removeFile('missing');
    expect(splot.getState().files).toEqual([]);
  });

  it('clears the selected row when another file becomes active, not when the same one does', () => {
    loadAmp();
    loadSPlotText('dipole-synthetic.s1p', fixture('dipole-synthetic.s1p'));
    const [a, b] = splot.getState().files as [SPlotEntry, SPlotEntry];
    splot.getState().select(4);
    splot.getState().setActive(b.id);
    expect(splot.getState().selected).toBe(4); // already active: untouched
    splot.getState().setActive(a.id);
    expect(splot.getState().selected).toBeNull();
    splot.getState().setActive('missing');
    expect(splot.getState().activeId).toBe(a.id);
  });

  it('changes the frequency unit without losing the original data', () => {
    const e = loadAmp();
    splot.getState().setUnit(e.id, 'MHZ');
    const after = activeEntry(splot.getState()) as SPlotEntry;
    expect(after.unit).toBe('MHZ');
    expect(after.data.points[0]?.frequency).toBeCloseTo(5e5, 3);
    expect(after.original.points[0]?.frequency).toBeCloseTo(5e8, 0);
    splot.getState().setUnit(e.id, 'GHZ');
    expect((activeEntry(splot.getState()) as SPlotEntry).data.points[0]?.frequency).toBeCloseTo(
      5e8,
      0,
    );
  });

  it('keeps visibility, colour, traces, axis and cursor', () => {
    const e = loadAmp();
    const s = splot.getState();
    s.setVisible(e.id, false);
    s.setColor(e.id, '#123456');
    s.toggleTrace('s12');
    s.setLogX(true);
    s.setCursor(1e9);
    const now = splot.getState();
    expect(now.files[0]).toMatchObject({ visible: false, color: '#123456' });
    expect(now.traces.s12).toBe(false);
    expect(now.traces.s11).toBe(true);
    expect(now.logX).toBe(true);
    expect(now.cursor).toBe(1e9);
  });
});

describe('hand-over to the Smith chart', () => {
  it('uses the selected row, else the cursor, else the first sample as the reference frequency', () => {
    const e = loadAmp();
    expect(referenceFrequency(e, null, null)).toBeCloseTo(5e8, 0);
    expect(referenceFrequency(e, null, 2.1e9)).toBeCloseTo(2e9, 0);
    expect(referenceFrequency(e, 5, 2.1e9)).toBeCloseTo(3e9, 0);
    expect(referenceFrequency(e, 99, null)).toBeCloseTo(5e8, 0);
  });

  it('sets the load and design frequency from s11 at the chosen frequency', () => {
    const e = loadAmp();
    const msg = sendLoadToChart(e, 1, 2e9);
    // 2 GHz row: s11 = 0.5 at -80 degrees, z = 0.6968 - j0.9149, so 34.84 - j45.75 ohm at Z0 = 50.
    const d = design.getState().design;
    expect(d.load.re).toBeCloseTo(34.84, 2);
    expect(d.load.im).toBeCloseTo(-45.75, 2);
    expect(d.frequency).toBeCloseTo(2e9, 0);
    expect(design.getState().view).toBe('chart');
    expect(msg).toContain('2 GHz');
    // The same hand-over is one history entry.
    design.getState().undo();
    expect(design.getState().design.frequency).not.toBeCloseTo(2e9, 0);
  });

  it('sends s22 the same way', () => {
    const e = loadAmp();
    sendLoadToChart(e, 2, 1e9);
    // 1 GHz row: s22 = 0.47 at -40 degrees.
    const g = {
      re: 0.47 * Math.cos((-40 * Math.PI) / 180),
      im: 0.47 * Math.sin((-40 * Math.PI) / 180),
    };
    const z = {
      re: (50 * (1 - g.re * g.re - g.im * g.im)) / ((1 - g.re) ** 2 + g.im ** 2),
      im: (50 * 2 * g.im) / ((1 - g.re) ** 2 + g.im ** 2),
    };
    const d = design.getState().design;
    expect(d.load.re).toBeCloseTo(z.re, 9);
    expect(d.load.im).toBeCloseTo(z.im, 9);
  });

  it('adds the file as a datapoint sweep with DP1 nearest the design frequency', () => {
    const e = loadAmp();
    design.getState().setFrequency(2.1e9);
    sendSweepToChart(e, 1);
    const d = design.getState().design;
    expect(d.sweep.enabled).toBe(true);
    expect(d.sweep.mode).toBe('datapoints');
    expect(d.sweep.loads).toHaveLength(12);
    expect(d.sweep.loadsName).toBe('amp-synthetic.s2p s11');
    expect(d.frequency).toBeCloseTo(2e9, 0);
    expect(design.getState().view).toBe('chart');
  });

  it('refuses a sweep of a single point and s22 of a one-port', () => {
    loadSPlotText('dipole-synthetic.s1p', fixture('dipole-synthetic.s1p'));
    const e = activeEntry(splot.getState()) as SPlotEntry;
    expect(sendLoadToChart(e, 2, 1.4e8)).toContain('no s22');
    const single = { ...e, data: { ...e.data, points: e.data.points.slice(0, 1) } };
    expect(sendSweepToChart(single, 1)).toContain('at least two');
    expect(design.getState().design.sweep.loads).toBeUndefined();
  });

  it('fills the two-port panel at the design frequency', () => {
    const e = loadAmp();
    design.getState().setFrequency(2e9);
    fillDeviceFromFile(e);
    const tp = design.getState().design.twoPort;
    expect(tp?.source?.fileName).toBe('amp-synthetic.s2p');
    expect(tp?.s.s21.re).toBeCloseTo(4.9246 * Math.cos((80 * Math.PI) / 180), 9);
    expect(fillDeviceFromFile({ ...e, data: { ...e.data, ports: 1 } })).toContain('two ports');
  });
});

describe('export', () => {
  it('names files after the source, parameter and normalization', () => {
    const e = loadAmp();
    const base = { format: 'MA', unit: 'GHZ' } as const;
    expect(exportFileName(e, { ...base, parameter: 'S', normalized: true })).toBe(
      'amp-synthetic.s2p',
    );
    expect(exportFileName(e, { ...base, parameter: 'Z', normalized: true })).toBe(
      'amp-synthetic-z-norm.s2p',
    );
    expect(exportFileName(e, { ...base, parameter: 'ABCD', normalized: false })).toBe(
      'amp-synthetic-abcd-ohm.s2p',
    );
    expect(
      exportFileName(
        { ...e, fileName: 'two port.citi [DATA]' },
        { ...base, parameter: 'S', normalized: true },
      ),
    ).toBe('two_port.s2p');
  });

  it('writes Z-parameters that read back as the converted S-parameters', () => {
    const e = loadAmp();
    const text = exportTouchstoneText(e, {
      parameter: 'Z',
      normalized: false,
      format: 'RI',
      unit: 'MHZ',
    });
    expect(text).toContain('# MHZ Z RI R 1');
    const back = readTouchstone(text);
    expect(back.parameter).toBe('Z');
    expect(back.points[0]?.frequency).toBeCloseTo(5e8, 0);
    // Cross-check one entry against the closed form z11 = ((1+s11)(1-s22) + s12 s21) / ((1-s11)(1-s22) - s12 s21).
    const s = (e.data.points[0] as { s: readonly Complex[] }).s;
    const [s11, s12, s21, s22] = s as [Complex, Complex, Complex, Complex];
    const mul = (a: Complex, b: Complex): Complex =>
      complex(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
    const one = complex(1);
    const sub = (a: Complex, b: Complex): Complex => complex(a.re - b.re, a.im - b.im);
    const add = (a: Complex, b: Complex): Complex => complex(a.re + b.re, a.im + b.im);
    const s1221 = mul(s12, s21);
    const num = add(mul(add(one, s11), sub(one, s22)), s1221);
    const den = sub(mul(sub(one, s11), sub(one, s22)), s1221);
    const d2 = den.re * den.re + den.im * den.im;
    const z11 = complex(
      ((num.re * den.re + num.im * den.im) / d2) * 50,
      ((num.im * den.re - num.re * den.im) / d2) * 50,
    );
    const got = back.points[0]?.s[0] as Complex;
    expect(got.re).toBeCloseTo(z11.re, 3);
    expect(got.im).toBeCloseTo(z11.im, 3);
  });
});
