/**
 * Adversarial tests for the file-format package (readers, writers, number
 * format). Each test states the behaviour a user would expect; a failing test
 * is a defect, see the adversary report.
 *
 * Lives under the session worktree directory; the sources are imported from
 * the repository checkout. Run from packages/core with
 *   npx vitest run --dir <this directory>
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildXmlsc,
  cabs,
  complex,
  formatDotNetDouble,
  polarDeg,
  readCiti,
  readEznec,
  readTouchstone,
  readXmlsc,
  touchstoneFromCiti,
  writeAscii,
  writeNetlist,
  writeTouchstone,
  writeXmlsc,
  type Ladder,
} from '../src/index';

const FIXTURES = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  'packages',
  'core',
  'test',
  'fixtures',
  'sparams',
);
const load = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

describe('adv: Touchstone reader', () => {
  it('DB files round-trip the noise block magnitude through the writer', () => {
    const d = readTouchstone(load('amp-synthetic.s2p'), 2);
    const text = writeTouchstone(d, { format: 'DB' });
    const back = readTouchstone(text, 2);
    expect(cabs(back.noise[2]!.gammaOpt)).toBeCloseTo(cabs(d.noise[2]!.gammaOpt), 6);
  });

  it('a row with a trailing comma is rejected as not a number, not read as a zero', () => {
    const text = '# MHZ S MA R 50\n100, 0.5, -30,\n200, 0.4, -40,\n300, 0.3, -50,\n';
    let d;
    try {
      d = readTouchstone(text, 1);
    } catch (e) {
      // Any error is acceptable as long as it names the problem.
      expect((e as Error).message).toMatch(/number|column|comma/i);
      return;
    }
    expect(d.points.every((p) => p.frequency > 0)).toBe(true);
  });

  it('a Touchstone v2 file with 12_21 order is refused or read in that order', () => {
    const text = [
      '[Version] 2.0',
      '# Hz S RI R 50',
      '[Number of Ports] 2',
      '[Two-Port Data Order] 12_21',
      '[Number of Frequencies] 1',
      '[Network Data]',
      '1e9 0.1 0 0.2 0 0.3 0 0.4 0',
      '[End]',
    ].join('\n');
    let d;
    try {
      d = readTouchstone(text, 2);
    } catch {
      return;
    }
    // In 12_21 order the second pair is S12 = 0.2.
    expect(d.points[0]!.s[1]!.re).toBeCloseTo(0.2, 12);
  });

  it('a .s2p holding one-port rows is refused instead of read as garbage', () => {
    const text = '# MHZ S MA R 50\n100 0.5 -30\n200 0.4 -40\n300 0.3 -50\n';
    expect(() => readTouchstone(text, 2)).toThrow();
  });

  it('a noise block whose first frequency exceeds the last S-parameter frequency', () => {
    // Forbidden by the spec; here to document what happens.
    const s = '# GHZ S MA R 50\n1 0.5 0 2 0 0.1 0 0.4 0\n';
    const noise = Array.from({ length: 9 }, (_, i) => `${2 + i} 1 0.5 0 0.2`).join('\n');
    let d;
    try {
      d = readTouchstone(s + noise + '\n', 2);
    } catch {
      return;
    }
    expect(d.points).toHaveLength(1);
  });

  it('a Z-parameter file is not read as S-parameters', () => {
    const d = readTouchstone('# MHZ Z RI R 50\n100 75 0\n200 75 0\n', 1);
    expect(d.parameter).toBe('Z');
  });

  it('survives BOM, CR endings, tabs, +1 and .5 numbers', () => {
    const d = readTouchstone('﻿# MHZ S RI R 50\r100\t+.5\t-.25\r200\t.4\t+0.1\r', 1);
    expect(d.points).toHaveLength(2);
    expect(d.points[0]!.s[0]!.re).toBe(0.5);
  });

  it('equal frequencies do not divide by zero in the lookup', () => {
    const d = readTouchstone('# MHZ S RI R 50\n100 0.5 0\n100 0.4 0\n', 1);
    expect(d.points).toHaveLength(2);
  });
});

describe('adv: CITI and EZNEC', () => {
  it('a CITI package with an empty variable list is rejected, not imported as zero points', () => {
    const text = [
      'CITIFILE A.01.00',
      'NAME DATA',
      'VAR FREQ MAG 0',
      'DATA S[1,1] RI',
      'DATA S[2,1] RI',
      'VAR_LIST_BEGIN',
      'VAR_LIST_END',
      'BEGIN',
      'END',
      'BEGIN',
      'END',
    ].join('\n');
    let pkgs;
    try {
      pkgs = readCiti(text);
    } catch {
      return;
    }
    const d = touchstoneFromCiti(pkgs[0]!);
    expect(d.points.length).toBeGreaterThan(0);
  });

  it('a tab-separated VAR line still sets the declared count', () => {
    const text = [
      'CITIFILE A.01.00',
      'NAME DATA',
      'VAR\tFREQ\tMAG\t2',
      'DATA S[1,1] RI',
      'VAR_LIST_BEGIN',
      '1e9',
      '2e9',
      '3e9',
      'VAR_LIST_END',
      'BEGIN',
      '0.1,0',
      '0.2,0',
      '0.3,0',
      'END',
    ].join('\n');
    // VAR says 2 points, the list holds 3: the reader should notice.
    expect(() => readCiti(text)).toThrow(/declares 2/);
  });

  it('EZNEC rows with an empty cell are rejected, not read as 0 ohm', () => {
    const text = '"Freq MHz","Src #","R","X","SWR (50 ohms)","SWR (alt. Z0)"\n14,1,,-40,2,1\n';
    expect(() => readEznec(text)).toThrow();
  });
});

describe('adv: xmlsc writer', () => {
  const guid = (): string => '00000000-0000-4000-8000-000000000000';
  const base: Ladder = { z0: 50, frequency: 1e9, load: complex(50, 0), elements: [] };

  it('a unilateral device (S12 = 0) with stability circles gives a file the reader accepts', () => {
    const s = {
      s11: polarDeg(0.5, -120),
      s12: complex(0, 0),
      s21: polarDeg(3, 80),
      s22: polarDeg(0.4, -40),
    };
    const text = writeXmlsc(
      buildXmlsc(base, {
        twoPort: { s, noise: null },
        stabilityCircles: true,
        gainCircles: [{ gainType: 1, plane: 1, gainDb: 10 }],
        guid,
      }),
    );
    expect(text).not.toMatch(/Infinity|NaN/);
    expect(() => readXmlsc(text)).not.toThrow();
  });

  it('write-read-write is stable for extreme element values', () => {
    const ladder: Ladder = {
      z0: 50,
      frequency: 1e9,
      load: complex(-10, 1e-30),
      elements: [
        { kind: 'L', orientation: 'series', value: 1e-30 },
        { kind: 'C', orientation: 'shunt', value: 1e30 },
        { kind: 'line', z0: 1e-3, length: 0, refFrequency: 1e9 },
        { kind: 'shortStub', z0: 50, length: 0, refFrequency: 1e9 },
        { kind: 'openStub', z0: 50, length: 0.25, refFrequency: 1e9 },
      ],
    };
    const first = writeXmlsc(buildXmlsc(ladder, { guid }));
    const d = readXmlsc(first);
    const second = writeXmlsc({ ...d, qList: d.qListText, vswrList: d.vswrListText });
    expect(second).toBe(first);
  });

  it('a frequency sweep given high to low keeps start below stop', () => {
    const d = readXmlsc(writeXmlsc(buildXmlsc(base, { frequencySweep: [3e9, 2e9, 1e9], guid })));
    expect(d.sweep!.startFrequency).toBeLessThan(d.sweep!.stopFrequency);
    expect(d.sweep!.stepFrequency).toBeGreaterThan(0);
  });
});

describe('adv: formatDotNetDouble', () => {
  it('round-trips through Number for random doubles of every magnitude', () => {
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let i = 0; i < 200000; i++) {
      const exp = Math.floor(rnd() * 640) - 320;
      const v = (rnd() - 0.5) * 10 ** exp;
      if (!Number.isFinite(v)) continue;
      const t = formatDotNetDouble(v);
      expect(Number(t)).toBe(v);
      expect(t).toMatch(/^-?(\d+(\.\d+)?|\d(\.\d+)?E[+-]\d{2,3})$/);
    }
  });

  it('handles the limits', () => {
    expect(Number(formatDotNetDouble(Number.MAX_VALUE))).toBe(Number.MAX_VALUE);
    expect(Number(formatDotNetDouble(Number.MIN_VALUE))).toBe(Number.MIN_VALUE);
    expect(Number(formatDotNetDouble(-Number.MAX_VALUE))).toBe(-Number.MAX_VALUE);
    expect(formatDotNetDouble(1e21)).toBe('1E+21');
    // .NET Framework prints 17 digits here (no shorter string round-trips); .NET Core would print 999999999999999.9.
    expect(formatDotNetDouble(9.999999999999999e14)).toBe('999999999999999.88');
  });
});

describe('adv: netlist and ASCII writers', () => {
  it('the netlist never carries NaN or Infinity for a line with er = 0 or f = 0', () => {
    const ladder: Ladder = {
      z0: 50,
      frequency: 1e9,
      load: complex(50, 0),
      elements: [{ kind: 'line', z0: 50, length: 0.1, refFrequency: 1e9, er: 0 }],
    };
    expect(writeNetlist(ladder)).not.toMatch(/NaN|Infinity/);
    const zero: Ladder = {
      ...ladder,
      frequency: 0,
      elements: [{ kind: 'line', z0: 50, length: 0.1 }],
    };
    expect(writeNetlist(zero)).not.toMatch(/NaN|Infinity/);
  });

  it('the ASCII export of a short-circuit load has a numeric Q column', () => {
    const text = writeAscii(
      [{ start: true, label: 'DP1', z: complex(0, 0), frequency: 1e9 }],
      null,
    );
    expect(text).not.toMatch(/NaN|Infinity/);
  });

  it('the ASCII circles of a unilateral device carry numbers only', () => {
    const s = {
      s11: polarDeg(0.5, -120),
      s12: complex(0, 0),
      s21: polarDeg(3, 80),
      s22: polarDeg(0.4, -40),
    };
    const text = writeAscii([], {
      s,
      noise: null,
      frequency: 1e9,
      gain: [{ plane: 1, gainDb: 10, gmaxDb: 12 }],
      noiseDb: [],
      stability: [{ plane: 1, stableInside: true, k: 1 / 0 }],
    });
    expect(text).not.toMatch(/NaN|Infinity/);
  });

  it('netlist values are written with the requested digits even for 1e-30 and 1e30', () => {
    const ladder: Ladder = {
      z0: 50,
      frequency: 1e9,
      load: complex(50, 0),
      elements: [
        { kind: 'L', orientation: 'series', value: 1e-30 },
        { kind: 'C', orientation: 'shunt', value: 1e30 },
        { kind: 'R', orientation: 'series', value: -5 },
      ],
    };
    const text = writeNetlist(ladder);
    expect(text).toContain('L=1e-21');
    expect(text).toContain('C=1e+42');
    expect(text).toContain('R=-5');
  });
});
