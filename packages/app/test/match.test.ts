import { applyElement, cabs, complex, zToGamma } from '@smithonline/core';
import { describe, expect, it } from 'vitest';
import { lSolutions, matchSolutions, minimumQ } from '../src/lib/match';

const F = 140e6;
const ZIN = complex(25, -18);
const Z0 = complex(50, 0);

describe('matchSolutions', () => {
  it('offers the L-networks with the single parts that reach the target', () => {
    const sols = matchSolutions('L', ZIN, Z0, 50, F, 0);
    expect(sols.length).toBeGreaterThanOrEqual(2);
    expect(sols).toEqual(lSolutions(ZIN, Z0, 50, F));
    for (let i = 1; i < sols.length; i++) expect(sols[i]!.q).toBeGreaterThanOrEqual(sols[i - 1]!.q);
  });

  it('builds Pi and T networks at the requested Q and lands on the target', () => {
    for (const topology of ['Pi', 'T'] as const) {
      const sols = matchSolutions(topology, ZIN, Z0, 50, F, 5);
      expect(sols).toHaveLength(2);
      for (const s of sols) {
        let z = ZIN;
        for (const el of s.elements) z = applyElement(el, z, F);
        expect(cabs(zToGamma(z, 50))).toBeLessThan(1e-6);
        expect(s.q).toBeCloseTo(5, 6);
      }
    }
  });

  it('offers nothing below the minimum Q and something just above it', () => {
    for (const topology of ['Pi', 'T'] as const) {
      const q = minimumQ(topology, ZIN, Z0);
      expect(q).toBeGreaterThan(0);
      expect(matchSolutions(topology, ZIN, Z0, 50, F, q * 0.9)).toEqual([]);
      expect(matchSolutions(topology, ZIN, Z0, 50, F, q * 1.1).length).toBeGreaterThan(0);
    }
  });

  it('reads the minimum Q of a T from the series resistances: 500 to 50 ohm is 3', () => {
    expect(minimumQ('T', complex(500, 0), Z0)).toBeCloseTo(3, 9);
    expect(minimumQ('Pi', complex(500, 0), Z0)).toBeCloseTo(3, 9);
    expect(minimumQ('T', complex(0, 10), Z0)).toBe(Infinity);
  });
});
