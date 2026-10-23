/**
 * QA round 1: netparams.ts branches the existing tests do not reach. Every
 * expected value is a hand calculation (Pozar table 4.2), noted inline.
 */
import { describe, expect, it } from 'vitest';
import {
  abcdToS,
  complex,
  convertS,
  convertToS,
  hToS,
  NetworkParameterError,
  sToAbcd,
  sToH,
  sToY,
  sToZ,
  supportedParameters,
  yToS,
  zToS,
} from '../src/index';

const c = (re: number, im = 0) => complex(re, im);

/** Shunt admittance y = 2 (normalized): S11 = -y/(2+y) = -0.5, S21 = 2/(2+y) = 0.5. All exact in binary. */
const SHUNT2 = [c(-0.5), c(0.5), c(0.5), c(-0.5)];
/** Series impedance z = 2 (normalized): S11 = z/(z+2) = 0.5, S21 = 2/(z+2) = 0.5. */
const SERIES2 = [c(0.5), c(0.5), c(0.5), c(0.5)];

function near(actual: readonly { re: number; im: number }[], expected: readonly number[][]) {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((v, i) => {
    expect(v.re).toBeCloseTo(expected[i]![0]!, 12);
    expect(v.im).toBeCloseTo(expected[i]![1] ?? 0, 12);
  });
}

describe('matrix shape checks', () => {
  it('refuses an empty matrix and non-square lengths 2, 3, 5', () => {
    for (const bad of [[], [c(0), c(0)], [c(0), c(0), c(0)], [c(0), c(0), c(0), c(0), c(0)]]) {
      expect(() => sToZ(bad)).toThrow(NetworkParameterError);
      expect(() => sToZ(bad)).toThrow(/not square/);
      expect(() => convertS(bad, 'S', 50)).toThrow(NetworkParameterError);
      expect(() => convertToS(bad, 'Z', 50)).toThrow(NetworkParameterError);
    }
  });

  it('H and ABCD refuse a one-port and a three-port with a two-port message', () => {
    expect(() => sToH([c(0.2)])).toThrow(/two-ports only/);
    expect(() => hToS([c(0.2)])).toThrow(/two-ports only/);
    expect(() => sToAbcd(Array.from({ length: 9 }, () => c(0)))).toThrow(/two-ports only/);
    expect(() => abcdToS([c(1)])).toThrow(/two-ports only/);
  });

  it('supportedParameters: five types for a two-port, S Z Y otherwise', () => {
    expect(supportedParameters(2)).toEqual(['S', 'Z', 'Y', 'H', 'ABCD']);
    expect(supportedParameters(1)).toEqual(['S', 'Z', 'Y']);
    expect(supportedParameters(3)).toEqual(['S', 'Z', 'Y']);
    expect(supportedParameters(4)).toEqual(['S', 'Z', 'Y']);
  });
});

describe('one-port limits', () => {
  it('s = 0.5: z = (1 + s)/(1 - s) = 3, y = 1/3; unnormalized 150 ohm and 1/150 S', () => {
    near(sToZ([c(0.5)]), [[3]]);
    near(sToY([c(0.5)]), [[1 / 3]]);
    near(convertS([c(0.5)], 'Z', 50, false), [[150]]);
    near(convertS([c(0.5)], 'Y', 50, false), [[1 / 150]]);
    near(convertToS([c(150)], 'Z', 50, false), [[0.5]]);
    near(convertToS([c(1 / 150)], 'Y', 50, false), [[0.5]]);
  });

  it('s = 1 (open) has no Z matrix, s = -1 (short) has no Y matrix', () => {
    expect(() => sToZ([c(1)])).toThrow(/I - S is singular/);
    expect(() => sToY([c(-1)])).toThrow(/I \+ S is singular/);
    // The other one still exists: open -> y = 0, short -> z = 0.
    near(sToY([c(1)]), [[0]]);
    near(sToZ([c(-1)]), [[0]]);
  });

  it('z = -1 and y = -1 (the points where the inverse does not exist) are refused', () => {
    expect(() => zToS([c(-1)])).toThrow(/z \+ I is singular/);
    expect(() => yToS([c(-1)])).toThrow(/I \+ y is singular/);
  });

  it('a zero matrix (matched) converts: z = y = I, S back is 0', () => {
    near(sToZ([c(0)]), [[1]]);
    near(sToY([c(0)]), [[1]]);
    near(zToS([c(1)]), [[0]]);
  });
});

