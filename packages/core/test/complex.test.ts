import { describe, expect, it } from 'vitest';
import {
  cabs,
  cadd,
  carg,
  cargDeg,
  ccosh,
  cclose,
  cdiv,
  cexp,
  cinv,
  cmul,
  cneg,
  complex,
  conj,
  cscale,
  csinh,
  csub,
  polar,
  polarDeg,
  TINY,
} from '../src/index';

describe('complex', () => {
  it('computes the magnitude of 3 + 4j', () => {
    expect(cabs(complex(3, 4))).toBe(5);
  });

  it('defaults the imaginary part to zero', () => {
    expect(complex(2)).toEqual({ re: 2, im: 0 });
  });

  it('adds, subtracts, negates and scales', () => {
    expect(cadd(complex(1, 2), complex(3, -5))).toEqual({ re: 4, im: -3 });
    expect(csub(complex(1, 2), complex(3, -5))).toEqual({ re: -2, im: 7 });
    expect(cneg(complex(1, -2))).toEqual({ re: -1, im: 2 });
    expect(cscale(complex(1, -2), 3)).toEqual({ re: 3, im: -6 });
  });

  it('multiplies: (1 + 2j)(3 + 4j) = -5 + 10j', () => {
    expect(cmul(complex(1, 2), complex(3, 4))).toEqual({ re: -5, im: 10 });
  });

  it('divides: (-5 + 10j) / (3 + 4j) = 1 + 2j', () => {
    expect(cclose(cdiv(complex(-5, 10), complex(3, 4)), complex(1, 2))).toBe(true);
  });

  it('inverts: 1 / (3 + 4j) = 0.12 - 0.16j', () => {
    expect(cclose(cinv(complex(3, 4)), complex(0.12, -0.16))).toBe(true);
  });

  it('treats division by exactly zero as division by TINY', () => {
    const r = cdiv(complex(1, 0), complex(0, 0));
    expect(r.re).toBe(1 / TINY);
    expect(r.im).toBe(0);
  });

  it('computes the argument in radians and degrees', () => {
    expect(carg(complex(0, 1))).toBeCloseTo(Math.PI / 2, 12);
    expect(cargDeg(complex(-1, 0))).toBe(180);
    expect(cargDeg(complex(1, -1))).toBeCloseTo(-45, 12);
  });

  it('conjugates', () => {
    expect(conj(complex(1, 2))).toEqual({ re: 1, im: -2 });
  });

  it('exp(j pi) = -1', () => {
    expect(cclose(cexp(complex(0, Math.PI)), complex(-1, 0))).toBe(true);
    expect(cclose(cexp(complex(1, 0)), complex(Math.E, 0))).toBe(true);
  });

  it('builds from polar form', () => {
    expect(cclose(polar(2, Math.PI / 2), complex(0, 2))).toBe(true);
    expect(cclose(polarDeg(1, 60), complex(0.5, Math.sqrt(3) / 2))).toBe(true);
  });

  it('round-trips magnitude and angle', () => {
    const z = complex(-3, 7);
    expect(cclose(polar(cabs(z), carg(z)), z, 1e-12)).toBe(true);
  });

  it('cosh and sinh reduce to cos and j sin on the imaginary axis', () => {
    const z = complex(0, 1.2);
    expect(cclose(ccosh(z), complex(Math.cos(1.2), 0))).toBe(true);
    expect(cclose(csinh(z), complex(0, Math.sin(1.2)))).toBe(true);
  });

  it('cosh^2 - sinh^2 = 1 for a general argument', () => {
    const z = complex(0.3, -2.1);
    const c = ccosh(z);
    const s = csinh(z);
    expect(cclose(csub(cmul(c, c), cmul(s, s)), complex(1, 0), 1e-12)).toBe(true);
  });
});
