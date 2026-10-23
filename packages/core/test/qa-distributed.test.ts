/**
 * QA round 1 on distributed synthesis: branches and limits the feature tests
 * do not reach. Expected values come from the textbook formulas (Pozar 5.6,
 * 5.7, 8.3, 8.6, 8.8) worked by hand, never from the code under test.
 */
import { describe, expect, it } from 'vitest';
import {
  cabs,
  chebyshevT,
  commensurateAbcd,
  commensurateS,
  complex,
  designStubFilter,
  elementAbcd,
  gammaFromRippleDb,
  kuroda,
  ladderAbcd,
  lowpassPrototype,
  multisectionTransformer,
  rippleDbFromGamma,
  throughAbcd,
  type Abcd,
  type CommensurateElement,
  type Element,
  type StubFilterOptions,
} from '../src/index';

const F = 1e9;

/** Transducer gain |S21|^2 from an rs source into an rl load, from the ABCD at port 1. */
function gain(m: Abcd, rs: number, rl: number): number {
  const re = m.a.re * rl + m.b.re + m.c.re * rs * rl + m.d.re * rs;
  const im = m.a.im * rl + m.b.im + m.c.im * rs * rl + m.d.im * rs;
  return (4 * rs * rl) / (re * re + im * im);
}

function lossDb(elements: readonly Element[], rs: number, rl: number, f: number): number {
  return -10 * Math.log10(gain(ladderAbcd(elements, f), rs, rl));
}

function gammaAt(elements: readonly Element[], load: number, z0: number, f: number): number {
  const z = throughAbcd(ladderAbcd(elements, f), complex(load));
  const dr = z.re - z0;
  const sr = z.re + z0;
  return Math.hypot(dr, z.im) / Math.hypot(sr, z.im);
}

/** T_N by the recurrence T_{n+1} = 2 x T_n - T_{n-1}, independent of the code under test. */
function tRec(n: number, x: number): number {
  let a = 1;
  let b = x;
  if (n === 0) return 1;
  for (let k = 1; k < n; k++) [a, b] = [b, 2 * x * b - a];
  return b;
}

