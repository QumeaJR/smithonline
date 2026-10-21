import { describe, expect, it } from 'vitest';
import {
  buildXmlsc,
  cabs,
  cargDeg,
  complex,
  impedanceRows,
  ladderFromXmlsc,
  polarDeg,
  readCiti,
  readTouchstone,
  readXmlsc,
  reflectionAt,
  sIndex,
  sweepPoints,
  sweepValues,
  TouchstoneError,
  writeTouchstone,
  writeXmlsc,
  type Ladder,
} from '../src/index';

const guid = (): string => '00000000-0000-4000-8000-000000000000';

// Three-port S(i,j) = 0.ij, written one matrix row per line (7 then 6 then 6 numbers).
const THREE_WRAPPED =
  '# GHZ S RI R 50\n1 0.11 0 0.12 0 0.13 0\n 0.21 0 0.22 0 0.23 0\n 0.31 0 0.32 0 0.33 0\n';
// The same matrix on one line (19 numbers).
const THREE_ONE_LINE =
  '# GHZ S RI R 50\n1 0.11 0 0.12 0 0.13 0 0.21 0 0.22 0 0.23 0 0.31 0 0.32 0 0.33 0\n';
// Four-port, first line 9 numbers, continuation lines 8: S11 = 0.05, S21 = -j0.7, S31 = -0.7, S41 = 0.02.
const FOUR_WRAPPED =
  '# MHZ S RI R 50\n' +
  '900 0.05 0 0 -0.7 -0.7 0 0.02 0\n' +
  '    0 -0.7 0.05 0 0.02 0 -0.7 0\n' +
  '    -0.7 0 0.02 0 0.05 0 0 -0.7\n' +
  '    0.02 0 -0.7 0 0 -0.7 0.05 0\n';

describe('qa2: round 1 fixes hold', () => {
  it('DB writer floors a zero S12 at -400 dB and the reader takes it as 1e-20', () => {
    // 20 log10(0.5) = -6.0206, 20 log10(2) = 6.0206, 20 log10(0.4) = -7.9588; rows are S11 S21 S12 S22.
    const text = writeTouchstone(
      {
        ports: 2,
        z0: 50,
        points: [
          { frequency: 1e9, s: [complex(0.5, 0), complex(0, 0), complex(2, 0), complex(0.4, 0)] },
        ],
      },
      { format: 'DB' },
    );
    expect(text.split('\n')[2]).toBe('1 -6.0205999 0 6.0205999 0 -400 0 -7.9588002 0');
    const back = readTouchstone(text, 2);
    expect(back.points[0]!.s[sIndex(2, 1, 2)]!.re).toBe(1e-20);
  });

  it('writes the noise block as magnitude and angle whatever the S format is', () => {
    for (const format of ['RI', 'DB', 'MA'] as const) {
      const text = writeTouchstone(
        {
          ports: 2,
          z0: 50,
          points: [
            {
              frequency: 1e9,
              s: [complex(0.5, 0), complex(0.1, 0), complex(2, 0), complex(0.4, 0)],
            },
          ],
          noise: [{ frequency: 1e9, nfMinDb: 0.9, gammaOpt: polarDeg(0.55, 50), rn: 0.18 }],
        },
        { format },
      );
      expect(text.trimEnd().split('\n').pop()).toBe('1 0.9 0.55 50 0.18');
      const back = readTouchstone(text, 2);
      expect(cabs(back.noise[0]!.gammaOpt)).toBeCloseTo(0.55, 6);
      expect(cargDeg(back.noise[0]!.gammaOpt)).toBeCloseTo(50, 6);
    }
  });

  it('reads INF, -INF and NaN back from transformed points of a project file', () => {
    const xml =
      '<CSmithChartDesign>' +
      '<CDatapoint><StartDatapoint>0</StartDatapoint><IsRealDP>0</IsRealDP><IndexOfDP>0</IndexOfDP>' +
      '<Frequency>1000000000</Frequency><R>INF</R><X>-INF</X><U>0</U><V>0</V></CDatapoint>' +
      '<CDatapoint><StartDatapoint>0</StartDatapoint><IsRealDP>0</IsRealDP><IndexOfDP>1</IndexOfDP>' +
      '<Frequency>1000000000</Frequency><R>NaN</R><X>0</X><U>0</U><V>0</V></CDatapoint>' +
      '</CSmithChartDesign>';
    const d = readXmlsc(xml);
    expect(d.datapoints[0]!.r).toBe(Infinity);
    expect(d.datapoints[0]!.x).toBe(-Infinity);
    expect(Number.isNaN(d.datapoints[1]!.r)).toBe(true);
    // Round trip keeps the spellings.
    const text = writeXmlsc({ ...d, qList: d.qListText, vswrList: d.vswrListText });
    expect(text).toContain('<R>INF</R><X>-INF</X>');
    expect(text).toContain('<R>NaN</R>');
  });

  it('CITI keywords followed by tabs still declare the count and the arrays', () => {
    const [p] = readCiti(
      'CITIFILE\tA.01.00\nNAME\tDATA\nVAR\tFREQ\tMAG\t2\nDATA\tS[1,1]\tRI\nVAR_LIST_BEGIN\n1e9\n2e9\nVAR_LIST_END\nBEGIN\n0.5,0\n0.25,0\nEND\n',
    );
    expect(p!.name).toBe('DATA');
    expect(p!.variableValues).toEqual([1e9, 2e9]);
    expect(p!.arrays[0]!.name).toBe('S[1,1]');
    expect(p!.arrays[0]!.values[1]).toEqual({ re: 0.25, im: 0 });
  });
});

