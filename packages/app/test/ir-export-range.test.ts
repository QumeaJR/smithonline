/**
 * Phase 3 side item: the File menu's .s2p export and the S-Plot network entry
 * share one range (the sweep when a frequency sweep is on, else 0.5 f to 2 f
 * in 201 points) and both include the component packages the parts name.
 */
import { DEFAULT_PACKAGES, readTouchstone } from '@smithonline/core';
import { describe, expect, it } from 'vitest';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { designToS2p, exportBand } from '../src/lib/simexport';
import { networkBand, networkSPlotFile } from '../src/lib/splotNetwork';

const design: Design = {
  ...emptyDesign(),
  name: 'Range',
  frequency: 450e6,
  load: { re: 20, im: -12 },
  elements: identify([
    { kind: 'L', orientation: 'shunt', value: 16e-9 },
    { kind: 'C', orientation: 'series', value: 22e-12 },
  ]),
  sweep: { enabled: true, start: 300e6, stop: 600e6, points: 31 },
};

const s2pFrequencies = (d: Design): number[] =>
  readTouchstone(designToS2p(d, null, DEFAULT_PACKAGES), 2).points.map((p) => p.frequency);
const entryFrequencies = (d: Design): number[] =>
  networkSPlotFile(d, DEFAULT_PACKAGES).data.points.map((p) => p.frequency);

describe('one export range for the .s2p and the S-Plot network entry', () => {
  it('is the same function', () => {
    expect(networkBand).toBe(exportBand);
  });

  it('a frequency sweep that is on: its range and points, in both', () => {
    const a = s2pFrequencies(design);
    const b = entryFrequencies(design);
    expect(a).toHaveLength(31);
    expect(a[0]).toBeCloseTo(300e6, 0);
    expect(a[30]).toBeCloseTo(600e6, 0);
    expect(b.length).toBe(a.length);
    b.forEach((f, i) => expect(f).toBeCloseTo(a[i] as number, 0));
  });

  it('the sweep off: 0.5 f to 2 f in 201 points, in both', () => {
    const off: Design = { ...design, sweep: { ...design.sweep, enabled: false } };
    const a = s2pFrequencies(off);
    const b = entryFrequencies(off);
    expect(a).toHaveLength(201);
    expect(a[0]).toBeCloseTo(225e6, 0);
    expect(a[200]).toBeCloseTo(900e6, 0);
    expect(b).toHaveLength(201);
    expect(b[0]).toBeCloseTo(a[0] as number, 0);
    expect(b[200]).toBeCloseTo(a[200] as number, 0);
  });

  it('a measured load: the band of its rows (QA round on docs/09)', () => {
    const dp: Design = {
      ...design,
      sweep: {
        ...design.sweep,
        mode: 'datapoints',
        loads: [
          { frequency: 400e6, z: { re: 20, im: 0 } },
          { frequency: 500e6, z: { re: 30, im: 0 } },
        ],
      },
    };
    expect(exportBand(dp)).toEqual({ start: 400e6, stop: 500e6, points: 201 });
  });

  it('both include the packages a part names', () => {
    const packaged: Design = {
      ...design,
      elements: design.elements.map((el) =>
        el.kind === 'C' ? { ...el, package: '0603' as const } : el,
      ),
    };
    const plain = readTouchstone(designToS2p(design, null, DEFAULT_PACKAGES), 2).points[30];
    const withPkg = readTouchstone(designToS2p(packaged, null, DEFAULT_PACKAGES), 2).points[30];
    const entry = networkSPlotFile(packaged, DEFAULT_PACKAGES).data.points[30];
    expect(plain && withPkg && entry).toBeTruthy();
    // The package changes the network...
    expect(Math.abs(withPkg!.s[0]!.re - plain!.s[0]!.re)).toBeGreaterThan(1e-6);
    // ...and the .s2p and the S-Plot entry agree on it.
    expect(entry!.s[0]!.re).toBeCloseTo(withPkg!.s[0]!.re, 6);
    expect(entry!.s[2]!.im).toBeCloseTo(withPkg!.s[2]!.im, 6);
    expect(networkSPlotFile(packaged, DEFAULT_PACKAGES).description).toContain('packages');
  });
});
