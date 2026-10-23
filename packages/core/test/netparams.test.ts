import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  abcdToS,
  cabs,
  cadd,
  cdiv,
  cmul,
  complex,
  convertS,
  convertToS,
  convertTouchstonePoints,
  csub,
  hToS,
  NetworkParameterError,
  readTouchstone,
  sToAbcd,
  sToH,
  sToY,
  sToZ,
  supportedParameters,
  writeConvertedTouchstone,
  yToS,
  zToS,
  type Complex,
  type NetworkParameter,
} from '../src/index';

const c = (re: number, im = 0): Complex => complex(re, im);

function expectMatrix(actual: readonly Complex[], expected: readonly Complex[], digits = 12): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((e, i) => {
    expect((actual[i] as Complex).re).toBeCloseTo(e.re, digits);
    expect((actual[i] as Complex).im).toBeCloseTo(e.im, digits);
  });
}

/**
 * T network with normalized Z = [[3, 2], [2, 3]] (series arms 1 and 1, shunt
 * arm 2): by hand Delta_z = (z11 + 1)(z22 + 1) - z12 z21 = 16 - 4 = 12,
 * s11 = ((z11 - 1)(z22 + 1) - z12 z21) / 12 = (8 - 4) / 12 = 1/3, and
 * s12 = s21 = 2 z12 / 12 = 1/3, s22 = 1/3.
 */
const T_S: Complex[] = [c(1 / 3), c(1 / 3), c(1 / 3), c(1 / 3)];
/** Inverse of Z: det 9 - 4 = 5, Y = [[3, -2], [-2, 3]] / 5. */
const T_Y: Complex[] = [c(0.6), c(-0.4), c(-0.4), c(0.6)];
/** h11 = det / z22 = 5/3, h12 = z12 / z22 = 2/3, h21 = -z21 / z22 = -2/3, h22 = 1 / z22 = 1/3. */
const T_H: Complex[] = [c(5 / 3), c(2 / 3), c(-2 / 3), c(1 / 3)];
/** A = z11 / z21 = 1.5, B = det / z21 = 2.5, C = 1 / z21 = 0.5, D = z22 / z21 = 1.5. */
const T_ABCD: Complex[] = [c(1.5), c(2.5), c(0.5), c(1.5)];
const T_Z: Complex[] = [c(3), c(2), c(2), c(3)];

/** Series impedance z = 1 + j: s11 = z / (z + 2) = (1 + j)(3 - j) / 10 = 0.4 + 0.2j, s21 = 2 / (3 + j) = 0.6 - 0.2j. */
const SERIES_S: Complex[] = [c(0.4, 0.2), c(0.6, -0.2), c(0.6, -0.2), c(0.4, 0.2)];
/** Shunt admittance y = 1: s11 = -y / (y + 2) = -1/3, s21 = 2 / (y + 2) = 2/3. */
const SHUNT_S: Complex[] = [c(-1 / 3), c(2 / 3), c(2 / 3), c(-1 / 3)];