describe('qa: multisectionTransformer branches', () => {
  it('one section is the plain quarter-wave line for both types, sqrt(Z0 ZL), with the same band', () => {
    // theta_m = acos(Gamma_m / |ln(ZL/Z0) / 2|), BW = 2 - 4 theta_m / pi = 0.18433 for 50 to 100, 0.05.
    for (const type of ['binomial', 'chebyshev'] as const) {
      const t = multisectionTransformer(50, 100, 1, { type, frequency: F, gammaMax: 0.05 });
      expect(t.impedances).toHaveLength(1);
      expect(t.impedances[0]).toBeCloseTo(70.71067811865476, 9);
      expect(t.theoryBandwidth).toBeCloseTo(0.18433289, 6);
      expect(gammaAt(t.elements, 100, 50, F)).toBeLessThan(1e-12);
    }
  });

  it('Chebyshev N = 2 equals the closed form A T_2(s cos theta): Z1 = 60.966, Z2 = 82.013 ohm, BW 0.6698', () => {
    // s = cosh(acosh(ratio) / 2), Gamma_0 = A s^2 / 2, Gamma_1 = A (s^2 - 1), A = Gamma_m.
    const t = multisectionTransformer(50, 100, 2, {
      type: 'chebyshev',
      frequency: F,
      gammaMax: 0.05,
    });
    expect(t.impedances[1]).toBeCloseTo(60.9656018, 5);
    expect(t.impedances[0]).toBeCloseTo(82.0134609, 5);
    expect(t.theoryBandwidth).toBeCloseTo(0.66983779, 6);
  });

  it('ZL = Z0 gives Z0 sections and no band edge for both types', () => {
    for (const type of ['binomial', 'chebyshev'] as const) {
      for (let n = 1; n <= 6; n++) {
        const t = multisectionTransformer(50, 50, n, { type, frequency: F });
        t.impedances.forEach((z) => expect(z).toBeCloseTo(50, 12));
        expect(t.bandwidth).toBeNull();
      }
    }
  });

  it('the sections are geometrically symmetric: Z_k Z_{N+1-k} = Z0 ZL, and swapping the ends reverses them', () => {
    for (const type of ['binomial', 'chebyshev'] as const) {
      for (let n = 1; n <= 6; n++) {
        const up = multisectionTransformer(50, 300, n, { type, frequency: F, gammaMax: 0.02 });
        const down = multisectionTransformer(300, 50, n, { type, frequency: F, gammaMax: 0.02 });
        for (let k = 0; k < n; k++) {
          expect((up.impedances[k] as number) * (up.impedances[n - 1 - k] as number)).toBeCloseTo(
            15000,
            6,
          );
          expect(up.impedances[k]).toBeCloseTo(down.impedances[n - 1 - k] as number, 9);
        }
        expect(up.bandwidth).toBeCloseTo(down.bandwidth as number, 12);
      }
    }
  });

  it('the reported band keeps |Gamma| near the limit on the ladder for a 6:1 step (Chebyshev N = 6, 0.05)', () => {
    // The tool states the bandwidth where |Gamma| stays under the limit; allow 10 % for the
    // small-reflection approximation. 50 to 300 ohm is an ordinary step for a quarter-wave design.
    const t = multisectionTransformer(50, 300, 6, {
      type: 'chebyshev',
      frequency: F,
      gammaMax: 0.05,
    });
    const edge = 1 - (t.bandwidth as number) / 2;
    let worst = 0;
    for (let x = edge; x <= 2 - edge; x += 0.005)
      worst = Math.max(worst, gammaAt(t.elements, 300, 50, x * F));
    expect(worst).toBeLessThan(0.055);
  });

  it('rippleDb overrides gammaMax; the default limit is 0.05', () => {
    // sqrt(1 - 10^(-0.1 / 10)) = 0.150873.
    const t = multisectionTransformer(50, 100, 3, {
      type: 'chebyshev',
      frequency: F,
      gammaMax: 0.2,
      rippleDb: 0.1,
    });
    expect(t.gammaMax).toBeCloseTo(0.15087339, 7);
    expect(multisectionTransformer(50, 100, 3, { type: 'binomial', frequency: F }).gammaMax).toBe(
      0.05,
    );
  });

  it('a Chebyshev step inside the limit takes the binomial split and lands on Z0 at f0', () => {
    // Nothing to ripple: an equal-ripple split would leave every section at sqrt(Z0 ZL), which for
    // an even N is a half wave that does nothing at f0. The binomial split is used instead.
    const c = multisectionTransformer(50, 52, 2, { type: 'chebyshev', frequency: F });
    const b0 = multisectionTransformer(50, 52, 2, { type: 'binomial', frequency: F });
    c.impedances.forEach((z, i) => expect(z).toBeCloseTo(b0.impedances[i] as number, 12));
    expect(gammaAt(c.elements, 52, 50, F)).toBeLessThan(1e-9);
    expect(c.bandwidth).toBeNull();
    const b = multisectionTransformer(50, 52, 2, { type: 'binomial', frequency: F });
    expect(gammaAt(b.elements, 52, 50, F)).toBeLessThan(1e-5);
  });

  it('refuses every invalid input with a RangeError', () => {
    const ok = { type: 'binomial' as const, frequency: F };
    const bad: (() => unknown)[] = [
      () => multisectionTransformer(0, 100, 2, ok),
      () => multisectionTransformer(Number.NaN, 100, 2, ok),
      () => multisectionTransformer(Infinity, 100, 2, ok),
      () => multisectionTransformer(50, Infinity, 2, ok),
      () => multisectionTransformer(50, 0, 2, ok),
      () => multisectionTransformer(50, 100, 2.5, ok),
      () => multisectionTransformer(50, 100, Number.NaN, ok),
      () => multisectionTransformer(50, 100, -1, ok),
      () => multisectionTransformer(50, 100, 2, { type: 'binomial', frequency: 0 }),
      () => multisectionTransformer(50, 100, 2, { type: 'binomial', frequency: -1 }),
      () => multisectionTransformer(50, 100, 2, { type: 'binomial', frequency: Number.NaN }),
      () => multisectionTransformer(50, 100, 2, { type: 'binomial', frequency: Infinity }),
      () => multisectionTransformer(50, 100, 2, { ...ok, gammaMax: 0 }),
      () => multisectionTransformer(50, 100, 2, { ...ok, gammaMax: -0.1 }),
      () => multisectionTransformer(50, 100, 2, { ...ok, gammaMax: Number.NaN }),
      () => multisectionTransformer(50, 100, 2, { ...ok, rippleDb: 0 }),
      () => multisectionTransformer(50, 100, 2, { ...ok, rippleDb: -1 }),
      () => multisectionTransformer(50, 100, 2, { ...ok, rippleDb: Infinity }),
      () => multisectionTransformer(50, 100, 2, { ...ok, rippleDb: Number.NaN }),
    ];
    bad.forEach((fn) => expect(fn).toThrow(RangeError));
  });

  it('chebyshevT agrees with the recurrence inside, outside and at the ends of [-1, 1]', () => {
    for (let n = 0; n <= 9; n++) {
      for (const x of [-2.5, -1.5, -1, -0.3, 0, 0.5, 1, 1.2, 3]) {
        expect(chebyshevT(n, x)).toBeCloseTo(tRec(n, x), 8);
      }
    }
    // By hand: T_3(-2) = 4 (-8) - 3 (-2) = -26, T_4(1.5) = 8 (5.0625) - 8 (2.25) + 1 = 23.5.
    expect(chebyshevT(3, -2)).toBeCloseTo(-26, 10);
    expect(chebyshevT(4, 1.5)).toBeCloseTo(23.5, 10);
  });

  it('ripple and reflection conversions at the limits', () => {
    expect(gammaFromRippleDb(10 * Math.log10(2))).toBeCloseTo(Math.SQRT1_2, 12);
    expect(rippleDbFromGamma(Math.SQRT1_2)).toBeCloseTo(3.0103, 4);
    expect(rippleDbFromGamma(0)).toBeCloseTo(0, 12);
    expect(rippleDbFromGamma(1)).toBe(Infinity);
  });
});

