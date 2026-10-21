import { describe, expect, it } from 'vitest';
import {
  complex,
  polarDeg,
  writeAscii,
  writeAsciiCircles,
  writeAsciiDatapoints,
  writeNetlist,
  type Ladder,
} from '../src/index';

const base = { z0: 50, frequency: 1e9, load: complex(50, 0) };

describe('qa: netlist edge cases', () => {
  it('writes an empty ladder with both DEF2P nodes at 1', () => {
    const text = writeNetlist({ ...base, frequency: 2.45e9, elements: [] }, { name: 'x' });
    expect(text.split('\n').slice(6)).toEqual([
      'CKT',
      'DEF2P 1 1 A ! A is actual passive Network',
      '!',
      'FREQ',
      'FIXED 2450',
      '',
    ]);
  });

  it('takes the physical length of lines and stubs without refFrequency at the design frequency', () => {
    // 0.25 wavelength at 1 GHz in air: 0.25 * 299.792458 mm = 74.9481 mm; 0.125: 37.4741 mm.
    const ladder: Ladder = {
      ...base,
      elements: [
        { kind: 'line', z0: 50, length: 0.25 },
        { kind: 'openStub', z0: 50, length: 0.125 },
        { kind: 'line', z0: 50, length: 0.25, refFrequency: 2e9 },
        { kind: 'line', z0: 50, length: 0.25, refFrequency: 1e9, er: 4 },
      ],
    };
    expect(writeNetlist(ladder).split('\n').slice(7, 11)).toEqual([
      'TLINP 1 2 0 Z=50 L=74.9481 K=1 A=0 F=0',
      'TLINP 2 99 0 Z=50 L=37.4741 K=1 A=0 F=0',
      'TLINP 2 3 0 Z=50 L=37.4741 K=1 A=0 F=0',
      'TLINP 3 4 0 Z=50 L=37.4741 K=4 A=0 F=0',
    ]);
  });

  it('writes missing RLC parts as 0 and zero values as 0', () => {
    const ladder: Ladder = {
      ...base,
      elements: [
        { kind: 'RLC', orientation: 'shunt', connection: 'series', l: 10e-9 },
        { kind: 'R', orientation: 'series', value: 0 },
      ],
    };
    expect(writeNetlist(ladder).split('\n').slice(7, 9)).toEqual([
      'SRLC 1 0 R=0 L=10 C=0',
      'RES 1 2 R=0',
    ]);
  });

  it('rounds to the requested digits and uses a bare exponent for tiny values', () => {
    const ladder: Ladder = {
      ...base,
      elements: [
        { kind: 'R', orientation: 'series', value: 46.08 },
        { kind: 'C', orientation: 'series', value: 1e-20 },
        { kind: 'C', orientation: 'shunt', value: 1.23456789e-20 },
        { kind: 'L', orientation: 'series', value: 1e-3 },
        { kind: 'C', orientation: 'series', value: 1.5e-14 },
      ],
    };
    expect(writeNetlist(ladder, { digits: 3 }).split('\n')[7]).toBe('RES 1 2 R=46.1');
    expect(writeNetlist(ladder).split('\n').slice(8, 12)).toEqual([
      'CAP 2 3 C=1e-8',
      'CAP 3 0 C=1.23457e-8',
      'IND 3 4 L=1000000',
      'CAP 4 5 C=0.015',
    ]);
  });
});

describe('qa: ASCII edge cases', () => {
  const noise = { nfMinDb: 1, gammaOpt: polarDeg(0.4, 60), rn: 0.3 };

  it('pads columns with two spaces and no trailing delimiter for "none"', () => {
    const text = writeAsciiCircles(
      { s: null, noise, frequency: 2e9, gain: [], noiseDb: [1.5], stability: [] },
      { delimiter: 'none' },
    );
    expect(text).toBe('N1  1.5  1  0.4  60  0.3  2000000000\n');
    const comma = writeAsciiCircles(
      { s: null, noise, frequency: 2e9, gain: [], noiseDb: [1.5], stability: [] },
      { delimiter: 'comma' },
    );
    expect(comma).toBe('N1,1.5,1,0.4,60,0.3,2000000000,\n');
  });

  it('names the output plane circles and the stable-inside case', () => {
    const s = {
      s11: polarDeg(0.5, -120),
      s12: polarDeg(0.05, 50),
      s21: polarDeg(3, 80),
      s22: polarDeg(0.4, -40),
    };
    const lines = writeAsciiCircles({
      s,
      noise: null,
      frequency: 1e9,
      gain: [{ plane: 2, gainDb: 9, gmaxDb: 12.5 }],
      noiseDb: [1.5],
      stability: [{ plane: 2, stableInside: true, k: 0.8 }],
    }).split('\n');
    expect(lines[0]).toBe(
      'G1;output plane const. gain circle;9;12.5;0.5;-120;3;80;0.05;50;0.4;-40;1000000000;',
    );
    expect(lines[1]).toBe(
      'S1;Output plane stability circle;stable inside;0.8;0.5;-120;3;80;0.05;50;0.4;-40;1000000000;',
    );
    // Noise circles need noise parameters.
    expect(lines).toHaveLength(3);
  });

  it('writes an empty table, an empty Q cell on the rim, and honours digits', () => {
    expect(writeAsciiDatapoints([])).toBe('Start DP;Point;R[Ohm];X[Ohm];Q;Frequency[Hz]\n');
    const rim = writeAsciiDatapoints([
      { start: true, label: 'DP1', z: complex(0, 50), frequency: 1e9 },
    ]);
    expect(rim.split('\n')[1]).toBe('true;DP1;0;50;;1000000000');
    const three = writeAsciiDatapoints(
      [{ start: false, label: 'TP2', z: complex(27.2, 10.5), frequency: 450e6 }],
      { digits: 3 },
    );
    expect(three.split('\n')[1]).toBe('false;TP2;27.2;10.5;0.386;450000000');
  });

  it('adds no blank line when the circle block is empty', () => {
    const points = [{ start: true, label: 'DP1', z: complex(20, -12), frequency: 450e6 }];
    const empty = { s: null, noise: null, frequency: 1, gain: [], noiseDb: [], stability: [] };
    expect(writeAscii(points, empty)).toBe(writeAsciiDatapoints(points));
    expect(writeAscii(points, empty, { delimiter: 'none' })).toBe(
      'Start DP  Point  R[Ohm]  X[Ohm]  Q    Frequency[Hz]\ntrue      DP1    20      -12     0.6  450000000\n',
    );
  });
});
