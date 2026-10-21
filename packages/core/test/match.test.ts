import { describe, expect, it } from 'vitest';
import {
  applyElement,
  cabs,
  complex,
  csub,
  elementReach,
  lMatch,
  matchToZ0,
  singleMatch,
  zToGamma,
  type Element,
} from '../src/index';

const F = 100e6;

function landsOn(
  elements: readonly Element[],
  zin: { re: number; im: number },
  target: { re: number; im: number },
): void {
  let z = zin;
  for (const e of elements) z = applyElement(e, z, F);
  expect(cabs(csub(z, target))).toBeLessThan(1e-6 * Math.max(cabs(target), 1));
}

describe('lMatch', () => {
  it('matches 500 ohm to 50 ohm at 100 MHz with shunt C 9.55 pF and series L 239 nH (QuickSmith Example 2)', () => {
    const sols = matchToZ0(complex(500, 0), 50, F);
    expect(sols.length).toBe(2); // only shunt-first works, R_in > Z0
    const best = sols.find((s) => s.elements[0]?.kind === 'C' && s.elements[1]?.kind === 'L');
    expect(best).toBeDefined();
    expect(best!.elements[0]).toMatchObject({ kind: 'C', orientation: 'shunt' });
    expect((best!.elements[0] as { value: number }).value).toBeCloseTo(9.549e-12, 14);
    expect((best!.elements[1] as { value: number }).value).toBeCloseTo(238.73e-9, 11);
    for (const s of sols) landsOn(s.elements, complex(500, 0), complex(50, 0));
    expect(sols[0]!.q).toBeCloseTo(3, 6); // sqrt(500 / 50 - 1)
  });

  it('offers all four solutions for a complex load inside both regions', () => {
    // 30 - j60: R < Z0 and R_p = |Z|^2 / R = 150 > Z0, so both shapes work.
    const zin = complex(30, -60);
    const sols = lMatch(zin, complex(50, 0), F);
    expect(sols).toHaveLength(4);
    for (const s of sols) {
      expect(s.elements).toHaveLength(2);
      landsOn(s.elements, zin, complex(50, 0));
    }
    // Sorted by Q, lowest first.
    for (let i = 1; i < sols.length; i++) expect(sols[i]!.q).toBeGreaterThanOrEqual(sols[i - 1]!.q);
  });

  it('matches to an arbitrary complex target', () => {
    const zin = complex(30, -40);
    const target = complex(80, 25);
    const sols = lMatch(zin, target, F);
    expect(sols.length).toBeGreaterThan(0);
    for (const s of sols) landsOn(s.elements, zin, target);
  });

  it('drops a zero-valued part and keeps the single element that remains', () => {
    // From 50 + j30 to 50 + j0 a series C alone does it: the shunt part is zero.
    const sols = lMatch(complex(50, 30), complex(50, 0), F);
    const single = sols.filter((s) => s.elements.length === 1);
    expect(single.length).toBeGreaterThan(0);
    expect(single[0]!.elements[0]).toMatchObject({ kind: 'C', orientation: 'series' });
  });

  it('returns nothing for a load without resistance', () => {
    expect(lMatch(complex(0, 30), complex(50, 0), F)).toEqual([]);
    expect(lMatch(complex(50, 0), complex(50, 0), 0)).toEqual([]);
  });
});

describe('singleMatch', () => {
  it('finds the one element that reaches the target and ignores the rest', () => {
    const zin = complex(50, 30);
    const target = complex(50, -20);
    const candidates: Element[] = [
      { kind: 'L', orientation: 'series', value: 1e-9 },
      { kind: 'C', orientation: 'series', value: 1e-12 },
      { kind: 'C', orientation: 'shunt', value: 1e-12 },
      { kind: 'line', z0: 50, length: 0.1, refFrequency: F },
    ];
    const sols = singleMatch(candidates, zin, target, F);
    expect(
      sols.map(
        (s) => s.elements[0]!.kind + (s.elements[0] as { orientation?: string }).orientation,
      ),
    ).toEqual(['Cseries']);
    landsOn(sols[0]!.elements, zin, target);
  });

  it('a line reaches any point on its constant |Gamma| circle', () => {
    const zin = complex(30, -40);
    const line: Element = { kind: 'line', z0: 50, length: 0.1, refFrequency: F };
    const target = applyElement({ ...line, length: 0.3 }, zin, F);
    const sols = singleMatch([line], zin, target, F);
    expect(sols).toHaveLength(1);
    expect((sols[0]!.elements[0] as { length: number }).length).toBeCloseTo(0.3, 9);
  });
});

describe('elementReach', () => {
  it('spans the constant-R circle for a series inductor and ends near the rim', () => {
    const zin = complex(30, -40);
    const pts = elementReach(
      { kind: 'L', orientation: 'series', value: 50 / (2 * Math.PI * F) },
      zin,
      F,
      50,
    );
    expect(pts).toHaveLength(51);
    for (const p of pts) expect(p.re).toBeCloseTo(30, 9);
    expect(pts[0]!.im).toBeCloseTo(-40 + 0.5, 6);
    expect(cabs(zToGamma(pts[50]!, 50))).toBeGreaterThan(0.95);
  });

  it('a line reach is the full constant |Gamma| circle and a stub stays on constant G', () => {
    const zin = complex(30, -40);
    const g0 = cabs(zToGamma(zin, 50));
    for (const p of elementReach(
      { kind: 'line', z0: 50, length: 0.1, refFrequency: F },
      zin,
      F,
      40,
    )) {
      expect(cabs(zToGamma(p, 50))).toBeCloseTo(g0, 9);
    }
    const g = 30 / (30 * 30 + 40 * 40);
    for (const p of elementReach(
      { kind: 'openStub', z0: 50, length: 0.1, refFrequency: F },
      zin,
      F,
      40,
    )) {
      const d = p.re * p.re + p.im * p.im;
      // Skip the quarter-wave point where the stub shorts the node.
      if (d > 1e-6 && Number.isFinite(d)) expect(p.re / d).toBeCloseTo(g, 6);
    }
  });

  it('RLC blocks have no single-value reach', () => {
    expect(
      elementReach(
        { kind: 'RLC', orientation: 'series', connection: 'parallel' },
        complex(50, 0),
        F,
      ),
    ).toEqual([]);
  });
});