describe('S to Z, Y, H and ABCD, hand-computed', () => {
  it('converts the T network (normalized)', () => {
    expectMatrix(sToZ(T_S), T_Z);
    expectMatrix(sToY(T_S), T_Y);
    expectMatrix(sToH(T_S), T_H);
    expectMatrix(sToAbcd(T_S), T_ABCD);
  });

  it('converts back from every type', () => {
    expectMatrix(zToS(T_Z), T_S);
    expectMatrix(yToS(T_Y), T_S);
    expectMatrix(hToS(T_H), T_S);
    expectMatrix(abcdToS(T_ABCD), T_S);
  });

  it('unnormalizes with Z0 = 50: Z x 50, Y / 50, h11 x 50, h22 / 50, B x 50, C / 50', () => {
    expectMatrix(convertS(T_S, 'S', 50, false), T_S);
    expectMatrix(convertS(T_S, 'Z', 50, false), [c(150), c(100), c(100), c(150)]);
    expectMatrix(convertS(T_S, 'Y', 50, false), [c(0.012), c(-0.008), c(-0.008), c(0.012)]);
    expectMatrix(convertS(T_S, 'H', 50, false), [c(250 / 3), c(2 / 3), c(-2 / 3), c(1 / 150)]);
    expectMatrix(convertS(T_S, 'ABCD', 50, false), [c(1.5), c(125), c(0.01), c(1.5)]);
  });

  it('keeps the normalized values when asked', () => {
    expectMatrix(convertS(T_S, 'Z', 75, true), T_Z);
    expectMatrix(convertS(T_S, 'ABCD', 75, true), T_ABCD);
  });

  it('inverts the unnormalized values with the same Z0', () => {
    const z0 = 75;
    for (const kind of ['S', 'Z', 'Y', 'H', 'ABCD'] as const) {
      expectMatrix(convertToS(convertS(T_S, kind, z0, false), kind, z0, false), T_S);
    }
  });

  it('converts a series impedance: H = [z 1; -1 0], ABCD = [1 z; 0 1]', () => {
    expectMatrix(sToH(SERIES_S), [c(1, 1), c(1), c(-1), c(0)]);
    expectMatrix(sToAbcd(SERIES_S), [c(1), c(1, 1), c(0), c(1)]);
    expectMatrix(hToS([c(1, 1), c(1), c(-1), c(0)]), SERIES_S);
    expectMatrix(abcdToS([c(1), c(1, 1), c(0), c(1)]), SERIES_S);
    // A series element has neither a Z nor a Y matrix.
    expect(() => sToZ(SERIES_S)).toThrow(NetworkParameterError);
    expect(() => sToY(SERIES_S)).not.toThrow();
  });

  it('converts a shunt admittance: Z = 1/y [1 1; 1 1], H = [0 1; -1 y], ABCD = [1 0; y 1]', () => {
    expectMatrix(sToZ(SHUNT_S), [c(1), c(1), c(1), c(1)]);
    expectMatrix(sToH(SHUNT_S), [c(0), c(1), c(-1), c(1)]);
    expectMatrix(sToAbcd(SHUNT_S), [c(1), c(0), c(1), c(1)]);
    expect(() => sToY(SHUNT_S)).toThrow(/admittance matrix/);
  });

  it('converts one-ports: z = (1 + s) / (1 - s)', () => {
    // s = 1/3 gives z = (4/3) / (2/3) = 2, i.e. 100 ohm and 10 mS at Z0 = 50.
    expectMatrix(sToZ([c(1 / 3)]), [c(2)]);
    expectMatrix(convertS([c(1 / 3)], 'Z', 50, false), [c(100)]);
    expectMatrix(convertS([c(1 / 3)], 'Y', 50, false), [c(0.01)]);
    // z = 1 + j gives s = j / (2 + j) = (1 + 2j) / 5.
    expectMatrix(sToZ([c(0.2, 0.4)]), [c(1, 1)]);
    expectMatrix(zToS([c(1, 1)]), [c(0.2, 0.4)]);
  });

  it('converts a three-port: S = I/3 is z = 2 I, and a tridiagonal z survives the round trip', () => {
    const s3 = [1, 0, 0, 0, 1, 0, 0, 0, 1].map((v) => c(v / 3));
    expectMatrix(
      sToZ(s3),
      [2, 0, 0, 0, 2, 0, 0, 0, 2].map((v) => c(v)),
    );
    expectMatrix(
      sToY(s3),
      [0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5].map((v) => c(v)),
    );
    const z = [2, 1, 0, 1, 2, 1, 0, 1, 2].map((v) => c(v, v === 1 ? 0.5 : 0));
    expectMatrix(sToZ(zToS(z)), z);
    // I - S = [0.1 -0.5; -0.5 0.9] has its largest first-column entry in row 2: the elimination swaps rows.
    const s2 = [c(0.9), c(0.5), c(0.5), c(0.1)];
    expectMatrix(zToS(sToZ(s2)), s2);
  });

  it('refuses H and ABCD for other than two ports, and ABCD for S21 = 0', () => {
    expect(() => sToH([c(0.1)])).toThrow(/two-ports only/);
    expect(() => sToAbcd(new Array(9).fill(c(0.1)))).toThrow(/two-ports only/);
    expect(() => sToAbcd([c(0.2), c(0.1), c(0), c(0.3)])).toThrow(/S21 is zero/);
    expect(() => sToZ([c(1), c(0), c(0), c(1)])).toThrow(/no impedance matrix/);
    expect(() => sToZ([c(1), c(2), c(3)])).toThrow(/not square/);
    expect(supportedParameters(1)).toEqual(['S', 'Z', 'Y']);
    expect(supportedParameters(2)).toEqual(['S', 'Z', 'Y', 'H', 'ABCD']);
    expect(supportedParameters(4)).toEqual(['S', 'Z', 'Y']);
  });
});

