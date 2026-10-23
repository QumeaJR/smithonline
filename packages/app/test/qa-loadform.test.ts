/**
 * QA round 1: load entry forms, hand values and refusals.
 * 25 + j25 ohm: Y = (25 - j25) / 1250 = 0.02 - j0.02 S = 20 - j20 mS.
 * |Gamma| 0.5 at 0 degrees in 50 ohm: Z = 50 (1.5 / 0.5) = 150 ohm.
 * |Gamma| 1/3 at 180 degrees: Z = 50 (2/3) / (4/3) = 25 ohm.
 */
import { complex } from '@smithonline/core';
import { describe, expect, it } from 'vitest';
import { LOAD_FORMS, loadFromFields, loadToFields } from '../src/lib/loadForm';

describe('loadToFields', () => {
  it('admittance of 25 + j25 is 20 - j20 mS', () => {
    const [g, b] = loadToFields('y', complex(25, 25), 50);
    expect(g).toBeCloseTo(20, 12);
    expect(b).toBeCloseTo(-20, 12);
  });

  it('a short is |Gamma| 1 at 180 degrees; a match is 0 at 0 degrees', () => {
    expect(loadToFields('gamma', complex(0, 0), 50)).toEqual([1, 180]);
    expect(loadToFields('gamma', complex(50, 0), 50)).toEqual([0, 0]);
  });

  it('the impedance form shows the numbers as they are, negative resistance included', () => {
    expect(loadToFields('z', complex(-10, 3), 50)).toEqual([-10, 3]);
  });
});

describe('loadFromFields', () => {
  it('20 - j20 mS is 25 + j25 ohm; 0.5 at 0 degrees is 150 ohm; 1/3 at 180 degrees is 25 ohm', () => {
    const y = loadFromFields('y', 20, -20, 50)!;
    expect(y.re).toBeCloseTo(25, 12);
    expect(y.im).toBeCloseTo(25, 12);
    const g1 = loadFromFields('gamma', 0.5, 0, 50)!;
    expect(g1.re).toBeCloseTo(150, 12);
    expect(g1.im).toBeCloseTo(0, 12);
    const g2 = loadFromFields('gamma', 1 / 3, 180, 50)!;
    expect(g2.re).toBeCloseTo(25, 9);
    expect(g2.im).toBeCloseTo(0, 9);
  });

  it('|Gamma| 1 at 360 and -360 degrees is the open circuit too', () => {
    expect(loadFromFields('gamma', 1, 360, 50)).toBeNull();
    expect(loadFromFields('gamma', 1, -360, 50)).toBeNull();
  });

  it('|Gamma| 1 at 180 degrees is a short, which the chart holds', () => {
    const z = loadFromFields('gamma', 1, 180, 50)!;
    expect(z).not.toBeNull();
    expect(z.re).toBeCloseTo(0, 9);
    expect(z.im).toBeCloseTo(0, 9);
  });

  it('a reflection coefficient above 1 is an active load and is accepted as a finite impedance', () => {
    // |Gamma| 2 at 180 degrees: Z = 50 (1 - 2) / (1 + 2) = -16.667 ohm.
    const z = loadFromFields('gamma', 2, 180, 50)!;
    expect(z.re).toBeCloseTo(-50 / 3, 9);
  });

  it('refuses NaN and Infinity in either field of every form', () => {
    for (const form of ['z', 'y', 'gamma'] as const) {
      expect(loadFromFields(form, NaN, 0, 50)).toBeNull();
      expect(loadFromFields(form, 1, NaN, 50)).toBeNull();
      expect(loadFromFields(form, Infinity, 0, 50)).toBeNull();
    }
  });

  it('the forms expose the units and the only lower bound is |Gamma| >= 0', () => {
    expect(LOAD_FORMS.z.fields.map((f) => f.unit)).toEqual(['Ω', 'Ω']);
    expect(LOAD_FORMS.y.fields.map((f) => f.unit)).toEqual(['mS', 'mS']);
    expect(LOAD_FORMS.gamma.fields[0].min).toBe(0);
    expect(LOAD_FORMS.gamma.fields[1].min).toBeUndefined();
    expect(LOAD_FORMS.z.fields[0].min).toBeUndefined();
  });

  it('round-trips an inductive load through the admittance form at another Z0', () => {
    const z = complex(12, 70);
    const [g, b] = loadToFields('y', z, 75);
    const back = loadFromFields('y', g, b, 75)!;
    expect(back.re).toBeCloseTo(12, 9);
    expect(back.im).toBeCloseTo(70, 9);
    const [m, a] = loadToFields('gamma', z, 75);
    const back2 = loadFromFields('gamma', m, a, 75)!;
    expect(back2.re).toBeCloseTo(12, 9);
    expect(back2.im).toBeCloseTo(70, 9);
  });
});
