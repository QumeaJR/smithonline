import { describe, expect, it } from 'vitest';
import {
  cabs,
  commensurateS,
  complex,
  csub,
  cadd,
  cdiv,
  designStubFilter,
  kuroda,
  ladderAbcd,
  lowpassPrototype,
  multisectionTransformer,
  throughAbcd,
  transmissionS21,
  gammaFromRippleDb,
  rippleDbFromGamma,
  type CommensurateElement,
  type Element,
} from '../src/index';

const F = 1e9;

function zin(elements: readonly Element[], load: number, f: number): { re: number; im: number } {
  return throughAbcd(ladderAbcd(elements, f), complex(load));
}

function gammaMag(elements: readonly Element[], load: number, z0: number, f: number): number {
  const z = zin(elements, load, f);
  return cabs(cdiv(csub(z, complex(z0)), cadd(z, complex(z0))));
}

function s21Db(elements: readonly Element[], load: number, z0: number, f: number): number {
  return transmissionS21(ladderAbcd(elements, f), complex(load), z0).db;
}

describe('multisectionTransformer', () => {
  it('binomial N = 2 takes the impedance step in quarters: 3/4 next to the load, 1/4 next to the source', () => {
    const t = multisectionTransformer(50, 200, 2, { type: 'binomial', frequency: F });
    expect(t.impedances[0]).toBeCloseTo(50 * 4 ** 0.75, 9);
    expect(t.impedances[1]).toBeCloseTo(50 * 4 ** 0.25, 9);
    expect(t.elements).toHaveLength(2);
    for (const el of t.elements) {
      expect(el.kind).toBe('line');
      expect(el.length).toBe(0.25);
      expect(el.refFrequency).toBe(F);
    }
  });

  it('binomial N = 3 from 100 to 50 ohm matches Pozar example 5.6, bandwidth 70 % at |Gamma| 0.05', () => {
    const t = multisectionTransformer(100, 50, 3, {
      type: 'binomial',
      frequency: F,
      gammaMax: 0.05,
    });
    // Source side first in the textbook: 91.7, 70.7, 54.5.
    expect(t.impedances[2]).toBeCloseTo(91.7, 1);
    expect(t.impedances[1]).toBeCloseTo(70.7, 1);
    expect(t.impedances[0]).toBeCloseTo(54.5, 1);
    expect(t.theoryBandwidth).toBeCloseTo(0.7, 2);
    expect(t.bandwidth).toBeCloseTo(0.7, 1);
  });

  it('Chebyshev N = 3 from 50 to 100 ohm matches Pozar example 5.7, bandwidth 101 % at |Gamma| 0.05', () => {
    const t = multisectionTransformer(50, 100, 3, {
      type: 'chebyshev',
      frequency: F,
      gammaMax: 0.05,
    });
    expect(t.impedances[2]).toBeCloseTo(57.5, 1);
    expect(t.impedances[1]).toBeCloseTo(70.7, 1);
    expect(t.impedances[0]).toBeCloseTo(87.0, 1);
    expect(t.theoryBandwidth).toBeCloseTo(1.006, 3);
    // The ladder agrees: matched at f0, close to the ripple level at the theory band edges.
    expect(gammaMag(t.elements, 100, 50, F)).toBeLessThan(1e-12);
    expect(t.centreGamma).toBeLessThan(1e-12);
    expect(t.peakGamma).toBeLessThan(0.055);
    const edge = 1 - (t.theoryBandwidth as number) / 2;
    expect(gammaMag(t.elements, 100, 50, edge * F)).toBeCloseTo(0.05, 2);
    let worst = 0;
    for (let x = edge; x <= 2 - edge; x += 0.01)
      worst = Math.max(worst, gammaMag(t.elements, 100, 50, x * F));
    expect(worst).toBeLessThan(0.055);
    // The exact band is where the built lines stay under the limit: just inside the theory band.
    expect(t.bandwidth).toBeGreaterThan(0.95);
    const exactEdge = 1 - (t.bandwidth as number) / 2;
    expect(gammaMag(t.elements, 100, 50, exactEdge * F)).toBeCloseTo(0.05, 9);
    for (let x = exactEdge; x <= 1; x += 0.001) {
      expect(gammaMag(t.elements, 100, 50, x * F)).toBeLessThanOrEqual(0.05 + 1e-12);
    }
  });

  it('for a large step the exact band is narrower than the theory one, and the peak says why', () => {
    const t = multisectionTransformer(50, 5, 6, {
      type: 'chebyshev',
      frequency: F,
      gammaMax: 0.05,
    });
    expect(t.peakGamma).toBeGreaterThan(0.08);
    expect(t.bandwidth as number).toBeLessThan(t.theoryBandwidth as number);
  });

  it('for a 10:1 step the Chebyshev sections are synthesized lower, so the band widens with N and holds', () => {
    let previous = 0;
    for (let n = 1; n <= 6; n++) {
      const t = multisectionTransformer(50, 5, n, {
        type: 'chebyshev',
        frequency: F,
        gammaMax: 0.05,
      });
      const bw = t.bandwidth as number;
      expect(bw).toBeGreaterThan(previous);
      previous = bw;
      expect(t.designGamma).toBeLessThanOrEqual(0.05);
      // The whole stated band stays under the limit on the built lines.
      const edge = 1 - bw / 2;
      for (let x = edge; x <= 2 - edge; x += 0.002) {
        expect(gammaMag(t.elements, 5, 50, x * F)).toBeLessThanOrEqual(0.05 + 1e-9);
      }
    }
    const plain = multisectionTransformer(50, 100, 3, { type: 'chebyshev', frequency: F });
    expect(plain.designGamma).toBe(0.05);
  });

  it('lands on Z0 at the centre frequency, except an even Chebyshev, which ripples there', () => {
    for (const type of ['binomial', 'chebyshev'] as const) {
      for (let n = 1; n <= 6; n++) {
        const t = multisectionTransformer(50, 10, n, { type, frequency: F, rippleDb: 0.1 });
        const centre = gammaMag(t.elements, 10, 50, F);
        if (type === 'chebyshev' && n % 2 === 0) expect(centre).toBeCloseTo(t.gammaMax, 1);
        else expect(centre).toBeLessThan(1e-9);
        // Impedances move monotonically from the load to the source.
        for (let i = 1; i < n; i++)
          expect(t.impedances[i]).toBeGreaterThan(t.impedances[i - 1] as number);
      }
    }
  });

  it('more sections widen the band, and Chebyshev is wider than binomial', () => {
    const bw = (type: 'binomial' | 'chebyshev', n: number): number =>
      multisectionTransformer(50, 200, n, { type, frequency: F, gammaMax: 0.05 })
        .bandwidth as number;
    for (let n = 2; n <= 6; n++) {
      expect(bw('binomial', n)).toBeGreaterThan(bw('binomial', n - 1));
      expect(bw('chebyshev', n)).toBeGreaterThan(bw('binomial', n));
    }
  });

  it('a step already inside the limit has no band edge', () => {
    const t = multisectionTransformer(50, 52, 3, {
      type: 'chebyshev',
      frequency: F,
      gammaMax: 0.05,
    });
    expect(t.bandwidth).toBeNull();
    expect(gammaMag(t.elements, 52, 50, 0.3 * F)).toBeLessThan(0.05);
  });

  it('ripple in dB and |Gamma| convert both ways', () => {
    expect(rippleDbFromGamma(gammaFromRippleDb(0.25))).toBeCloseTo(0.25, 12);
    const a = multisectionTransformer(50, 100, 4, {
      type: 'chebyshev',
      frequency: F,
      rippleDb: 0.1,
    });
    const b = multisectionTransformer(50, 100, 4, {
      type: 'chebyshev',
      frequency: F,
      gammaMax: gammaFromRippleDb(0.1),
    });
    expect(a.impedances).toEqual(b.impedances);
  });

  it('refuses sizes and impedances it cannot design', () => {
    expect(() => multisectionTransformer(50, 100, 0, { type: 'binomial', frequency: F })).toThrow(
      RangeError,
    );
    expect(() => multisectionTransformer(50, 100, 7, { type: 'binomial', frequency: F })).toThrow(
      RangeError,
    );
    expect(() => multisectionTransformer(50, -1, 2, { type: 'binomial', frequency: F })).toThrow(
      RangeError,
    );
    expect(() =>
      multisectionTransformer(50, 100, 2, { type: 'chebyshev', frequency: F, gammaMax: 1 }),
    ).toThrow(RangeError);
  });
});

