import { describe, expect, it } from 'vitest';
import { complex } from '../src/complex.js';
import { chartDistance, fitToTarget, fittableIndices } from '../src/fit.js';
import { evaluateLadder, type Ladder } from '../src/ladder.js';
import type { Element } from '../src/elements.js';

const Z0 = 50;

describe('fitToTarget', () => {
  it('re-solves a detuned L-network exactly', () => {
    // Example 1 of Smith V4.1: 10 + j7 to 50 ohm at 150 MHz with series C and shunt L
    // (39.2 pF, 26.6 nH). Start from values 30 percent off.
    const ladder: Ladder = {
      z0: Z0,
      frequency: 150e6,
      load: complex(10, 7),
      elements: [
        { kind: 'C', orientation: 'series', value: 30e-12 },
        { kind: 'L', orientation: 'shunt', value: 35e-9 },
      ],
    };
    const fit = fitToTarget(ladder, complex(50, 0));
    expect(fit).not.toBeNull();
    expect(fit!.exact).toBe(true);
    expect(fit!.after).toBeLessThan(1e-4);
    // Series C must add X = -(7 + sqrt(10 (50 - 10))) = -27 ohm, the shunt L then cancels B = 0.04 S.
    const w = 2 * Math.PI * 150e6;
    expect((fit!.elements[0] as { value: number }).value / (1 / (w * 27))).toBeCloseTo(1, 3);
    expect((fit!.elements[1] as { value: number }).value / (1 / (w * 0.04))).toBeCloseTo(1, 3);
  });

  it('tunes only the free parts: Example 18 with the inductors fixed', () => {
    // 61 + j60 ohm at 145 MHz, lowpass with three capacitors to tune and 56 nH coils fixed.
    const elements: Element[] = [
      { kind: 'C', orientation: 'shunt', value: 15e-12 },
      { kind: 'L', orientation: 'series', value: 56e-9 },
      { kind: 'C', orientation: 'shunt', value: 15e-12 },
      { kind: 'L', orientation: 'series', value: 56e-9 },
      { kind: 'C', orientation: 'shunt', value: 15e-12 },
    ];
    const ladder: Ladder = { z0: Z0, frequency: 145e6, load: complex(61, 60), elements };
    const fit = fitToTarget(ladder, complex(50, 0), { indices: [0, 2, 4] });
    expect(fit).not.toBeNull();
    expect(fit!.indices).toEqual([0, 2, 4]);
    expect(fit!.after).toBeLessThan(1e-3);
    expect((fit!.elements[1] as { value: number }).value).toBe(56e-9);
    expect((fit!.elements[3] as { value: number }).value).toBe(56e-9);
    const zin = evaluateLadder({ ...ladder, elements: fit!.elements }).zin;
    expect(chartDistance(zin, complex(50, 0), Z0)).toBeLessThan(1e-3);
  });

  it('keeps a matched design untouched and reports it exact', () => {
    const w = 2 * Math.PI * 150e6;
    const ladder: Ladder = {
      z0: Z0,
      frequency: 150e6,
      load: complex(10, 7),
      elements: [
        { kind: 'C', orientation: 'series', value: 1 / (w * 27) },
        { kind: 'L', orientation: 'shunt', value: 1 / (w * 0.04) },
      ],
    };
    const fit = fitToTarget(ladder, complex(50, 0));
    expect(fit!.exact).toBe(true);
    expect(fit!.elements).toBe(ladder.elements);
  });

  it('returns null when nothing can be varied and lists fittable parts', () => {
    const ladder: Ladder = {
      z0: Z0,
      frequency: 1e9,
      load: complex(20, 0),
      elements: [
        { kind: 'RLC', orientation: 'shunt', connection: 'series', r: 5, l: 1e-9, c: 1e-12 },
      ],
    };
    expect(fittableIndices(ladder)).toEqual([]);
    expect(fitToTarget(ladder, complex(50, 0))).toBeNull();
  });

  it('gets as close as one part allows', () => {
    const ladder: Ladder = {
      z0: Z0,
      frequency: 1e9,
      load: complex(20, 0),
      elements: [{ kind: 'L', orientation: 'series', value: 1e-9 }],
    };
    const fit = fitToTarget(ladder, complex(50, 0));
    expect(fit).not.toBeNull();
    // A single series inductor cannot change the resistance: the best it can do is the
    // smallest reactance the bounds allow, Z0 / 25 = 2 ohm.
    expect(fit!.exact).toBe(false);
    expect(fit!.after).toBeLessThan(fit!.before);
    expect(fit!.zin.re).toBeCloseTo(20, 6);
    expect(Math.abs(fit!.zin.im)).toBeLessThan(2.1);
  });
});
