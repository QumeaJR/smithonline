/**
 * Phase D4, the board in the network: the stackup (Djordjevic-Sarkar), the
 * microstrip model (Hammerstad-Jensen static, Kirschning-Jansen dispersion,
 * Jansen-Kirschning Z0 dispersion, conductor and dielectric loss), the
 * Goldfarb-Pucel via, the land capacitance, and the network as built with its
 * board parasitics. Sources are cited at each test.
 *
 * What could not be had: the tables of the Kirschning-Jansen (1982) and
 * Jansen-Kirschning (1983) papers and the worked example of Goldfarb and
 * Pucel (1991) were not available while this was written. line.ts is a
 * line-by-line port of scikit-rf 2.2.0's MLine (model 'hammerstadjensen',
 * disp 'kirschningjansen', diel 'djordjevicsvensson', no compatibility mode),
 * so the values below printed by scikit-rf, and the oracle
 * (tools/oracle/d4_check.py) that recomputes them with scikit-rf in CI, show
 * that the port is faithful, not that the model is right. The checks that do
 * not go through scikit-rf's code are the physical limits and Pozar's example
 * here, the review of each formula against its published form, and Keysight
 * ADS's MLIN on scikit-rf's regression data (qa-d4-ads.test.ts). The via
 * formula is pinned to a step-by-step evaluation and its thin-via limit.
 */
import { describe, expect, it } from 'vitest';
import {
  applyElement,
  cabs,
  complex,
  csub,
  DEFAULT_BOARD,
  DEFAULT_PACKAGES,
  djordjevicSarkar,
  elementArc,
  elementParameters,
  evaluateAt,
  kirschningJansenEeff,
  ladderParameters,
  layoutAssumptions,
  discLandCapacitance,
  landCapacitance,
  microstripCapacitancePerMetre,
  microstripDimensions,
  microstripProperties,
  microstripStatic,
  microstripWidth,
  microstripWidthAt,
  MU0,
  packageById,
  packagePadCapacitance,
  parameterValue,
  sensitivityAt,
  SPEED_OF_LIGHT,
  STACKUP_PRESETS,
  viaInductance,
  withBoard,
  withPackages,
  zinWith,
  type BoardSettings,
  type Complex,
  type Element,
  type ParameterRef,
  type Stackup,
} from '../src/index';

const preset = (id: string): Stackup => {
  const p = STACKUP_PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(id);
  return p.stackup;
};
const FR4 = preset('fr4-1.6');
const RO4003C = preset('ro4003c-0.508');
const relErr = (a: number, b: number): number => Math.abs(a - b) / Math.abs(b);
const crel = (a: Complex, b: Complex): number => cabs(csub(a, b)) / cabs(b);

describe('stackup presets cite their data sheets', () => {
  it('FR-4 (Isola 370HR) and Rogers RO4003C and RO4350B hold the data sheet values', () => {
    // Isola 370HR data sheet rev. C (2021): Dk 4.17, Df 0.0161 at 1 GHz. Rogers RO4000 data
    // sheet: design Dk 3.55 (RO4003C) and 3.66 (RO4350B), Df 0.0027 and 0.0037 at 10 GHz.
    expect(FR4).toMatchObject({ h: 1.6e-3, er: 4.17, tanD: 0.0161, fRef: 1e9, t: 35e-6 });
    expect(preset('fr4-0.8')).toMatchObject({ h: 0.8e-3, er: 4.17, tanD: 0.0161 });
    expect(RO4003C).toMatchObject({ h: 0.508e-3, er: 3.55, tanD: 0.0027, fRef: 10e9 });
    expect(preset('ro4350b-0.762')).toMatchObject({ h: 0.762e-3, er: 3.66, tanD: 0.0037 });
    for (const p of STACKUP_PRESETS) {
      expect(p.source.length).toBeGreaterThan(80);
      // Rogers publication 92-243, table 1: 1 oz ED foil, 3.2 um RMS on the treated side.
      expect(p.stackup.roughness).toBe(3.2e-6);
    }
  });
});

