import { expect, it } from 'vitest';
import { complex, designStubFilter, ladderAbcd, transmissionS21 } from '../src/index';

/** Adversary scan: Chebyshev high-pass ripples where the Delta bisection does not bracket. */
it('adv scan: high-pass cutoff loss is the ripple for every order at small ripples', () => {
  const out: string[] = [];
  for (let n = 1; n <= 9; n++) {
    const fails: string[] = [];
    for (const r of [0.001, 0.0015, 0.002, 0.003, 0.005, 0.0075, 0.01, 0.02, 0.05]) {
      const d = designStubFilter({
        kind: 'highpass',
        response: 'chebyshev',
        order: n,
        rippleDb: r,
        cutoff: 1e9,
        z0: 50,
      });
      const got = -transmissionS21(ladderAbcd(d.elements, 1e9), complex(50), 50).db;
      if (Math.abs(got - r) > 1e-3 * Math.max(1, r)) fails.push(`${r} (${got.toFixed(3)} dB)`);
    }
    if (fails.length) out.push(`N ${n}: ${fails.join(', ')}`);
  }
  expect(out).toEqual([]);
});
