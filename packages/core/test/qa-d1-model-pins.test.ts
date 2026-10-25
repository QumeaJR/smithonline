/**
 * QA round on depth phase D1: element-model pins that the D1 invariant and
 * golden tests do not provide. Every model mutation below survives
 * invariants.test.ts and golden.test.ts (they are reciprocal, lossless or
 * passive either way); each test here kills one of them:
 *
 * - line attenuation not scaled by sqrt(f / refFrequency), or dropped;
 * - eps_r ignored in the physical length of a lossy line;
 * - S21 sign or phase, S11 / S22 orientation, transformer ratio inverted;
 * - Q of L or C dropped; package pad not split, Cp, ESR or ESL dropped;
 * - RLC connection flipped; stub length not scaled with frequency.
 *
 * Expected values are closed-form, computed here with local complex
 * arithmetic that does not use the app's code.
 */
import { describe, expect, it } from 'vitest';
import { evaluateAt, ladderSParameters, type Element, type SParameters } from '../src/index';

/* ------------------------------------------------- local complex helpers */

type C = { re: number; im: number };
const c = (re: number, im = 0): C => ({ re, im });
const add = (a: C, b: C): C => c(a.re + b.re, a.im + b.im);
const mul = (a: C, b: C): C => c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const div = (a: C, b: C): C => {
  const d = b.re * b.re + b.im * b.im;
  return c((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
const inv = (a: C): C => div(c(1), a);
const sc = (a: C, k: number): C => c(a.re * k, a.im * k);
const abs = (a: C): number => Math.hypot(a.re, a.im);

/** S of a series impedance z between two ports of z0: S11 = S22 = z / (z + 2 z0), S21 = 2 z0 / (z + 2 z0). */
function seriesS(z: C, z0: number): SParameters {
  const den = add(z, c(2 * z0));
  const s11 = div(z, den);
  const s21 = div(c(2 * z0), den);
  return { s11, s12: s21, s21, s22: s11 };
}

/** S of a shunt admittance y: with yn = y z0, S11 = S22 = -yn / (2 + yn), S21 = 2 / (2 + yn). */
function shuntS(y: C, z0: number): SParameters {
  const yn = sc(y, z0);
  const den = add(c(2), yn);
  const s11 = div(sc(yn, -1), den);
  const s21 = div(c(2), den);
  return { s11, s12: s21, s21, s22: s11 };
}

/** S from an ABCD matrix (textbook, Pozar table 4.2). */
function abcdS(a: C, b: C, cc: C, d: C, z0: number): SParameters {
  const bz = sc(b, 1 / z0);
  const cz = sc(cc, z0);
  const den = add(add(a, bz), add(cz, d));
  const s21 = div(c(2), den);
  return {
    s11: div(add(add(a, bz), sc(add(cz, d), -1)), den),
    s12: s21,
    s21,
    s22: div(add(add(sc(a, -1), bz), add(d, sc(cz, -1))), den),
  };
}

function expectS(got: SParameters, want: SParameters, tol = 1e-12): void {
  for (const k of ['s11', 's12', 's21', 's22'] as const) {
    const err = abs(add(got[k], sc(want[k], -1)));
    if (err > tol) {
      throw new Error(
        `${k}: got ${got[k].re} ${got[k].im}j, want ${want[k].re} ${want[k].im}j (err ${err})`,
      );
    }
  }
}

const sOf = (elements: Element[], f: number, z0 = 50): SParameters =>
  ladderSParameters({ z0, frequency: f, load: c(z0), elements }, f);

const C0 = 299792458;
const W = (f: number): number => 2 * Math.PI * f;

/* ------------------------------------------------------------ lossy line */

describe('lossy line: dB per metre of physical length, scaled by sqrt(f / f_ref)', () => {
  // A matched line (Zc = Z0 = 50) has S11 = S22 = 0 and S21 = exp(-alpha l - j beta l).
  // 0.5 wavelength at 1 GHz in air is 0.149896229 m; at 10 dB/m that is 1.49896229 dB.
  const line = (extra: Partial<Element> = {}): Element =>
    ({
      kind: 'line',
      z0: 50,
      length: 0.5,
      refFrequency: 1e9,
      alphaDbPerM: 10,
      ...extra,
    }) as Element;
  const matched = (lossDb: number, phaseRad: number): SParameters => {
    const m = 10 ** (-lossDb / 20);
    const s21 = c(m * Math.cos(phaseRad), m * Math.sin(phaseRad));
    return { s11: c(0), s12: s21, s21, s22: c(0) };
  };

  it('at the reference frequency: 1.49896229 dB, phase -180 degrees', () => {
    expectS(sOf([line()], 1e9), matched(10 * 0.5 * (C0 / 1e9), -Math.PI));
  });

  it('at four times the reference frequency the loss doubles (sqrt 4), phase 2 wavelengths', () => {
    expectS(sOf([line()], 4e9), matched(2 * 10 * 0.5 * (C0 / 1e9), -4 * Math.PI));
  });

  it('at a quarter of the reference frequency the loss halves, 0.125 wavelength (-45 degrees)', () => {
    expectS(sOf([line()], 0.25e9), matched(0.5 * 10 * 0.5 * (C0 / 1e9), -Math.PI / 4));
  });

  it('eps_r 4 halves the physical length and with it the loss', () => {
    expectS(sOf([line({ er: 4 })], 1e9), matched((10 * 0.5 * (C0 / 1e9)) / 2, -Math.PI));
  });

  it('without a reference frequency the length is taken at the evaluation frequency', () => {
    // 0.5 wavelength at 2 GHz is 0.0749481145 m: 0.749481145 dB.
    expectS(
      sOf([{ kind: 'line', z0: 50, length: 0.5, alphaDbPerM: 10 }], 2e9),
      matched(10 * 0.5 * (C0 / 2e9), -Math.PI),
    );
  });
});

/* ------------------------------------------------- orientation and sign */

describe('S-parameter orientation and phase', () => {
  it('a matched quarter-wave line has S21 = -j exactly', () => {
    const s = sOf([{ kind: 'line', z0: 50, length: 0.25 }], 1e9);
    expectS(s, { s11: c(0), s12: c(0, -1), s21: c(0, -1), s22: c(0) });
  });

  it('shunt R at the load, series R at the source: S11 = 0.2, S22 = -0.2, S21 = 0.4', () => {
    // ABCD = [1 50; 0 1][1 0; 1/50 1] = [2 50; 0.02 1], Delta = 5.
    const s = sOf(
      [
        { kind: 'R', orientation: 'shunt', value: 50 },
        { kind: 'R', orientation: 'series', value: 50 },
      ],
      1e6,
    );
    expectS(s, { s11: c(0.2), s12: c(0.4), s21: c(0.4), s22: c(-0.2) });
  });

  it('ideal transformer n = 2: S11 = 0.6, S22 = -0.6, S21 = 0.8; the source sees 4 x 50 ohm', () => {
    const el: Element = { kind: 'transformer', n: 2 };
    expectS(sOf([el], 1e9), { s11: c(0.6), s12: c(0.8), s21: c(0.8), s22: c(-0.6) });
    const zin = evaluateAt({ z0: 50, frequency: 1e9, load: c(50), elements: [el] }, 1e9, c(50), {
      arcSteps: 0,
    }).zin;
    expect(abs(add(zin, c(-200)))).toBeLessThan(1e-9);
  });
});

/* ---------------------------------------------------- Q and parasitics */

describe('finite Q and package parasitics', () => {
  const f = 1e9;
  const w = W(f);

  it('series L with Q 50: Z = wL / 50 + j wL', () => {
    const l = 10e-9;
    const s = sOf([{ kind: 'L', orientation: 'series', value: l, q: 50 }], f);
    expectS(s, seriesS(c((w * l) / 50, w * l), 50));
  });

  it('series C with Q 100: Z = 1 / (wC Q) - j / (wC)', () => {
    const cap = 1e-12;
    const s = sOf([{ kind: 'C', orientation: 'series', value: cap, q: 100 }], f);
    expectS(s, seriesS(c(1 / (w * cap * 100), -1 / (w * cap)), 50));
  });

  it('inductor with Cp and ESR: Z = 1 / (1 / (ESR + j wL) + j w Cp)', () => {
    const el: Element = {
      kind: 'L',
      orientation: 'series',
      value: 10e-9,
      parasitics: { cp: 0.1e-12, esr: 0.5 },
    };
    const z = inv(add(inv(c(0.5, w * 10e-9)), c(0, w * 0.1e-12)));
    expectS(sOf([el], f), seriesS(z, 50));
  });

  it('capacitor with ESL: Z = j (w ESL - 1 / (wC))', () => {
    const el: Element = {
      kind: 'C',
      orientation: 'series',
      value: 1e-12,
      parasitics: { esl: 1e-9 },
    };
    expectS(sOf([el], f), seriesS(c(0, w * 1e-9 - 1 / (w * 1e-12)), 50));
  });

  it('shunt C with pad 0.2 pF: only half the pad acts, Y = j w (C + pad / 2)', () => {
    const el: Element = {
      kind: 'C',
      orientation: 'shunt',
      value: 1e-12,
      parasitics: { pad: 0.2e-12 },
    };
    expectS(sOf([el], f), shuntS(c(0, w * 1.1e-12), 50));
  });

  it('series L with pad 0.4 pF: a Pi of pad / 2, the branch, pad / 2', () => {
    const el: Element = {
      kind: 'L',
      orientation: 'series',
      value: 10e-9,
      parasitics: { pad: 0.4e-12 },
    };
    const z = c(0, w * 10e-9);
    const yh = c(0, w * 0.2e-12);
    // [1 0; Yh 1][1 Z; 0 1][1 0; Yh 1] = [1 + Z Yh, Z; Yh (2 + Z Yh), 1 + Z Yh].
    const a = add(c(1), mul(z, yh));
    expectS(sOf([el], f), abcdS(a, z, mul(yh, add(c(2), mul(z, yh))), a, 50));
  });
});

/* ------------------------------------------------------- RLC and stubs */

describe('RLC connections and stub frequency scaling', () => {
  const f = 2e9;
  const w = W(f);

  it('shunt RLC in series connection: Z = R + j (wL - 1 / (wC))', () => {
    const el: Element = {
      kind: 'RLC',
      orientation: 'shunt',
      connection: 'series',
      r: 10,
      l: 10e-9,
      c: 1e-12,
    };
    const z = c(10, w * 10e-9 - 1 / (w * 1e-12));
    expectS(sOf([el], f), shuntS(inv(z), 50));
  });

  it('series RLC in parallel connection: Y = 1 / R + j (wC - 1 / (wL))', () => {
    const el: Element = {
      kind: 'RLC',
      orientation: 'series',
      connection: 'parallel',
      r: 10,
      l: 10e-9,
      c: 1e-12,
    };
    const y = c(0.1, w * 1e-12 - 1 / (w * 10e-9));
    expectS(sOf([el], f), seriesS(inv(y), 50));
  });

  it('an open stub of 0.125 wavelength at 1 GHz is 0.1875 wavelength at 1.5 GHz: Y = j (1 + sqrt 2) / 50', () => {
    const el: Element = { kind: 'openStub', z0: 50, length: 0.125, refFrequency: 1e9 };
    expectS(sOf([el], 1.5e9), shuntS(c(0, (1 + Math.SQRT2) / 50), 50));
  });

  it('a shorted stub of 0.125 wavelength at 1 GHz at 1.5 GHz: Y = -j (sqrt 2 - 1) / 50', () => {
    const el: Element = { kind: 'shortStub', z0: 50, length: 0.125, refFrequency: 1e9 };
    expectS(sOf([el], 1.5e9), shuntS(c(0, -(Math.SQRT2 - 1) / 50), 50));
  });
});