describe('Djordjevic-Sarkar dielectric: causal, slowly falling er, nearly constant tanD', () => {
  // A. R. Djordjevic et al., IEEE Trans. EMC 43 (4), 2001: a wideband Debye model whose real
  // and imaginary parts obey the Kramers-Kronig relations.
  const { er, tanD, fRef } = FR4;

  it('holds er and tanD at the reference frequency', () => {
    const d = djordjevicSarkar(er, tanD, fRef, fRef);
    expect(d.er.re).toBeCloseTo(er, 12);
    expect(d.tanD).toBeCloseTo(tanD, 12);
    expect(d.er.im).toBeCloseTo(-er * tanD, 12);
  });

  it('er falls monotonically with frequency from 1 Hz to 10 THz', () => {
    let last = Infinity;
    for (let f = 1; f <= 1e13; f *= 1.5) {
      const e = djordjevicSarkar(er, tanD, fRef, f).er.re;
      expect(e).toBeLessThan(last);
      last = e;
    }
    // Between f_low and f_high er falls by eps_d ln 10 per decade, eps_d = 2 tanD er / pi
    // (0.043 for FR-4): 0.29 higher at 1 MHz than at 1 GHz.
    const at1M = djordjevicSarkar(er, tanD, fRef, 1e6).er.re;
    const at10G = djordjevicSarkar(er, tanD, fRef, 10e9).er.re;
    expect(at1M).toBeGreaterThan(er);
    expect(at10G).toBeLessThan(er);
    expect(at1M - er).toBeCloseTo(3 * Math.LN10 * ((tanD * er * 2) / Math.PI), 2);
  });

  it('tanD stays within 7 % of the reference from 1 MHz to 100 GHz (well inside 1 kHz to 1 THz)', () => {
    // It is not exactly constant: eps'' is constant across the band, eps' falls.
    let worst = 0;
    for (let f = 1e6; f <= 1e11; f *= 2) {
      const t = djordjevicSarkar(er, tanD, fRef, f).tanD;
      worst = Math.max(worst, Math.abs(t / tanD - 1));
    }
    expect(worst).toBeLessThan(0.07);
    expect(worst).toBeGreaterThan(0.05);
  });

  it('Kramers-Kronig: er(f) - er(infinity) is the Hilbert transform of the loss (to 1e-4)', () => {
    // eps'(w0) - eps_inf = (2 / pi) PV int_0^inf w eps''(w) / (w^2 - w0^2) dw; the singular
    // part is removed by subtracting w0 eps''(w0), whose principal value integral is 0.
    const epsInf = djordjevicSarkar(er, tanD, fRef, 1e30).er.re;
    const loss = (f: number): number => -djordjevicSarkar(er, tanD, fRef, f).er.im;
    for (const f0 of [1e5, 3.3e7, 1e9, 2.2e10]) {
      const l0 = loss(f0);
      const n = 400_000;
      const t0 = Math.log(1e-4);
      const t1 = Math.log(1e17);
      const dt = (t1 - t0) / n;
      let sum = 0;
      for (let i = 0; i <= n; i++) {
        const f = Math.exp(t0 + (i + 0.5) * dt);
        const g = (f * loss(f) - f0 * l0) / (f * f - f0 * f0);
        sum += g * f * dt;
      }
      const kk = (2 / Math.PI) * sum;
      const direct = djordjevicSarkar(er, tanD, fRef, f0).er.re - epsInf;
      expect(Math.abs(kk - direct) / direct).toBeLessThan(1e-4);
    }
  });

  it('a lossless dielectric is er at every frequency', () => {
    expect(djordjevicSarkar(3.5, 0, 1e9, 123e6).er).toEqual(complex(3.5, 0));
  });
});

