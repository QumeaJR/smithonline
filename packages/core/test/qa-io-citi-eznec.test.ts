import { describe, expect, it } from 'vitest';
import {
  cabs,
  citiArray,
  citiPorts,
  CitiError,
  EznecError,
  readCiti,
  readEznec,
  touchstoneFromCiti,
} from '../src/index';

const zeros = (n: number): string => Array.from({ length: n }, () => '0,0').join('\n');

describe('qa: CITI SEG_LIST', () => {
  it('expands a segment into evenly spaced points', () => {
    const [p] = readCiti(
      'CITIFILE A.01.00\nVAR FREQ MAG 5\nDATA S[1,1] RI\nSEG_LIST_BEGIN\nSEG 1000000000 2000000000 5\nSEG_LIST_END\nBEGIN\n' +
        zeros(5) +
        '\nEND\n',
    );
    expect(p!.variableValues).toEqual([1e9, 1.25e9, 1.5e9, 1.75e9, 2e9]);
  });

  it('concatenates several segments and holds a one-point segment at its start', () => {
    const [p] = readCiti(
      'CITIFILE A.01.00\nVAR FREQ MAG 3\nDATA S[1,1] RI\nSEG_LIST_BEGIN\nSEG 1e9 2e9 2\nSEG 3e9 9e9 1\nSEG_LIST_END\nBEGIN\n' +
        zeros(3) +
        '\nEND\n',
    );
    expect(p!.variableValues).toEqual([1e9, 2e9, 3e9]);
  });

  it('rejects a SEG_LIST without its end and a count that disagrees with VAR', () => {
    expect(() =>
      readCiti('CITIFILE A.01.00\nVAR FREQ MAG 2\nDATA S[1,1] RI\nSEG_LIST_BEGIN\nSEG 1 2 2\n'),
    ).toThrow(/SEG_LIST_BEGIN without SEG_LIST_END/);
    expect(() =>
      readCiti(
        'CITIFILE A.01.00\nVAR FREQ MAG 2\nDATA S[1,1] RI\nSEG_LIST_BEGIN\nSEG 1 3 3\nSEG_LIST_END\nBEGIN\n' +
          zeros(3) +
          '\nEND\n',
      ),
    ).toThrow(/VAR declares 2 points but the list has 3/);
  });
});

describe('qa: CITI formats, keywords and validation', () => {
  it('reads DBANGLE with negative dB and MAG with one value per row', () => {
    const [p] = readCiti(
      'CITIFILE A.01.00\nVAR FREQ MAG 1\nDATA S[1,1] DBANGLE\nDATA S[2,2] MAG\nVAR_LIST_BEGIN\n1\nVAR_LIST_END\nBEGIN\n-6.0206,90\nEND\nBEGIN\n0.5\nEND\n',
    );
    const s11 = citiArray(p!, 1, 1)!.values[0]!;
    expect(s11.re).toBeCloseTo(0, 5);
    expect(s11.im).toBeCloseTo(0.5, 5);
    expect(citiArray(p!, 2, 2)!.values[0]).toEqual({ re: 0.5, im: 0 });
    expect(citiPorts(p!)).toBe(2);
    // The missing S[1,2] and S[2,1] are filled with zero.
    const t = touchstoneFromCiti(p!);
    expect(t.z0).toBe(50);
    expect(t.points[0]!.s).toHaveLength(4);
    expect(t.points[0]!.s[1]).toEqual({ re: 0, im: 0 });
    expect(t.points[0]!.s[2]).toEqual({ re: 0, im: 0 });
    expect(cabs(t.points[0]!.s[3]!)).toBe(0.5);
  });

  it('rejects unknown formats, surplus or missing BEGIN blocks and non-numbers', () => {
    const head = 'CITIFILE A.01.00\nVAR FREQ MAG 1\n';
    const list = 'VAR_LIST_BEGIN\n1\nVAR_LIST_END\n';
    expect(() => readCiti(`${head}DATA S[1,1] XY\n${list}BEGIN\n0,0\nEND\n`)).toThrow(
      /Unknown data format "XY"/,
    );
    expect(() =>
      readCiti(`${head}DATA S[1,1] RI\n${list}BEGIN\n0,0\nEND\nBEGIN\n0,0\nEND\n`),
    ).toThrow(/More BEGIN blocks/);
    expect(() =>
      readCiti(`${head}DATA S[1,1] RI\nDATA S[2,1] RI\n${list}BEGIN\n0,0\nEND\n`),
    ).toThrow(/declares 2 data arrays but holds 1/);
    expect(() => readCiti(`${head}DATA S[1,1] RI\n${list}BEGIN\nabc,0\nEND\n`)).toThrow(
      /Not a number: "abc" in S\[1,1\]/,
    );
    expect(() => readCiti(`${head}DATA S[1,1] RI\nVAR_LIST_BEGIN\n1\n`)).toThrow(
      /VAR_LIST_BEGIN without VAR_LIST_END/,
    );
    expect(() =>
      readCiti(`${head}DATA S[1,1] RI\nVAR_LIST_BEGIN\n1\n2\nVAR_LIST_END\nBEGIN\n0,0\n0,0\nEND\n`),
    ).toThrow(/VAR declares 1 points but the list has 2/);
  });

  it('accepts lowercase keywords, CRLF, comments, a non-FREQ variable and spaced values', () => {
    const [p] = readCiti(
      'junk before the header\r\ncitifile A.01.00\r\n#hash comment\r\nCOMMENT word comment\r\nname Test\r\nvar TIME MAG 2\r\ndata S[1,1] RI\r\nvar_list_begin\r\n0\r\n1\r\nvar_list_end\r\nbegin\r\n0.1 0.2\r\n0.3 0.4\r\nend\r\n',
    );
    expect(p).toMatchObject({ version: 'A.01.00', name: 'Test', variable: 'TIME' });
    expect(p!.comments).toEqual(['hash comment', 'word comment']);
    expect(p!.variableValues).toEqual([0, 1]);
    expect(p!.arrays[0]!.values).toEqual([
      { re: 0.1, im: 0.2 },
      { re: 0.3, im: 0.4 },
    ]);
  });

  it('tolerates a VAR line without a count and a header-only package', () => {
    const [p] = readCiti(
      'CITIFILE A.01.00\nVAR FREQ MAG\nDATA S[1,1] RI\nVAR_LIST_BEGIN\n1\n2\nVAR_LIST_END\nBEGIN\n0,0\n0,0\nEND\n',
    );
    expect(p!.variableValues).toEqual([1, 2]);
    const [empty] = readCiti('CITIFILE A.01.00\n');
    expect(empty!.arrays).toEqual([]);
    expect(empty!.variableValues).toEqual([]);
    expect(() => touchstoneFromCiti(empty!)).toThrow(/holds no S\[i,j\] arrays/);
    const [noS] = readCiti(
      'CITIFILE A.01.00\nVAR FREQ MAG 1\nDATA E[1,1] RI\nVAR_LIST_BEGIN\n1\nVAR_LIST_END\nBEGIN\n0,0\nEND\n',
    );
    expect(citiPorts(noS!)).toBe(0);
    expect(citiArray(noS!, 1, 1)).toBeNull();
    expect(() => touchstoneFromCiti(noS!)).toThrow(CitiError);
  });
});