describe('qa: lowpassPrototype tables (Pozar table 8.4)', () => {
  const cases: readonly [number, number | null, readonly number[]][] = [
    [1, null, [2, 1]],
    [2, null, [1.4142, 1.4142, 1]],
    [1, 0.5, [0.6986, 1]],
    [2, 0.5, [1.4029, 0.7071, 1.9841]],
    [5, 0.5, [1.7058, 1.2296, 2.5408, 1.2296, 1.7058, 1]],
    // g_{N+1} for even N is (sqrt(1 + eps^2) + eps)^2 = 5.80890 at 3.000 dB (the table rounds to 5.8095).
    [2, 3, [3.1013, 0.5339, 5.8089]],
    [3, 3, [3.3487, 0.7117, 3.3487, 1]],
    [4, 3, [3.4389, 0.7483, 4.3471, 0.592, 5.8089]],
  ];
  for (const [n, ripple, table] of cases) {
    it(`${ripple === null ? 'Butterworth' : `Chebyshev ${ripple} dB`} N = ${n}`, () => {
      const g =
        ripple === null
          ? lowpassPrototype(n, { response: 'butterworth' })
          : lowpassPrototype(n, { response: 'chebyshev', rippleDb: ripple });
      expect(g).toHaveLength(n + 1);
      table.forEach((v, i) => expect(g[i]).toBeCloseTo(v, 3));
    });
  }

  it('refuses a fractional or NaN order and a ripple that is not a positive finite number', () => {
    expect(() => lowpassPrototype(2.5, { response: 'butterworth' })).toThrow(RangeError);
    expect(() => lowpassPrototype(Number.NaN, { response: 'butterworth' })).toThrow(RangeError);
    for (const r of [-1, Number.NaN, Infinity]) {
      expect(() => lowpassPrototype(3, { response: 'chebyshev', rippleDb: r })).toThrow(RangeError);
    }
  });
});