describe('microstrip static model: Hammerstad-Jensen 1980', () => {
  it("Pozar's Example 3.7: 50 ohm on 0.127 cm, er 2.20: W/d 3.081, a quarter wave at 2.5 GHz 2.19 cm", () => {
    // D. M. Pozar, Microwave Engineering, 3rd/4th ed., Example 3.7. Pozar's design formulas are
    // Hammerstad's simpler ones, which give eeff 1.87; Hammerstad-Jensen gives 1.881 (0.6 %
    // higher, the size of the difference between the two models). W/d and the length agree to
    // the printed digits.
    const w = microstripWidth(50, 2.2);
    expect(w).not.toBeNull();
    expect(w?.wOverH ?? 0).toBeCloseTo(3.081, 2);
    expect(relErr(w?.wOverH ?? 0, 3.081)).toBeLessThan(1e-3);
    expect(w?.eeff ?? 0).toBeCloseTo(1.881, 3);
    const quarter = SPEED_OF_LIGHT / 2.5e9 / 4 / Math.sqrt(w?.eeff ?? 1);
    expect(quarter * 100).toBeCloseTo(2.19, 2);
  });

  it('matches scikit-rf 2.2.0 (independent code of the same paper) at 1 kHz on alumina, u = 1', () => {
    const st = microstripStatic(1, 9.8, 0);
    // scikit-rf MLine(w = h = 0.635 mm, t = 0, ep_r = 9.8, tand = 0) at 1 kHz.
    expect(relErr(st.eeff.re, 6.5790265540717465)).toBeLessThan(1e-9);
    expect(relErr(st.z0.re, 49.28879991891544)).toBeLessThan(1e-9);
  });

  it('the thickness correction makes the dielectric line wider than the air line (ur < u1 when er > 1)', () => {
    const thin = microstripStatic(1.9, 4.3, 0);
    const thick = microstripStatic(1.9, 4.3, 0.021875);
    expect(thick.ur.re).toBeGreaterThan(1.9);
    expect(thick.z0.re).toBeLessThan(thin.z0.re);
  });
});

describe('microstrip dispersion: Kirschning-Jansen eeff, Jansen-Kirschning Z0', () => {
  const alumina: Stackup = { h: 0.635e-3, er: 9.8, tanD: 0, fRef: 1e9, t: 0, roughness: 0 };
  // scikit-rf 2.2.0 MLine with the same models, w = h = 0.635 mm (h / lambda0 = 0.085 at 40 GHz).
  const SKRF = [
    { f: 1e9, eeff: 6.5930671995042935, z0: 49.27387510746586 },
    { f: 10e9, eeff: 6.928186326420613, z0: 49.7288020230091 },
    { f: 20e9, eeff: 7.39407955485555, z0: 52.19495871885114 },
    { f: 40e9, eeff: 8.18637191068227, z0: 61.16066365828025 },
  ];

  it('eeff(f) and Z0(f) match scikit-rf to 1e-9 on alumina from 1 to 40 GHz', () => {
    for (const r of SKRF) {
      const p = microstripProperties(alumina, 0.635e-3, r.f);
      expect(relErr(p.eeff.re, r.eeff)).toBeLessThan(1e-9);
      expect(relErr(p.z0.re, r.z0)).toBeLessThan(1e-9);
      expect(p.inRange).toBe(true);
    }
  });

  it('eeff rises monotonically from the static value towards er, and is static at low frequency', () => {
    const st = microstripStatic(1, 9.8, 0).eeff.re;
    expect(relErr(microstripProperties(alumina, 0.635e-3, 1e3).eeff.re, st)).toBeLessThan(1e-12);
    let last = st;
    for (let f = 1e8; f < 1e12; f *= 1.3) {
      const e = microstripProperties(alumina, 0.635e-3, f).eeff.re;
      expect(e).toBeGreaterThanOrEqual(last);
      expect(e).toBeLessThan(9.8);
      last = e;
    }
    // At a terahertz the field is all in the substrate.
    expect(kirschningJansenEeff(1, 1e4, 9.8, st).re).toBeGreaterThan(9.7);
  });

  it('the dispersion is under 0.5 % at 1 GHz on 1.6 mm FR-4 and past 5 % by 20 GHz', () => {
    const lo = microstripProperties(FR4, 3e-3, 1e9);
    const hi = microstripProperties(FR4, 3e-3, 20e9);
    expect(lo.eeff.re / lo.eeffStatic.re - 1).toBeLessThan(0.005);
    expect(hi.eeff.re / hi.eeffStatic.re - 1).toBeGreaterThan(0.05);
  });
});

