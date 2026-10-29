/**
 * docs/10 section 4: the zoom maths of a response plot, the SVG drawing of
 * one plot and its CSV data.
 */
import { describe, expect, it } from 'vitest';
import {
  boxRange,
  clampRange,
  MIN_SPAN,
  panBy,
  pinchRange,
  rangeText,
  validRange,
  zoomAbout,
  fmtPlotFrequency,
} from '../src/lib/plotZoom';
import { columnName, plotCsv, plotFileBase, plotFooter } from '../src/response/plotExport';
import { logTicks, niceTicks, plotSvg, type PlotPicture } from '../src/response/plotSvg';
import type { PlotAxis, PlotSeries } from '../src/response/Plot';

const FULL = [225e6, 900e6] as const;

describe('frequency zoom', () => {
  it('a box inside the data zooms to it; one reaching both ends is no zoom', () => {
    expect(boxRange(300e6, 400e6, FULL, false)).toEqual([300e6, 400e6]);
    expect(boxRange(400e6, 300e6, FULL, false)).toEqual([300e6, 400e6]);
    expect(boxRange(100e6, 1e9, FULL, false)).toBeNull();
    expect(boxRange(300e6, 300e6, FULL, false)).toBeNull();
    expect(boxRange(Number.NaN, 300e6, FULL, false)).toBeNull();
  });

  it('never below 1/1000 of the span, never past the data', () => {
    const r = clampRange([500e6, 500e6 + 1], FULL, false) as [number, number];
    expect(r[1] - r[0]).toBeCloseTo((FULL[1] - FULL[0]) * MIN_SPAN, 0);
    expect(clampRange([800e6, 1.2e9], FULL, false)).toEqual([500e6, 900e6]);
  });

  it('zooms in and out about a frequency; out to the whole range is null', () => {
    const z = zoomAbout(null, FULL, 500e6, 0.5, false) as [number, number];
    expect(z[0]).toBeLessThan(500e6);
    expect(z[1]).toBeGreaterThan(500e6);
    expect(z[1] - z[0]).toBeCloseTo((FULL[1] - FULL[0]) / 2, 0);
    expect(zoomAbout(z, FULL, 500e6, 4, false)).toBeNull();
  });

  it('works in log f: the box edges are frequencies, the zoom is in decades', () => {
    const full = [1e6, 1e9] as const;
    const z = zoomAbout(null, full, 1e7, 0.5, true) as [number, number];
    // Half the decades about 10 MHz: 1.5 decades wide.
    expect(Math.log10(z[1]) - Math.log10(z[0])).toBeCloseTo(1.5, 6);
    expect(validRange([0, 1e6], true)).toBe(false);
    expect(boxRange(1e7, 1e8, full, true)).toEqual([1e7, 1e8]);
  });

  it('pans by a share of the span and stops at the ends without shrinking', () => {
    const r = [300e6, 400e6] as const;
    expect(panBy(r, FULL, 0.1, false)).toEqual([310e6, 410e6]);
    const end = panBy(r, FULL, 100, false) as [number, number];
    expect(end[1]).toBe(900e6);
    expect(end[1] - end[0]).toBeCloseTo(100e6, 0);
    expect(panBy(null, FULL, 0.1, false)).toBeNull();
  });

  it('a pinch spreading the fingers zooms in about the midpoint', () => {
    const z = pinchRange(FULL, FULL, 500e6, 100, 200, false) as [number, number];
    expect(z[1] - z[0]).toBeCloseTo((FULL[1] - FULL[0]) / 2, 0);
    expect(z[0]).toBeLessThan(500e6);
  });

  it('the chip writes the unit once', () => {
    expect(rangeText([2.3e9, 2.55e9], fmtPlotFrequency)).toBe('2.3 to 2.55 GHz');
    expect(rangeText([900e6, 1.2e9], fmtPlotFrequency)).toBe('900 MHz to 1.2 GHz');
  });
});

const AXIS: PlotAxis = { format: (v) => `${v}`, unit: 'dB', exportUnit: 'dB' };
const xs = [1e9, 1.5e9, 2e9, 2.5e9, 3e9];
const series: PlotSeries[] = [
  { label: '|S21|', color: '#1c7ed6', values: [-0.1, -0.2, null, -0.4, -0.5] },
  { label: '|S11|', color: '#d6336c', values: [-10, -20, -30, -20, -10], dash: [3, 3] },
  { label: '|S11| measured', color: '#d6336c', values: [null, -19, null, -21, null], points: true },
];