describe('qa: commensurate networks and Kuroda', () => {
  it('commensurateS of a UE: matched line passes with phase -theta, a 100 ohm quarter wave in 50 ohm reflects 0.6', () => {
    const th = 0.7;
    const s = commensurateS([{ kind: 'ue', z: 50 }], th, 50);
    expect(cabs(s[0]!)).toBeLessThan(1e-12);
    expect(s[2]!.re).toBeCloseTo(Math.cos(th), 12);
    expect(s[2]!.im).toBeCloseTo(-Math.sin(th), 12);
    // Zin = 100^2 / 50 = 200, Gamma = 150 / 250 = 0.6, |S21| = 0.8.
    const q = commensurateS([{ kind: 'ue', z: 100 }], Math.PI / 2, 50);
    expect(q[0]!.re).toBeCloseTo(0.6, 9);
    expect(cabs(q[2]!)).toBeCloseTo(0.8, 9);
  });

  it('commensurateS of a shunt open stub at an eighth wave: Y = j / Z, S21 = 2 / (2 + j Z0 / Z)', () => {
    // Z = 50 in 50 ohm: S21 = 2 / (2 + j), |S21|^2 = 4 / 5.
    const s = commensurateS([{ kind: 'shuntOpen', z: 50 }], Math.PI / 4, 50);
    expect(cabs(s[2]!) ** 2).toBeCloseTo(0.8, 12);
  });

  it('the commensurate transformer has the ladder transformer ABCD', () => {
    const a = commensurateAbcd({ kind: 'transformer', n: 2 }, 0.3);
    const b = elementAbcd({ kind: 'transformer', n: 2 }, F);
    expect(a).toEqual(b);
  });

  it('(c) and (d) by hand: shunt short 45 then UE 70 gives n = 45 / 115; series open 25 then UE 70 gives n = 95 / 70', () => {
    const c = kuroda({ kind: 'shuntShort', z: 45 }, { kind: 'ue', z: 70 });
    const n = 45 / 115;
    expect(c[0]).toEqual({ kind: 'ue', z: n * 70 });
    expect(c[1]!.kind).toBe('shuntShort');
    expect((c[1] as { z: number }).z).toBeCloseTo(n * 45, 12);
    expect(c[2]).toEqual({ kind: 'transformer', n });
    const d = kuroda({ kind: 'seriesOpen', z: 25 }, { kind: 'ue', z: 70 });
    const m = 95 / 70;
    expect((d[0] as { z: number }).z).toBeCloseTo(95, 12);
    expect((d[1] as { z: number }).z).toBeCloseTo(m * 25, 12);
    expect((d[2] as { n: number }).n).toBeCloseTo(m, 12);
  });

  it('keeps the two-port for extreme impedance ratios', () => {
    const thetas = [0.1, 0.5, 1.0, 1.4, 2.0, 2.9];
    for (const [zu, zs] of [
      [1, 1000],
      [1000, 1],
      [0.01, 0.02],
    ] as const) {
      for (const kind of ['seriesShort', 'seriesOpen', 'shuntOpen', 'shuntShort'] as const) {
        for (const order of [0, 1]) {
          const ue: CommensurateElement = { kind: 'ue', z: zu };
          const stub: CommensurateElement = { kind, z: zs };
          const pair = order === 0 ? [ue, stub] : [stub, ue];
          const out = kuroda(pair[0]!, pair[1]!);
          for (const th of thetas) {
            const a = commensurateS(pair, th, 1);
            const b = commensurateS(out, th, 1);
            for (let k = 0; k < 4; k++) {
              expect(Math.abs(a[k]!.re - b[k]!.re)).toBeLessThan(1e-9);
              expect(Math.abs(a[k]!.im - b[k]!.im)).toBeLessThan(1e-9);
            }
          }
        }
      }
    }
  });

  it('refuses a transformer, two stubs and impedances that are NaN, infinite or negative', () => {
    const ue: CommensurateElement = { kind: 'ue', z: 50 };
    expect(() => kuroda(ue, { kind: 'transformer', n: 2 })).toThrow(RangeError);
    expect(() => kuroda({ kind: 'transformer', n: 2 }, ue)).toThrow(RangeError);
    expect(() => kuroda({ kind: 'shuntOpen', z: 1 }, { kind: 'shuntShort', z: 1 })).toThrow(
      RangeError,
    );
    for (const z of [Number.NaN, Infinity, -5]) {
      expect(() => kuroda({ kind: 'ue', z }, { kind: 'shuntOpen', z: 50 })).toThrow(RangeError);
      expect(() => kuroda({ kind: 'seriesOpen', z }, ue)).toThrow(RangeError);
    }
  });
});