describe('qa: EZNEC', () => {
  const header = '"Freq MHz","Src #","R","X","SWR (50 ohms)","SWR (alt. Z0)"\n';

  it('keeps rows of a second source with their source number', () => {
    const d = readEznec(
      '"EZNEC, ver 6"\n' +
        header +
        '14,1,68,-40,2.09,1.75\n14,2,30,10,1.8,1.5\n14.1,1,70,-20,1.61,1.33\n14.1,2,32,12,1.7,1.4\n',
    );
    expect(d.header).toEqual(['EZNEC, ver 6']);
    expect(d.rows.map((r) => r.source)).toEqual([1, 2, 1, 2]);
    expect(d.rows[1]).toEqual({ frequency: 14e6, source: 2, z: { re: 30, im: 10 } });
    expect(d.rows[3]!.frequency).toBeCloseTo(14.1e6, 3);
  });

  it('defaults a blank or zero source number to 1 and allows negative R', () => {
    const d = readEznec(header + '14,,68,-40,2,1.7\n14.1,0,-5,3,2,1.7\n');
    expect(d.rows.map((r) => r.source)).toEqual([1, 1]);
    expect(d.rows[1]!.z).toEqual({ re: -5, im: 3 });
  });

  it('scales kHz and GHz frequency columns and works without a source column', () => {
    const k = readEznec('"Freq kHz","Src #","R","X"\n14000,1,68,-40\n');
    expect(k.rows[0]!.frequency).toBe(14e6);
    const g = readEznec('"Freq GHz","Src #","R","X"\n0.014,1,68,-40\n');
    expect(g.rows[0]!.frequency).toBeCloseTo(14e6, 3);
    const noSrc = readEznec('"Freq MHz","R","X","SWR"\n14,68,-40,2\n');
    expect(noSrc.rows[0]).toEqual({ frequency: 14e6, source: 1, z: { re: 68, im: -40 } });
  });

  it('accepts a table with only the Freq, R and X columns', () => {
    const d = readEznec('"Freq MHz","R","X"\n14,68,-40\n');
    expect(d.rows[0]).toEqual({ frequency: 14e6, source: 1, z: { re: 68, im: -40 } });
  });

  it('rejects a bad row and a header without data', () => {
    expect(() => readEznec(header + '14,1,abc,-40,2,1.7\n')).toThrow(/Bad row/);
    expect(() => readEznec(header + '\n\n')).toThrow(/No data rows/);
    expect(() => readEznec('')).toThrow(EznecError);
  });
});