describe('microstrip on a real stackup: complex Z0, losses (scikit-rf 2.2.0 values)', () => {
  // scikit-rf MLine with the preset's numbers, rho 1.7241e-8, rough 3.2 um.
  const CASES = [
    {
      s: RO4003C,
      w: 1.1e-3,
      f: 2.4e9,
      z0: complex(49.859764603907045, 0.058976061315274914),
      eeff: complex(2.751706163137114, -0.006534702195803712),
      ac: 0.33428507177603217,
      ad: 0.09997052414282481,
      beta: 83.4394505159768,
    },
    {
      s: RO4003C,
      w: 1.1e-3,
      f: 10e9,
      z0: complex(50.02710188132482, 0.058700560288066604),
      eeff: complex(2.789941497788334, -0.006776488622607337),
      ac: 0.7012010340332909,
      ad: 0.42210684515111757,
      beta: 350.07146639656156,
    },
    {
      s: FR4,
      w: 3e-3,
      f: 1e9,
      z0: complex(51.356861925733426, 0.3679409512608427),
      eeff: complex(3.160328183018613, -0.0455490636201889),
      ac: 0.07205589416052663,
      ad: 0.2697028140533024,
      beta: 37.258490644108846,
    },
    {
      s: FR4,
      w: 3e-3,
      f: 5e9,
      z0: complex(52.22732177820346, 0.37110050486678997),
      eeff: complex(3.2141333035594783, -0.048971806939949646),
      ac: 0.1709083895950323,
      ad: 1.3973326794232233,
      beta: 187.87159054153133,
    },
  ];

  for (const c of CASES) {
    it(`${c.s.name}, W ${c.w * 1e3} mm, ${c.f / 1e9} GHz: Z0, eeff, alpha_c, alpha_d, beta to 1e-9`, () => {
      const p = microstripProperties(c.s, c.w, c.f);
      expect(crel(p.z0, c.z0)).toBeLessThan(1e-9);
      expect(crel(p.eeff, c.eeff)).toBeLessThan(1e-9);
      expect(relErr(p.alphaConductor, c.ac)).toBeLessThan(1e-9);
      expect(relErr(p.alphaDielectric, c.ad)).toBeLessThan(1e-9);
      expect(relErr(p.beta, c.beta)).toBeLessThan(1e-12);
    });
  }

  it("dielectric loss is Pozar's alpha_d = k0 er (eeff - 1) tanD / (2 sqrt(eeff) (er - 1))", () => {
    // Pozar, Microwave Engineering, eq. 3.198 (4th ed.), with er and tanD at f from the
    // Djordjevic-Sarkar model and eeff the dispersed one.
    const f = 2.4e9;
    const p = microstripProperties(RO4003C, 1.1e-3, f);
    const k0 = (2 * Math.PI * f) / SPEED_OF_LIGHT;
    const er = p.er.re;
    const tanD = -p.er.im / p.er.re;
    const e = p.eeff.re;
    const pozar = (k0 * er * (e - 1) * tanD) / (2 * Math.sqrt(e) * (er - 1));
    expect(relErr(p.alphaDielectric, pozar)).toBeLessThan(1e-12);
  });

  it('conductor loss of smooth copper is Rs / (Z0 W) Ki (Hammerstad-Jensen), by hand', () => {
    // Rs = sqrt(pi f mu0 rho); Ki = exp(-1.2 (Z0 / eta0)^0.7); Kr = 1 without roughness.
    const s: Stackup = { ...FR4, roughness: 0, tanD: 0 };
    const f = 1e9;
    const w = 3e-3;
    const p = microstripProperties(s, w, f);
    const rs = Math.sqrt(Math.PI * f * MU0 * 1.7241e-8);
    expect(rs).toBeCloseTo(0.00825, 6);
    const ki = Math.exp(-1.2 * (p.z0.re / 376.730313412) ** 0.7);
    expect(relErr(p.alphaConductor, (rs / (p.z0.re * w)) * ki)).toBeLessThan(1e-12);
    expect(p.alphaDielectric).toBe(0);
    // About 0.35 dB/m for a 3 mm track at 1 GHz.
    expect((p.alphaConductor * 20) / Math.LN10).toBeCloseTo(0.35, 1);
  });

  it('the Hammerstad-Jensen roughness factor rises from 1 to 2: 1.61 at D = delta', () => {
    const f = 1e9;
    const delta = Math.sqrt(1.7241e-8 / (Math.PI * f * MU0));
    const at = (rough: number): number =>
      microstripProperties({ ...FR4, roughness: rough, tanD: 0 }, 3e-3, f).alphaConductor;
    const smooth = at(0);
    expect(at(delta) / smooth).toBeCloseTo(1 + (2 / Math.PI) * Math.atan(1.4), 12);
    expect(at(delta) / smooth).toBeCloseTo(1.6, 1);
    expect(at(100 * delta) / smooth).toBeCloseTo(2, 3);
  });

  it('no copper thickness: no conductor loss (an infinitely thin perfect strip)', () => {
    expect(microstripProperties({ ...FR4, t: 0 }, 3e-3, 1e9).alphaConductor).toBe(0);
  });
});

