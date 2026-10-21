import { describe, expect, it } from 'vitest';
import {
  complex,
  polarDeg,
  SPEED_OF_LIGHT,
  writeAscii,
  writeAsciiCircles,
  writeAsciiDatapoints,
  writeNetlist,
  type Ladder,
} from '../src/index';

describe('writeNetlist', () => {
  it('reproduces the layout documented for Smith V4.1', () => {
    const f = 500e6;
    const lambda = SPEED_OF_LIGHT / f;
    const ladder: Ladder = {
      z0: 50,
      frequency: f,
      load: complex(50, 0),
      elements: [
        { kind: 'RLC', orientation: 'shunt', connection: 'series', r: 33, l: 22e-9, c: 18e-12 },
        { kind: 'line', z0: 50, length: 0.0378 / lambda, refFrequency: f, er: 1, alphaDbPerM: 2 },
        { kind: 'R', orientation: 'series', value: 46.08 },
        { kind: 'L', orientation: 'shunt', value: 13.18e-9 },
        { kind: 'C', orientation: 'series', value: 19.4e-12 },
      ],
    };
    expect(writeNetlist(ladder, { name: 'Example_netlist' })).toBe(
      [
        '! SMITH-CHART NETLIST GENERATOR VERSION 1.0             TIME=1e-12  COND=1e-0',
        '! INPUT FILE: Example_netlist.xmlsc',
        '! OUTPUT FILE: Example_netlist.ckt',
        '! GLOBAL',
        'DIM FREQ=1e6 RES=1e0 IND=1e-9 CAP=1e-12 LNG=1e-3',
        '!',
        'CKT',
        'SRLC 1 0 R=33 L=22 C=18',
        'TLINP 1 2 0 Z=50 L=37.8 K=1 A=2 F=0',
        'RES 2 3 R=46.08',
        'IND 3 0 L=13.18',
        'CAP 3 4 C=19.4',
        'DEF2P 1 4 A ! A is actual passive Network',
        '!',
        'FREQ',
        'FIXED 500',
        '',
      ].join('\n'),
    );
  });

  it('writes stubs, transformers, series RLC and shunt R', () => {
    const f = 1e9;
    const lambda = SPEED_OF_LIGHT / f;
    const ladder: Ladder = {
      z0: 50,
      frequency: f,
      load: complex(50, 0),
      elements: [
        { kind: 'openStub', z0: 50, length: 0.01 / lambda, refFrequency: f },
        { kind: 'shortStub', z0: 75, length: 0.02 / lambda, refFrequency: f },
        { kind: 'transformer', n: 2 },
        { kind: 'RLC', orientation: 'series', connection: 'parallel', r: 100, l: 1e-9, c: 2e-12 },
        { kind: 'R', orientation: 'shunt', value: 200 },
        { kind: 'line', z0: 50, length: 0.25, refFrequency: f, er: 4 },
      ],
    };
    const lines = writeNetlist(ladder).split('\n');
    expect(lines.slice(7, 14)).toEqual([
      'TLINP 1 99 0 Z=50 L=10 K=1 A=0 F=0',
      'TLINP 1 0 0 Z=75 L=20 K=1 A=0 F=0',
      'TRF 1 0 2 0 N=2 R1=0',
      'PRLC 2 3 R=100 L=1 C=2',
      'RES 3 0 R=200',
      `TLINP 3 4 0 Z=50 L=${Number(((0.25 * lambda) / 2) * 1e3)
        .toPrecision(6)
        .replace(/\.?0+$/, '')} K=4 A=0 F=0`,
      'DEF2P 1 4 A ! A is actual passive Network',
    ]);
    expect(lines[1]).toBe('! INPUT FILE: design.xmlsc');
    expect(lines[16]).toBe('FIXED 1000');
  });
});

describe('ASCII export', () => {
  const points = [
    { start: true, label: 'DP1', z: complex(20, -12), frequency: 450e6 },
    { start: false, label: 'TP2', z: complex(27.2, 10.5), frequency: 450e6 },
  ];

  it('writes the datapoint columns with the chosen delimiter', () => {
    expect(writeAsciiDatapoints(points)).toBe(
      'Start DP;Point;R[Ohm];X[Ohm];Q;Frequency[Hz]\n' +
        'true;DP1;20;-12;0.6;450000000\n' +
        'false;TP2;27.2;10.5;0.3860294118;450000000\n',
    );
    expect(writeAsciiDatapoints(points, { delimiter: 'comma' }).split('\n')[1]).toBe(
      'true,DP1,20,-12,0.6,450000000',
    );
    const none = writeAsciiDatapoints(points, { delimiter: 'none' }).split('\n');
    expect(none[0]).toBe('Start DP  Point  R[Ohm]  X[Ohm]  Q             Frequency[Hz]');
    expect(none[1]).toBe('true      DP1    20      -12     0.6           450000000');
  });

  it('writes one line per circle with a trailing delimiter', () => {
    const s = {
      s11: polarDeg(0.5, -120),
      s12: polarDeg(0.05, 50),
      s21: polarDeg(3, 80),
      s22: polarDeg(0.4, -40),
    };
    const text = writeAsciiCircles({
      s,
      noise: { nfMinDb: 1, gammaOpt: polarDeg(0.4, 60), rn: 0.3 },
      frequency: 2e9,
      gain: [{ plane: 1, gainDb: 10, gmaxDb: 12.5 }],
      noiseDb: [1.5],
      stability: [{ plane: 1, stableInside: false, k: 1.17 }],
    });
    const lines = text.split('\n');
    expect(lines[0]).toBe(
      'G1;input plane const. gain circle;10;12.5;0.5;-120;3;80;0.05;50;0.4;-40;2000000000;',
    );
    expect(lines[1]).toBe(
      'S1;Input plane stability circle;stable outside;1.17;0.5;-120;3;80;0.05;50;0.4;-40;2000000000;',
    );
    expect(lines[2]).toBe('N1;1.5;1;0.4;60;0.3;2000000000;');
    expect(lines[3]).toBe('');
    expect(
      writeAsciiCircles({
        s: null,
        noise: null,
        frequency: 1,
        gain: [],
        noiseDb: [],
        stability: [],
      }),
    ).toBe('');
  });

  it('joins datapoints and circles with a blank line', () => {
    const text = writeAscii(points, {
      s: null,
      noise: { nfMinDb: 1, gammaOpt: polarDeg(0.4, 60), rn: 0.3 },
      frequency: 2e9,
      gain: [],
      noiseDb: [2],
      stability: [],
    });
    expect(text).toContain('\n\nN1;2;1;0.4;60;0.3;2000000000;\n');
    expect(writeAscii(points, null)).toBe(writeAsciiDatapoints(points));
  });
});
