import {
  broadbandMatch,
  nearestInSeries,
  sweepPoints,
  worstVswr,
  type Complex,
} from '@smithonline/core';
import { describe, expect, it } from 'vitest';
import { bandLoad, loadModelOf, snapCandidate } from '../src/lib/broadband';
import { emptyDesign, identify, type Design } from '../src/lib/design';

const BAND = sweepPoints(100e6, 200e6, 21);
const TARGET: Complex = { re: 50, im: 0 };

const base: Design = {
  ...emptyDesign(),
  frequency: 150e6,
  load: { re: 10, im: 0 },
  realize: { enabled: true, series: 'E24', stockText: '', scope: 'all' },
};

const value = (el: unknown): number => (el as { value: number }).value;

describe('broadband matching in the app', () => {
  const result = broadbandMatch(BAND, { load: base.load, z0: 50, maxElements: 3 });
  const best = result.candidates[0]!;

  it('snaps only the new parts and measures the worst VSWR on the whole ladder', () => {
    const keep = identify([{ kind: 'L', orientation: 'series', value: 11.7e-9 }]);
    const withPrefix = broadbandMatch(BAND, {
      load: base.load,
      z0: 50,
      maxElements: 2,
      prefix: keep,
    });
    const cand = withPrefix.candidates[0]!;
    const snapped = snapCandidate(base, keep, cand, base.load, BAND, TARGET)!;
    expect(snapped.elements).toHaveLength(cand.elements.length);
    for (const el of snapped.elements) expect(nearestInSeries(value(el), 'E24')).toBe(value(el));
    expect(snapped.worstVswr).toBeCloseTo(
      worstVswr([...keep, ...snapped.elements], base.load, 50, BAND, TARGET),
      9,
    );
    // Snapping costs a little but must not wreck the match.
    expect(snapped.worstVswr).toBeLessThan(withPrefix.baseline);
  });

  it('is null while Realize is off', () => {
    const off: Design = { ...base, realize: { ...base.realize, enabled: false } };
    expect(snapCandidate(off, [], best, base.load, BAND, TARGET)).toBeNull();
  });

  it('judges the band against the datapoint loads only when asked and there are two or more', () => {
    const loads = [
      { frequency: 140e6, z: { re: 40, im: 5 } },
      { frequency: 150e6, z: { re: 60, im: -5 } },
    ];
    const d: Design = { ...base, sweep: { ...base.sweep, loads } };
    expect(bandLoad(d, true)).toBe(loads);
    expect(bandLoad(d, false)).toBe(d.load);
    expect(bandLoad(base, true)).toBe(base.load);
    const model = loadModelOf(bandLoad(d, true));
    expect(typeof model).toBe('function');
    if (typeof model === 'function') expect(model(145e6).re).toBeCloseTo(50, 9);
  });
});