describe('width synthesis and dimensions at the design frequency', () => {
  it('the width found at f has Re Z0(f) = Z0 asked for (dispersion included)', () => {
    for (const s of STACKUP_PRESETS.map((p) => p.stackup)) {
      for (const [z0, f] of [
        [50, 1e9],
        [30, 5e9],
        [90, 10e9],
      ] as const) {
        const w = microstripWidthAt(s, z0, f);
        expect(w).not.toBeNull();
        expect(microstripProperties(s, w ?? 0, f).z0.re).toBeCloseTo(z0, 6);
      }
    }
    expect(microstripWidthAt(FR4, 1e4, 1e9)).toBeNull();
  });

  it('dimensions: length from the dispersed eeff, loss over the length', () => {
    const d = microstripDimensions(RO4003C, 50, 0.25, 10e9);
    expect(d).not.toBeNull();
    if (!d) return;
    expect(d.at.z0.re).toBeCloseTo(50, 6);
    expect(d.length).toBeCloseTo(SPEED_OF_LIGHT / 10e9 / 4 / Math.sqrt(d.at.eeff.re), 12);
    expect(d.lossDb).toBeCloseTo((20 / Math.LN10) * d.at.gamma.re * d.length, 12);
    expect(microstripDimensions(RO4003C, 50, 0.25, 0)).toBeNull();
  });
});

describe('Goldfarb-Pucel via inductance', () => {
  // M. E. Goldfarb and R. A. Pucel, IEEE Microwave and Guided Wave Letters 1 (6), 1991:
  // L = mu0 / 2 pi [h ln((h + sqrt(r^2 + h^2)) / r) + 1.5 (r - sqrt(r^2 + h^2))].
  it('0.4 mm drill through 1.6 mm: 0.4647 nH, step by step', () => {
    const h = 1.6e-3;
    const r = 0.2e-3;
    const s = Math.sqrt(r * r + h * h); // 1.612452 mm
    expect(s * 1e3).toBeCloseTo(1.612452, 6);
    const bracket = h * Math.log((h + s) / r) + 1.5 * (r - s); // 2.3237 mm
    expect(bracket * 1e3).toBeCloseTo(2.32368, 4);
    expect(viaInductance(h, 2 * r) * 1e9).toBeCloseTo(0.46474, 5);
    expect(viaInductance(h, 2 * r)).toBeCloseTo((MU0 / (2 * Math.PI)) * bracket, 18);
  });

  it('a thin via tends to mu0 / 2 pi (h (ln(2h / r) - 1.5) + 1.5 r)', () => {
    // For r << h, ln((h + s) / r) = ln(2h / r) + O(r^2 / h^2) and r - s = r - h + O(r^2 / h).
    const h = 1.6e-3;
    const r = 1e-7;
    const limit = (MU0 / (2 * Math.PI)) * (h * (Math.log((2 * h) / r) - 1.5) + 1.5 * r);
    expect(relErr(viaInductance(h, 2 * r), limit)).toBeLessThan(1e-9);
  });

  it('grows with the board and shrinks with the drill; unusable input is 0', () => {
    expect(viaInductance(1.6e-3, 0.3e-3)).toBeGreaterThan(viaInductance(0.8e-3, 0.3e-3));
    expect(viaInductance(1.6e-3, 0.5e-3)).toBeLessThan(viaInductance(1.6e-3, 0.3e-3));
    expect(viaInductance(0, 0.3e-3)).toBe(0);
    expect(viaInductance(1.6e-3, NaN)).toBe(0);
  });
});