describe('Kuroda identities', () => {
  const thetas = Array.from({ length: 160 }, (_, i) => 0.0137 + i * 0.0193);

  function sameTwoPort(a: readonly CommensurateElement[], b: readonly CommensurateElement[]): void {
    for (const th of thetas) {
      const sa = commensurateS(a, th, 50);
      const sb = commensurateS(b, th, 50);
      for (let k = 0; k < 4; k++) {
        expect(cabs(csub(sa[k]!, sb[k]!))).toBeLessThan(1e-9);
      }
    }
  }

  const ue: CommensurateElement = { kind: 'ue', z: 70 };
  const cases: readonly [string, CommensurateElement, CommensurateElement][] = [
    ['(a) UE then series shorted stub', ue, { kind: 'seriesShort', z: 35 }],
    ['(b) series shorted stub then UE', { kind: 'seriesShort', z: 35 }, ue],
    ['(a) backwards: shunt open stub then UE', { kind: 'shuntOpen', z: 120 }, ue],
    ['(b) backwards: UE then shunt open stub', ue, { kind: 'shuntOpen', z: 120 }],
    ['(c) shunt shorted stub then UE', { kind: 'shuntShort', z: 45 }, ue],
    ['(c) mirrored: UE then shunt shorted stub', ue, { kind: 'shuntShort', z: 45 }],
    ['(d) series open stub then UE', { kind: 'seriesOpen', z: 25 }, ue],
    ['(d) mirrored: UE then series open stub', ue, { kind: 'seriesOpen', z: 25 }],
  ];

  for (const [name, a, b] of cases) {
    it(`${name} keeps the S-parameters at every frequency`, () => {
      const out = kuroda(a, b);
      sameTwoPort([a, b], out);
      // The stub has crossed the UE.
      const stubAt = out.findIndex((el) => el.kind !== 'ue' && el.kind !== 'transformer');
      const ueAt = out.findIndex((el) => el.kind === 'ue');
      expect(stubAt > ueAt).toBe(a.kind !== 'ue');
    });
  }

  it('(a) turns a series inductor into a shunt capacitor and back', () => {
    const [shunt, line] = kuroda(ue, { kind: 'seriesShort', z: 35 });
    expect(shunt).toEqual({ kind: 'shuntOpen', z: (70 * 105) / 35 });
    expect(line).toEqual({ kind: 'ue', z: 105 });
    const back = kuroda(shunt!, line!);
    expect(back[0]!.kind).toBe('ue');
    expect((back[0] as { z: number }).z).toBeCloseTo(70, 9);
    expect(back[1]!.kind).toBe('seriesShort');
    expect((back[1] as { z: number }).z).toBeCloseTo(35, 9);
  });

  it('refuses pairs that are not one UE and one stub', () => {
    expect(() => kuroda(ue, ue)).toThrow(RangeError);
    expect(() => kuroda({ kind: 'shuntOpen', z: 50 }, { kind: 'seriesShort', z: 50 })).toThrow(
      RangeError,
    );
    expect(() => kuroda(ue, { kind: 'shuntOpen', z: 0 })).toThrow(RangeError);
  });
});