function picture(over: Partial<PlotPicture> = {}): PlotPicture {
  return {
    title: 'Gain & return loss <dB>',
    xs,
    series,
    left: AXIS,
    logX: false,
    xRange: [1.5e9, 2.5e9],
    yRange: [-40, 0],
    markers: [2e9],
    designFrequency: 2e9,
    limits: [{ f1: 1.5e9, f2: 2.5e9, kind: 'max', value: -15, scale: 'y', violated: true }],
    vswrBand: { limit: 2, band: { low: 1.8e9, high: 2.2e9 } },
    footer: 'antenna, 2026-10-27, SmithChart.Online',
    ...over,
  };
}

describe('SVG of one plot', () => {
  it('is an 800 x 450 drawing with escaped text, the zoom and every element', () => {
    const svg = plotSvg(picture());
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450"')).toBe(
      true,
    );
    expect(svg).toContain('Gain &amp; return loss &lt;dB&gt;');
    // A gap in |S21| splits its line in two runs; the dashed |S11| keeps its dash.
    expect(svg.match(/<polyline[^>]*stroke="#1c7ed6"/g)).toHaveLength(2);
    expect(svg).toMatch(/<polyline[^>]*stroke="#d6336c"[^>]*stroke-dasharray="3 3"/);
    // Measured points as dots.
    expect(svg.match(/<circle cx=[^>]*r="2.5"/g)).toHaveLength(2);
    expect(svg).toContain('>M1</text>');
    expect(svg).toContain('antenna, 2026-10-27, SmithChart.Online');
    expect(svg).toContain('clip-path="url(#plot-area)"');
    // The zoom: ticks inside 1.5 to 2.5 GHz only, 1.6 GHz a tenth of the width in (x 140.2).
    expect(svg).toContain('<text x="140.2" y="414" text-anchor="middle">1.6 GHz</text>');
    expect(svg).not.toContain('>1.4 GHz</text>');
    expect(svg).not.toMatch(/NaN|Infinity|e\+|e-\d/);
  });

  it('takes ticks for its own size, not those of the plot on screen (QA round 1)', () => {
    // The y axis is 340 units high: about one tick per 60 units, never the 2 of a short plot.
    const svg = plotSvg(picture({ yRange: [-40, 0] }));
    const yLabels = svg.match(/<text x="64" [^>]*text-anchor="end">/g) ?? [];
    expect(yLabels.length).toBeGreaterThanOrEqual(5);
    expect(svg).toContain('>2 GHz</text>');
  });

  it('nice and log ticks', () => {
    expect(niceTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(logTicks(1e6, 1e8)).toEqual([1e6, 2e6, 5e6, 1e7, 2e7, 5e7, 1e8]);
    expect(niceTicks(1, 1)).toEqual([]);
  });
});

describe('CSV of one plot', () => {
  it('frequency in Hz, one column per curve with its unit, measured dots in a second block', () => {
    const csv = plotCsv(xs, series, AXIS);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Frequency Hz,|S21| dB,|S11| dB');
    expect(lines[1]).toBe('1000000000,-0.1,-10');
    expect(lines[3]).toBe('2000000000,,-30');
    expect(lines[6]).toBe('');
    expect(lines[7]).toBe('Frequency Hz,|S11| measured dB');
    expect(lines.slice(8, 10)).toEqual(['1500000000,-19', '2500000000,-21']);
  });

  it('the full range, not the zoom, and headers with a comma are quoted', () => {
    const odd: PlotSeries = { label: 'a, b', color: '#000', values: [1, 2, 3, 4, 5] };
    const csv = plotCsv(xs, [odd], { format: String });
    expect(csv.split('\r\n')[0]).toBe('Frequency Hz,"a, b"');
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(6);
  });

  it('units per axis: R ohm, Group delay s, VSWR alone', () => {
    const ohm: PlotAxis = { format: String, unit: 'Ω', exportUnit: 'ohm' };
    const s: PlotAxis = { format: String, exportUnit: 's' };
    expect(columnName({ label: 'R', color: '', values: [] }, ohm, undefined)).toBe('R ohm');
    expect(columnName({ label: 'Group delay', color: '', values: [], scale: 'd' }, ohm, s)).toBe(
      'Group delay s',
    );
    expect(
      columnName({ label: 'VSWR', color: '', values: [] }, { format: String }, undefined),
    ).toBe('VSWR');
  });

  it('file names and the footer', () => {
    expect(plotFileBase('antenna', 'vswr')).toBe('antenna_vswr');
    expect(plotFileBase('My design: v2/3', 'VSWR')).toBe('My_design_v2_3_vswr');
    expect(plotFileBase('', 'gain')).toBe('design_gain');
    expect(plotFooter('antenna', new Date('2026-10-27T10:00:00Z'))).toBe(
      'antenna, 2026-10-27, SmithChart.Online',
    );
  });
});
