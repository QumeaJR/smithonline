import { fitToTarget, lMatch, nearestInSeries, type Complex } from '@smithonline/core';
import { describe, expect, it } from 'vitest';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { designLadder, sliderSteps, snapFit, snapSolutions } from '../src/lib/realize';

const base: Design = {
  ...emptyDesign(),
  frequency: 450e6,
  load: { re: 20, im: -12 },
  realize: { enabled: true, series: 'E24', stockText: '', scope: 'all' },
};

const value = (el: unknown): number => (el as { value: number }).value;

describe('realize-aware matching in the app', () => {
  it('returns null for every helper while Realize is off', () => {
    const off: Design = { ...base, realize: { ...base.realize, enabled: false } };
    const sols = lMatch(off.load, { re: 50, im: 0 }, off.frequency);
    expect(snapSolutions(off, off.elements, sols)).toBeNull();
    const el = identify([{ kind: 'L', orientation: 'series', value: 16e-9 }])[0]!;
    expect(sliderSteps(off.realize, el, 16e-9)).toBeNull();
  });

  it('snaps "Add parts" solutions to the series and ranks them by VSWR', () => {
    const sols = lMatch(base.load, { re: 50, im: 0 }, base.frequency);
    const snapped = snapSolutions(base, base.elements, sols)!;
    expect(snapped).toHaveLength(sols.length);
    for (const r of snapped) {
      for (const el of r.elements) expect(nearestInSeries(value(el), 'E24')).toBe(value(el));
    }
    for (let i = 1; i < snapped.length; i++) {
      expect(snapped[i]!.vswr).toBeGreaterThanOrEqual(snapped[i - 1]!.vswr);
    }
  });

  it('snaps a fit to the stock and reports the residual towards the target', () => {
    const design: Design = {
      ...base,
      elements: identify([
        { kind: 'L', orientation: 'series', value: 12e-9 },
        { kind: 'C', orientation: 'shunt', value: 10e-12 },
      ]),
      realize: {
        enabled: true,
        series: 'stock',
        stockText: '10 nH, 12 nH, 15 nH, 6.8 pF, 8.2 pF, 10 pF',
        scope: 'all',
      },
    };
    const target: Complex = { re: 50, im: 0 };
    const fit = fitToTarget(designLadder(design, design.elements), target)!;
    expect(fit.exact).toBe(true);
    const s = snapFit(design, design.elements, fit)!;
    expect([10e-9, 12e-9, 15e-9]).toContain(value(s.elements[0]));
    expect([6.8e-12, 8.2e-12, 10e-12]).toContain(value(s.elements[1]));
    expect(s.sourceLabel).toBe('stock');
    expect(s.distance).toBeGreaterThan(0);
    expect(s.vswr).toBeGreaterThan(1);
    expect(s.vswr).toBeLessThan(2);
  });

  it('gives a locked or out-of-scope part a continuous slider and the others series steps', () => {
    const [l, c] = identify([
      { kind: 'L', orientation: 'series', value: 16e-9 },
      { kind: 'C', orientation: 'shunt', value: 10e-12 },
    ]);
    expect(sliderSteps(base.realize, l!, 16e-9, 2)).toEqual([13e-9, 15e-9, 16e-9, 18e-9, 20e-9]);
    expect(sliderSteps(base.realize, { ...l!, locked: true }, 16e-9)).toBeNull();
    expect(sliderSteps({ ...base.realize, scope: 'C' }, l!, 16e-9)).toBeNull();
    expect(sliderSteps({ ...base.realize, scope: 'C' }, c!, 10e-12, 1)).toEqual([
      9.1e-12, 10e-12, 11e-12,
    ]);
    // A stock without capacitors leaves the capacitor slider continuous.
    const stock = { ...base.realize, series: 'stock' as const, stockText: '10 nH, 15 nH' };
    expect(sliderSteps(stock, c!, 10e-12)).toBeNull();
    expect(sliderSteps(stock, l!, 12e-9)).toEqual([10e-9, 15e-9]);
  });
});
