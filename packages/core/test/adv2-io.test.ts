/**
 * Adversary round 2, core: re-run of the round 1 attacks against the fixes,
 * then attacks on the fixes themselves (Touchstone keyword parser and shape
 * check, xmlsc INF reader, buildXmlsc with a disabled datapoint sweep, the
 * engineering-notation parser). A failing test is a defect; see the report.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildXmlsc,
  cabs,
  cargDeg,
  complex,
  evaluateLadder,
  formatDotNetDouble,
  ladderFromXmlsc,
  polarDeg,
  readCiti,
  readTouchstone,
  readXmlsc,
  touchstoneFromCiti,
  tryParseEngineering,
  writeAscii,
  writeXmlsc,
  type Ladder,
} from '../src/index';

const FIXTURES = join(__dirname, 'fixtures');
const load = (...parts: string[]): string => readFileSync(join(FIXTURES, ...parts), 'utf8');
const guid = (): string => '00000000-0000-4000-8000-000000000000';
const base: Ladder = { z0: 50, frequency: 1e9, load: complex(50, 0), elements: [] };

const S = {
  s11: polarDeg(0.5, -120),
  s12: polarDeg(0.05, 50),
  s21: polarDeg(3, 80),
  s22: polarDeg(0.4, -40),
};

describe('adv2: round 1 fixes confirmed', () => {
  it('xmlsc writer spells INF, -INF and NaN the .NET way; the reader refuses them in a load', () => {
    // A transformed point (an open after a quarter-wave stub, say) may carry them.
    const xml = writeXmlsc(
      buildXmlsc(
        { ...base, elements: [{ kind: 'shortStub', z0: 50, length: 0.25, refFrequency: 1e9 }] },
        { guid, qList: [NaN] },
      ),
    );
    expect(xml).toContain('<QList>NaN</QList>');
    const d = readXmlsc(xml);
    expect(d.datapoints).toHaveLength(2);
    // A user datapoint with INF would make the whole design NaN, so it is refused.
    const bad = writeXmlsc(buildXmlsc({ ...base, load: complex(Infinity, -Infinity) }, { guid }));
    expect(bad).toContain('<R>INF</R><X>-INF</X>');
    expect(() => readXmlsc(bad)).toThrow(/Non-finite/);
  });

  it('unilateral device: no stability circles, finite Gmax', () => {
    const d = readXmlsc(
      writeXmlsc(
        buildXmlsc(base, {
          twoPort: { s: { ...S, s12: complex(0, 0) }, noise: null },
          stabilityCircles: true,
          gainCircles: [{ gainType: 1, plane: 1, gainDb: 10 }],
          guid,
        }),
      ),
    );
    expect(d.stabilityCircles).toHaveLength(0);
    expect(Number.isFinite(d.gainCircles[0]!.gmaxDb)).toBe(true);
  });

  it('noise Gamma_opt is magnitude and angle in an RI file', () => {
    const text =
      '# GHZ S RI R 50\n1 0.1 0 2 0 0.05 0 0.2 0\n2 0.1 0 2 0 0.05 0 0.2 0\n1 1.5 0.6 45 0.3\n';
    const d = readTouchstone(text, 2);
    expect(cabs(d.noise[0]!.gammaOpt)).toBeCloseTo(0.6, 12);
    expect(cargDeg(d.noise[0]!.gammaOpt)).toBeCloseTo(45, 12);
  });

  it('ASCII writes an empty cell for a non-finite value', () => {
    const text = writeAscii(
      [{ start: true, label: 'DP1', z: complex(0, 0), frequency: 1e9 }],
      null,
    );
    expect(text).not.toMatch(/NaN|Infinity/);
    expect(text.split('\n')[1]).toBe('true;DP1;0;0;;1000000000');
  });

  it('a .s2p holding one-port rows is refused, wrapped 3 + 6 rows are read', () => {
    expect(() => readTouchstone('# MHZ S MA R 50\n100 0.5 -30\n200 0.4 -40\n', 2)).toThrow(
      /rows hold 1-port/,
    );
    const wrapped = '# MHZ S RI R 50\n100 0.1 0\n0.2 0 0.3 0 0.4 0\n200 0.1 0\n0.2 0 0.3 0 0.4 0\n';
    expect(readTouchstone(wrapped, 2).points).toHaveLength(2);
  });

  it('Touchstone 2 keywords: 12_21 honoured, Lower, mixed-mode and per-port references refused', () => {
    const v2 = (extra: string): string =>
      [
        '[Version] 2.0',
        '# Hz S RI R 50',
        '[Number of Ports] 2',
        extra,
        '[Network Data]',
        '1e9 0.1 0 0.2 0 0.3 0 0.4 0',
        '[End]',
      ].join('\n');
    expect(readTouchstone(v2('[Two-Port Data Order] 12_21'), 2).points[0]!.s[1]!.re).toBeCloseTo(
      0.2,
    );
    expect(readTouchstone(v2('[Two-Port Data Order] 21_12'), 2).points[0]!.s[1]!.re).toBeCloseTo(
      0.3,
    );
    expect(() => readTouchstone(v2('[Matrix Format] Lower'), 2)).toThrow(/Matrix Format/);
    expect(() => readTouchstone(v2('[Mixed-Mode Order] D1,2 C1,2'), 2)).toThrow(/mixed-mode/i);
    expect(() => readTouchstone(v2('[Reference] 50 75'), 2)).toThrow(/per-port/);
  });

  it('CITI: declared arrays without points rejected, header-only package parses', () => {
    const broken = [
      'CITIFILE A.01.00',
      'NAME X',
      'DATA S[1,1] RI',
      'VAR_LIST_BEGIN',
      'VAR_LIST_END',
      'BEGIN',
      'END',
    ].join('\n');
    expect(() => readCiti(broken)).toThrow(/no points/);
    const headerOnly = [
      'CITIFILE A.01.00',
      'NAME X',
      'CITIFILE A.01.00',
      'NAME Y',
      'VAR FREQ MAG 1',
      'DATA S[1,1] RI',
      'VAR_LIST_BEGIN',
      '1e9',
      'VAR_LIST_END',
      'BEGIN',
      '0.1,0',
      'END',
    ].join('\n');
    const pkgs = readCiti(headerOnly);
    expect(pkgs).toHaveLength(2);
    expect(() => touchstoneFromCiti(pkgs[0]!)).toThrow();
    expect(touchstoneFromCiti(pkgs[1]!).points).toHaveLength(1);
  });

  it('formatDotNetDouble writes 0 for -0', () => {
    expect(formatDotNetDouble(-0)).toBe('0');
  });
});

describe('adv2: Touchstone keyword parser', () => {
  const v2 = (lines: string[]): string =>
    [
      '[Version] 2.0',
      '# Hz S RI R 50',
      '[Number of Ports] 2',
      ...lines,
      '[Network Data]',
      '1e9 0.1 0 0.2 0 0.3 0 0.4 0',
      '[End]',
    ].join('\n');

  it('[Reference] with one value is accepted', () => {
    expect(readTouchstone(v2(['[Reference] 50']), 2).points).toHaveLength(1);
  });

  it('lowercase keywords are honoured', () => {
    expect(readTouchstone(v2(['[two-port data order] 12_21']), 2).points[0]!.s[1]!.re).toBeCloseTo(
      0.2,
    );
    expect(() => readTouchstone(v2(['[matrix format] lower']), 2)).toThrow(/Matrix Format/);
  });

  it('[Reference] with its value on the next line (allowed by Touchstone 2) is not read as data', () => {
    // One value for both ports, continued on the next line.
    let d;
    try {
      d = readTouchstone(v2(['[Reference]', '50']), 2);
    } catch (e) {
      // A refusal is acceptable only if it names the reference, not a bogus column count.
      expect((e as Error).message).toMatch(/[Rr]eference/);
      return;
    }
    expect(d.points).toHaveLength(1);
    expect(d.points[0]!.frequency).toBe(1e9);
  });

  it('[Reference] with per-port values on the next line is refused for the right reason', () => {
    expect(() => readTouchstone(v2(['[Reference]', '50 75']), 2)).toThrow(/per-port/);
  });

  it('a keyword after the data is harmless', () => {
    const text = [
      '# Hz S RI R 50',
      '1e9 0.1 0 0.2 0 0.3 0 0.4 0',
      '[End]',
      '[Two-Port Data Order] 21_12',
    ].join('\n');
    expect(readTouchstone(text, 2).points[0]!.s[1]!.re).toBeCloseTo(0.3);
  });

  it('Touchstone 2 noise block: Gamma_opt stays magnitude and angle whatever the option line says (spec 2.0, x3)', () => {
    const text = [
      '[Version] 2.0',
      '# Hz S RI R 50',
      '[Number of Ports] 2',
      '[Number of Frequencies] 1',
      '[Number of Noise Frequencies] 1',
      '[Network Data]',
      '1e9 0.1 0 0.2 0 0.3 0 0.4 0',
      '[Noise Data]',
      '1e9 1.5 0.3 0.3 0.3',
      '[End]',
    ].join('\n');
    const d = readTouchstone(text, 2);
    expect(d.noise).toHaveLength(1);
    expect(cabs(d.noise[0]!.gammaOpt)).toBeCloseTo(0.3, 12);
    expect(cargDeg(d.noise[0]!.gammaOpt)).toBeCloseTo(0.3, 12);
  });

  it('Touchstone 2: rn in the noise block is in ohm, not normalized (spec 2.0, x5 and compatibility notes)', () => {
    const text = [
      '[Version] 2.0',
      '# GHz S MA R 50',
      '[Number of Ports] 2',
      '[Number of Frequencies] 1',
      '[Number of Noise Frequencies] 1',
      '[Network Data]',
      '1 0.5 0 2 0 0.1 0 0.4 0',
      '[Noise Data]',
      '1 1.5 0.6 45 15',
      '[End]',
    ].join('\n');
    const d = readTouchstone(text, 2);
    // 15 ohm against 50 ohm is rn = 0.3; version 1 would read the same number as 15 (750 ohm).
    expect(d.noise[0]!.rn).toBeCloseTo(0.3, 12);
  });

  it('Touchstone 2: a single [Reference] overrides the option line R', () => {
    const d = readTouchstone(v2(['[Reference] 75']), 2);
    expect(d.z0).toBe(75);
  });

  it('Touchstone 2: equal per-port references are a plain reference, not a refusal', () => {
    const d = readTouchstone(v2(['[Reference] 75 75']), 2);
    expect(d.z0).toBe(75);
  });

  it('Touchstone 2 noise block that starts above the last S frequency is refused (illegal in every version)', () => {
    const text = [
      '[Version] 2.0',
      '# Hz S RI R 50',
      '[Number of Ports] 2',
      '[Number of Frequencies] 1',
      '[Number of Noise Frequencies] 1',
      '[Network Data]',
      '1e9 0.1 0 0.2 0 0.3 0 0.4 0',
      '[Noise Data]',
      '2e9 1.5 0.6 0 0.3',
      '[End]',
    ].join('\n');
    // Spec: the first noise frequency shall be at or below the highest network frequency.
    expect(() => readTouchstone(text, 2)).toThrow();
  });
});

describe('adv2: Touchstone shape check', () => {
  it('a two-port written 5 + 4 numbers per point is read', () => {
    const text = '# MHZ S RI R 50\n100 0.1 0 0.3 0\n0.2 0 0.4 0\n200 0.1 0 0.3 0\n0.2 0 0.4 0\n';
    const d = readTouchstone(text, 2);
    expect(d.points).toHaveLength(2);
    expect(d.points[1]!.s[1]!.re).toBeCloseTo(0.2);
  });

  it('a one-port with a comment between rows and a trailing comment', () => {
    const text = '# MHZ S MA R 50\n100 0.5 -30 ! first\n! between\n200 0.4 -40\n';
    expect(readTouchstone(text, 1).points).toHaveLength(2);
  });

  it('a four-port with blank lines between matrix rows', () => {
    const row = (f: string): string =>
      `${f} 0.1 0 0.2 0 0.3 0 0.4 0\n\n0.1 0 0.2 0 0.3 0 0.4 0\n\n0.1 0 0.2 0 0.3 0 0.4 0\n\n0.1 0 0.2 0 0.3 0 0.4 0\n\n`;
    const text = '# GHZ S RI R 50\n' + row('1') + row('2');
    expect(readTouchstone(text, 4).points).toHaveLength(2);
    expect(readTouchstone(text).ports).toBe(4);
  });

  it('a four-port with a single frequency point, name given and inferred', () => {
    const text =
      '# GHZ S RI R 50\n1 0.1 0 0.2 0 0.3 0 0.4 0\n0.1 0 0.2 0 0.3 0 0.4 0\n0.1 0 0.2 0 0.3 0 0.4 0\n0.1 0 0.2 0 0.3 0 0.4 0\n';
    expect(readTouchstone(text, 4).points).toHaveLength(1);
    expect(readTouchstone(text).ports).toBe(4);
  });

  it('a two-port with one point and a noise block is a two-port, not a four-port', () => {
    const text = '# GHZ S MA R 50\n1 0.5 0 2 0 0.1 0 0.4 0\n1 1 0.5 0 0.2\n';
    const d = readTouchstone(text, 2);
    expect(d.points).toHaveLength(1);
    expect(d.noise).toHaveLength(1);
    expect(readTouchstone(text).ports).toBe(2);
  });

  it('a three-port written on one line per point', () => {
    const line = (f: number): string =>
      `${f} ` + Array.from({ length: 18 }, (_, i) => (i % 2 ? '0' : '0.1')).join(' ');
    const text = `# GHZ S RI R 50\n${line(1)}\n${line(2)}\n`;
    expect(readTouchstone(text, 3).points).toHaveLength(2);
  });

  it('a one-port with two points per line (6 numbers) is read', () => {
    const text = '# MHZ S RI R 50\n100 0.1 0 200 0.2 0\n300 0.3 0 400 0.4 0\n';
    expect(readTouchstone(text, 1).points).toHaveLength(4);
  });
});

describe('adv2: xmlsc INF in places the design needs finite', () => {
  const file = (dp: string): string =>
    '<?xml version="1.0" encoding="utf-8"?><CSmithChartDesign>' +
    `<CDatapoint><StartDatapoint>1</StartDatapoint><IsRealDP>1</IsRealDP><IndexOfDP>0</IndexOfDP>${dp}<U>0</U><V>0</V></CDatapoint>` +
    '<CComponent><GUID>x</GUID><Typ>4</Typ><Value>1E-08</Value><Xend>0</Xend><Rend>50</Rend><LineImp>0</LineImp><Xbegin>0</Xbegin><Rbegin>50</Rbegin><Er>0</Er><Alpha>0</Alpha><Lambda>0</Lambda><RValueRLC>0</RValueRLC><LValueRLC>0</LValueRLC><CValueRLC>0</CValueRLC></CComponent>' +
    '</CSmithChartDesign>';

  it('a user datapoint with R = INF is refused or clamped, not evaluated to NaN', () => {
    const xml = file('<Frequency>1000000000</Frequency><R>INF</R><X>0</X>');
    let ladder;
    try {
      ladder = ladderFromXmlsc(readXmlsc(xml));
    } catch {
      return;
    }
    const r = evaluateLadder(ladder);
    expect(Number.isFinite(r.zin.re) || Number.isFinite(r.info[0]!.gammaMag)).toBe(true);
  });

  it('a user datapoint with Frequency = NaN or INF is refused', () => {
    for (const f of ['NaN', 'INF', '-INF']) {
      const xml = file(`<Frequency>${f}</Frequency><R>50</R><X>0</X>`);
      let ladder;
      try {
        ladder = ladderFromXmlsc(readXmlsc(xml));
      } catch {
        continue;
      }
      expect(Number.isFinite(ladder.frequency)).toBe(true);
    }
  });

  it('a component Value of INF is refused', () => {
    const xml = file('<Frequency>1000000000</Frequency><R>50</R><X>0</X>').replace(
      '<Value>1E-08</Value>',
      '<Value>INF</Value>',
    );
    let ladder;
    try {
      ladder = ladderFromXmlsc(readXmlsc(xml));
    } catch {
      return;
    }
    const el = ladder.elements[0] as { value: number };
    expect(Number.isFinite(el.value)).toBe(true);
  });

  it('a sweep record with StepFrequency NaN or INF does not hang or crash', () => {
    const xml = file('<Frequency>1000000000</Frequency><R>50</R><X>0</X>').replace(
      '</CSmithChartDesign>',
      '<CSweepDatapointParameters><Sweeptype>2</Sweeptype><StartFrequency>1E+08</StartFrequency><StopFrequency>1E+09</StopFrequency><StepFrequency>NaN</StepFrequency></CSweepDatapointParameters></CSmithChartDesign>',
    );
    const d = readXmlsc(xml);
    expect(d.sweep?.sweepType).toBe('frequency');
  });
});

describe('adv2: buildXmlsc with a disabled datapoint sweep', () => {
  it('two user datapoints without sweep records read back as two loads and the right start', () => {
    const ladder: Ladder = {
      ...base,
      frequency: 2e9,
      load: complex(30, 10),
      elements: [{ kind: 'L', orientation: 'series', value: 1e-9 }],
    };
    const d = buildXmlsc(ladder, {
      datapointSweep: [{ frequency: 1e9, z: complex(20, -5) }],
      sweepEnabled: false,
      guid,
    });
    expect(d.sweep).toBeUndefined();
    expect(d.sweepDatapoints).toHaveLength(0);
    const back = ladderFromXmlsc(readXmlsc(writeXmlsc(d)));
    expect(back.frequency).toBe(2e9);
    expect(back.load).toEqual(complex(30, 10));
    expect(back.sweepLoads.map((l) => l.frequency)).toEqual([1e9, 2e9]);
  });

  it('a second user datapoint at the design frequency with another impedance keeps the start on the load', () => {
    const ladder: Ladder = { ...base, load: complex(30, 10) };
    const d = buildXmlsc(ladder, {
      datapointSweep: [{ frequency: 1e9, z: complex(20, -5) }],
      sweepEnabled: false,
      guid,
    });
    const back = ladderFromXmlsc(readXmlsc(writeXmlsc(d)));
    expect(back.load).toEqual(complex(30, 10));
  });

  it('a datapoint sweep load equal to the design load in value but another object is not duplicated', () => {
    const ladder: Ladder = { ...base, load: complex(30, 10) };
    const d = buildXmlsc(ladder, {
      datapointSweep: [
        { frequency: 1e9, z: complex(30, 10) },
        { frequency: 2e9, z: complex(1, 1) },
      ],
      guid,
    });
    expect(d.datapoints.filter((p) => p.isReal)).toHaveLength(2);
    expect(d.datapoints.filter((p) => p.isStart)).toHaveLength(1);
  });
});

describe('adv2: engineering-notation parser', () => {
  it('does not turn an overflowing literal into Infinity', () => {
    const p = tryParseEngineering('1e400');
    expect(p === null || Number.isFinite(p.value)).toBe(true);
  });

  it('a value of 1e400 typed into a field cannot reach the design', () => {
    // Mirrors ValueInput: parse, then only `value < min` is refused.
    const p = tryParseEngineering('1e400');
    const accepted = p !== null && !(p.value < 0);
    expect(accepted && !Number.isFinite(p!.value)).toBe(false);
  });
});

describe('adv2: example files survive the writer round trip after the INF change', () => {
  it('every example reads, writes and reads again to the same text', () => {
    for (const name of [
      'Example1.xmlsc',
      'Example13-input.xmlsc',
      'Example15.xmlsc',
      'Example16.xmlsc',
      'Example17.xmlsc',
    ]) {
      const text = load('xmlsc', name);
      const d = readXmlsc(text);
      const out = writeXmlsc({ ...d, qList: d.qListText, vswrList: d.vswrListText });
      expect(out).toBe(text);
    }
  });
});