describe('land capacitance: parallel plate plus fringing at the four edges', () => {
  const eps0 = 1 / (MU0 * SPEED_OF_LIGHT * SPEED_OF_LIGHT);

  it("is C'(W) L + C'(L) W - eps0 er W L / h with C' of the static microstrip (a land wider than h)", () => {
    // 2 x 2.4 mm on 1.6 mm: the equal-area side 2.19 mm is above h, so the edge estimate alone.
    const c = landCapacitance(FR4, 2e-3, 2.4e-3);
    const byHand =
      microstripCapacitancePerMetre(FR4, 2.4e-3) * 2e-3 +
      microstripCapacitancePerMetre(FR4, 2e-3) * 2.4e-3 -
      (eps0 * FR4.er * 2e-3 * 2.4e-3) / FR4.h;
    expect(c).toBeCloseTo(byHand, 25);
  });

  it('a land much wider than h is the parallel plate plus the fringing along its perimeter', () => {
    // 20 mm square on 0.5 mm: the plate is 92 % of it, the rest the wide-strip edge fringing.
    const s: Stackup = { h: 0.5e-3, er: 4, tanD: 0, fRef: 1e9, t: 0, roughness: 0 };
    const a = 20e-3;
    const plate = (eps0 * 4 * a * a) / 0.5e-3;
    const fringePerEdge = (microstripCapacitancePerMetre(s, a) - (eps0 * 4 * a) / 0.5e-3) / 2;
    expect(landCapacitance(s, a, a)).toBeCloseTo(plate + 4 * a * fringePerEdge, 20);
    expect(plate / landCapacitance(s, a, a)).toBeGreaterThan(0.9);
  });

  it('a land smaller than h takes the isolated-disc estimate where the edge estimate is 28 %, 19 %, 3 % lower', () => {
    // A thin disc of radius r on the dielectric half-space: C = 8 eps0 (er + 1) / 2 r (the
    // disc at the interface of two half-spaces), raised by the image in the ground plane at
    // depth 2h: C / (1 - C / (4 pi eps0 (er + 1) / 2 2h)). The edge estimate leaves out the
    // field above and around a land much smaller than h, so it is low there; for a land whose
    // equal-area side is below h the larger of the two is taken.
    const s: Stackup = { ...FR4, t: 0 };
    const disc = (l: number, w: number): number => {
      const ea = (eps0 * (s.er + 1)) / 2;
      const c0 = 8 * ea * Math.sqrt((l * w) / Math.PI);
      return c0 / (1 - c0 / (4 * Math.PI * ea * 2 * s.h));
    };
    const edge = (l: number, w: number): number =>
      microstripCapacitancePerMetre(s, w) * l +
      microstripCapacitancePerMetre(s, l) * w -
      (eps0 * s.er * w * l) / s.h;
    const short = (l: number, w: number): number => 1 - edge(l, w) / disc(l, w);
    expect(short(0.3e-3, 0.3e-3)).toBeCloseTo(0.28, 2);
    expect(short(0.5e-3, 0.6e-3)).toBeCloseTo(0.19, 2);
    expect(short(1.1e-3, 1.8e-3)).toBeCloseTo(0.03, 2);
    for (const [l, w] of [
      [0.3e-3, 0.3e-3],
      [0.5e-3, 0.6e-3],
      [1.1e-3, 1.8e-3],
    ] as const) {
      expect(landCapacitance(s, l, w)).toBeCloseTo(disc(l, w), 25);
      expect(discLandCapacitance(s, l, w)).toBeCloseTo(disc(l, w), 25);
    }
  });

  it('where the equal-area side passes h the disc gives way to the edge estimate (a step under 2 %)', () => {
    for (const p of STACKUP_PRESETS) {
      const a = p.stackup.h;
      const below = landCapacitance(p.stackup, a * (1 - 1e-9), a * (1 - 1e-9));
      const above = landCapacitance(p.stackup, a * (1 + 1e-9), a * (1 + 1e-9));
      expect(Math.abs(below / above - 1)).toBeLessThan(0.02);
    }
  });

  it('both lands of a package: twice one land; the table value without a land size', () => {
    const pkg = packageById(DEFAULT_PACKAGES, '0402');
    expect(pkg).toBeDefined();
    if (!pkg) return;
    expect(packagePadCapacitance(pkg, FR4)).toBe(2 * landCapacitance(FR4, 0.5e-3, 0.6e-3));
    expect(packagePadCapacitance({ ...pkg, padLength: 0 }, FR4)).toBeNull();
    // 0402 lands on 1.6 mm FR-4: about 0.12 pF both (the disc estimate), against 0.03 pF in the
    // default table, which assumed a thinner board.
    expect((packagePadCapacitance(pkg, FR4) ?? 0) * 1e12).toBeCloseTo(0.121, 3);
  });
});

/* ---------------------------------------------------- the network as built */

const BOARD: BoardSettings = {
  ...DEFAULT_BOARD,
  enabled: true,
  stackup: FR4,
  viaDrill: 0.3e-3,
  viasPerShunt: 2,
  traceLength: 2.5e-3,
  traceWidth: 0,
};
const CTX = { z0: 50, frequency: 1.5e9 };

