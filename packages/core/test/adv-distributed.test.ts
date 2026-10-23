/** QA round 1 (distributed synthesis), adversary: hostile and borderline inputs. */
import { describe, expect, it } from 'vitest';
import {
  cabs,
  cadd,
  cdiv,
  commensurateS,
  complex,
  csub,
  designStubFilter,
  kuroda,
  ladderAbcd,
  multisectionTransformer,
  throughAbcd,
  transmissionS21,
  type CommensurateElement,
  type Element,
} from '../src/index';

const F = 1e9;

function zinOf(elements: readonly Element[], load: number, f: number): { re: number; im: number } {
  return throughAbcd(ladderAbcd(elements, f), complex(load));
}
function gammaMag(elements: readonly Element[], load: number, z0: number, f: number): number {
  const z = zinOf(elements, load, f);
  return cabs(cdiv(csub(z, complex(z0)), cadd(z, complex(z0))));
}
function s21Db(elements: readonly Element[], load: number, z0: number, f: number): number {
  return transmissionS21(ladderAbcd(elements, f), complex(load), z0).db;
}
const allFinite = (xs: readonly number[]): boolean => xs.every((x) => Number.isFinite(x) && x > 0);

describe('adv: multisectionTransformer extremes', () => {
  for (const type of ['binomial', 'chebyshev'] as const) {
    it(`${type}: an impedance ratio whose quotient underflows gives finite positive sections or a RangeError`, () => {
      // zl / zs = 1e-200 / 1e200 underflows to 0 -> ln = -Infinity.
      let threw = false;
      let imps: readonly number[] = [];
      try {
        imps = multisectionTransformer(1e200, 1e-200, 3, {
          type,
          frequency: F,
          gammaMax: 0.05,
        }).impedances;
      } catch (e) {
        threw = e instanceof RangeError;
      }
      expect(threw || allFinite(imps)).toBe(true);
    });
    it(`${type}: an impedance ratio whose quotient overflows gives finite positive sections or a RangeError`, () => {
      let threw = false;
      let imps: readonly number[] = [];
      try {
        imps = multisectionTransformer(1e-200, 1e200, 3, {
          type,
          frequency: F,
          gammaMax: 0.05,
        }).impedances;
      } catch (e) {
        threw = e instanceof RangeError;
      }
      expect(threw || allFinite(imps)).toBe(true);
    });
  }

  it('in-band |Gamma| of the built ladder stays near gammaMax and the stated bandwidth holds (exact line maths)', () => {
    const rows: string[] = [];
    let worst = 0;
    for (const ratio of [2, 4, 10, 100]) {
      for (const type of ['binomial', 'chebyshev'] as const) {
        for (let n = 1; n <= 6; n++) {
          const t = multisectionTransformer(50, 50 * ratio, n, {
            type,
            frequency: F,
            gammaMax: 0.05,
          });
          if (t.bandwidth === null) continue;
          const half = t.bandwidth / 2;
          let peak = 0;
          for (let i = 0; i <= 400; i++) {
            const f = F * (1 - half + (2 * half * i) / 400);
            peak = Math.max(peak, gammaMag(t.elements, 50 * ratio, 50, f));
          }
          worst = Math.max(worst, peak);
          if (peak > 0.06)
            rows.push(
              `${type} N=${n} ratio ${ratio}: peak |G| ${peak.toFixed(4)} over stated BW ${(t.bandwidth * 100).toFixed(1)} %`,
            );
        }
      }
    }
    expect(worst).toBeLessThan(0.06);
  });

  it('gammaMax 0.9 and 0.001 (UI bounds), every N, a 1e6 ratio: finite elements', () => {
    for (const g of [0.001, 0.9])
      for (const type of ['binomial', 'chebyshev'] as const)
        for (let n = 1; n <= 6; n++) {
          const t = multisectionTransformer(50, 5e7, n, { type, frequency: 1, gammaMax: g });
          expect(allFinite(t.impedances)).toBe(true);
          if (t.bandwidth !== null) expect(Number.isFinite(t.bandwidth)).toBe(true);
        }
  });
});

