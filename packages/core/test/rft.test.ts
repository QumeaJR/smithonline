/**
 * The real frequency technique (rft.ts): the algebra, the closed-form cases
 * and the comparison with the topology search on the reference loads
 * (docs/08-depth-plan.md, D7).
 */
import { describe, expect, it } from 'vitest';
import {
  belevitchGain,
  cabs,
  cadd,
  cdiv,
  complex,
  csub,
  feasibility,
  hurwitzFactor,
  ladderAbcd,
  ladderBelevitch,
  realFrequencyMatch,
  sweepPoints,
  synthesizeLadder,
  throughAbcd,
  vswrOfGain,
  gainOfVswr,
  type Complex,
  type NormalizedPart,
} from '../src/index.js';

const parallelRC = (r: number, c: number) => (f: number) => {
  const y = complex(1 / r, 2 * Math.PI * f * c);
  const d = y.re * y.re + y.im * y.im;
  return complex(y.re / d, -y.im / d);
};

/** Transducer gain of a ladder (load side first) between R0 and the load at f. */
function ladderGain(
  elements: Parameters<typeof ladderAbcd>[0],
  load: Complex,
  r0: number,
  f: number,
): number {
  const zin = throughAbcd(ladderAbcd(elements, f), load);
  const g = cabs(cdiv(csub(zin, complex(r0)), cadd(zin, complex(r0))));
  return 1 - g * g;
}

const peval = (a: readonly number[], x: number): number => a.reduce((s, c, i) => s + c * x ** i, 0);

describe('Belevitch form and synthesis', () => {
  const ladders: { name: string; parts: NormalizedPart[] }[] = [
    {
      name: 'lowpass, series L first',
      parts: [
        { orientation: 'series', kind: 'L', value: 1.3 },
        { orientation: 'shunt', kind: 'C', value: 0.7 },
        { orientation: 'series', kind: 'L', value: 2.1 },
      ],
    },
    {
      name: 'highpass, shunt L first',
      parts: [
        { orientation: 'shunt', kind: 'L', value: 0.9 },
        { orientation: 'series', kind: 'C', value: 1.6 },
        { orientation: 'shunt', kind: 'L', value: 0.4 },
        { orientation: 'series', kind: 'C', value: 3.0 },
      ],
    },
    {
      name: 'bandpass, series C, shunt L, series L, shunt C',
      parts: [
        { orientation: 'series', kind: 'C', value: 1.4 },
        { orientation: 'shunt', kind: 'L', value: 0.8 },
        { orientation: 'series', kind: 'L', value: 2.2 },
        { orientation: 'shunt', kind: 'C', value: 0.6 },
      ],
    },
  ];

  for (const { name, parts } of ladders) {
    it(`a ladder's h and g give back its parts and its gain (${name})`, () => {
      const b = ladderBelevitch(parts);
      // g g* = h h* + f f* at a few real p.
      for (const p of [0.3, 0.9, 1.7]) {
        const lhs = peval(b.g, p) * peval(b.g, -p);
        const rhs = peval(b.h, p) * peval(b.h, -p) + (b.k % 2 === 0 ? 1 : -1) * p ** (2 * b.k);
        expect(Math.abs(lhs - rhs)).toBeLessThan(1e-12 * Math.max(1, Math.abs(lhs)));
      }
      // The Hurwitz factor of h h* + f f* is the ladder's own g.
      const g = hurwitzFactor(b.h, b.k);
      expect(g).not.toBeNull();
      g!.forEach((c, i) => expect(c).toBeCloseTo(b.g[i] as number, 10));
      // Synthesis returns the same parts, R0 at the end.
      const order = name.startsWith('bandpass') ? 'zero-first' : 'infinity-first';
      const syn = synthesizeLadder(b, order);
      expect(syn).not.toBeNull();
      expect(syn!.termination).toBeCloseTo(1, 10);
      expect(syn!.parts).toHaveLength(parts.length);
      syn!.parts.forEach((part, i) => {
        expect(part.orientation).toBe(parts[i]!.orientation);
        expect(part.kind).toBe(parts[i]!.kind);
        expect(part.value).toBeCloseTo(parts[i]!.value, 9);
      });
      // The Belevitch gain on a complex load equals the cascade's (R0 = 1, omega = 1).
      const elements = [...parts].reverse().map((part) => ({ ...part }));
      for (const w of [0.4, 1, 1.9]) {
        const zl = complex(0.3 + w / 4, -0.8 + w / 2);
        const f = w / (2 * Math.PI);
        expect(Math.abs(belevitchGain(b, w, zl) - ladderGain(elements, zl, 1, f))).toBeLessThan(
          1e-12,
        );
      }
    });
  }

  it('gain and VSWR convert both ways', () => {
    for (const v of [1, 1.2, 2, 5]) expect(vswrOfGain(gainOfVswr(v))).toBeCloseTo(v, 10);
  });
});

/**
 * Fano's RC load (R in parallel with C) over the lowpass band 0 to omega_c,
 * where the optimum is known in closed form.
 *
 * Infinite degree: Bode's integral, the integral of ln(1 / |Gamma|) over all
 * frequencies is at most pi / (R C), so a gain flat over the band is at most
 * 1 - exp(-2 pi / (omega_c R C)) (Bode, Network Analysis and Feedback
 * Amplifier Design, 1945; Fano, J. Franklin Inst. 249, 1950).
 *
 * Finite degree: the Chebyshev solution for the RC load (Chen, Theory and
 * Design of Broadband Matching Networks, 1976, chapter on the RC load; the
 * formula below, written from the published method, not checked against the
 * book's page): N reactive elements in all (the load's C and the equalizer),
 * sinh a - sinh a' = 2 sin(pi / 2N) / (omega_c R C), gain between
 * K = 1 - sinh^2(N a') / sinh^2(N a) and K / (1 + eps^2), eps = 1 / sinh(N a),
 * the generator resistance free (an ideal transformer). Its lowest passband
 * gain, maximized over a', tends to Bode's limit as N grows. The real
 * frequency technique optimizes the lowest gain itself over every network of
 * the degree, so it must reach the Chebyshev value and may pass it.
 */
