import { describe, expect, it } from 'vitest';
import {
  applyElement,
  cabs,
  complex,
  csub,
  piMatch,
  teeMatch,
  zToGamma,
  type Complex,
  type Element,
} from '../src/index';

const F = 100e6;

function through(elements: readonly Element[], zin: Complex, f: number): Complex {
  let z = zin;
  for (const e of elements) z = applyElement(e, z, f);
  return z;
}

function orientations(elements: readonly Element[]): string[] {
  return elements.map((e) => (e as { orientation: string }).orientation);
}

describe('teeMatch and piMatch', () => {
  // QuickSmith case match-pi-and-t: load 25 - j18 at 140 MHz, Q 5. Four
  // three-element networks, each landing within |Gamma| 1e-4 at the requested Q.
  it('match at exactly the Q they were asked for (QuickSmith match-pi-and-t)', () => {
    const f = 140e6;
    const zin = complex(25, -18);
    const target = complex(50, 0);
    const sols = [...teeMatch(zin, target, f, 5), ...piMatch(zin, target, f, 5)];
    expect(sols).toHaveLength(4);
    for (const s of sols) {
      expect(s.elements).toHaveLength(3);
      expect(cabs(zToGamma(through(s.elements, zin, f), 50))).toBeLessThan(1e-4);
      expect(Math.abs(s.q - 5)).toBeLessThan(1e-3);
    }
  });

  it('a higher Q is a narrower network and still exact (QuickSmith match-pi-and-t-high-q)', () => {
    const f = 175e6;
    const zin = complex(1.94, 1.1);
    const target = complex(50, 0);
    const sols = [...teeMatch(zin, target, f, 12), ...piMatch(zin, target, f, 12)];
    expect(sols).toHaveLength(4);
    for (const s of sols) {
      expect(cabs(zToGamma(through(s.elements, zin, f), 50))).toBeLessThan(1e-4);
      expect(Math.abs(s.q - 12)).toBeLessThan(1e-3);
    }
  });

  it('offers nothing below the Q of the L-network (QuickSmith match-q-below-the-l-network)', () => {
    const zin = complex(1.94, 1.1);
    expect(teeMatch(zin, complex(50, 0), 175e6, 2)).toEqual([]);
    expect(piMatch(zin, complex(50, 0), 175e6, 2)).toEqual([]);
  });

  it('builds the T as series, shunt, series and the Pi as shunt, series, shunt', () => {
    const tees = teeMatch(complex(25, -18), complex(50, 0), 140e6, 5);
    expect(tees.map((s) => s.elements.map((e) => e.kind).join(''))).toEqual(
      expect.arrayContaining(['LCL', 'CLC']),
    );
    for (const s of tees) {
      expect(orientations(s.elements)).toEqual(['series', 'shunt', 'series']);
      expect(s.description.startsWith('T: ')).toBe(true);
    }
    const pis = piMatch(complex(25, -18), complex(50, 0), 140e6, 5);
    expect(pis.map((s) => s.elements.map((e) => e.kind).join(''))).toEqual(
      expect.arrayContaining(['CLC', 'LCL']),
    );
    for (const s of pis) {
      expect(orientations(s.elements)).toEqual(['shunt', 'series', 'shunt']);
      expect(s.description.startsWith('Pi: ')).toBe(true);
    }
  });

  it('reaches a complex target', () => {
    const zin = complex(30, 40);
    const target = complex(80, -25);
    const sols = [...teeMatch(zin, target, F, 4), ...piMatch(zin, target, F, 4)];
    expect(sols).toHaveLength(4);
    for (const s of sols) {
      const z = through(s.elements, zin, F);
      expect(cabs(csub(z, target))).toBeLessThan(1e-6 * cabs(target));
      expect(s.q).toBeCloseTo(4, 6);
    }
  });

  it('sorts by Q and lets the load Q count when it is the highest on the path', () => {
    // A load with Q 6 stays the highest point of a Q 3 network.
    const zin = complex(10, 60);
    const sols = teeMatch(zin, complex(50, 0), F, 3);
    expect(sols.length).toBeGreaterThan(0);
    for (const s of sols) expect(s.q).toBeCloseTo(6, 6);
    for (let i = 1; i < sols.length; i++) expect(sols[i]!.q).toBeGreaterThanOrEqual(sols[i - 1]!.q);
  });

  it('rejects a load without resistance, a zero frequency or a zero Q', () => {
    expect(teeMatch(complex(0, 30), complex(50, 0), F, 3)).toEqual([]);
    expect(piMatch(complex(50, 0), complex(50, 0), 0, 3)).toEqual([]);
    expect(piMatch(complex(50, 0), complex(50, 0), F, 0)).toEqual([]);
    expect(teeMatch(complex(50, 0), complex(50, 0), F, Infinity)).toEqual([]);
  });
});
