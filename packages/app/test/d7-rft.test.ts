/** The app side of the real frequency technique (docs/08, D7): labels and the gain curve. */
import { describe, expect, it } from 'vitest';
import { complex, realFrequencyMatch, sweepPoints, type Element } from '@smithonline/core';
import { gainDb, ladderGains, prototypeText, rftLabel } from '../src/lib/rft';

describe('real frequency helpers', () => {
  it('labels a ladder in the search words, skipping anything but L and C', () => {
    const els: Element[] = [
      { kind: 'transformer', n: 1.2 },
      { kind: 'C', orientation: 'shunt', value: 1e-12 },
      { kind: 'L', orientation: 'series', value: 1e-9 },
    ];
    expect(rftLabel(els)).toBe('shunt C + series L');
  });

  it('names the prototype', () => {
    expect(prototypeText({ prototype: 'lowpass', zerosAtDc: 0 })).toBe('lowpass');
    expect(prototypeText({ prototype: 'bandpass', zerosAtDc: 2 })).toBe(
      'bandpass (2 of the parts block DC)',
    );
    expect(gainDb(1)).toBe(0);
    expect(gainDb(0)).toBe(-120);
  });

  it("the gain curve of the result's ladder is its gain shape, and the VSWR it reports", () => {
    const load = (f: number) => complex(10, 2 * Math.PI * f * 50e-9);
    const r = realFrequencyMatch(sweepPoints(70e6, 130e6, 21), { load, z0: 50, parts: 2 });
    const best = r.best!;
    const gains = ladderGains(best.synthesized, load, 50, r.scoringFrequencies);
    gains.forEach((g, i) => expect(Math.abs(g - (best.gain[i] as number))).toBeLessThan(1e-6));
    const final = ladderGains(best.elements, load, 50, r.scoringFrequencies);
    const worst = Math.sqrt(1 - Math.min(...final));
    expect((1 + worst) / (1 - worst)).toBeCloseTo(best.worstVswr, 9);
  }, 60000);
});
