import {
  broadbandMatch,
  nearestInSeries,
  realizeLadder,
  sweepPoints,
  worstVswr,
  type Complex,
} from '@smithonline/core';
import { describe, expect, it } from 'vitest';
import {
  bandLoad,
  bandPointCount,
  floorMethodText,
  loadModelOf,
  noFloorReason,
  snapCandidate,
} from '../src/lib/broadband';
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

  it('lets each new part try its neighbouring values against the band', () => {
    const plain = realizeLadder(
      { z0: 50, frequency: 150e6, load: base.load, elements: best.elements },
      { source: { kind: 'series', series: 'E24' }, scope: 'all', target: TARGET },
    );
    const plainWorst = worstVswr(plain.ladder.elements, base.load, 50, BAND, TARGET);
    const snapped = snapCandidate(base, [], best, base.load, BAND, TARGET)!;
    expect(snapped.worstVswr).toBeLessThanOrEqual(plainWorst + 1e-9);
    expect(snapped.worstVswr).toBeGreaterThanOrEqual(best.worstVswr - 1e-9);
    for (const el of snapped.elements) expect(nearestInSeries(value(el), 'E24')).toBe(value(el));
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

describe('broadband panel: band points and the floor wording', () => {
  it('judges the band at the sweep count, 5 to 101, and at least 4 per part plus 1', () => {
    expect(bandPointCount(3, 1)).toBe(5);
    expect(bandPointCount(3, 4)).toBe(17);
    expect(bandPointCount(3, 8)).toBe(33);
    expect(bandPointCount(51, 8)).toBe(51);
    expect(bandPointCount(1001, 2)).toBe(101);
    expect(bandPointCount(NaN, 2)).toBe(9);
  });

  it('names the method behind the floor and says why there is none', () => {
    const fmt = (v: number) => v.toFixed(2);
    expect(
      floorMethodText(
        { q: 2, fractionalBandwidth: 0.5, floor: 2.5, method: 'exact', model: 'parallel RC' },
        fmt,
      ),
    ).toBe('exact for a parallel RC load');
    expect(
      floorMethodText({ q: 2, fractionalBandwidth: 0.5, floor: 2.5, method: 'estimate' }, fmt),
    ).toContain('estimated from the load Q 2.00 at band centre (Yaghjian-Best)');
    expect(noFloorReason(false, 21)).toMatch(/fixed impedance/);
    expect(noFloorReason(true, 5)).toMatch(/the band has 5 points, and below 9/);
    expect(noFloorReason(true, 21)).toMatch(/no resistance/);
  });
});
