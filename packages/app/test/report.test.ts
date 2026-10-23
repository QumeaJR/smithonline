import { evaluateLadder } from '@smithonline/core';
import { describe, expect, it } from 'vitest';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { ladderOf } from '../src/lib/files';
import {
  circleTable,
  datapointTable,
  reportHtml,
  reportSvg,
  type ReportParts,
  type ReportSelection,
} from '../src/lib/report';

const design: Design = {
  ...emptyDesign(),
  name: 'Test <match>',
  frequency: 450e6,
  load: { re: 20, im: -12 },
  elements: identify([
    { kind: 'L', orientation: 'shunt', value: 16e-9 },
    { kind: 'C', orientation: 'series', value: 22e-12 },
  ]),
  vswrCircles: [1.5, 2],
  qContours: [0.6],
};
const result = evaluateLadder(ladderOf(design));

const square = {
  markup: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle r="4"/></svg>',
  aspect: 1,
};
const wide = {
  markup: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 224 84"><path d="M0 0"/></svg>',
  aspect: 224 / 84,
};

const parts: ReportParts = {
  title: design.name,
  subtitle: '450 MHz, Z0 = 50 Ω',
  chart: square,
  schematic: wide,
  datapoints: [datapointTable(result)],
  circles: circleTable(design),
};
const all: ReportSelection = { chart: true, schematic: true, datapoints: true, circles: true };

describe('report tables', () => {
  it('lists one datapoint row per node with the right panel figures', () => {
    const t = datapointTable(result);
    expect(t.title).toBe('Datapoints at 450 MHz');
    expect(t.rows).toHaveLength(3);
    expect(t.rows[0]![0]).toBe('DP1');
    expect(t.rows[0]![1]).toBe('20.00 - j12.00');
    expect(t.rows[2]![0]).toBe('TP3');
    expect(t.header).toHaveLength(t.rows[0]!.length);
    expect(t.note).toContain('S21 into the load');
  });

  it('lists VSWR circles, Q contours and nothing else without a device', () => {
    const t = circleTable(design);
    expect(t.rows.map((r) => r[0])).toEqual(['VSWR circle', 'VSWR circle', 'Q contour']);
    expect(t.rows[0]![3]).toBe('0.2000');
    expect(t.rows[2]![2]).toBe('0.000 ± j1.667');
    expect(circleTable({ ...design, vswrCircles: [], qContours: [] }).note).toBe(
      'No circles or contours are set.',
    );
  });
});

describe('report SVG', () => {
  it('stacks chart, schematic and tables and escapes the text', () => {
    const svg = reportSvg(parts, all);
    expect(svg.startsWith('<?xml')).toBe(true);
    expect(svg).toContain('Test &lt;match&gt;');
    const chartAt = svg.indexOf('<circle r="4"/>');
    const schematicAt = svg.indexOf('<path d="M0 0"/>');
    const tableAt = svg.indexOf('Datapoints at 450 MHz');
    const circlesAt = svg.indexOf('Circles and contours');
    expect(chartAt).toBeGreaterThan(0);
    expect(schematicAt).toBeGreaterThan(chartAt);
    expect(tableAt).toBeGreaterThan(schematicAt);
    expect(circlesAt).toBeGreaterThan(tableAt);
    // The nested chart is placed and sized; the row text keeps its column spacing.
    expect(svg).toMatch(/<svg x="80" y="[\d.]+" width="640" height="640\.0"/);
    expect(svg).toContain('xml:space="preserve"');
    expect(svg).toMatch(/DP1\s{2,}20\.00 - j12\.00/);
  });

  it('leaves out what is not selected and still gives a valid page', () => {
    const svg = reportSvg(parts, {
      chart: false,
      schematic: false,
      datapoints: true,
      circles: false,
    });
    expect(svg).not.toContain('<circle r="4"/>');
    expect(svg).not.toContain('<path d="M0 0"/>');
    expect(svg).toContain('Datapoints at 450 MHz');
    expect(svg).not.toContain('Circles and contours');
    const height = Number(/height="(\d+)" viewBox/.exec(svg)![1]);
    expect(height).toBeGreaterThan(100);
    expect(height).toBeLessThan(400);
    const none = reportSvg({ ...parts, chart: null }, { ...all, chart: true });
    expect(none).not.toContain('<circle');
  });
});

describe('report print page', () => {
  it('is a complete HTML document with the selection and the print trigger', () => {
    const html = reportHtml(parts, all);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>Test &lt;match&gt;</title>');
    expect(html).toContain('<circle r="4"/>');
    expect(html).toContain('<h2>Datapoints at 450 MHz</h2>');
    expect(html).toContain('<th>VSWR</th>');
    expect(html).toContain('window.print()');
    const noChart = reportHtml(parts, { ...all, chart: false, circles: false });
    expect(noChart).not.toContain('<circle r="4"/>');
    expect(noChart).not.toContain('Circles and contours');
  });
});