describe('qa: designStubFilter low-pass against the prototype response', () => {
  function chebyshevLossDb(n: number, ripple: number, x: number): number {
    // Insertion loss 1 + eps^2 T_N(Omega)^2 with Omega = tan(pi f / (4 fc)) (Richards).
    const eps2 = 10 ** (ripple / 10) - 1;
    return 10 * Math.log10(1 + eps2 * tRec(n, Math.tan((Math.PI / 4) * x)) ** 2);
  }

  it('every Chebyshev order 1 to 9 at 0.5 and 3 dB follows 1 + eps^2 T_N(tan theta)^2 into its design load', () => {
    for (const ripple of [0.5, 3]) {
      for (let n = 1; n <= 9; n++) {
        const d = designStubFilter({
          kind: 'lowpass',
          response: 'chebyshev',
          order: n,
          rippleDb: ripple,
          cutoff: F,
          z0: 50,
        });
        // Odd orders end in Z0; even orders in Z0 g_{N+1} or Z0 / g_{N+1}.
        const gl = d.g[n] as number;
        if (n % 2 === 1) expect(d.designLoad).toBeCloseTo(50, 9);
        else
          expect(
            Math.min(Math.abs(d.designLoad - 50 * gl), Math.abs(d.designLoad - 50 / gl)),
          ).toBeLessThan(1e-9);
        for (const x of [0.05, 0.4, 0.95, 1, 1.3, 1.8, 2.5, 3.2]) {
          expect(lossDb(d.elements, 50, d.designLoad, x * F)).toBeCloseTo(
            chebyshevLossDb(n, ripple, x),
            6,
          );
        }
      }
    }
  });

  it('Butterworth N = 1 is one 25 ohm open stub; N = 2 has stubs 35.36 and 85.36 and a 120.71 ohm line', () => {
    // N = 1: C = 2, stub Z0 / 2. N = 2: L = C = sqrt 2; one UE of 1 across L (Kuroda (a)):
    // UE 1 + sqrt 2, shunt 1 (1 + sqrt 2) / sqrt 2; the C stays a 1 / sqrt 2 stub.
    const one = designStubFilter({
      kind: 'lowpass',
      response: 'butterworth',
      order: 1,
      cutoff: F,
      z0: 50,
    });
    expect(one.elements).toHaveLength(1);
    expect(one.elements[0]!.kind).toBe('openStub');
    expect(one.elements[0]!.z0).toBeCloseTo(25, 9);
    const two = designStubFilter({
      kind: 'lowpass',
      response: 'butterworth',
      order: 2,
      cutoff: F,
      z0: 50,
    });
    expect([...two.stubImpedances].sort((a, b) => a - b)[0]).toBeCloseTo(35.35533906, 6);
    expect([...two.stubImpedances].sort((a, b) => a - b)[1]).toBeCloseTo(85.35533906, 6);
    expect(two.lineImpedances[0]).toBeCloseTo(120.71067812, 6);
  });

  it('Chebyshev 0.5 dB N = 3 keeps the realization nearest Z0: stubs 81.32, 45.59, 81.32, lines 129.82 ohm', () => {
    // Series first (L C L), one UE from each end: shunt Z0 (1 + g1) / g1, UE Z0 (1 + g1).
    const d = designStubFilter({
      kind: 'lowpass',
      response: 'chebyshev',
      order: 3,
      rippleDb: 0.5,
      cutoff: F,
      z0: 50,
    });
    [81.3224, 45.5913, 81.3224].forEach((z, i) => expect(d.stubImpedances[i]).toBeCloseTo(z, 1));
    d.lineImpedances.forEach((z) => expect(z).toBeCloseTo(129.815, 1));
  });

  it('the attenuation pole sits at 2 fc and the response repeats: the 3 fc loss is the cutoff loss', () => {
    const d = designStubFilter({
      kind: 'lowpass',
      response: 'butterworth',
      order: 5,
      cutoff: F,
      z0: 50,
    });
    expect(lossDb(d.elements, 50, 50, 2 * F)).toBeGreaterThan(100);
    expect(lossDb(d.elements, 50, 50, 3 * F)).toBeCloseTo(10 * Math.log10(2), 6);
    expect(lossDb(d.elements, 50, 50, 4 * F)).toBeLessThan(1e-9);
  });

  it('scales with Z0: a 75 ohm design is the 50 ohm one times 1.5, and elements carry the cutoff in Hz', () => {
    const base: StubFilterOptions = {
      kind: 'lowpass',
      response: 'chebyshev',
      order: 6,
      rippleDb: 1,
      cutoff: 2.4e9,
      z0: 50,
    };
    const a = designStubFilter(base);
    const b = designStubFilter({ ...base, z0: 75 });
    a.elements.forEach((el, i) => {
      expect(b.elements[i]!.z0).toBeCloseTo(el.z0 * 1.5, 9);
      expect(el.refFrequency).toBe(2.4e9);
      expect(el.length).toBe(0.125);
    });
    expect(b.designLoad).toBeCloseTo(a.designLoad * 1.5, 9);
  });
});