describe('qa2: Touchstone row shape against the file name', () => {
  it('accepts a four-port whose continuation lines hold 8 numbers', () => {
    for (const ports of [4, null]) {
      const d = readTouchstone(FOUR_WRAPPED, ports);
      expect(d.ports).toBe(4);
      expect(d.points).toHaveLength(1);
      expect(d.points[0]!.frequency).toBe(900e6);
      expect(d.points[0]!.s[sIndex(4, 1, 1)]).toEqual({ re: 0.05, im: 0 });
      expect(d.points[0]!.s[sIndex(4, 1, 2)]).toEqual({ re: 0, im: -0.7 });
      expect(d.points[0]!.s[sIndex(4, 4, 1)]).toEqual({ re: 0.02, im: 0 });
      expect(d.points[0]!.s[sIndex(4, 4, 4)]).toEqual({ re: 0.05, im: 0 });
    }
  });

  it('accepts a three-port written on one line, named or inferred', () => {
    for (const ports of [3, null]) {
      const d = readTouchstone(THREE_ONE_LINE, ports);
      expect(d.ports).toBe(3);
      expect(d.points[0]!.s[sIndex(3, 2, 2)]).toEqual({ re: 0.22, im: 0 });
      expect(d.points[0]!.s[sIndex(3, 2, 3)]).toEqual({ re: 0.23, im: 0 });
      expect(d.points[0]!.s[sIndex(3, 3, 1)]).toEqual({ re: 0.31, im: 0 });
    }
    expect(readTouchstone(THREE_WRAPPED, 3).points[0]!.s).toEqual(
      readTouchstone(THREE_ONE_LINE, 3).points[0]!.s,
    );
  });

  it('refuses three-port rows under a .s2p or .s4p name and two-port rows under .s1p', () => {
    expect(() => readTouchstone(THREE_WRAPPED, 2)).toThrow(/says 2 ports.*3-port/);
    expect(() => readTouchstone(THREE_WRAPPED, 4)).toThrow(/says 4 ports.*3-port/);
    expect(() => readTouchstone('# GHZ S RI R 50\n1 0.1 0 0.3 0 0.2 0 0.4 0\n', 1)).toThrow(
      /says 1 ports.*2-port/,
    );
    expect(() => readTouchstone(FOUR_WRAPPED, 2)).toThrow(TouchstoneError);
  });

  it('keeps a two-port point wrapped as 3 plus 6 numbers and a frequency on its own line', () => {
    const d = readTouchstone(
      '# GHZ S RI R 50\n1 0.1 0\n0.3 0 0.2 0 0.4 0\n2 0.1 0\n0.3 0 0.2 0 0.4 0\n',
      2,
    );
    expect(d.points).toHaveLength(2);
    expect(d.points[1]!.s[sIndex(2, 2, 1)]).toEqual({ re: 0.3, im: 0 });
    const four = readTouchstone(
      '# GHZ S RI R 50\n1\n0 0 0 0 0 0 0 0\n0 0 0 0 0 0 0 0\n0 0 0 0 0 0 0 0\n0 0 0 0 0 0 0 0\n',
      4,
    );
    expect(four.points).toHaveLength(1);
  });
});