describe('a complex two-port against the textbook closed forms', () => {
  const [s11, s12, s21, s22] = [c(0.31, -0.42), c(0.07, 0.03), c(2.1, 1.3), c(-0.2, 0.25)];
  const s = [s11, s12, s21, s22];
  const one = c(1);
  const s1221 = cmul(s12, s21);
  const dz = csub(cmul(csub(one, s11), csub(one, s22)), s1221);

  it('Z matches z11 = ((1 + s11)(1 - s22) + s12 s21) / ((1 - s11)(1 - s22) - s12 s21)', () => {
    const z = sToZ(s);
    expectMatrix(
      z,
      [
        cdiv(cadd(cmul(cadd(one, s11), csub(one, s22)), s1221), dz),
        cdiv(cmul(c(2), s12), dz),
        cdiv(cmul(c(2), s21), dz),
        cdiv(cadd(cmul(csub(one, s11), cadd(one, s22)), s1221), dz),
      ],
      10,
    );
  });

  it('keeps AD - BC = 1 for a reciprocal network and S21 = 2 / (A + B + C + D)', () => {
    const recip = [s11, c(0.4, 0.1), c(0.4, 0.1), s22];
    const [a, b, cc, d] = sToAbcd(recip) as [Complex, Complex, Complex, Complex];
    const det = csub(cmul(a, d), cmul(b, cc));
    expect(det.re).toBeCloseTo(1, 12);
    expect(det.im).toBeCloseTo(0, 12);
    const sum = cadd(cadd(a, b), cadd(cc, d));
    const s21Back = cdiv(c(2), sum);
    expect(s21Back.re).toBeCloseTo(0.4, 12);
    expect(s21Back.im).toBeCloseTo(0.1, 12);
  });
});