describe('two-port hand values (shunt y = 2 and series z = 2)', () => {
  it('shunt: Z = (1/y)[1 1; 1 1] = 0.5 each, H = [0 1; -1 2], ABCD = [1 0; 2 1]', () => {
    near(sToZ(SHUNT2), [[0.5], [0.5], [0.5], [0.5]]);
    near(sToH(SHUNT2), [[0], [1], [-1], [2]]);
    near(sToAbcd(SHUNT2), [[1], [0], [2], [1]]);
    // A shunt element has no Y matrix (V1 = V2 always).
    expect(() => sToY(SHUNT2)).toThrow(NetworkParameterError);
  });

  it('series: Y = (1/z)[1 -1; -1 1] = 0.5, H = [2 1; -1 0], ABCD = [1 2; 0 1], and no Z matrix', () => {
    near(sToY(SERIES2), [[0.5], [-0.5], [-0.5], [0.5]]);
    near(sToH(SERIES2), [[2], [1], [-1], [0]]);
    near(sToAbcd(SERIES2), [[1], [2], [0], [1]]);
    expect(() => sToZ(SERIES2)).toThrow(NetworkParameterError);
  });

  it('unnormalized at 50 ohm: shunt Z 25 ohm, h22 0.04 S, C 0.04 S; series Y 0.01 S, h11 100 ohm, B 100 ohm', () => {
    near(convertS(SHUNT2, 'Z', 50, false), [[25], [25], [25], [25]]);
    near(convertS(SHUNT2, 'H', 50, false), [[0], [1], [-1], [0.04]]);
    near(convertS(SHUNT2, 'ABCD', 50, false), [[1], [0], [0.04], [1]]);
    near(convertS(SERIES2, 'Y', 50, false), [[0.01], [-0.01], [-0.01], [0.01]]);
    near(convertS(SERIES2, 'H', 50, false), [[100], [1], [-1], [0]]);
    near(convertS(SERIES2, 'ABCD', 50, false), [[1], [100], [0], [1]]);
  });

  it('convertToS inverts the unnormalized values at another Z0 (75 ohm) consistently', () => {
    // Series 100 ohm in a 75 ohm system: z = 100/75 = 4/3, S11 = z/(z+2) = 0.4, S21 = 2/(z+2) = 0.6.
    near(convertToS([c(1), c(100), c(0), c(1)], 'ABCD', 75, false), [[0.4], [0.6], [0.6], [0.4]]);
    near(convertToS([c(100), c(1), c(-1), c(0)], 'H', 75, false), [[0.4], [0.6], [0.6], [0.4]]);
    near(convertToS([c(0.01), c(-0.01), c(-0.01), c(0.01)], 'Y', 75, false), [
      [0.4],
      [0.6],
      [0.6],
      [0.4],
    ]);
  });

  it('ideal transformer n = 2 as ABCD [2 0; 0 0.5]: S11 = (n^2-1)/(n^2+1) = 0.6, S21 = 2n/(n^2+1) = 0.8', () => {
    near(abcdToS([c(2), c(0), c(0), c(0.5)]), [[0.6], [0.8], [0.8], [-0.6]]);
  });
});

describe('zero denominators', () => {
  it('sToH: (1 - s11)(1 + s22) + s12 s21 = 0 for s11 = 1, s12 = s21 = 0', () => {
    expect(() => sToH([c(1), c(0), c(0), c(0)])).toThrow(/zero denominator/);
  });

  it('hToS: (h11 + 1)(h22 + 1) - h12 h21 = 0 for h11 = -1, h12 = h21 = 0', () => {
    expect(() => hToS([c(-1), c(0), c(0), c(0)])).toThrow(/zero denominator/);
  });

  it('abcdToS: A + B + C + D = 0', () => {
    expect(() => abcdToS([c(1), c(-1), c(0), c(0)])).toThrow(/zero denominator/);
  });

  it('sToAbcd: S21 = 0 names S21', () => {
    expect(() => sToAbcd([c(0.5), c(0.5), c(0), c(0.5)])).toThrow(/S21 is zero/);
  });

  it('convertS to S is a copy, normalized or not', () => {
    const copy = convertS(SHUNT2, 'S', 50, false);
    expect(copy).toEqual(SHUNT2);
    expect(copy).not.toBe(SHUNT2);
  });
});

describe('three-port', () => {
  it('S = 0 (all matched): Z = Y = I, unnormalized 50 ohm and 0.02 S on the diagonal', () => {
    const s = Array.from({ length: 9 }, () => c(0));
    const z = convertS(s, 'Z', 50, false);
    const y = convertS(s, 'Y', 50, false);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        expect(z[i * 3 + j]!.re).toBeCloseTo(i === j ? 50 : 0, 12);
        expect(y[i * 3 + j]!.re).toBeCloseTo(i === j ? 0.02 : 0, 12);
      }
    }
    near(
      convertToS(z, 'Z', 50, false),
      s.map(() => [0]),
    );
  });
});
