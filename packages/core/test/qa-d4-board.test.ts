/**
 * QA, phase D4: gaps in the tests of the stackup, the microstrip model and
 * the board parasitics found by mutation testing, and the limits of the
 * stackup validation.
 *
 * Reference values marked "scikit-rf" were printed by scikit-rf 2.2.0's MLine
 * (model 'hammerstadjensen', disp 'kirschningjansen', diel
 * 'djordjevicsvensson', no compatibility mode), the program the core's model
 * was checked against; every other expected value is worked out by hand in
 * the comment next to it.
 */
import { describe, expect, it } from 'vitest';
import {
  djordjevicSarkar,
  isUsableStackup,
  microstripProperties,
  type Stackup,
} from '../src/index';

const relErr = (a: number, b: number): number => Math.abs(a - b) / Math.abs(b);

describe('qa d4: Jansen-Kirschning Z0 dispersion on a narrow strip (the R9 term)', () => {
  // R9 carries exp(-R6), R6 = 22.2 u^1.92, so it only matters for narrow strips (u = 0.2:
  // R6 = 1.01) at high f h (R5 = (fn / 28.843)^12, fn = 25.4 GHz mm at 40 GHz on 0.635 mm).
  // The existing cases (u >= 1) leave it untested: a changed constant in R9 passed every test.
  const alumina: Stackup = { h: 0.635e-3, er: 9.8, tanD: 0, fRef: 1e9, t: 0, roughness: 0 };
  const SKRF = [
    { f: 20e9, z0: 93.84752413850411, eeff: 6.515479890298887 },
    { f: 30e9, z0: 101.5105661008067, eeff: 6.847549893154628 },
    { f: 40e9, z0: 115.47044425772731, eeff: 7.179363633436841 },
  ];
  it('W 0.127 mm on 0.635 mm alumina, 20 to 40 GHz: Z0 and eeff match scikit-rf to 1e-9', () => {
    for (const r of SKRF) {
      const p = microstripProperties(alumina, 0.127e-3, r.f);
      expect(relErr(p.z0.re, r.z0), `Z0 at ${r.f / 1e9} GHz`).toBeLessThan(1e-9);
      expect(relErr(p.eeff.re, r.eeff), `eeff at ${r.f / 1e9} GHz`).toBeLessThan(1e-9);
    }
  });
});

describe('qa d4: Jansen-Kirschning Z0 dispersion on a wide strip (the R16 term)', () => {
  // R16 = 1 + 0.0503 er^2 R11 (1 - exp(-(u / 15)^6)): for u <= 2 the last factor is below
  // 1e-5, so only a wide strip tests it (u = 10: 1 - exp(-0.0878) = 0.084).
  const alumina: Stackup = { h: 0.635e-3, er: 9.8, tanD: 0, fRef: 1e9, t: 0, roughness: 0 };
  const SKRF = [
    { f: 20e9, z0: 10.729244506545145, eeff: 9.39417673522412 },
    { f: 30e9, z0: 11.223961917503376, eeff: 9.548769413309133 },
    { f: 40e9, z0: 11.635208251541426, eeff: 9.628789920833169 },
  ];
  it('W 6.35 mm on 0.635 mm alumina, 20 to 40 GHz: Z0 and eeff match scikit-rf to 1e-9', () => {
    for (const r of SKRF) {
      const p = microstripProperties(alumina, 6.35e-3, r.f);
      expect(relErr(p.z0.re, r.z0), `Z0 at ${r.f / 1e9} GHz`).toBeLessThan(1e-9);
      expect(relErr(p.eeff.re, r.eeff), `eeff at ${r.f / 1e9} GHz`).toBeLessThan(1e-9);
    }
  });
});

describe('qa d4: the stackups isUsableStackup accepts give a physical permittivity', () => {
  // isUsableStackup: "True when every number of the stackup is usable by the model."
  // Djordjevic-Sarkar with f_low 1 kHz, f_high 1 THz: k = ln((f_high + j fRef) / (f_low + j fRef)),
  // at fRef = 1 GHz k = 6.9078 - 1.5698 j, eps_inf = er (1 + tanD Re k / Im k)
  // = er (1 - 4.40 tanD), eps_d = er tanD / 1.5698.
  it("tanD 0.3 at 1 GHz on er 4.17 is accepted, so eps' must stay >= 1 up to 100 GHz", () => {
    // eps_inf = 4.17 (1 - 1.320) = -1.335, eps_d = 0.797; at 100 GHz
    // Re ln((1e12 + j 1e11) / (1e3 + j 1e11)) = ln(10.05) = 2.308, so eps' = -1.335 + 0.797 * 2.308
    // = 0.504: below vacuum. Either the stackup is refused or the model must not go below 1.
    const s: Stackup = { h: 1.6e-3, er: 4.17, tanD: 0.3, fRef: 1e9, t: 35e-6, roughness: 0 };
    if (!isUsableStackup(s)) return;
    for (const f of [1e9, 10e9, 100e9]) {
      expect(
        djordjevicSarkar(s.er, s.tanD, s.fRef, f).er.re,
        `eps' at ${f / 1e9} GHz`,
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it('fRef 10 THz (above f_high) is accepted, so er at 1 GHz must stay near the slope of the model', () => {
    // Between f_low and f_high eps' falls by eps_d ln 10 per decade with eps_d about
    // 2 tanD er / pi = 0.0427 (board.test.ts): four decades below fRef that is at most
    // 4.17 + 4 * 2.3026 * 0.0427 = 4.56. With fRef above f_high, Im k = -0.0997 instead of
    // -pi/2, so eps_d = 0.673 and eps'(1 GHz) = 4.17 + 0.673 * 6.91 = 8.8: twice er.
    const s: Stackup = { h: 1.6e-3, er: 4.17, tanD: 0.0161, fRef: 1e13, t: 35e-6, roughness: 0 };
    if (!isUsableStackup(s)) return;
    expect(djordjevicSarkar(s.er, s.tanD, s.fRef, 1e9).er.re).toBeLessThan(4.6);
  });
});
