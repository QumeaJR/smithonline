/**
 * Adversarial: one row per distinct network (docs/07 phase 3 leftovers in
 * phase 4) for loads on the unit-resistance and unit-conductance circles,
 * where an L-network's second part comes out at (nearly) zero, and for the
 * Pi and T lists.
 */
import { complex } from '@smithonline/core';
import { describe, expect, it } from 'vitest';
import { elementName, elementSummary } from '../src/lib/elements';
import { matchSolutions } from '../src/lib/match';

const shown = (els: readonly unknown[]): string =>
  els.map((el) => `${elementName(el as never)} ${elementSummary(el as never)}`).join(' + ');

function dupes(topology: 'L' | 'Pi' | 'T', zs: { re: number; im: number }[], q = 3): string[] {
  const out: string[] = [];
  for (const z of zs) {
    const rows = matchSolutions(topology, complex(z.re, z.im), complex(50, 0), 50, 1e9, q).map(
      (r) => shown(r.elements),
    );
    const dup = rows.find((t, i) => rows.indexOf(t) !== i);
    if (dup) out.push(`${topology} ${z.re} ${z.im}: ${dup}`);
  }
  return out;
}

const onR = Array.from({ length: 40 }, (_, k) => ({ re: 50, im: -200 + k * 10 }));
const onG = Array.from({ length: 40 }, (_, k) => {
  const b = (-0.04 + k * 0.002) as number;
  const g = 0.02;
  const d = g * g + b * b;
  return { re: g / d, im: -b / d };
});
const near = Array.from({ length: 40 }, (_, k) => ({ re: 50 + 1e-9 * k, im: -30 + 1e-9 * k }));

describe('no two rows read the same', () => {
  it('L on the R = Z0 and G = 1/Z0 circles', () => {
    expect([...dupes('L', onR), ...dupes('L', onG), ...dupes('L', near)].slice(0, 5)).toEqual([]);
  });
  it('Pi and T', () => {
    const zs = [...onR, ...onG, { re: 10, im: 5 }, { re: 200, im: -80 }];
    expect([...dupes('Pi', zs), ...dupes('T', zs)].slice(0, 5)).toEqual([]);
  });
  it('no row carries a part that rounds to zero', () => {
    const bad: string[] = [];
    for (const z of [...onR, ...onG]) {
      for (const r of matchSolutions('L', complex(z.re, z.im), complex(50, 0), 50, 1e9, 3)) {
        const t = shown(r.elements);
        if (/(^|\s)0 [pnµm]?[FHΩ]|\b0(\.0+)? [pnµm]?[FHΩ]/.test(t))
          bad.push(`${z.re} ${z.im}: ${t}`);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });
});
