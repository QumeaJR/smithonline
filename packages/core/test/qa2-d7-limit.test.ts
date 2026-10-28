/**
 * QA round 2 on D7: one rule for showing a Bode-Fano limit beside results
 * (`shownBandLimit`), used by the real frequency table, the search's limit
 * row and the Response view's dashed line.
 */
import { describe, expect, it } from 'vitest';
import { losslessLadder, shownBandLimit, type Element, type Feasibility } from '../src/index.js';

const floor = (value: number, method: 'exact' | 'estimate'): Feasibility =>
  ({ q: 2, fractionalBandwidth: 0.2, floor: value, method }) as Feasibility;

describe('shownBandLimit', () => {
  it('shows a floor no result beats, exact or estimate, with its method', () => {
    expect(shownBandLimit(floor(1.5, 'estimate'), [2, 1.8]).floor?.method).toBe('estimate');
    expect(shownBandLimit(floor(1.5, 'exact'), [1.5]).floor?.floor).toBe(1.5);
  });

  it('drops a floor a result beats, and says why', () => {
    const r = shownBandLimit(floor(1.5, 'estimate'), [2, 1.4]);
    expect(r.floor).toBeNull();
    expect(r.note).toMatch(
      /estimate does not hold for this load: a ladder found, or the load alone, beats it/,
    );
  });

  it('shows none through kept parts with loss', () => {
    const r = shownBandLimit(floor(1.5, 'exact'), [2], true);
    expect(r.floor).toBeNull();
    expect(r.note).toMatch(/kept parts have loss/);
  });

  it('none without a floor, and no note', () => {
    expect(shownBandLimit(null, [2])).toEqual({ floor: null, note: null });
    expect(shownBandLimit(() => null, [])).toEqual({ floor: null, note: null });
  });

  it('a ladder of L and C is lossless, one with a resistor is not', () => {
    const lc: Element[] = [
      { kind: 'L', value: 10e-9, orientation: 'series' } as Element,
      { kind: 'C', value: 2e-12, orientation: 'shunt' } as Element,
    ];
    expect(losslessLadder(lc, [1e8, 2e8])).toBe(true);
    const r: Element[] = [{ kind: 'R', value: 5, orientation: 'series' } as Element];
    expect(losslessLadder(r, [1e8])).toBe(false);
  });
});
