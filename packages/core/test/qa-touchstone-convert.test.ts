/**
 * QA round 1: touchstone-convert.ts and network-s2p.ts, byte-level layout of
 * the converted files and the branches the existing tests skip. The S values
 * are chosen so every converted number is exact in binary (see qa-netparams).
 */
import { describe, expect, it } from 'vitest';
import {
  abcdMatrixToS,
  complex,
  convertTouchstonePoints,
  ladderSParameters,
  NetworkParameterError,
  readTouchstone,
  writeConvertedTouchstone,
  writeLadderS2p,
  type Ladder,
  type TouchstoneData,
} from '../src/index';

const c = (re: number, im = 0) => complex(re, im);

/** Shunt y = 2 at 100 MHz: S = [-0.5 0.5; 0.5 -0.5]. */
const SHUNT: TouchstoneData = {
  ports: 2,
  parameter: 'S',
  format: 'RI',
  frequencyUnit: 'MHZ',
  z0: 50,
  points: [{ frequency: 100e6, s: [c(-0.5), c(0.5), c(0.5), c(-0.5)] }],
  noise: [{ frequency: 100e6, nfMinDb: 1.5, gammaOpt: c(0.25), rn: 0.2 }],
  comments: [],
};

const ONE: TouchstoneData = {
  ports: 1,
  parameter: 'S',
  format: 'RI',
  frequencyUnit: 'GHZ',
  z0: 50,
  points: [{ frequency: 1e9, s: [c(0.5)] }],
  noise: [],
  comments: [],
};

describe('writeConvertedTouchstone layout', () => {
  it('one-port Z normalized: comment, option line with R 50, one data line "1 3 0"', () => {
    expect(writeConvertedTouchstone(ONE, 'Z')).toBe(
      ['! Z-parameters normalized to 50 ohm', '# GHZ Z RI R 50', '1 3 0'].join('\n') + '\n',
    );
  });

  it('one-port Y unnormalized: siemens with R 1 and the two explanatory comments', () => {
    // y = 1/3 normalized, 1/150 S = 0.0066666667 to 8 digits.
    expect(writeConvertedTouchstone(ONE, 'Y', { normalized: false })).toBe(
      [
        '! Y-parameters in ohm and siemens (unnormalized)',
        '! reference resistance R 1 on the option line; source Z0 was 50 ohm',
        '# GHZ Y RI R 1',
        '1 0.0066666667 0',
      ].join('\n') + '\n',
    );
  });

  it('two-port Z unnormalized of the shunt: 25 ohm in every cell, column order Z11 Z21 Z12 Z22', () => {
    expect(writeConvertedTouchstone(SHUNT, 'Z', { normalized: false })).toBe(
      [
        '! Z-parameters in ohm and siemens (unnormalized)',
        '! reference resistance R 1 on the option line; source Z0 was 50 ohm',
        '# MHZ Z RI R 1',
        '! f Z11 Z21 Z12 Z22',
        '100 25 0 25 0 25 0 25 0',
      ].join('\n') + '\n',
    );
  });

  it('two-port ABCD normalized: letter A, column comment A B C D, values 1 0 2 1', () => {
    expect(writeConvertedTouchstone(SHUNT, 'ABCD')).toBe(
      [
        '! ABCD parameters normalized to 50 ohm',
        '! chain matrix in the order A B C D; B in ohm and C in siemens when unnormalized',
        '# MHZ A RI R 50',
        '! f A B C D',
        '100 1 0 0 0 2 0 1 0',
      ].join('\n') + '\n',
    );
  });

  it('two-port H unnormalized: h11 0, h12 1, h21 -1, h22 0.04 S in the order H11 H21 H12 H22', () => {
    const lines = writeConvertedTouchstone(SHUNT, 'H', { normalized: false }).split('\n');
    expect(lines[2]).toBe('# MHZ H RI R 1');
    expect(lines[3]).toBe('! f H11 H21 H12 H22');
    expect(lines[4]).toBe('100 0 0 -1 0 1 0 0.04 0');
  });

  it('S keeps the noise block and the source unit; every other type drops the noise block', () => {
    const s = writeConvertedTouchstone(SHUNT, 'S', { normalized: false });
    expect(s).toContain('! f NFmin(dB) |Gopt| ang(Gopt) rn/Z0');
    expect(s).toContain('# MHZ S RI R 50');
    expect(s.split('\n')[0]).toBe('! S-parameters');
    expect(writeConvertedTouchstone(SHUNT, 'Z')).not.toContain('NFmin');
    expect(writeConvertedTouchstone(SHUNT, 'ABCD', { normalized: false })).not.toContain('NFmin');
  });

  it('extra comments come first; format, unit and digits options are honoured', () => {
    const text = writeConvertedTouchstone(ONE, 'Z', {
      comments: ['hello'],
      format: 'MA',
      frequencyUnit: 'MHZ',
      digits: 3,
    });
    expect(text.split('\n').slice(0, 3)).toEqual([
      '! hello',
      '! Z-parameters normalized to 50 ohm',
      '# MHZ Z MA R 50',
    ]);
    // 1 GHz in MHz is 1000; z = 3 at angle 0.
    expect(text.split('\n')[3]).toBe('1000 3 0');
  });

  it('the ABCD file is not read back as S-parameters: the reader refuses it (as its doc says) or labels it A', () => {
    let parameter: string | null;
    try {
      parameter = readTouchstone(writeConvertedTouchstone(SHUNT, 'ABCD'), 2).parameter;
    } catch {
      parameter = null;
    }
    expect(parameter).not.toBe('S');
  });

  it('the normalized Z file reads back as Z data with the same numbers', () => {
    const back = readTouchstone(writeConvertedTouchstone(SHUNT, 'Z'), 2);
    expect(back.parameter).toBe('Z');
    expect(back.points[0]!.frequency).toBe(100e6);
    expect(back.points[0]!.s.map((v) => v.re)).toEqual([0.5, 0.5, 0.5, 0.5]);
  });
});