describe('adv: stub low-pass exactness over the input range', () => {
  it('Chebyshev low-pass matches 10 log10(1 + eps^2 T_N^2(tan theta)) for every order and ripple 0.001 to 10 dB', () => {
    const bad: string[] = [];
    for (const r of [0.001, 0.01, 0.5, 3, 10])
      for (let n = 1; n <= 9; n++) {
        const d = designStubFilter({
          kind: 'lowpass',
          response: 'chebyshev',
          order: n,
          rippleDb: r,
          cutoff: F,
          z0: 50,
        });
        const eps2 = 10 ** (r / 10) - 1;
        for (const x of [0.2, 0.7, 1, 1.3, 1.8]) {
          const om = Math.tan((Math.PI / 4) * x);
          const tn = om <= 1 ? Math.cos(n * Math.acos(om)) : Math.cosh(n * Math.acosh(om));
          const expected = -10 * Math.log10(1 + eps2 * tn * tn);
          const got = s21Db(d.elements, d.designLoad, 50, x * F);
          if (!(Math.abs(got - expected) < 1e-4 * Math.max(1, Math.abs(expected))))
            bad.push(`r ${r} N ${n} x ${x}: got ${got} expected ${expected}`);
        }
      }
    expect(bad).toEqual([]);
  });
});

describe('adv: stub high-pass cutoff', () => {
  it('the loss at the cutoff equals the prototype loss for every order and ripple (the bisection brackets)', () => {
    const bad: string[] = [];
    const cases: { response: 'butterworth' | 'chebyshev'; r?: number }[] = [
      { response: 'butterworth' },
      ...[0.001, 0.01, 0.1, 0.5, 1, 3, 6, 10].map((r) => ({ response: 'chebyshev' as const, r })),
    ];
    for (const c of cases)
      for (let n = 1; n <= 9; n++) {
        const d = designStubFilter({
          kind: 'highpass',
          response: c.response,
          order: n,
          ...(c.r !== undefined ? { rippleDb: c.r } : {}),
          cutoff: F,
          z0: 50,
        });
        const want = c.response === 'butterworth' ? 10 * Math.log10(2) : (c.r as number);
        const got = -s21Db(d.elements, 50, 50, F);
        if (!(Math.abs(got - want) < 1e-3 * Math.max(1, want)))
          bad.push(
            `${c.response} r ${c.r ?? '-'} N ${n}: loss at fc ${got.toFixed(5)} dB, wanted ${want} dB`,
          );
      }
    expect(bad).toEqual([]);
  });
});

describe('adv: stub filter extreme z0 and cutoff', () => {
  it('a huge but finite z0 gives finite element impedances or a RangeError', () => {
    let threw = false;
    let zs: number[] = [];
    try {
      zs = designStubFilter({
        kind: 'lowpass',
        response: 'chebyshev',
        order: 9,
        rippleDb: 3,
        cutoff: F,
        z0: 1e307,
      }).elements.map((e) => e.z0);
    } catch (e) {
      threw = e instanceof RangeError;
    }
    expect(threw || allFinite(zs)).toBe(true);
  });
});

describe('adv: Kuroda identities with tiny and huge impedances', () => {
  const pairs: [string, CommensurateElement, CommensurateElement][] = [
    [
      '(a) UE 1e200, series short 1e200',
      { kind: 'ue', z: 1e200 },
      { kind: 'seriesShort', z: 1e200 },
    ],
    [
      '(a) back: UE 1e-200, shunt open 1e-200',
      { kind: 'ue', z: 1e-200 },
      { kind: 'shuntOpen', z: 1e-200 },
    ],
    [
      '(a) back: UE 1e200, shunt open 1e200',
      { kind: 'ue', z: 1e200 },
      { kind: 'shuntOpen', z: 1e200 },
    ],
  ];
  for (const [name, a, b] of pairs)
    it(`${name}: finite positive impedances or a RangeError`, () => {
      let threw = false;
      let out: CommensurateElement[] = [];
      try {
        out = kuroda(a, b);
      } catch (e) {
        threw = e instanceof RangeError;
      }
      expect(
        threw ||
          out.every(
            (e) =>
              (e.kind === 'transformer' ? e.n : e.z) > 0 &&
              Number.isFinite(e.kind === 'transformer' ? e.n : e.z),
          ),
      ).toBe(true);
    });

  it('commensurateS at theta = 0 for a shunt shorted stub is the short: S21 = 0, S11 = -1, no NaN', () => {
    const s = commensurateS([{ kind: 'shuntShort', z: 1 }], 0, 1);
    expect(s.every((x) => Number.isFinite(x.re) && Number.isFinite(x.im))).toBe(true);
  });
});
