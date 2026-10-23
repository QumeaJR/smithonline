import { describe, expect, it } from 'vitest';
import { stressOf } from '../src/lib/build';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { realizeDesign } from '../src/lib/realize';
import { decodeDesign, encodeDesign } from '../src/lib/share';
import { activeLimits, designStress, powerToWatt, stressSettings } from '../src/lib/stress';
import { useDesignStore } from '../src/store/useDesignStore';

const base: Design = {
  ...emptyDesign(),
  frequency: 100e6,
  load: { re: 200, im: 0 },
  elements: identify([
    { kind: 'C', orientation: 'shunt', value: 10e-12 },
    { kind: 'L', orientation: 'series', value: 100e-9 },
  ]),
};

describe('power units', () => {
  it('reads watts and dBm', () => {
    expect(powerToWatt(5, 'W')).toBe(5);
    expect(powerToWatt(30, 'dBm')).toBeCloseTo(1, 12);
    expect(powerToWatt(-3, 'W')).toBeNull();
    expect(powerToWatt(NaN, 'dBm')).toBeNull();
  });
});

describe('stress settings', () => {
  it('default to off', () => {
    expect(stressSettings(emptyDesign()).power).toBe(0);
    expect(designStress(base, base.elements, null)).toBeNull();
  });

  it('compute for the design, and for the realized values when Realize is on', () => {
    const d: Design = { ...base, stress: { power: 10, unit: 'W', limits: {} } };
    const ideal = designStress(d, d.elements, null)!;
    expect(ideal).toHaveLength(2);
    expect(ideal[0]!.vPeak).toBeGreaterThan(0);
    const dr: Design = { ...d, realize: { ...d.realize, enabled: true, series: 'E6' } };
    const real = designStress(dr, dr.elements, realizeDesign(dr, dr.elements))!;
    // 10 pF and 100 nH are on E6/E12 values already: same numbers, same stress.
    expect(real[0]!.vPeak).toBeCloseTo(ideal[0]!.vPeak, 6);
  });

  it('keep only positive limits', () => {
    expect(
      activeLimits({
        power: 1,
        unit: 'W',
        limits: { C: { vPeak: 100, iRms: 0 }, L: { iRms: -1 } },
      }),
    ).toEqual({ C: { vPeak: 100 } });
  });

  it('round-trip through a share link and are absent from an old one', () => {
    const d: Design = {
      ...emptyDesign(),
      stress: { power: 12.5, unit: 'dBm', limits: { C: { vPeak: 250, iRms: 2 }, L: { iRms: 3 } } },
    };
    expect(decodeDesign(encodeDesign(d))?.stress).toEqual(d.stress);
    expect(decodeDesign(encodeDesign(emptyDesign()))?.stress).toBeUndefined();
  });

  it('decode drops garbage', () => {
    expect(stressOf(null)).toBeNull();
    expect(
      stressOf({ power: -4, unit: 'x', limits: { C: { vPeak: 'a' }, Q: { vPeak: 1 } } }),
    ).toBeNull();
    expect(stressOf({ power: 3, unit: 'x', limits: { C: { vPeak: 'a' } } })).toEqual({
      power: 3,
      unit: 'W',
      limits: {},
    });
  });

  it('are set through the store in one history step', () => {
    useDesignStore.getState().init(emptyDesign());
    useDesignStore.getState().setStress({ power: 5 });
    useDesignStore.getState().setStress({ limits: { C: { vPeak: 100 } } });
    const s = useDesignStore.getState().design.stress!;
    expect(s).toEqual({ power: 5, unit: 'W', limits: { C: { vPeak: 100 } } });
    useDesignStore.getState().undo();
    expect(useDesignStore.getState().design.stress?.limits).toEqual({});
  });
});