describe('convertTouchstonePoints errors', () => {
  it('refuses non-S data naming the parameter', () => {
    expect(() => convertTouchstonePoints({ ...ONE, parameter: 'Z' }, 'S')).toThrow(/file holds Z/);
  });

  it('refuses H and ABCD for a one-port naming the port count', () => {
    expect(() => convertTouchstonePoints(ONE, 'H')).toThrow(/this file has 1 ports/);
    expect(() => convertTouchstonePoints(ONE, 'ABCD')).toThrow(/ABCD parameters are defined/);
  });

  it('names the frequency in Hz when a point has no such matrix', () => {
    const open: TouchstoneData = { ...ONE, points: [{ frequency: 2.5e9, s: [c(1)] }] };
    expect(() => convertTouchstonePoints(open, 'Z')).toThrow(/^At 2500000000 Hz: /);
    expect(() => convertTouchstonePoints(open, 'Z')).toThrow(NetworkParameterError);
  });

  it('an empty point list converts to an empty list', () => {
    expect(convertTouchstonePoints({ ...ONE, points: [] }, 'Z')).toEqual([]);
  });
});

describe('abcdMatrixToS and writeLadderS2p', () => {
  it('shunt admittance 1/50 S at Z0 50: S11 = -1/3, S21 = 2/3', () => {
    const s = abcdMatrixToS({ a: c(1), b: c(0), c: c(1 / 50), d: c(1) }, 50);
    expect(s.s11.re).toBeCloseTo(-1 / 3, 12);
    expect(s.s21.re).toBeCloseTo(2 / 3, 12);
    expect(s.s12.re).toBeCloseTo(2 / 3, 12);
    expect(s.s22.re).toBeCloseTo(-1 / 3, 12);
  });

  it('ideal transformer n = 2: S11 = 0.6, S21 = 0.8, S22 = -0.6', () => {
    const s = abcdMatrixToS({ a: c(2), b: c(0), c: c(0), d: c(0.5) }, 50);
    expect(s.s11.re).toBeCloseTo(0.6, 12);
    expect(s.s21.re).toBeCloseTo(0.8, 12);
    expect(s.s22.re).toBeCloseTo(-0.6, 12);
  });

  it('an empty ladder is the identity two-port at every frequency', () => {
    const ladder: Ladder = { z0: 50, frequency: 1e9, load: c(10, 5), elements: [] };
    const s = ladderSParameters(ladder, 3e9);
    expect(s.s11).toEqual(c(0));
    expect(s.s21).toEqual(c(1));
  });

  it('writes the header, MHz, RI and 9 digits by default; no data lines for no frequencies', () => {
    const ladder: Ladder = { z0: 75, frequency: 1e9, load: c(50), elements: [] };
    const text = writeLadderS2p(ladder, [], { name: 'x' });
    expect(text).toBe(
      [
        '! Smith Online matching network: x',
        '! Port 1 at the source end, port 2 at the load end; the load is not included',
        '# MHZ S RI R 75',
        '! f S11 S21 S12 S22',
      ].join('\n') + '\n',
    );
    const one = writeLadderS2p(ladder, [1e9]);
    expect(one.split('\n')[0]).toBe('! Smith Online matching network');
    expect(one.split('\n')[4]).toBe('1000 0 0 1 0 1 0 0 0');
  });
});
