/**
 * QA round 1: winding.ts limits and boundaries. Wheeler: L[uH] = D^2 N^2 / (18 D + 40 l), inches.
 */
import { describe, expect, it } from 'vitest';
import { solenoidInductance, solenoidTurns, toroidTurnLength, toroidTurns } from '../src/index';

const INCH = 0.0254;

describe('solenoid', () => {
  it('20 turns, 2 inch diameter, 1 inch long: 4 * 400 / (36 + 40) = 21.0526 uH', () => {
    expect(solenoidInductance(20, 2 * INCH, 1 * INCH)).toBeCloseTo(1600e-6 / 76, 15);
  });

  it('zero turns or zero diameter is zero inductance, not NaN', () => {
    expect(solenoidInductance(0, INCH, INCH)).toBe(0);
    expect(solenoidInductance(10, 0, INCH)).toBe(0);
  });

  it('with both length and pitch given, the length wins and is kept as given', () => {
    // 1 uH on a 1 inch coil 1 inch long: N = sqrt(1 * 58 / 1) = 7.6158 -> 8 turns.
    const r = solenoidTurns({ inductance: 1e-6, diameter: INCH, length: INCH, pitch: 1e-3 })!;
    expect(r.exactTurns).toBeCloseTo(Math.sqrt(58), 9);
    expect(r.turns).toBe(8);
    expect(r.length).toBe(INCH);
  });

  it('length/diameter exactly 0.4 carries no warning, 0.39 does', () => {
    expect(solenoidTurns({ inductance: 1e-6, diameter: 1, length: 0.4 })!.warning).toBeUndefined();
    expect(solenoidTurns({ inductance: 1e-6, diameter: 1, length: 0.39 })!.warning).toMatch(
      /0\.4 of the diameter/,
    );
  });

  it('negative leads count as none; NaN leads count as none too', () => {
    const none = solenoidTurns({ inductance: 1e-6, diameter: 0.01, pitch: 1e-3 })!;
    const negative = solenoidTurns({ inductance: 1e-6, diameter: 0.01, pitch: 1e-3, leads: -1 })!;
    expect(negative.wireLength).toBe(none.wireLength);
    const nan = solenoidTurns({ inductance: 1e-6, diameter: 0.01, pitch: 1e-3, leads: NaN })!;
    expect(nan.wireLength).toBe(none.wireLength);
  });

  it('wire is turns times pi times the mean diameter plus the leads', () => {
    const r = solenoidTurns({ inductance: 1e-6, diameter: 0.01, pitch: 1e-3, leads: 0.05 })!;
    expect(r.wireLength).toBeCloseTo(r.turns * Math.PI * 0.01 + 0.05, 12);
    expect(r.length).toBeCloseTo(r.turns * 1e-3, 15);
  });

  it('refuses Infinity in the diameter, length and pitch', () => {
    expect(solenoidTurns({ inductance: 1e-6, diameter: Infinity, length: 0.01 })).toBeNull();
    expect(solenoidTurns({ inductance: 1e-6, diameter: 0.01, length: Infinity })).toBeNull();
    expect(solenoidTurns({ inductance: 1e-6, diameter: 0.01, pitch: Infinity })).toBeNull();
    expect(solenoidTurns({ inductance: 1e-6, diameter: 0.01, length: -1, pitch: -1 })).toBeNull();
  });
});

describe('toroid', () => {
  it('a turn length of 0 or negative gives no wire length; negative leads count as none', () => {
    expect(toroidTurns({ inductance: 1e-6, al: 4.9, turnLength: 0 })!.wireLength).toBeNull();
    expect(toroidTurns({ inductance: 1e-6, al: 4.9, turnLength: -1 })!.wireLength).toBeNull();
    const r = toroidTurns({ inductance: 1e-6, al: 4.9, turnLength: 0.02, leads: -1 })!;
    expect(r.wireLength).toBeCloseTo(14 * 0.02, 12);
  });

  it('NaN AL or inductance is refused', () => {
    expect(toroidTurns({ inductance: 1e-6, al: NaN })).toBeNull();
    expect(toroidTurns({ inductance: NaN, al: 10 })).toBeNull();
  });

  it('an inductance below one turn still gives one turn', () => {
    // sqrt(1e-9 / 100e-9) = 0.1 -> 1 turn, L = 100 nH.
    const r = toroidTurns({ inductance: 1e-9, al: 100 })!;
    expect(r.exactTurns).toBeCloseTo(0.1, 12);
    expect(r.turns).toBe(1);
    expect(r.inductance).toBeCloseTo(100e-9, 18);
  });

  it('T37-2 turn length: 2 * 3.25 + (9.53 - 5.21) = 10.82 mm', () => {
    expect(toroidTurnLength({ od: 9.53, id: 5.21, height: 3.25 })).toBeCloseTo(10.82e-3, 12);
  });
});