describe('withBoard: what the board adds to which part', () => {
  const design: Element[] = [
    { kind: 'C', orientation: 'shunt', value: 2.2e-12, package: '0402' },
    { kind: 'L', orientation: 'series', value: 6.8e-9, package: '0402' },
    { kind: 'line', z0: 50, length: 0.1, refFrequency: 1.5e9 },
    { kind: 'R', orientation: 'shunt', value: 390 },
    { kind: 'C', orientation: 'series', value: 4.7e-12 },
  ];

  it('board off: exactly withPackages', () => {
    expect(withBoard(design, DEFAULT_PACKAGES, DEFAULT_BOARD, CTX)).toEqual(
      withPackages(design, DEFAULT_PACKAGES),
    );
  });

  it('board on: vias under shunt lumped parts, traces between neighbouring lumped parts, pads from the stackup', () => {
    const built = withBoard(design, DEFAULT_PACKAGES, BOARD, CTX);
    const via = viaInductance(1.6e-3, 0.3e-3) / 2;
    expect(built[0]?.kind === 'C' && built[0].board?.via).toBe(via);
    expect(built[0]?.kind === 'C' && built[0].board?.trace).toBeFalsy(); // the load side: none
    expect(built[1]?.kind === 'L' && built[1].board?.via).toBeFalsy(); // series: no via
    const trace = built[1]?.kind === 'L' ? built[1].board?.trace : undefined;
    expect(trace?.length).toBe(2.5e-3);
    // The trace width follows the design's Z0 at its frequency.
    expect(microstripProperties(FR4, trace?.width ?? 0, 1.5e9).z0.re).toBeCloseTo(50, 6);
    expect(built[2]).toBe(design[2]); // the line is its own interconnect
    expect(built[3]?.kind === 'R' && built[3].board?.trace).toBeFalsy(); // after a line: none
    expect(built[3]?.kind === 'R' && built[3].board?.via).toBe(via);
    expect(built[4]?.kind === 'C' && built[4].board?.trace?.length).toBe(2.5e-3);
    const pad = packagePadCapacitance(packageById(DEFAULT_PACKAGES, '0402')!, FR4);
    expect(built[0]?.kind === 'C' && built[0].parasitics?.pad).toBe(pad);
    expect(built[0]?.kind === 'C' && built[0].parasitics?.esl).toBe(0.4e-9);
  });

  it('layout assumptions name the stackup, the pads, the vias and the traces', () => {
    const text = layoutAssumptions(design, DEFAULT_PACKAGES, BOARD, CTX).join('\n');
    expect(text).toMatch(/Stackup: FR-4, 1.6 mm: h 1.6 mm, er 4.17 and tanD 0.0161 at 1 GHz/);
    expect(text).toMatch(/Pads: .*0402 lands 500 µm x 600 µm/);
    expect(text).toMatch(/Vias: 2 per shunt part to ground, 300 µm drill through 1.6 mm/);
    expect(text).toMatch(
      /Traces between parts: microstrip 2.5 mm long, .* wide \(the width for 50 ohm/,
    );
    expect(text).toMatch(/0.271 nH for the 2 in parallel \(0.543 nH each/);
    expect(layoutAssumptions(design, DEFAULT_PACKAGES, DEFAULT_BOARD, CTX)[0]).toMatch(
      /^Board: not in the network/,
    );
  });
});

describe('the as-built network equals a hand-built ladder of the equivalent parts', () => {
  it('pads, ESL, vias and traces as separate elements give the same Zin and two-port to 1e-12', () => {
    const design: Element[] = [
      { kind: 'C', orientation: 'shunt', value: 2e-12, package: '0402' },
      { kind: 'L', orientation: 'series', value: 10e-9 },
      { kind: 'C', orientation: 'shunt', value: 1e-12, package: '0603' },
    ];
    const built = withBoard(design, DEFAULT_PACKAGES, BOARD, CTX);
    const via = viaInductance(1.6e-3, 0.3e-3) / 2;
    const p402 = packageById(DEFAULT_PACKAGES, '0402')!;
    const p603 = packageById(DEFAULT_PACKAGES, '0603')!;
    const pad402 = packagePadCapacitance(p402, FR4)!;
    const pad603 = packagePadCapacitance(p603, FR4)!;
    const width = microstripWidthAt(FR4, 50, 1.5e9)!;
    const trace: Element = { kind: 'microstrip', width, length: 2.5e-3, stackup: FR4 };
    // The shunt C with its ESL and via is a series L-C to ground; its node pad a shunt C.
    const hand: Element[] = [
      { kind: 'RLC', orientation: 'shunt', connection: 'series', l: p402.esl + via, c: 2e-12 },
      { kind: 'C', orientation: 'shunt', value: pad402 / 2 },
      trace,
      { kind: 'L', orientation: 'series', value: 10e-9 },
      trace,
      { kind: 'RLC', orientation: 'shunt', connection: 'series', l: p603.esl + via, c: 1e-12 },
      { kind: 'C', orientation: 'shunt', value: pad603 / 2 },
    ];
    const load = complex(15, 30);
    for (const f of [0.5e9, 1.5e9, 3e9]) {
      const a = evaluateAt({ z0: 50, frequency: f, load, elements: built }, f, load, {
        arcSteps: 0,
      });
      const b = evaluateAt({ z0: 50, frequency: f, load, elements: hand }, f, load, {
        arcSteps: 0,
      });
      expect(crel(a.zin, b.zin)).toBeLessThan(1e-12);
      for (const k of ['a', 'b', 'c', 'd'] as const) {
        expect(cabs(csub(a.abcd[k], b.abcd[k]))).toBeLessThan(1e-12 * Math.max(1, cabs(b.abcd[k])));
      }
    }
  });

  it('the locus of a part with a trace walks the trace, then the part, and ends at its node', () => {
    const built = withBoard(
      [
        { kind: 'C', orientation: 'shunt', value: 2e-12 },
        { kind: 'L', orientation: 'series', value: 10e-9, package: '0402' },
        { kind: 'C', orientation: 'shunt', value: 1e-12 },
      ],
      DEFAULT_PACKAGES,
      BOARD,
      CTX,
    );
    const z = complex(20, -10);
    for (const el of built) {
      const arc = elementArc(el, z, 1.5e9, 16);
      expect(crel(arc[arc.length - 1] as Complex, applyElement(el, z, 1.5e9))).toBeLessThan(1e-12);
      expect(arc[0]).toEqual(z);
    }
    const ms: Element = { kind: 'microstrip', width: 3e-3, length: 20e-3, stackup: FR4 };
    const arc = elementArc(ms, z, 1.5e9, 16);
    expect(crel(arc[16] as Complex, applyElement(ms, z, 1.5e9))).toBeLessThan(1e-12);
  });
});

describe('sensitivity through the board: microstrip width and length, parts with vias and traces', () => {
  const LOAD = complex(18, -27);
  const elements = withBoard(
    [
      { kind: 'C', orientation: 'shunt', value: 1.8e-12, q: 300, package: '0402' },
      { kind: 'L', orientation: 'series', value: 6.8e-9, q: 45, package: '0402' },
      { kind: 'microstrip', width: 1.1e-3, length: 9e-3, stackup: RO4003C },
      { kind: 'RLC', orientation: 'shunt', connection: 'series', r: 3, l: 2e-9, c: 3e-12 },
      { kind: 'C', orientation: 'series', value: 4.7e-12 },
    ],
    DEFAULT_PACKAGES,
    BOARD,
    CTX,
  );

  it('lists width and length for a microstrip', () => {
    expect(elementParameters(elements[2] as Element)).toEqual(['length', 'width']);
  });

  it('every parameter against central differences, three frequencies (1e-6)', () => {
    for (const f of [0.8e9, 1.5e9, 2.6e9]) {
      const s = sensitivityAt(elements, LOAD, 50, f);
      ladderParameters(elements).forEach((ref: ParameterRef, i) => {
        const v = parameterValue(elements[ref.index] as Element, ref.parameter);
        const dv = Math.abs(v) * 1e-5;
        const up = zinWith(elements, ref, v + dv, LOAD, f);
        const dn = zinWith(elements, ref, v - dv, LOAD, f);
        const fd = complex((up.re - dn.re) / (2 * dv), (up.im - dn.im) / (2 * dv));
        const got = s.dZin[i] as Complex;
        const err = cabs(csub(got, fd)) / Math.max(cabs(fd), cabs(got));
        expect(err, `${ref.index}:${ref.parameter} at ${f}`).toBeLessThan(1e-6);
      });
    }
  });
});
