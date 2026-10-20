import { describe, expect, it } from 'vitest';
import {
  cclose,
  complex,
  datapointInfo,
  denormalize,
  gammaToY,
  gammaToZ,
  mismatchLossDb,
  normalize,
  qFactor,
  returnLossDb,
  vswr,
  yToGamma,
  yToZ,
  zToGamma,
  zToY,
} from '../src/index';

describe('conversions', () => {
  it('maps Z0 to the chart centre and the short and open to the rim', () => {
    expect(cclose(zToGamma(complex(50, 0), 50), complex(0, 0))).toBe(true);
    expect(cclose(zToGamma(complex(0, 0), 50), complex(-1, 0))).toBe(true);
    expect(cclose(zToGamma(complex(0, 50), 50), complex(0, 1))).toBe(true);
  });

  it('Gamma of 100 + j0 on 50 ohm is 1/3', () => {
    expect(cclose(zToGamma(complex(100, 0), 50), complex(1 / 3, 0))).toBe(true);
  });

  it('works with an arbitrary real Z0', () => {
    expect(cclose(zToGamma(complex(75, 0), 75), complex(0, 0))).toBe(true);
    expect(cclose(zToGamma(complex(150, 0), 75), complex(1 / 3, 0))).toBe(true);
  });

  it('round-trips Z, Gamma and Y', () => {
    const z = complex(23.7, -101);
    expect(cclose(gammaToZ(zToGamma(z, 50), 50), z, 1e-10)).toBe(true);
    expect(cclose(yToZ(zToY(z)), z, 1e-10)).toBe(true);
    const y = zToY(z);
    expect(cclose(gammaToY(yToGamma(y, 50), 50), y, 1e-15)).toBe(true);
    expect(cclose(yToGamma(y, 50), zToGamma(z, 50), 1e-15)).toBe(true);
  });

  it('normalizes and denormalizes', () => {
    expect(normalize(complex(25, -50), 50)).toEqual({ re: 0.5, im: -1 });
    expect(denormalize(complex(0.5, -1), 50)).toEqual({ re: 25, im: -50 });
  });

  it('VSWR, return loss and mismatch loss for |Gamma| = 1/3', () => {
    expect(vswr(1 / 3)).toBeCloseTo(2, 12);
    expect(returnLossDb(1 / 3)).toBeCloseTo(9.542425094, 8);
    expect(mismatchLossDb(1 / 3)).toBeCloseTo(0.511525224, 8);
  });

  it('handles the match and the rim', () => {
    expect(vswr(0)).toBe(1);
    expect(returnLossDb(0)).toBe(Infinity);
    expect(mismatchLossDb(0)).toBe(0);
    expect(vswr(1)).toBe(Infinity);
    expect(mismatchLossDb(1)).toBe(Infinity);
  });

  it('Q = |X| / R', () => {
    expect(qFactor(complex(20, -12))).toBeCloseTo(0.6, 12);
    expect(qFactor(complex(20, 12))).toBeCloseTo(0.6, 12);
    expect(qFactor(complex(0, 12))).toBe(Infinity);
  });

  it('collects the cursor values for one datapoint', () => {
    const info = datapointInfo(complex(100, 0), 50);
    expect(info.gammaMag).toBeCloseTo(1 / 3, 12);
    expect(info.gammaAngleDeg).toBeCloseTo(0, 12);
    expect(info.vswr).toBeCloseTo(2, 12);
    expect(info.y.re).toBeCloseTo(0.01, 15);
    expect(info.q).toBe(0);
    expect(datapointInfo(complex(50, 0), 50).gammaAngleDeg).toBe(0);
  });
});
