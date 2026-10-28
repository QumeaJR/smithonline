/**
 * QA round 1, D7: hurwitzFactor (rft.ts) keeps the roots of its last call per
 * degree (warmRoots) as the start of the next. These tests run first in their
 * own file (vitest gives each file its own module instance), so the first call
 * starts cold, as the optimizer's first evaluation at a degree does.
 */
import { describe, expect, it } from 'vitest';
import { hurwitzFactor } from '../src/index.js';

const peval = (a: readonly number[], x: number): number => a.reduce((s, c, i) => s + c * x ** i, 0);

/** Largest relative error of g(p) g(-p) against h(p) h(-p) + 1 (k = 0) at a few real p. */
function identityError(g: readonly number[], h: readonly number[]): number {
  let worst = 0;
  for (const p of [0, 0.5, 1, 2]) {
    const lhs = peval(g, p) * peval(g, -p);
    const rhs = peval(h, p) * peval(h, -p) + 1;
    worst = Math.max(worst, Math.abs(lhs - rhs) / Math.max(1, Math.abs(rhs)));
  }
  return worst;
}

describe('hurwitzFactor on what the optimizer visits at degree 8', () => {
  // Numerators h(p) (k = 0, h(0) = 0) the optimizer reached on the lesson antenna
  // (10 ohm + 50 nH, 70 to 130 MHz, 8 parts), rounded to 4 digits. Any real h has
  // h h* + 1 > 0 on the imaginary axis, so the Hurwitz factor exists, and g(0)^2 =
  // h(0)^2 + 1 = 1 by hand.
  const nearDegenerate = [0, 0.8216, 3.871, -0.4156, 6.685, -0.5889, 2.512, 0.09651, -2.178e-12];
  const regular = [0, -0.7491, -0.4487, 0.7665, -0.9461, 0.1256, 0.1504, -0.1937, -0.6432];

  it('a leading coefficient near zero gives the factor or null, never a wrong g', () => {
    const g = hurwitzFactor(nearDegenerate, 0);
    if (g !== null) {
      expect(Math.abs(Math.abs(g[0] as number) - 1)).toBeLessThan(1e-6);
      expect(identityError(g, nearDegenerate)).toBeLessThan(1e-6);
    }
  });

  it('a regular h after it gives the same g as on its own (no state from the call before)', () => {
    hurwitzFactor(nearDegenerate, 0);
    const g = hurwitzFactor(regular, 0);
    expect(g).not.toBeNull();
    expect(Math.abs((g![0] as number) - 1)).toBeLessThan(1e-9);
    expect(identityError(g!, regular)).toBeLessThan(1e-9);
  });
});
