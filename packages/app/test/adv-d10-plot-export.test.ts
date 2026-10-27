// @vitest-environment jsdom
/**
 * QA docs/10 section 4.4 (adversarial): the plot exports with hostile data.
 * The SVG must be well-formed XML with no NaN coordinates (it is also the
 * PNG's source); the CSV must not let a cell from a name start a formula
 * (CSV injection) and must keep its columns.
 */
import { describe, expect, it } from 'vitest';
import * as core from '@smithonline/core';
import { plotCsv } from '../src/response/plotExport';
import { plotSvg, type PlotPicture } from '../src/response/plotSvg';
import type { PlotAxis, PlotSeries } from '../src/response/Plot';

const axis: PlotAxis = { unit: 'dB', format: (v: number) => v.toFixed(1) } as PlotAxis;

function picture(over: Partial<PlotPicture>): PlotPicture {
  return {
    title: 'VSWR',
    xs: [1e9, 2e9, 3e9],
    series: [{ label: 'VSWR', color: '#123456', values: [1.5, 2, 1.2] } as PlotSeries],
    left: axis,
    logX: false,
    xRange: [1e9, 3e9],
    yRange: [1, 3],
    markers: [],
    designFrequency: 2e9,
    footer: 'antenna, 2026-10-27, Smith Online',
    ...over,
  } as PlotPicture;
}

function wellFormed(svg: string): string | null {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  return err ? (err.textContent ?? 'parsererror') : null;
}

describe('plot SVG with hostile data', () => {
  it('NaN gaps, an all-NaN series and huge values: no NaN or Infinity in the drawing', () => {
    const svg = plotSvg(
      picture({
        series: [
          { label: 'a', color: '#111', values: [NaN, 2, NaN] },
          { label: 'b', color: '#222', values: [NaN, NaN, NaN] },
          { label: 'c', color: '#333', values: [1e308, -1e308, Infinity] },
        ] as PlotSeries[],
        yRange: [-1e300, 1e300],
      }),
    );
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(wellFormed(svg)).toBeNull();
  });

  it('a new design (no parts): the Phase and group delay panel exports without NaN', () => {
    // The group delay of an empty network is 0 at every frequency; DELAY_AXIS.range in
    // response/ResponseView.tsx (line 128) then gives the zero-height range [0, 0].
    const fs = core.sweepPoints(225e6, 900e6, 51);
    const resp = core.sweepResponse(
      core.sweepFrequency(
        { z0: 50, frequency: 450e6, load: { re: 50, im: 0 }, elements: [] } as never,
        fs,
      ),
    );
    expect(resp.groupDelay.every((v) => v === 0)).toBe(true);
    const delayRange = (min: number, max: number): [number, number] => [
      Math.max(min, -1e-6),
      Math.min(max, 1e-6),
    ];
    const lo = Math.min(...resp.groupDelay);
    const hi = Math.max(...resp.groupDelay);
    const svg = plotSvg(
      picture({
        title: 'Phase S21 and group delay',
        xs: resp.frequency,
        series: [
          { label: 'Phase S21', color: '#111', values: resp.phaseDeg },
          { label: 'Group delay', color: '#222', values: resp.groupDelay, scale: 'd' },
        ] as PlotSeries[],
        right: { format: String, exportUnit: 's' } as PlotAxis,
        xRange: [225e6, 900e6],
        yRange: [-1, 1],
        dRange: delayRange(lo, hi),
      }),
    );
    expect(svg).not.toMatch(/="NaN"|NaN,|,NaN|NaN /);
  });

  it('names with markup and ampersands are escaped; the document stays well-formed', () => {
    const svg = plotSvg(
      picture({
        title: 'VSWR <script>alert(1)</script> & "x"',
        series: [
          { label: '</text><script>x</script>', color: '#111', values: [1, 2, 3] },
        ] as PlotSeries[],
        footer: 'R&D <b>antenna</b>, 2026-10-27, Smith Online',
      }),
    );
    expect(svg).not.toContain('<script>');
    expect(wellFormed(svg)).toBeNull();
  });

  it('a design name with a control character (from a share link or design file) keeps the SVG well-formed', () => {
    const svg = plotSvg(picture({ footer: 'ant\u0007enna, 2026-10-27, Smith Online' }));
    expect(wellFormed(svg)).toBeNull();
  });
});

describe('plot CSV with hostile names', () => {
  it('a stored curve named like a formula does not start a cell with = + - @', () => {
    // A stored curve takes the design's name by default (OverlayBar), and a design name comes
    // from a share link or a design file someone else made.
    const csv = plotCsv(
      [1e9, 2e9],
      [
        { label: 'VSWR', color: '#111', values: [1.2, 1.3] },
        { label: '=HYPERLINK("https://evil.example","Open") VSWR', color: '#222', values: [1, 2] },
        { label: '@SUM(1+1) VSWR', color: '#333', values: [1, 2] },
      ] as PlotSeries[],
      { unit: '', format: String } as PlotAxis,
    );
    const header = csv.split('\r\n')[0] ?? '';
    // Split the header into cells the way a spreadsheet does.
    const cells: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < header.length; i++) {
      const ch = header[i] as string;
      if (q) {
        if (ch === '"' && header[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') {
        cells.push(cur);
        cur = '';
      } else cur += ch;
    }
    cells.push(cur);
    expect(cells).toHaveLength(4);
    for (const c of cells) expect(c, c).not.toMatch(/^[=+\-@\t\r]/);
  });
});