describe('qa: designStubFilter high-pass', () => {
  it('cutoff loss is exact for every order and every ripple the tool accepts, 0.001 to 10 dB (no silent Delta = 1 fallback)', () => {
    const misses: string[] = [];
    for (const response of ['butterworth', 'chebyshev'] as const) {
      for (const ripple of response === 'chebyshev'
        ? [0.001, 0.005, 0.01, 0.1, 0.5, 1, 3, 10]
        : [0.5]) {
        for (let n = 1; n <= 9; n++) {
          const d = designStubFilter({
            kind: 'highpass',
            response,
            order: n,
            rippleDb: ripple,
            cutoff: F,
            z0: 50,
          });
          const want = response === 'butterworth' ? 10 * Math.log10(2) : ripple;
          const got = lossDb(d.elements, 50, 50, F);
          if (Math.abs(got - want) > 1e-6) misses.push(`${response} ${ripple} dB N=${n}: ${got}`);
        }
      }
    }
    expect(misses).toEqual([]);
  });

  it('lossless at 2 fc, symmetric about it (3 fc loss = cutoff loss), one stub for N = 1', () => {
    for (let n = 1; n <= 9; n++) {
      const d = designStubFilter({
        kind: 'highpass',
        response: 'butterworth',
        order: n,
        cutoff: F,
        z0: 50,
      });
      expect(d.stubImpedances).toHaveLength(n);
      expect(d.lineImpedances).toHaveLength(n - 1);
      expect(d.designLoad).toBe(50);
      expect(lossDb(d.elements, 50, 50, 2 * F)).toBeLessThan(1e-9);
      expect(lossDb(d.elements, 50, 50, 3 * F)).toBeCloseTo(10 * Math.log10(2), 6);
      expect(lossDb(d.elements, 50, 50, 1.4 * F)).toBeCloseTo(
        lossDb(d.elements, 50, 50, 2.6 * F),
        9,
      );
    }
    // N = 1: one shunt short stub; |S21|^2 = 4 / (4 + (Z0 / Z)^2) = 1 / 2 at fc gives Z = Z0 / 2.
    const one = designStubFilter({
      kind: 'highpass',
      response: 'butterworth',
      order: 1,
      cutoff: F,
      z0: 50,
    });
    expect(one.elements[0]!.kind).toBe('shortStub');
    expect(one.elements[0]!.z0).toBeCloseTo(25, 6);
  });
});

describe('qa: designStubFilter inputs and range report', () => {
  const base: StubFilterOptions = {
    kind: 'lowpass',
    response: 'butterworth',
    order: 3,
    cutoff: F,
    z0: 50,
  };

  it('refuses order, cutoff, Z0 and ripple outside their domains', () => {
    const bad: StubFilterOptions[] = [
      { ...base, order: 0 },
      { ...base, order: 10 },
      { ...base, order: 2.5 },
      { ...base, cutoff: -1 },
      { ...base, cutoff: Infinity },
      { ...base, cutoff: Number.NaN },
      { ...base, z0: 0 },
      { ...base, z0: Infinity },
      { ...base, response: 'chebyshev', rippleDb: 0 },
      { ...base, response: 'chebyshev', rippleDb: -1 },
    ];
    bad.forEach((o) => expect(() => designStubFilter(o)).toThrow(RangeError));
  });

  it('Butterworth ignores a ripple and reports rippleDb null', () => {
    const d = designStubFilter({ ...base, rippleDb: -3 });
    expect(d.rippleDb).toBeNull();
  });

  it('a narrow range flags exactly the elements outside it with their ladder kind', () => {
    // N = 3 Butterworth: stubs 100, 25, 100 and lines 100 ohm; [30, 90] flags all but none inside.
    const d = designStubFilter({ ...base, range: [30, 90] });
    expect(d.outOfRange.map((o) => o.index)).toEqual([0, 1, 2, 3, 4]);
    expect(d.outOfRange.map((o) => o.kind)).toEqual([
      'openStub',
      'line',
      'openStub',
      'line',
      'openStub',
    ]);
    const e = designStubFilter({ ...base, range: [20, 101] });
    expect(e.outOfRange).toEqual([]);
  });

  it('an impedance exactly on the default 150 ohm limit is not flagged (75 ohm Butterworth N = 3)', () => {
    // Stubs and lines 2 Z0 = 150 ohm, middle stub Z0 / 2 = 37.5 ohm: all inside 15 to 150 inclusive.
    const d = designStubFilter({ ...base, z0: 75 });
    expect(d.outOfRange).toEqual([]);
  });
});
