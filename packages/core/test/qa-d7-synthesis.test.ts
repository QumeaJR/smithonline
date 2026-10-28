/**
 * QA round 1, D7: the algebra under the real frequency technique (rft.ts):
 * Belevitch form, Hurwitz factor, root finder, continued fraction synthesis,
 * scaling to elements and the gain conversions, at every degree 1 to 8.
 * Expected values come from hand calculations stated next to each assertion
 * or from identities that hold exactly (g g* = h h* + f f*, g(0)^2 = h(0)^2 + 1
 * for k = 0).
 */
import { describe, expect, it } from 'vitest';
import {
  belevitchGain,
  cabs,
  cadd,
  cdiv,
  complex,
  csub,
  gainOfVswr,
  hurwitzFactor,
  ladderAbcd,
  ladderBelevitch,
  ladderElements,
  polynomialRoots,
  seededRandom,
  synthesizeLadder,
  throughAbcd,
  vswrOfGain,
  type Complex,
  type NormalizedPart,
} from '../src/index.js';

const peval = (a: readonly number[], x: number): number => a.reduce((s, c, i) => s + c * x ** i, 0);

/** Largest relative error of g(p) g(-p) against h(p) h(-p) + (-1)^k p^2k at a few real p. */
function identityError(g: readonly number[], h: readonly number[], k: number): number {
  let worst = 0;
  for (const p of [0, 0.5, 1, 2]) {
    const lhs = peval(g, p) * peval(g, -p);
    const rhs = peval(h, p) * peval(h, -p) + (k % 2 === 0 ? 1 : -1) * p ** (2 * k);
    worst = Math.max(worst, Math.abs(lhs - rhs) / Math.max(1, Math.abs(rhs)));
  }
  return worst;
}

function cascadeGain(parts: readonly NormalizedPart[], zl: Complex, w: number): number {
  const elements = [...parts].reverse().map((p) => ({ ...p }));
  const f = w / (2 * Math.PI);
  const zin = throughAbcd(ladderAbcd(elements, f), zl);
  const g = cabs(cdiv(csub(zin, complex(1)), cadd(zin, complex(1))));
  return 1 - g * g;
}

/** A random alternating ladder of n parts, k of them with a zero at DC, values 0.2 to 5. */
function randomLadder(rand: () => number, n: number): NormalizedPart[] {
  const k = Math.floor(rand() * (n + 1));
  const atZero = new Set<number>();
  while (atZero.size < k) atZero.add(Math.floor(rand() * n));
  const seriesFirst = rand() < 0.5;
  return Array.from({ length: n }, (_, i) => {
    const orientation = (i % 2 === 0) === seriesFirst ? 'series' : 'shunt';
    const kind = (orientation === 'series') === atZero.has(i) ? 'C' : 'L';
    return { orientation, kind, value: Math.exp(Math.log(0.2) + rand() * Math.log(25)) };
  });
}

describe('polynomialRoots', () => {
  it('degree 0 has no roots, leading zeros are dropped', () => {
    expect(polynomialRoots([3])).toEqual([]);
    // (p - 1)(p - 2)(p + 3) = p^3 - 7p + 6, written with two zero leading coefficients.
    const r = polynomialRoots([6, -7, 0, 1, 0, 0]).map((z) => z.re);
    expect(r).toHaveLength(3);
    expect([...r].sort((a, b) => a - b).map((x) => Math.round(x * 1e9) / 1e9)).toEqual([-3, 1, 2]);
  });

  it('roots 1 to 8 of the degree 8 product', () => {
    let p = [1];
    for (let k = 1; k <= 8; k++) {
      const next = new Array<number>(p.length + 1).fill(0);
      p.forEach((c, i) => {
        next[i + 1] = (next[i + 1] as number) + c;
        next[i] = (next[i] as number) - k * c;
      });
      p = next;
    }
    const r = polynomialRoots(p)
      .map((z) => z.re)
      .sort((a, b) => a - b);
    r.forEach((x, i) => expect(Math.abs(x - (i + 1))).toBeLessThan(1e-6));
  });
});

