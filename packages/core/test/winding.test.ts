import { describe, expect, it } from 'vitest';
import {
  solenoidInductance,
  solenoidTurns,
  TOROID_CORES,
  toroidTurnLength,
  toroidTurns,
} from '../src/index';

const IN = 0.0254;

describe('solenoidInductance (Wheeler)', () => {
  it('gives the textbook value for a 1 inch by 1 inch coil of 10 turns', () => {
    // 100 / (18 + 40) = 1.724 uH
    expect(solenoidInductance(10, IN, IN) * 1e6).toBeCloseTo(100 / 58, 9);
  });

  it('grows with the square of the turns', () => {
    const a = solenoidInductance(5, 0.01, 0.02);
    expect(solenoidInductance(10, 0.01, 0.02) / a).toBeCloseTo(4, 12);
  });
});

describe('solenoidTurns', () => {
  it('inverts the formula for a given length', () => {
    const L = solenoidInductance(10, IN, IN);
    const r = solenoidTurns({ inductance: L, diameter: IN, length: IN })!;
    expect(r.exactTurns).toBeCloseTo(10, 9);
    expect(r.turns).toBe(10);
    expect(r.inductance).toBeCloseTo(L, 15);
    expect(r.length).toBe(IN);
    expect(r.wireLength).toBeCloseTo(10 * Math.PI * IN, 12);
    expect(r.warning).toBeUndefined();
  });

  it('solves the pitch case so that length = turns x pitch reproduces the inductance', () => {
    const r = solenoidTurns({ inductance: 1e-6, diameter: 0.01, pitch: 0.0012 })!;
    const l = r.exactTurns * 0.0012;
    expect(solenoidInductance(r.exactTurns, 0.01, l)).toBeCloseTo(1e-6, 12);
    expect(r.length).toBeCloseTo(r.turns * 0.0012, 12);
    // Rounding the turns moves the inductance by at most a turn's worth.
    expect(Math.abs(r.inductance - 1e-6) / 1e-6).toBeLessThan(2 / r.exactTurns);
  });

  it('adds the leads to the wire and warns about a short fat coil', () => {
    const r = solenoidTurns({ inductance: 5e-6, diameter: 0.03, length: 0.005, leads: 0.04 })!;
    expect(r.wireLength).toBeCloseTo(r.turns * Math.PI * 0.03 + 0.04, 12);
    expect(r.lengthToDiameter).toBeCloseTo(0.005 / 0.03, 12);
    expect(r.warning).toMatch(/Wheeler/);
  });

  it('never returns less than one turn', () => {
    const r = solenoidTurns({ inductance: 1e-12, diameter: 0.05, length: 0.05 })!;
    expect(r.turns).toBe(1);
  });

  it('refuses what cannot be wound', () => {
    expect(solenoidTurns({ inductance: 0, diameter: 0.01, length: 0.01 })).toBeNull();
    expect(solenoidTurns({ inductance: 1e-6, diameter: -1, length: 0.01 })).toBeNull();
    expect(solenoidTurns({ inductance: 1e-6, diameter: 0.01 })).toBeNull();
    expect(solenoidTurns({ inductance: 1e-6, diameter: 0.01, pitch: 0 })).toBeNull();
    expect(solenoidTurns({ inductance: NaN, diameter: 0.01, length: 0.01 })).toBeNull();
  });
});

describe('toroidTurns', () => {
  it('is sqrt(L / AL), rounded', () => {
    // T50-2: AL 4.9 nH/N^2; 1 uH needs 14.28 turns.
    const r = toroidTurns({ inductance: 1e-6, al: 4.9 })!;
    expect(r.exactTurns).toBeCloseTo(Math.sqrt(1000 / 4.9), 9);
    expect(r.turns).toBe(14);
    expect(r.inductance).toBeCloseTo(4.9e-9 * 14 * 14, 18);
    expect(r.wireLength).toBeNull();
  });

  it('adds the wire when the turn length is known', () => {
    const r = toroidTurns({ inductance: 1e-6, al: 4.9, turnLength: 0.02, leads: 0.05 })!;
    expect(r.wireLength).toBeCloseTo(14 * 0.02 + 0.05, 12);
  });

  it('refuses a non-positive input', () => {
    expect(toroidTurns({ inductance: -1e-6, al: 4.9 })).toBeNull();
    expect(toroidTurns({ inductance: 1e-6, al: 0 })).toBeNull();
    expect(toroidTurns({ inductance: Infinity, al: 4 })).toBeNull();
  });
});

describe('core table', () => {
  it('has sane entries with unique names', () => {
    const names = new Set(TOROID_CORES.map((c) => c.name));
    expect(names.size).toBe(TOROID_CORES.length);
    for (const c of TOROID_CORES) {
      expect(c.al).toBeGreaterThan(0);
      expect(c.od).toBeGreaterThan(c.id);
      expect(c.height).toBeGreaterThan(0);
    }
  });

  it('gives a turn length around the cross-section', () => {
    // T50-2: height 4.83, wall (12.7 - 7.7) / 2 = 2.5: 2 * (4.83 + 2.5) = 14.66 mm.
    expect(toroidTurnLength({ od: 12.7, id: 7.7, height: 4.83 }) * 1e3).toBeCloseTo(14.66, 9);
  });
});