describe('lowpassPrototype', () => {
  it('gives the tabulated Butterworth and Chebyshev values', () => {
    const b3 = lowpassPrototype(3, { response: 'butterworth' });
    [1, 2, 1, 1].forEach((g, i) => expect(b3[i]).toBeCloseTo(g, 12));
    const c3 = lowpassPrototype(3, { response: 'chebyshev', rippleDb: 0.5 });
    [1.5963, 1.0967, 1.5963, 1].forEach((g, i) => expect(c3[i]).toBeCloseTo(g, 4));
    const c4 = lowpassPrototype(4, { response: 'chebyshev', rippleDb: 0.5 });
    [1.6703, 1.1926, 2.3661, 0.8419, 1.9841].forEach((g, i) => expect(c4[i]).toBeCloseTo(g, 4));
  });

  it('refuses orders outside 1 to 9', () => {
    expect(() => lowpassPrototype(0, { response: 'butterworth' })).toThrow(RangeError);
    expect(() => lowpassPrototype(10, { response: 'butterworth' })).toThrow(RangeError);
    expect(() => lowpassPrototype(3, { response: 'chebyshev', rippleDb: 0 })).toThrow(RangeError);
  });
});

describe('designStubFilter', () => {
  it('Butterworth N = 3 low-pass: shunt open stubs and lines, 3 dB at the cutoff, falling to 2 fc', () => {
    const d = designStubFilter({
      kind: 'lowpass',
      response: 'butterworth',
      order: 3,
      cutoff: F,
      z0: 50,
    });
    expect(d.elements.map((el) => el.kind)).toEqual([
      'openStub',
      'line',
      'openStub',
      'line',
      'openStub',
    ]);
    for (const el of d.elements) {
      expect(el.length).toBe(0.125);
      expect(el.refFrequency).toBe(F);
    }
    // The textbook result: 2 Z0 outer stubs and lines, Z0 / 2 middle stub.
    d.stubImpedances.forEach((z, i) => expect(z).toBeCloseTo([100, 25, 100][i]!, 9));
    d.lineImpedances.forEach((z) => expect(z).toBeCloseTo(100, 9));
    expect(d.outOfRange).toEqual([]);
    expect(s21Db(d.elements, 50, 50, F)).toBeCloseTo(-10 * Math.log10(2), 9);
    let prev = s21Db(d.elements, 50, 50, F);
    for (let x = 1.01; x < 2; x += 0.01) {
      const db = s21Db(d.elements, 50, 50, x * F);
      expect(db).toBeLessThan(prev);
      prev = db;
    }
    // Matched at DC: open stubs and zero-length lines leave the 50 ohm load.
    expect(gammaMag(d.elements, 50, 50, 1)).toBeLessThan(1e-6);
    // And flat in the passband, as the prototype.
    expect(s21Db(d.elements, 50, 50, 0.5 * F)).toBeCloseTo(
      -10 * Math.log10(1 + Math.tan(Math.PI / 8) ** 6),
      9,
    );
  });

  it('Chebyshev low-pass shows the asked ripple in the passband', () => {
    for (const [order, ripple] of [
      [3, 0.5],
      [5, 0.1],
      [7, 1],
    ] as const) {
      const d = designStubFilter({
        kind: 'lowpass',
        response: 'chebyshev',
        order,
        rippleDb: ripple,
        cutoff: F,
        z0: 50,
      });
      expect(d.designLoad).toBeCloseTo(50, 9);
      let worst = 0;
      let best = -Infinity;
      for (let x = 0.001; x <= 1; x += 0.001) {
        const db = s21Db(d.elements, 50, 50, x * F);
        worst = Math.min(worst, db);
        best = Math.max(best, db);
      }
      expect(-worst).toBeCloseTo(ripple, 3);
      expect(best).toBeGreaterThan(-1e-4);
      expect(s21Db(d.elements, 50, 50, F)).toBeCloseTo(-ripple, 9);
      expect(s21Db(d.elements, 50, 50, 1.5 * F)).toBeLessThan(-20);
    }
  });

  it('only shunt open stubs and lines for every order, and the response matches the prototype', () => {
    for (let n = 1; n <= 9; n++) {
      const d = designStubFilter({
        kind: 'lowpass',
        response: 'butterworth',
        order: n,
        cutoff: F,
        z0: 50,
      });
      expect(d.elements.filter((el) => el.kind === 'openStub')).toHaveLength(n);
      expect(d.elements.filter((el) => el.kind === 'line')).toHaveLength(n - 1);
      d.elements.forEach((el, i) => expect(el.kind).toBe(i % 2 === 0 ? 'openStub' : 'line'));
      // Butterworth: |S21|^2 = 1 / (1 + tan(theta)^(2N)) with theta an eighth wave at fc.
      for (const x of [0.3, 0.8, 1.2, 1.7]) {
        const expected = -10 * Math.log10(1 + Math.tan((Math.PI / 4) * x) ** (2 * n));
        expect(s21Db(d.elements, 50, 50, x * F)).toBeCloseTo(expected, 6);
      }
    }
  });

  it('flags impedances outside the realizable range', () => {
    const d = designStubFilter({
      kind: 'lowpass',
      response: 'butterworth',
      order: 9,
      cutoff: F,
      z0: 50,
    });
    expect(d.outOfRange.length).toBeGreaterThan(0);
    for (const o of d.outOfRange) {
      expect(o.z < 15 || o.z > 150).toBe(true);
      expect(d.elements[o.index]!.z0).toBe(o.z);
    }
    const wide = designStubFilter({
      kind: 'lowpass',
      response: 'butterworth',
      order: 9,
      cutoff: F,
      z0: 50,
      range: [1, 1000],
    });
    expect(wide.outOfRange).toEqual([]);
  });

  it('an even-order Chebyshev low-pass names the load it is designed for', () => {
    const d = designStubFilter({
      kind: 'lowpass',
      response: 'chebyshev',
      order: 4,
      rippleDb: 0.5,
      cutoff: F,
      z0: 50,
    });
    expect(d.designLoad).not.toBeCloseTo(50, 1);
    expect(s21Db(d.elements, d.designLoad, 50, F)).toBeCloseTo(-0.5, 9);
  });

  it('high-pass: shunt shorted stubs and Z0 lines, cutoff exact, passes from fc to 3 fc', () => {
    for (const response of ['butterworth', 'chebyshev'] as const) {
      const d = designStubFilter({
        kind: 'highpass',
        response,
        order: 5,
        rippleDb: 0.5,
        cutoff: F,
        z0: 50,
      });
      expect(d.exact).toBe(false);
      d.elements.forEach((el, i) => expect(el.kind).toBe(i % 2 === 0 ? 'shortStub' : 'line'));
      d.lineImpedances.forEach((z) => expect(z).toBe(50));
      const loss = response === 'butterworth' ? 10 * Math.log10(2) : 0.5;
      expect(s21Db(d.elements, 50, 50, F)).toBeCloseTo(-loss, 6);
      expect(s21Db(d.elements, 50, 50, 2 * F)).toBeGreaterThan(-1e-9);
      expect(s21Db(d.elements, 50, 50, 0.5 * F)).toBeLessThan(-10);
    }
  });

  it('refuses a cutoff or Z0 that is not positive', () => {
    expect(() =>
      designStubFilter({ kind: 'lowpass', response: 'butterworth', order: 3, cutoff: 0, z0: 50 }),
    ).toThrow(RangeError);
    expect(() =>
      designStubFilter({
        kind: 'lowpass',
        response: 'butterworth',
        order: 3,
        cutoff: F,
        z0: Number.NaN,
      }),
    ).toThrow(RangeError);
  });
});