describe('conversions of a file', () => {
  const text = readFileSync(
    new URL('./fixtures/sparams/amp-synthetic.s2p', import.meta.url),
    'utf8',
  );
  const data = readTouchstone(text);

  it('round-trips every point through every parameter type, normalized or not', () => {
    for (const kind of ['Z', 'Y', 'H', 'ABCD'] as NetworkParameter[]) {
      for (const normalized of [true, false]) {
        const converted = convertTouchstonePoints(data, kind, normalized);
        expect(converted).toHaveLength(data.points.length);
        converted.forEach((p, i) => {
          const back = convertToS(p.s, kind, data.z0, normalized);
          const orig = (data.points[i] as { s: readonly Complex[] }).s;
          back.forEach((v, k) => {
            expect(cabs(csub(v, orig[k] as Complex))).toBeLessThan(1e-9);
          });
        });
      }
    }
  });

  it('writes Z-parameters normalized: option line Z, R 50, six numbers per data line', () => {
    const out = writeConvertedTouchstone(data, 'Z', { format: 'RI', frequencyUnit: 'GHZ' });
    expect(out).toContain('# GHZ Z RI R 50');
    expect(out).toContain('! f Z11 Z21 Z12 Z22');
    expect(out).toContain('! Z-parameters normalized to 50 ohm');
    const back = readTouchstone(out);
    expect(back.parameter).toBe('Z');
    expect(back.z0).toBe(50);
    expect(back.points).toHaveLength(data.points.length);
    const expected = convertS((data.points[3] as { s: readonly Complex[] }).s, 'Z', 50, true);
    (back.points[3] as { s: readonly Complex[] }).s.forEach((v, k) => {
      expect(cabs(csub(v, expected[k] as Complex))).toBeLessThan(1e-5);
    });
    // The noise block belongs to S and is not carried over.
    expect(back.noise).toHaveLength(0);
  });

  it('writes unnormalized Z in ohm with R 1', () => {
    const out = writeConvertedTouchstone(data, 'Z', { normalized: false, format: 'RI' });
    expect(out).toContain('# GHZ Z RI R 1');
    expect(out).toContain('ohm and siemens (unnormalized)');
    const back = readTouchstone(out);
    const expected = convertS((data.points[0] as { s: readonly Complex[] }).s, 'Z', 50, false);
    (back.points[0] as { s: readonly Complex[] }).s.forEach((v, k) => {
      expect(cabs(csub(v, expected[k] as Complex))).toBeLessThan(1e-4);
    });
  });

  it('writes the T network as a hand-checkable file in every type', () => {
    const t = {
      ports: 2,
      parameter: 'S' as const,
      format: 'RI' as const,
      frequencyUnit: 'HZ' as const,
      z0: 50,
      points: [{ frequency: 1000, s: T_S }],
      noise: [],
      comments: [],
    };
    const lines = (kind: NetworkParameter, normalized: boolean): string[] =>
      writeConvertedTouchstone(t, kind, { normalized, format: 'RI', digits: 6 })
        .split('\n')
        .filter((l) => l !== '' && !l.startsWith('!'));
    expect(lines('Z', false)).toEqual(['# HZ Z RI R 1', '1000 150 0 100 0 100 0 150 0']);
    expect(lines('Y', true)).toEqual(['# HZ Y RI R 50', '1000 0.6 0 -0.4 0 -0.4 0 0.6 0']);
    // Two-port order is 11 21 12 22: h11, h21, h12, h22.
    expect(lines('H', true)).toEqual([
      '# HZ H RI R 50',
      '1000 1.66667 0 -0.666667 0 0.666667 0 0.333333 0',
    ]);
    // ABCD is written in the order A B C D.
    expect(lines('ABCD', false)).toEqual(['# HZ A RI R 1', '1000 1.5 0 125 0 0.01 0 1.5 0']);
    expect(lines('ABCD', true)).toEqual(['# HZ A RI R 50', '1000 1.5 0 2.5 0 0.5 0 1.5 0']);
    expect(writeConvertedTouchstone(t, 'ABCD')).toContain('! f A B C D');
  });

  it('S export keeps the noise block and the original units', () => {
    const out = writeConvertedTouchstone(data, 'S');
    expect(out).toContain('# GHZ S MA R 50');
    expect(readTouchstone(out).noise).toHaveLength(data.noise.length);
  });

  it('refuses what has no such matrix, naming the frequency', () => {
    const series = {
      ...data,
      points: [{ frequency: 2e9, s: SERIES_S }],
      noise: [],
    };
    expect(() => writeConvertedTouchstone(series, 'Z')).toThrow(/At 2000000000 Hz/);
    expect(() => writeConvertedTouchstone(series, 'H')).not.toThrow();
    const oneport = {
      ...data,
      ports: 1,
      points: [{ frequency: 1e9, s: [c(0.2, 0.4)] }],
      noise: [],
    };
    expect(() => writeConvertedTouchstone(oneport, 'H')).toThrow(/two-ports only/);
    expect(writeConvertedTouchstone(oneport, 'Z', { normalized: false, format: 'RI' })).toContain(
      '1 50 50',
    );
  });
});