describe('qa2: Touchstone 2 keywords', () => {
  const v2 = (keywords: string, rows: string): string =>
    `[Version] 2.0\n# GHz S RI R 50\n${keywords}\n[Network Data]\n${rows}[End]\n`;

  it('honours 21_12 as the default order and Full matrices', () => {
    const d = readTouchstone(
      v2(
        '[Number of Ports] 2\n[Two-Port Data Order] 21_12\n[Matrix Format] Full',
        '1 0.1 0 0.3 0 0.2 0 0.4 0\n',
      ),
      2,
    );
    expect(d.points[0]!.s[sIndex(2, 2, 1)]).toEqual({ re: 0.3, im: 0 });
    expect(d.points[0]!.s[sIndex(2, 1, 2)]).toEqual({ re: 0.2, im: 0 });
    expect(() =>
      readTouchstone(v2('[Number of Ports] 2\n[Matrix Format] Lower', '1 0.1 0 0.3 0 0.4 0\n'), 2),
    ).toThrow(/Matrix Format/);
  });

  it('accepts [Reference] with one equal value per port, as the format requires', () => {
    // Touchstone 2 lists one reference per port; equal values are the common case.
    const d = readTouchstone(
      v2('[Number of Ports] 2\n[Reference] 50 50', '1 0.1 0 0.3 0 0.2 0 0.4 0\n'),
      2,
    );
    expect(d.z0).toBe(50);
    expect(d.points).toHaveLength(1);
  });

  it('takes a single-port [Reference] as the reference impedance', () => {
    const d = readTouchstone(v2('[Number of Ports] 1\n[Reference] 75', '1 0.1 0\n'), 1);
    expect(d.z0).toBe(75);
  });

  it('reads [Reference] values given on the following line', () => {
    const d = readTouchstone(v2('[Number of Ports] 1\n[Reference]\n75', '1 0.1 0\n2 0.2 0\n'), 1);
    expect(d.points.map((p) => p.frequency)).toEqual([1e9, 2e9]);
    expect(d.z0).toBe(75);
  });
});

describe('qa2: Touchstone lookup helpers', () => {
  it('reflectionAt on a single-point file returns that point at any frequency and port', () => {
    const d = readTouchstone('# MHZ S RI R 50\n100 0.1 0 0.3 0 0.2 0 0.4 0\n', 2);
    expect(reflectionAt(d, 1e6)).toEqual({ re: 0.1, im: 0 });
    expect(reflectionAt(d, 100e6, 2)).toEqual({ re: 0.4, im: 0 });
    expect(reflectionAt(d, 1e12, 2)).toEqual({ re: 0.4, im: 0 });
  });

  it('impedanceRows for ports 2 and 3 of a three-port', () => {
    // Gamma 0.22 against 50 ohm is 50 (1.22 / 0.78) = 78.2051 ohm; Gamma 0.33 is 50 (1.33 / 0.67) = 99.2537 ohm.
    const d = readTouchstone(THREE_WRAPPED, 3);
    expect(impedanceRows(d, 2)[0]!.z.re).toBeCloseTo(78.2051282, 6);
    expect(impedanceRows(d, 2)[0]!.z.im).toBeCloseTo(0, 12);
    expect(impedanceRows(d, 3)[0]!.z.re).toBeCloseTo(99.2537313, 6);
    expect(impedanceRows(d, 1)[0]!.z.re).toBeCloseTo(50 * (1.11 / 0.89), 6);
  });

  it('impedanceRows for a port the file does not have does not crash with a TypeError', () => {
    const one = readTouchstone('# GHZ S RI R 50\n1 0.5 0\n', 1);
    expect(() => impedanceRows(one, 2)).not.toThrow(TypeError);
  });

  it('refuses negative frequencies like it refuses descending ones', () => {
    expect(() => readTouchstone('# HZ S RI R 50\n-5 0.5 0\n1 0.4 0\n', 1)).toThrow(TouchstoneError);
  });
});

describe('qa2: Touchstone writer with non-finite values', () => {
  it('either refuses a NaN or infinite parameter or writes a file its own reader accepts', () => {
    for (const v of [complex(NaN, 0), complex(Infinity, 0)]) {
      let text = '';
      try {
        text = writeTouchstone(
          { ports: 1, z0: 50, points: [{ frequency: 1e9, s: [v] }] },
          { format: 'RI' },
        );
      } catch (e) {
        expect(e).toBeInstanceOf(TouchstoneError);
        continue;
      }
      expect(() => readTouchstone(text, 1)).not.toThrow();
    }
  });
});

