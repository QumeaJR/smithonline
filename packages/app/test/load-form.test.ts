import { complex, zToY } from '@smithonline/core';
import { describe, expect, it } from 'vitest';
import { loadFromFields, loadToFields } from '../src/lib/loadForm';

describe('load entry forms', () => {
  const z = complex(20, -12);

  it('shows the impedance as typed', () => {
    expect(loadToFields('z', z, 50)).toEqual([20, -12]);
  });

  it('shows the admittance in millisiemens', () => {
    const [g, b] = loadToFields('y', complex(50, 0), 50);
    expect(g).toBeCloseTo(20, 12);
    expect(b).toBeCloseTo(0, 12);
    const [g2, b2] = loadToFields('y', z, 50);
    const y = zToY(z);
    expect(g2).toBeCloseTo(y.re * 1e3, 12);
    expect(b2).toBeCloseTo(y.im * 1e3, 12);
  });

  it('shows the reflection coefficient as magnitude and degrees', () => {
    expect(loadToFields('gamma', complex(50, 0), 50)[0]).toBeCloseTo(0, 12);
    const [m, a] = loadToFields('gamma', complex(0, 50), 50);
    expect(m).toBeCloseTo(1, 12);
    expect(a).toBeCloseTo(90, 9);
    expect(loadToFields('gamma', complex(0, 0), 50)).toEqual([1, 180]);
  });

  it('converts back from every form', () => {
    expect(loadFromFields('z', 20, -12, 50)).toEqual(z);
    const fromY = loadFromFields('y', 20, 0, 50)!;
    expect(fromY.re).toBeCloseTo(50, 9);
    expect(fromY.im).toBeCloseTo(0, 9);
    // |Gamma| 0.5 at 0 degrees on a 50 ohm line is 150 ohm.
    const fromG = loadFromFields('gamma', 0.5, 0, 50)!;
    expect(fromG.re).toBeCloseTo(150, 9);
    expect(fromG.im).toBeCloseTo(0, 9);
    // 1 at 180 degrees is a short.
    const short = loadFromFields('gamma', 1, 180, 50)!;
    expect(short.re).toBeCloseTo(0, 9);
  });

  it('round-trips an arbitrary load through each form', () => {
    for (const form of ['z', 'y', 'gamma'] as const) {
      const [a, b] = loadToFields(form, z, 75);
      const back = loadFromFields(form, a, b, 75)!;
      expect(back.re).toBeCloseTo(z.re, 9);
      expect(back.im).toBeCloseTo(z.im, 9);
    }
  });

  it('refuses entries without a finite impedance', () => {
    expect(loadFromFields('y', 0, 0, 50)).toBeNull(); // open circuit
    expect(loadFromFields('gamma', 1, 0, 50)).toBeNull(); // open circuit
    expect(loadFromFields('gamma', -0.2, 0, 50)).toBeNull();
    expect(loadFromFields('z', Number.NaN, 0, 50)).toBeNull();
  });
});