function chebyshevRc(N: number, wcRC: number): number {
  const delta = (2 * Math.sin(Math.PI / (2 * N))) / wcRC;
  let best = 0;
  for (let i = 0; i <= 20000; i++) {
    const ah = (i / 20000) * 3;
    const a = Math.asinh(Math.sinh(ah) + delta);
    // (sinh^2(N a) - sinh^2(N a')) / cosh^2(N a), written so that large N does not overflow.
    const ratio = Math.exp(N * (ah - a)) * (-Math.expm1(-2 * N * ah) / -Math.expm1(-2 * N * a));
    best = Math.max(best, (1 - ratio * ratio) * Math.tanh(N * a) ** 2);
  }
  return best;
}

describe("Fano's RC load, closed form", () => {
  const r = 50;
  const fc = 1e9;
  const wcRC = 2;
  const load = parallelRC(r, wcRC / (2 * Math.PI * fc * r));
  const bode = 1 - Math.exp((-2 * Math.PI) / wcRC);
  const band = sweepPoints(fc / 1000, fc, 41);

  it('Chebyshev formula reaches Bode as the degree grows', () => {
    expect(chebyshevRc(400, wcRC)).toBeCloseTo(bode, 4);
  });

  it('meets the Chebyshev optimum, stays under Bode, and rises with the degree', () => {
    let last = 0;
    for (const n of [1, 2, 3, 4]) {
      const res = realFrequencyMatch(band, {
        load,
        z0: 50,
        parts: n,
        zerosAtDc: [0],
        transformer: true,
        polish: false,
      });
      const b = res.best!;
      const cheb = chebyshevRc(n + 1, wcRC);
      // N = 2 (one series L): the two agree (observed 1.7e-4 below, the band starting at fc / 1000).
      if (n === 1) expect(Math.abs(b.minGain - cheb)).toBeLessThan(5e-4);
      else expect(b.minGain).toBeGreaterThan(cheb - 5e-4);
      expect(b.minGain).toBeLessThan(bode);
      expect(b.minGain).toBeGreaterThan(last);
      last = b.minGain;
      // The synthesized ladder (with its transformer) has the optimized gain.
      expect(b.synthesisError).toBeLessThan(1e-9);
      expect(b.synthesizedVswr).toBeCloseTo(vswrOfGain(b.minGain), 6);
    }
  }, 60000);

  it('a lowpass ladder without a transformer ends in R0 exactly', () => {
    const res = realFrequencyMatch(band, { load, z0: 50, parts: 3, zerosAtDc: [0] });
    const b = res.best!;
    expect(b.belevitch.h[0]).toBe(0);
    expect(b.termination).toBeCloseTo(1, 12);
    expect(b.synthesisError).toBeLessThan(1e-9);
  }, 60000);

  it("over a bandpass band it never beats Fano's exact floor", () => {
    const bp = sweepPoints(0.6e9, 1e9, 21);
    const floor = feasibility(load, sweepPoints(0.6e9, 1e9, 201));
    expect(floor?.method).toBe('exact');
    for (const n of [2, 3]) {
      const res = realFrequencyMatch(bp, { load, z0: 50, parts: n });
      expect(res.best!.shapeVswr).toBeGreaterThan(floor!.floor);
      expect(res.best!.worstVswr).toBeGreaterThan(floor!.floor);
    }
  }, 60000);
});

describe('prefix and determinism', () => {
  it('builds after the parts already there, the same answer twice', () => {
    const load = (f: number) => complex(10, 2 * Math.PI * f * 50e-9);
    const prefix = [{ kind: 'C' as const, orientation: 'series' as const, value: 40e-12 }];
    const band = sweepPoints(70e6, 130e6, 21);
    const a = realFrequencyMatch(band, { load, z0: 50, parts: 2, prefix });
    const b = realFrequencyMatch(band, { load, z0: 50, parts: 2, prefix });
    expect(a.best!.worstVswr).toBe(b.best!.worstVswr);
    expect(a.best!.elements).toEqual(b.best!.elements);
    expect(a.best!.synthesisError).toBeLessThan(1e-6);
    // The gain shape is the gain of prefix and synthesized ladder together.
    const f = a.scoringFrequencies[7] as number;
    const t = ladderGain([...prefix, ...a.best!.synthesized], load(f), 50, f);
    expect(Math.abs(t - (a.best!.gain[7] as number))).toBeLessThan(1e-6);
  }, 60000);
});

describe('progress', () => {
  it('counts every optimization of the continuation, with one total throughout', () => {
    const load = (f: number) => complex(10, 2 * Math.PI * f * 50e-9);
    const seen: { done: number; total: number }[] = [];
    const r = realFrequencyMatch(sweepPoints(70e6, 130e6, 21), {
      load,
      z0: 50,
      parts: 3,
      onProgress: (p) => seen.push(p),
    });
    const totals = new Set(seen.map((p) => p.total));
    expect([...totals]).toEqual([r.steps]);
    // Degree 1: k 0 and 1; degree 2: 4 (k 1 twice); degree 3: 6.
    expect(r.steps).toBe(2 + 4 + 6);
    seen.forEach((p, i) => expect(p.done).toBe(i + 1));
  }, 60000);
});