describe('qa2: buildXmlsc with the sweep switched off', () => {
  const ladder: Ladder = {
    z0: 50,
    frequency: 1e9,
    load: complex(50, 0),
    elements: [{ kind: 'L', orientation: 'series', value: 5e-9 }],
  };
  const loads = [
    { frequency: 1e8, z: complex(100, 0) },
    { frequency: 3e8, z: complex(25, -25) },
  ];

  it('stores the user datapoints with the start mark but no sweep records', () => {
    const d = buildXmlsc(ladder, { datapointSweep: loads, sweepEnabled: false, guid });
    expect(d.sweep).toBeUndefined();
    expect(d.sweepDatapoints).toEqual([]);
    expect(d.datapoints.map((p) => [p.index, p.isReal, p.isStart, p.frequency, p.r])).toEqual([
      [0, true, false, 1e8, 100],
      [1, true, false, 3e8, 25],
      [2, true, true, 1e9, 50],
      [3, false, false, 1e9, 50],
    ]);
    // Series 5 nH at 1 GHz: X = 2 pi 1e9 5e-9 = 31.4159 ohm.
    expect(d.datapoints[3]!.x).toBeCloseTo(10 * Math.PI, 9);
  });

  it('reads back through readXmlsc and ladderFromXmlsc as the same ladder and loads', () => {
    const text = writeXmlsc(
      buildXmlsc(ladder, { datapointSweep: loads, sweepEnabled: false, guid }),
    );
    const parsed = readXmlsc(text);
    expect(parsed.sweep).toBeUndefined();
    expect(parsed.sweepDatapoints).toEqual([]);
    const back = ladderFromXmlsc(parsed);
    expect(back.frequency).toBe(1e9);
    expect(back.load).toEqual({ re: 50, im: 0 });
    expect(back.sweepLoads).toEqual([
      { frequency: 1e8, z: { re: 100, im: 0 } },
      { frequency: 3e8, z: { re: 25, im: -25 } },
      { frequency: 1e9, z: { re: 50, im: 0 } },
    ]);
    expect(back.elements).toEqual([{ kind: 'L', orientation: 'series', value: 5e-9 }]);
    // Writing the read-back design again reproduces the file.
    expect(writeXmlsc({ ...parsed, qList: parsed.qListText, vswrList: parsed.vswrListText })).toBe(
      text,
    );
  });

  it('sweepEnabled true writes one sweep record per user datapoint, start included', () => {
    const d = buildXmlsc(ladder, { datapointSweep: loads, sweepEnabled: true, guid });
    expect(d.sweep).toEqual({
      sweepType: 'datapoint',
      startFrequency: 1e8,
      stopFrequency: 1e9,
      stepFrequency: 9e8,
    });
    expect(d.sweepDatapoints.map((p) => p.frequency)).toEqual([1e8, 3e8, 1e9]);
    // 100 ohm through 5 nH at 100 MHz: X = 2 pi 1e8 5e-9 = 3.14159 ohm.
    expect(d.sweepDatapoints[0]!.r).toBeCloseTo(100, 9);
    expect(d.sweepDatapoints[0]!.x).toBeCloseTo(Math.PI, 9);
  });
});

describe('qa2: frequency sweep records at the limits', () => {
  const base: Ladder = { z0: 50, frequency: 1e9, load: complex(50, 0), elements: [] };

  it('a sweep with start equal to stop still comes back with at least two points', () => {
    // The app saves sweepPoints(start, stop, points); with start = stop the step is 0 and
    // sweepValues cannot recover the count, so the reader must fall back to a usable number.
    const d = readXmlsc(
      writeXmlsc(buildXmlsc(base, { frequencySweep: sweepPoints(1e9, 1e9, 5), guid })),
    );
    expect(d.sweepDatapoints).toHaveLength(5);
    // The record cannot carry a point count without a step; designFromXmlsc restores two points.
    expect(Number.isFinite(d.sweep!.stepFrequency)).toBe(true);
    expect(sweepValues(d.sweep!.startFrequency, d.sweep!.stopFrequency, 1)).toEqual([1e9]);
  });

  it('keeps several user datapoints next to a frequency sweep', () => {
    const d = buildXmlsc(base, {
      frequencySweep: [1e9, 2e9],
      datapointSweep: [{ frequency: 2e9, z: complex(20, 10) }],
      guid,
    });
    expect(d.datapoints.filter((p) => p.isReal)).toHaveLength(2);
    expect(d.sweep?.sweepType).toBe('frequency');
    const back = ladderFromXmlsc(readXmlsc(writeXmlsc(d)));
    expect(back.sweepLoads).toHaveLength(2);
  });
});
