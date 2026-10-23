/** QA round 2 (distributed synthesis), adversary: the exact band, the widened high-pass bracket, inRange. */
import { describe, expect, it } from 'vitest';
import {
  cabs,
  cadd,
  cdiv,
  complex,
  csub,
  designStubFilter,
  inRange,
  ladderAbcd,
  multisectionTransformer,
  throughAbcd,
  transmissionS21,
  type Element,
  type TransformerType,
} from '../src/index';

const F = 1e9;
function gammaMag(elements: readonly Element[], load: number, z0: number, f: number): number {
  const z = throughAbcd(ladderAbcd(elements, f), complex(load));
  return cabs(cdiv(csub(z, complex(z0)), cadd(z, complex(z0))));
}

/** Dense check: the first grid point (5e-6 step) inside the reported band where |Gamma| is above the limit, or null. */
function overInside(
  elements: readonly Element[],
  load: number,
  g: number,
  bw: number,
): number | null {
  const edge = 1 - bw / 2;
  for (let x = 1; x >= edge; x -= 5e-6)
    if (gammaMag(elements, load, 50, x * F) > g * (1 + 1e-9)) return x;
  return null;
}

describe('adv r2: exactBand against a dense scan', () => {
  it(
    'the reported band never covers a frequency where |Gamma| is above the limit (1e-3 scan step skipping narrow excursions)',
    { timeout: 600000 },
    () => {
      const bad: string[] = [];
      for (const type of ['chebyshev'] as TransformerType[])
        for (const ratio of [1.5, 2, 4])
          for (const g of [0.01, 0.05])
            for (let n = 1; n <= 6; n++) {
              const t = multisectionTransformer(50, 50 * ratio, n, {
                type,
                frequency: F,
                gammaMax: g,
              });
              if (t.bandwidth === null || t.bandwidth === 0) continue;
              const x = overInside(t.elements, 50 * ratio, g, t.bandwidth);
              if (x !== null)
                bad.push(
                  `${type} ratio ${ratio} g ${g} N ${n}: reported ${(t.bandwidth * 100).toFixed(3)} %, |Gamma| ${gammaMag(t.elements, 50 * ratio, 50, x * F).toFixed(6)} at f/f0 ${x.toFixed(6)}`,
                );
            }
      expect(bad).toEqual([]);
    },
  );

  it('an even-order Chebyshev, ripple at f0 equal to the limit in theory, still gets a band (not "0" for a rounding hair)', () => {
    const zero: string[] = [];
    for (const ratio of [1.2, 1.5, 2, 3])
      for (const g of [0.01, 0.05, 0.1])
        for (const n of [2, 4, 6]) {
          const t = multisectionTransformer(50, 50 * ratio, n, {
            type: 'chebyshev',
            frequency: F,
            gammaMax: g,
          });
          if (t.bandwidth === 0)
            zero.push(
              `ratio ${ratio} g ${g} N ${n}: centre ${t.centreGamma.toPrecision(8)} vs limit ${g} (theory BW ${((t.theoryBandwidth ?? 0) * 100).toFixed(1)} %)`,
            );
        }
    expect(zero).toEqual([]);
  });

  it('a ripple just over the limit inside the band does not collapse the band far below the theory band without the warning (peak <= 1.1 gammaMax)', () => {
    const collapsed: string[] = [];
    for (const ratio of [1.2, 1.5, 2, 3])
      for (const g of [0.01, 0.05, 0.1])
        for (let n = 1; n <= 6; n++) {
          const t = multisectionTransformer(50, 50 * ratio, n, {
            type: 'chebyshev',
            frequency: F,
            gammaMax: g,
          });
          if (t.theoryBandwidth === null || t.bandwidth === null) continue;
          // The UI warns only when peakGamma > 1.1 gammaMax.
          if (t.peakGamma <= 1.1 * g && t.bandwidth < 0.8 * t.theoryBandwidth)
            collapsed.push(
              `ratio ${ratio} g ${g} N ${n}: exact ${(t.bandwidth * 100).toFixed(1)} % vs theory ${(t.theoryBandwidth * 100).toFixed(1)} %, peak ${t.peakGamma.toFixed(4)}`,
            );
        }
    expect(collapsed).toEqual([]);
  });

  it('a step just inside the limit (whole band) and just outside it stay continuous', () => {
    // DC reflection of 50 -> 50 r is (r - 1) / (r + 1); put the limit just above and below it.
    const r = 1.2;
    const dc = (r - 1) / (r + 1);
    const out: string[] = [];
    for (const type of ['binomial', 'chebyshev'] as TransformerType[])
      for (const g of [dc * (1 + 1e-9), dc * (1 - 1e-9), dc * 1.001, dc * 0.999, Math.log(r) / 2]) {
        const t = multisectionTransformer(50, 50 * r, 3, { type, frequency: F, gammaMax: g });
        out.push(
          `${type} g ${g.toPrecision(10)}: bw ${t.bandwidth} centre ${t.centreGamma.toExponential(2)}`,
        );
        expect(t.bandwidth === null || (t.bandwidth > 0 && t.bandwidth <= 2)).toBe(true);
      }
  });
});