describe('Belevitch form, Hurwitz factor and synthesis on random ladders, degree 1 to 8', () => {
  const rand = seededRandom(7);
  for (let n = 1; n <= 8; n++) {
    it(`degree ${n}: g recovered, positive parts, the ladder's gain is the shape`, () => {
      let checked = 0;
      for (let t = 0; t < 120; t++) {
        const parts = randomLadder(rand, n);
        const b = ladderBelevitch(parts);
        // A ladder whose parts merge at DC or infinity has a lower degree: not this test's case.
        if (Math.abs(b.g[0] as number) < 1e-9 || Math.abs(b.g[n] as number) < 1e-9) continue;
        checked++;
        expect(identityError(b.g, b.h, b.k)).toBeLessThan(1e-12);
        const g = hurwitzFactor(b.h, b.k);
        expect(g).not.toBeNull();
        const scale = Math.max(...b.g.map(Math.abs));
        g!.forEach((c, i) => expect(Math.abs(c - (b.g[i] as number)) / scale).toBeLessThan(1e-9));
        const first = parts[0]!;
        const atInfinity = (first.orientation === 'series') === (first.kind === 'L');
        const syn = synthesizeLadder(b, atInfinity ? 'infinity-first' : 'zero-first');
        expect(syn).not.toBeNull();
        expect(syn!.parts).toHaveLength(n);
        syn!.parts.forEach((p) => expect(p.value).toBeGreaterThan(0));
        expect(syn!.termination).toBeGreaterThan(0);
        // The synthesized ladder on a complex load (scaled by its termination, the ideal
        // transformer) has the gain of the Belevitch form.
        for (const w of [0.3, 1, 2.5]) {
          const zl = complex(0.4 + w / 5, -0.6 + w / 3);
          const zt = complex(zl.re * syn!.termination, zl.im * syn!.termination);
          expect(Math.abs(cascadeGain(syn!.parts, zt, w) - belevitchGain(b, w, zl))).toBeLessThan(
            1e-8,
          );
        }
      }
      expect(checked).toBeGreaterThan(10);
    });
  }
});

describe('synthesis of a transformerless ladder that starts with a shunt part', () => {
  it('shunt C 1 then series C 1 (source side first) ends in R0', () => {
    // Hand: Y = p + p / (1 + p), Z = (1 + p) / (p^2 + 2p). The code removes Z's pole at
    // zero first (residue 1/2: series C 2), then Y = 2p + 4 (shunt C 2), ending in 1/4.
    // The ladder it came from ends in 1, so a ladder without a transformer exists.
    const parts: NormalizedPart[] = [
      { orientation: 'shunt', kind: 'C', value: 1 },
      { orientation: 'series', kind: 'C', value: 1 },
    ];
    const b = ladderBelevitch(parts);
    expect(b.k).toBe(1);
    for (const order of ['infinity-first', 'zero-first'] as const) {
      const syn = synthesizeLadder(b, order);
      expect(syn).not.toBeNull();
      expect(syn!.termination).toBeCloseTo(1, 9);
    }
  });
});

describe('ladderElements', () => {
  it('scales to R0 and omega, load side first, the transformer only when asked and needed', () => {
    const s = {
      parts: [
        { orientation: 'series', kind: 'L', value: 2 },
        { orientation: 'shunt', kind: 'C', value: 3 },
      ] as NormalizedPart[],
      termination: 4,
    };
    // Hand: L = 2 * 50 / 1e9 = 1e-7 H, C = 3 / (50 * 1e9) = 6e-11 F, n = sqrt(4) = 2.
    const plain = ladderElements(s, 50, 1e9);
    expect(plain).toHaveLength(2);
    expect(plain[0]).toMatchObject({ kind: 'C', orientation: 'shunt' });
    expect((plain[0] as { value: number }).value).toBeCloseTo(6e-11, 20);
    expect(plain[1]).toMatchObject({ kind: 'L', orientation: 'series' });
    expect((plain[1] as { value: number }).value).toBeCloseTo(1e-7, 18);
    const withT = ladderElements(s, 50, 1e9, true);
    expect(withT[0]).toEqual({ kind: 'transformer', n: 2 });
    expect(withT).toHaveLength(3);
    expect(ladderElements({ ...s, termination: 1 }, 50, 1e9, true)).toHaveLength(2);
  });
});

describe('gain and VSWR limits', () => {
  it('vswrOfGain: no gain is infinite VSWR, a gain above 1 is a match', () => {
    expect(vswrOfGain(0)).toBe(Infinity);
    expect(vswrOfGain(-0.1)).toBe(Infinity);
    expect(vswrOfGain(NaN)).toBe(Infinity);
    expect(vswrOfGain(1)).toBe(1);
    expect(vswrOfGain(1.5)).toBe(1);
    // Gain 0.75: |Gamma| = 0.5, VSWR 3.
    expect(vswrOfGain(0.75)).toBeCloseTo(3, 12);
  });

  it('gainOfVswr: VSWR 3 is 0.75, below 1 is NaN, an infinite VSWR is no gain', () => {
    expect(gainOfVswr(3)).toBeCloseTo(0.75, 12);
    expect(gainOfVswr(1)).toBe(1);
    expect(gainOfVswr(0.5)).toBeNaN();
    // |Gamma| = 1: gain 0 (observed NaN: (Inf - 1) / (Inf + 1)).
    expect(gainOfVswr(Infinity)).toBe(0);
  });
});
