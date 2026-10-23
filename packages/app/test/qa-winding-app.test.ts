/**
 * QA round 1: the stored core table parser and the note texts.
 */
import { TOROID_CORES } from '@smithonline/core';
import { describe, expect, it } from 'vitest';
import { parseCores, solenoidNote, toroidNote } from '../src/lib/winding';

describe('parseCores', () => {
  it('rejects od <= id, blank names, non-positive numbers and non-array JSON, falling back to the built-in table', () => {
    const row = { name: 'A', al: 10, od: 10, id: 5, height: 1 };
    expect(parseCores(JSON.stringify([{ ...row, od: 5, id: 6 }]))).toEqual([...TOROID_CORES]);
    expect(parseCores(JSON.stringify([{ ...row, od: 5, id: 5 }]))).toEqual([...TOROID_CORES]);
    expect(parseCores(JSON.stringify([{ ...row, name: '  ' }]))).toEqual([...TOROID_CORES]);
    expect(parseCores(JSON.stringify([{ ...row, al: 0 }]))).toEqual([...TOROID_CORES]);
    expect(parseCores(JSON.stringify([{ ...row, height: Infinity }]))).toEqual([...TOROID_CORES]);
    expect(parseCores('[]')).toEqual([...TOROID_CORES]);
    expect(parseCores('null')).toEqual([...TOROID_CORES]);
    expect(parseCores('{"a":1}')).toEqual([...TOROID_CORES]);
    expect(parseCores(JSON.stringify([row, { ...row, od: 1 }]))).toEqual([row]);
  });

  it('returns a fresh copy of the built-in table, not the constant itself', () => {
    expect(parseCores(null)).not.toBe(TOROID_CORES);
  });
});

describe('notes', () => {
  it('solenoid: turns, diameter, pitch, length and wire in millimetres to three digits', () => {
    const note = solenoidNote(
      {
        exactTurns: 6.6,
        turns: 7,
        length: 0.0084,
        inductance: 1e-6,
        wireLength: 0.2599,
        lengthToDiameter: 0.84,
      },
      0.01,
      0.0012,
    );
    expect(note).toMatch(
      /^Air core: 7 turns on 10 mm mean diameter, pitch 1\.2 mm, length 8\.4 mm, wire 260 mm, L = /,
    );
    expect(note).toMatch(/\(Wheeler\)$/);
    expect(note).toContain('µH');
  });

  it('solenoid without a pitch omits the pitch; one turn is singular', () => {
    const note = solenoidNote(
      {
        exactTurns: 0.7,
        turns: 1,
        length: 0.005,
        inductance: 5e-8,
        wireLength: 0.0314,
        lengthToDiameter: 0.5,
      },
      0.01,
      null,
    );
    expect(note).toMatch(
      /^Air core: 1 turn on 10 mm mean diameter, length 5 mm, wire 31\.4 mm, L = /,
    );
    expect(note).not.toContain('pitch');
  });

  it('toroid: the core name, the turns and the wire only when known', () => {
    expect(
      toroidNote('T50-2', { exactTurns: 14.3, turns: 14, inductance: 9.604e-7, wireLength: null }),
    ).toMatch(/^Toroid T50-2: 14 turns, L = .*H$/);
    const withWire = toroidNote('FT37-43', {
      exactTurns: 1.2,
      turns: 1,
      inductance: 4.2e-7,
      wireLength: 0.33,
    });
    expect(withWire).toMatch(/^Toroid FT37-43: 1 turn, wire 330 mm, L = /);
  });
});
