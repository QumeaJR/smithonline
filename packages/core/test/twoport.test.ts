import { describe, expect, it } from 'vitest';
import {
  availableGainCircle,
  cabs,
  complex,
  conjugateMatch,
  csub,
  gmaxDb,
  linearToDb,
  loadStabilityCircle,
  mag,
  msg,
  noiseCircle,
  noiseFigureDb,
  operatingGainCircle,
  polarDeg,
  sourceStabilityCircle,
  stability,
  unilateralGain,
  unilateralGainCircle,
  type NoiseParameters,
  type SParameters,
} from '../src/index';

/** The transistor of Example 13 at 2 GHz, as stored in Example13-input.xmlsc. */
const ex13: SParameters = {
  s11: complex(-0.10371725261211395, -0.062319599092006683),
  s12: complex(0.054976470768451691, 0.092960141599178314),
  s21: complex(0.72311252355575562, 3.6857352256774902),
  s22: complex(0.2380882203578949, -0.33378735184669495),
};

const ex13Noise: NoiseParameters = {
  nfMinDb: 3.6,
  gammaOpt: complex(0.32438739815381623, 0.26362248750627759),
  rn: 0.98,
};

describe('stability', () => {
  it('reproduces K of Example 13 (stored 1.1660794)', () => {
    const st = stability(ex13);
    // The gain record stores the S-parameters as doubles, the stability record
    // as singles; the K values differ in the seventh digit accordingly.
    expect(st.k).toBeCloseTo(1.1660794019699097, 6);
    expect(st.deltaMag).toBeLessThan(1);
    expect(st.unconditionallyStable).toBe(true);
    expect(st.mu).toBeGreaterThan(1);
    expect(st.muPrime).toBeGreaterThan(1);
  });

  it('places the Example 13 stability circles on the sides the file records', () => {
    // Stable = 1 (inside) for the input plane, 2 (outside) for the output plane.
    const src = sourceStabilityCircle(ex13);
    const load = loadStabilityCircle(ex13);
    expect(src.stableInside).toBe(true);
    expect(load.stableInside).toBe(false);
    // An unconditionally stable device has the whole chart on the stable side:
    // the circle either encloses the chart (stable inside) or lies outside it.
    expect(src.radius - cabs(src.center)).toBeGreaterThan(1);
    expect(cabs(load.center) - load.radius).toBeGreaterThan(1);
  });

  it('flags a potentially unstable device', () => {
    const s: SParameters = {
      s11: polarDeg(0.7, -60),
      s12: polarDeg(0.1, 40),
      s21: polarDeg(4, 100),
      s22: polarDeg(0.5, -30),
    };
    const st = stability(s);
    expect(st.k).toBeLessThan(1);
    expect(st.unconditionallyStable).toBe(false);
    expect(Number.isNaN(mag(s))).toBe(true);
    expect(gmaxDb(s)).toBeCloseTo(linearToDb(msg(s)), 12);
  });
});

describe('gains', () => {
  it('reproduces Gmax of Example 13 (stored 12.943446 dB)', () => {
    expect(gmaxDb(ex13)).toBeCloseTo(12.943446241933499, 5);
    expect(linearToDb(msg(ex13))).toBeGreaterThan(gmaxDb(ex13));
  });

  it('simultaneous conjugate match reaches MAG and lies inside the chart', () => {
    const m = conjugateMatch(ex13);
    expect(m).not.toBeNull();
    expect(cabs(m!.gammaSource)).toBeLessThan(1);
    expect(cabs(m!.gammaLoad)).toBeLessThan(1);
    // The MAG circle degenerates to the conjugate-match point.
    const ga = availableGainCircle(ex13, mag(ex13));
    expect(ga.radius).toBeLessThan(1e-6);
    expect(cabs(csub(ga.center, m!.gammaSource))).toBeLessThan(1e-6);
    const gp = operatingGainCircle(ex13, mag(ex13));
    expect(gp.radius).toBeLessThan(1e-6);
    expect(cabs(csub(gp.center, m!.gammaLoad))).toBeLessThan(1e-6);
  });

  it('a lower gain gives a larger circle in the same plane', () => {
    const a = availableGainCircle(ex13, 10 ** (12.5 / 10));
    const b = availableGainCircle(ex13, 10 ** (12 / 10));
    expect(b.radius).toBeGreaterThan(a.radius);
    expect(cabs(a.center)).toBeLessThan(1);
  });

  it('unilateral figures of merit', () => {
    const u = unilateralGain(ex13);
    expect(u.u).toBeGreaterThan(0);
    expect(u.u).toBeLessThan(1);
    expect(u.errorLow).toBeLessThan(1);
    expect(u.errorHigh).toBeGreaterThan(1);
    expect(linearToDb(u.gtuMax)).toBeCloseTo(
      linearToDb(u.gsMax) + linearToDb(u.g0) + linearToDb(u.glMax),
      12,
    );
    // The maximum gain circle collapses onto conj(S11); zero gain is the chart rim.
    const top = unilateralGainCircle(ex13, 'source', u.gsMax);
    expect(top.radius).toBeLessThan(1e-12);
    expect(cabs(csub(top.center, { re: ex13.s11.re, im: -ex13.s11.im }))).toBeLessThan(1e-12);
    const zero = unilateralGainCircle(ex13, 'load', 0);
    expect(zero.radius).toBeCloseTo(1, 12);
    expect(cabs(zero.center)).toBeCloseTo(0, 12);
  });
});

describe('noise', () => {
  it('NFmin is reached at Gamma_opt and the NFmin circle is a point', () => {
    expect(noiseFigureDb(ex13Noise, ex13Noise.gammaOpt)).toBeCloseTo(3.6, 12);
    const c = noiseCircle(ex13Noise, 3.6);
    expect(c.radius).toBeCloseTo(0, 12);
    expect(cabs(csub(c.center, ex13Noise.gammaOpt))).toBeLessThan(1e-12);
  });

  it('every point on a noise circle has that noise figure (Example 13 circles)', () => {
    for (const nf of [3.601, 3.7, 3.8, 3.9, 4]) {
      const c = noiseCircle(ex13Noise, nf);
      expect(c.radius).toBeGreaterThan(0);
      for (const deg of [0, 90, 180, 270]) {
        const p = polarDeg(c.radius, deg);
        const gs = complex(c.center.re + p.re, c.center.im + p.im);
        expect(noiseFigureDb(ex13Noise, gs)).toBeCloseTo(nf, 9);
      }
    }
    expect(noiseCircle(ex13Noise, 4).radius).toBeGreaterThan(noiseCircle(ex13Noise, 3.7).radius);
  });
});