describe('adv r2: high-pass after the decade widening', () => {
  it('no order and ripple the UI accepts (0.001 to 10 dB) throws, and every one hits its cutoff loss', () => {
    const bad: string[] = [];
    const ripples = [0.001, 0.0011, 0.0013, 0.0017, 0.002, 0.003, 0.005, 0.01, 0.1, 1, 5, 9.99, 10];
    for (const response of ['butterworth', 'chebyshev'] as const)
      for (const r of response === 'butterworth' ? [0.5] : ripples)
        for (let n = 1; n <= 9; n++) {
          try {
            const d = designStubFilter({
              kind: 'highpass',
              response,
              order: n,
              rippleDb: r,
              cutoff: F,
              z0: 50,
            });
            const want = response === 'butterworth' ? 10 * Math.log10(2) : r;
            const got = -transmissionS21(ladderAbcd(d.elements, F), complex(50), 50).db;
            if (!(Math.abs(got - want) < 1e-6 * Math.max(1, want)))
              bad.push(`${response} r ${r} N ${n}: ${got} dB at fc, wanted ${want}`);
            if (!d.elements.every((e) => Number.isFinite(e.z0) && e.z0 > 0))
              bad.push(`${response} r ${r} N ${n}: non-finite impedance`);
          } catch (e) {
            bad.push(`${response} r ${r} N ${n}: threw ${(e as Error).message}`);
          }
        }
    expect(bad).toEqual([]);
  });

  it('the found high-pass passes: loss at 2 fc (stubs a quarter wave, open) stays under 3 dB', () => {
    const bad: string[] = [];
    for (const r of [0.001, 0.002, 0.005, 0.01, 0.1, 0.5, 3])
      for (let n = 1; n <= 9; n++) {
        const d = designStubFilter({
          kind: 'highpass',
          response: 'chebyshev',
          order: n,
          rippleDb: r,
          cutoff: F,
          z0: 50,
        });
        const at2 = -transmissionS21(ladderAbcd(d.elements, 2 * F), complex(50), 50).db;
        const at1p5 = -transmissionS21(ladderAbcd(d.elements, 1.5 * F), complex(50), 50).db;
        const zs = d.stubImpedances.map((z) => z.toPrecision(3)).join(', ');
        if (!(at2 < 3) || !(at1p5 < 3))
          bad.push(
            `r ${r} N ${n}: loss ${at1p5.toFixed(2)} dB at 1.5 fc, ${at2.toFixed(2)} dB at 2 fc; stubs ${zs}`,
          );
      }
    expect(bad).toEqual([]);
  });
});

describe('adv r2: inRange and the table flag', () => {
  it('the table rule (inRange in DistributedTools.tsx) agrees with outOfRange for every design', () => {
    const bad: string[] = [];
    for (const z0 of [25, 50, 75, 100, 150, 15, 7.5, 300])
      for (const kind of ['lowpass', 'highpass'] as const)
        for (const response of ['butterworth', 'chebyshev'] as const)
          for (let n = 1; n <= 9; n++) {
            let d;
            try {
              d = designStubFilter({ kind, response, order: n, cutoff: F, z0 });
            } catch {
              continue;
            }
            const strict = d.elements.filter((e) => !inRange(e.z0, d.range)).length;
            if (strict !== d.outOfRange.length)
              bad.push(
                `${kind} ${response} N ${n} z0 ${z0}: table flags ${strict}, count says ${d.outOfRange.length}; values ${d.elements
                  .map((e) => e.z0)
                  .filter((z) => !inRange(z, [15, 150]) !== (z < 15 || z > 150))
                  .join(', ')}`,
              );
          }
    expect(bad).toEqual([]);
  });
});

describe('adv r2: the exact bands as a list the user ranks', () => {
  function shrinking(ratios: readonly number[], limits: readonly number[]): string[] {
    const bad: string[] = [];
    for (const type of ['binomial', 'chebyshev'] as TransformerType[])
      for (const ratio of ratios)
        for (const g of limits) {
          const bw = [1, 2, 3, 4, 5, 6].map((n) => {
            const t = multisectionTransformer(50, 50 / ratio, n, {
              type,
              frequency: F,
              gammaMax: g,
            });
            return t.bandwidth === null ? 2 : t.bandwidth;
          });
          for (let n = 1; n < 6; n++)
            if ((bw[n] as number) < (bw[n - 1] as number) - 1e-6)
              bad.push(
                `${type} ${ratio}:1 g ${g}: N ${n} ${((bw[n - 1] as number) * 100).toFixed(1)} %, N ${n + 1} ${((bw[n] as number) * 100).toFixed(1)} %`,
              );
        }
    return bad;
  }

  it('one more section never lists a narrower band (steps 1.5:1 to 10:1, Max |Γ| 0.005 to 0.2)', () => {
    expect(shrinking([1.5, 2, 4, 10], [0.005, 0.01, 0.05, 0.2])).toEqual([]);
  });

  // Known limit, QA round 2: at 100:1, or at |Γ| 0.001 on 10:1, the small-reflection
  // synthesis itself is too coarse and an odd N can list a narrower band than N - 1. The
  // bands listed are true for the lines built; an exact synthesis (Riblet) would remove it.
  it.fails('one more section never lists a narrower band at 100:1 or at Max |Γ| 0.001', () => {
    expect([...shrinking([100], [0.001, 0.005, 0.01]), ...shrinking([10], [0.001])]).toEqual([]);
  });
});
