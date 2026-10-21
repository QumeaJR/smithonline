/**
 * Adversary round 3, core: re-run of the round 2 attacks against the fixes,
 * then attacks on the fixes themselves (the Touchstone [Reference] parser,
 * the [Version] rule, the xmlsc finite guards). A failing test is a defect;
 * see the report. Tests marked "observe" record behaviour for the report and
 * assert only what a user would notice.
 */
import { describe, expect, it } from 'vitest';
import {
  buildXmlsc,
  complex,
  evaluateLadder,
  ladderFromXmlsc,
  readTouchstone,
  readXmlsc,
  tryParseEngineering,
  writeXmlsc,
  type Ladder,
} from '../src/index';

const guid = (): string => '00000000-0000-4000-8000-000000000000';
const base: Ladder = { z0: 50, frequency: 1e9, load: complex(50, 0), elements: [] };

const v2 = (lines: string[], data = '1e9 0.1 0 0.2 0 0.3 0 0.4 0', ports = 2): string =>
  [
    '[Version] 2.0',
    '# Hz S RI R 50',
    `[Number of Ports] ${ports}`,
    ...lines,
    '[Network Data]',
    data,
    '[End]',
  ].join('\n');

const noisy = (head: string[]): string =>
  [
    ...head,
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

describe('adv3: round 2 fixes confirmed', () => {
  it('[Reference] 75 sets z0, equal per-port values too, unequal ones are refused', () => {
    expect(readTouchstone(v2(['[Reference] 75']), 2).z0).toBe(75);
    expect(readTouchstone(v2(['[Reference] 75 75']), 2).z0).toBe(75);
    expect(() => readTouchstone(v2(['[Reference] 50 75']), 2)).toThrow(/per-port/);
  });

  it('[Reference] with its values on the next line is read, not taken as data', () => {
    const d = readTouchstone(v2(['[Reference]', '75 75']), 2);
    expect(d.z0).toBe(75);
    expect(d.points).toHaveLength(1);
    expect(d.points[0]!.frequency).toBe(1e9);
  });

  it('rn is in ohm only when a [Version] keyword was seen', () => {
    expect(readTouchstone(noisy(['[Version] 2.0']), 2).noise[0]!.rn).toBeCloseTo(0.3, 12);
    const v1 = '# GHz S MA R 50\n1 0.5 0 2 0 0.1 0 0.4 0\n1 1.5 0.6 45 15\n';
    expect(readTouchstone(v1, 2).noise[0]!.rn).toBe(15);
  });

  it('rn in a version 2 file is divided by the [Reference] value, not the option line R', () => {
    const text = noisy(['[Version] 2.0']).replace(
      '[Number of Ports] 2',
      '[Number of Ports] 2\n[Reference] 75',
    );
    expect(readTouchstone(text, 2).noise[0]!.rn).toBeCloseTo(15 / 75, 12);
  });

  it('tryParseEngineering refuses an overflowing literal', () => {
    expect(tryParseEngineering('1e400')).toBeNull();
    expect(tryParseEngineering('1e308')?.value).toBe(1e308);
  });

  it('INF in a user datapoint and in an element value is refused by the reader', () => {
    const bad = writeXmlsc(buildXmlsc({ ...base, load: complex(Infinity, 0) }, { guid }));
    expect(() => readXmlsc(bad)).toThrow(/Non-finite/);
    const el = writeXmlsc(
      buildXmlsc(
        { ...base, elements: [{ kind: 'L', orientation: 'series', value: Infinity }] },
        { guid },
      ),
    );
    expect(el).toContain('<Value>INF</Value>');
    expect(() => readXmlsc(el)).toThrow(/Non-finite/);
  });
});

describe('adv3: Touchstone [Reference] parser', () => {
  it('values split across two lines, one per line (2-port)', () => {
    // Touchstone 2: the per-port references may continue on the following lines.
    let d;
    try {
      d = readTouchstone(v2(['[Reference]', '75', '75']), 2);
    } catch (e) {
      // A refusal is acceptable only when it names the reference.
      expect((e as Error).message, (e as Error).message).toMatch(/[Rr]eference/);
      return;
    }
    expect(d.z0).toBe(75);
    expect(d.points).toHaveLength(1);
  });

  it('first value on the keyword line, the second on the next line (2-port)', () => {
    let d;
    try {
      d = readTouchstone(v2(['[Reference] 75', '75']), 2);
    } catch (e) {
      expect((e as Error).message, (e as Error).message).toMatch(/[Rr]eference/);
      return;
    }
    expect(d.z0).toBe(75);
    expect(d.points).toHaveLength(1);
  });

  it('4-port references two per line', () => {
    const row = '0.1 0 0.2 0 0.3 0 0.4 0';
    const data = `1e9 ${row}\n${row}\n${row}\n${row}`;
    let d;
    try {
      d = readTouchstone(v2(['[Reference]', '50 50', '50 50'], data, 4), 4);
    } catch (e) {
      expect((e as Error).message, (e as Error).message).toMatch(/[Rr]eference/);
      return;
    }
    expect(d.points).toHaveLength(1);
  });

  it('[Reference] after the data still applies (illegal placement, harmless) and does not eat rows', () => {
    const text = [
      '[Version] 2.0',
      '# Hz S RI R 50',
      '[Number of Ports] 2',
      '[Network Data]',
      '1e9 0.1 0 0.2 0 0.3 0 0.4 0',
      '[Reference] 75',
      '[End]',
    ].join('\n');
    const d = readTouchstone(text, 2);
    expect(d.points).toHaveLength(1);
    expect(d.z0).toBe(75);
  });

  it('[Reference] with 0, negative, NaN, overflow or a mix is refused as an invalid reference', () => {
    for (const r of ['0', '-50', 'NaN', '1e400', '50 0', 'INF', 'abc']) {
      expect(() => readTouchstone(v2([`[Reference] ${r}`]), 2), r).toThrow(/Invalid \[Reference\]/);
    }
  });

  it('[Reference] without values followed directly by [Network Data]: refusal names the reference', () => {
    // The file is illegal (no values); the first data row must not be read as references.
    let d;
    try {
      d = readTouchstone(v2(['[Reference]']), 2);
    } catch (e) {
      expect((e as Error).message, (e as Error).message).toMatch(/[Rr]eference/);
      return;
    }
    expect(d.points).toHaveLength(1);
  });

  it('[Version] 1.0 (observe): is rn treated as ohm?', () => {
    // No such version exists in the Touchstone 2 spec; a reader may treat it as version 1.
    const d = readTouchstone(noisy(['[Version] 1.0']), 2);
    // Record the behaviour: version-2 rule (0.3) or version-1 rule (15).
    expect([0.3, 15]).toContainEqual(Number(d.noise[0]!.rn.toPrecision(12)));
  });

  it('[Version] 2.0 after the option line and after the data: rn rule still applies', () => {
    const text = noisy([]).replace('[End]', '[Version] 2.0\n[End]');
    expect(readTouchstone(text, 2).noise[0]!.rn).toBeCloseTo(0.3, 12);
  });

  it('[Reference] with a trailing comment and tabs', () => {
    expect(readTouchstone(v2(['[Reference]\t75\t75 ! ohm']), 2).z0).toBe(75);
  });

  it('[Reference] followed by a comment line and a blank line, then the value', () => {
    expect(readTouchstone(v2(['[Reference]', '! the reference', '', '75']), 2).z0).toBe(75);
  });

  it('two [Reference] keywords: the last wins', () => {
    expect(readTouchstone(v2(['[Reference] 60', '[Reference] 75']), 2).z0).toBe(75);
  });

  it('a Touchstone 2 [Begin Information] block (free text) is not refused as data', () => {
    const text = v2([
      '[Begin Information]',
      'Manufacturer: ACME',
      'Date 2026-10-21',
      '[End Information]',
    ]);
    let d;
    try {
      d = readTouchstone(text, 2);
    } catch (e) {
      expect((e as Error).message, (e as Error).message).toMatch(/[Ii]nformation/);
      return;
    }
    expect(d.points).toHaveLength(1);
  });

  it('[Reference] on a one-port with a single value', () => {
    expect(readTouchstone(v2(['[Reference] 75'], '1e9 0.5 0', 1), 1).z0).toBe(75);
  });
});

const file = (dp: string, comp = ''): string =>
  '<?xml version="1.0" encoding="utf-8"?><CSmithChartDesign>' +
  `<CDatapoint><StartDatapoint>1</StartDatapoint><IsRealDP>1</IsRealDP><IndexOfDP>0</IndexOfDP>${dp}<U>0</U><V>0</V></CDatapoint>` +
  (comp ||
    '<CComponent><GUID>x</GUID><Typ>4</Typ><Value>1E-08</Value><Xend>0</Xend><Rend>50</Rend><LineImp>0</LineImp><Xbegin>0</Xbegin><Rbegin>50</Rbegin><Er>0</Er><Alpha>0</Alpha><Lambda>0</Lambda><RValueRLC>0</RValueRLC><LValueRLC>0</LValueRLC><CValueRLC>0</CValueRLC></CComponent>') +
  '</CSmithChartDesign>';
const DP = '<Frequency>1000000000</Frequency><R>50</R><X>0</X>';
const line = (fields: string): string =>
  `<CComponent><GUID>x</GUID><Typ>8</Typ><Value>0.1</Value><Xend>0</Xend><Rend>50</Rend><LineImp>50</LineImp><Xbegin>0</Xbegin><Rbegin>50</Rbegin><Er>1</Er><Alpha>0</Alpha><Lambda>0</Lambda><RValueRLC>0</RValueRLC><LValueRLC>0</LValueRLC><CValueRLC>0</CValueRLC></CComponent>`.replace(
    /<(LineImp|Er|Alpha|Rbegin|Rend|Xbegin|Xend|Lambda)>[^<]*<\/\1>/g,
    (m, tag: string) => {
      const re = new RegExp(`<${tag}>([^<]*)</${tag}>`);
      const o = re.exec(fields);
      return o ? o[0] : m;
    },
  );

describe('adv3: xmlsc finite guards', () => {
  it('INF in Rbegin of a component: the design still evaluates finite (the field is unused)', () => {
    const xml = file(DP, line('<Rbegin>INF</Rbegin>'));
    const ladder = ladderFromXmlsc(readXmlsc(xml));
    const r = evaluateLadder(ladder);
    expect(Number.isFinite(r.zin.re)).toBe(true);
  });

  it('NaN in a QList: the list entry parses as NaN and is left to the caller', () => {
    const xml = file(DP).replace(
      '</CSmithChartDesign>',
      '<QList>NaN</QList><QList>1</QList></CSmithChartDesign>',
    );
    const d = readXmlsc(xml);
    expect(d.qList).toHaveLength(2);
    expect(Number.isNaN(d.qList[0])).toBe(true);
  });

  it('INF in a CSweepDatapoint: opens, the sweep record is not used for the design', () => {
    const xml = file(DP).replace(
      '</CSmithChartDesign>',
      '<CSweepDatapoint><StartDatapoint>0</StartDatapoint><IsRealDP>0</IsRealDP><IndexOfDP>0</IndexOfDP><Frequency>INF</Frequency><R>INF</R><X>NaN</X><U>0</U><V>0</V></CSweepDatapoint></CSmithChartDesign>',
    );
    const d = readXmlsc(xml);
    expect(d.sweepDatapoints).toHaveLength(1);
    const r = evaluateLadder(ladderFromXmlsc(d));
    expect(Number.isFinite(r.zin.re)).toBe(true);
  });

  it('INF in a CSweepDatapoint marked IsRealDP 1 is refused like a user datapoint', () => {
    const xml = file(DP).replace(
      '</CSmithChartDesign>',
      '<CSweepDatapoint><StartDatapoint>0</StartDatapoint><IsRealDP>1</IsRealDP><IndexOfDP>0</IndexOfDP><Frequency>1E+09</Frequency><R>INF</R><X>0</X><U>0</U><V>0</V></CSweepDatapoint></CSmithChartDesign>',
    );
    expect(() => readXmlsc(xml)).toThrow(/Non-finite/);
  });

  it('INF in LineImp of a line reaches the ladder as z0 = Infinity (observe)', () => {
    const xml = file(DP, line('<LineImp>INF</LineImp>'));
    let ladder;
    try {
      ladder = ladderFromXmlsc(readXmlsc(xml));
    } catch (e) {
      expect((e as Error).message).toMatch(/Non-finite/);
      return;
    }
    const r = evaluateLadder(ladder);
    expect(Number.isFinite(r.zin.re), `zin = ${r.zin.re} + j${r.zin.im}`).toBe(true);
  });

  it('INF in Alpha or Er of a line reaches the ladder (observe)', () => {
    for (const f of ['<Alpha>INF</Alpha>', '<Er>INF</Er>']) {
      const xml = file(DP, line(f));
      let ladder;
      try {
        ladder = ladderFromXmlsc(readXmlsc(xml));
      } catch (e) {
        expect((e as Error).message).toMatch(/Non-finite/);
        continue;
      }
      const r = evaluateLadder(ladder);
      expect(Number.isFinite(r.zin.re), `${f}: zin = ${r.zin.re} + j${r.zin.im}`).toBe(true);
    }
  });

  it('a 1E+400 value is refused like INF', () => {
    const xml = file(DP).replace('<Value>1E-08</Value>', '<Value>1E+400</Value>');
    expect(() => readXmlsc(xml)).toThrow(/Non-finite/);
  });

  it('INF in StartFrequency of a frequency sweep record (observe)', () => {
    const xml = file(DP).replace(
      '</CSmithChartDesign>',
      '<CSweepDatapointParameters><Sweeptype>2</Sweeptype><StartFrequency>INF</StartFrequency><StopFrequency>1E+09</StopFrequency><StepFrequency>1E+08</StepFrequency></CSweepDatapointParameters></CSmithChartDesign>',
    );
    const d = readXmlsc(xml);
    expect(d.sweep?.sweepType).toBe('frequency');
  });

  it('a user datapoint with Frequency 0 (observe): a line at refFrequency 0', () => {
    const xml = file('<Frequency>0</Frequency><R>50</R><X>0</X>', line('<Rbegin>50</Rbegin>'));
    let ladder;
    try {
      ladder = ladderFromXmlsc(readXmlsc(xml));
    } catch {
      return;
    }
    const r = evaluateLadder(ladder);
    expect(Number.isFinite(r.zin.re), `zin = ${r.zin.re} + j${r.zin.im}`).toBe(true);
  });
});
