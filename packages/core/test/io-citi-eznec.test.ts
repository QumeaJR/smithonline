import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cabs,
  cargDeg,
  citiArray,
  citiPorts,
  CitiError,
  EznecError,
  readCiti,
  readEznec,
  touchstoneFromCiti,
  sParametersAt,
} from '../src/index';

const FIXTURES = join(__dirname, 'fixtures', 'sparams');
const load = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

describe('readCiti', () => {
  it('reads both packages of the sample file', () => {
    const pkgs = readCiti(load('twoport-synthetic.citi'));
    expect(pkgs).toHaveLength(2);
    const [a, b] = pkgs as [(typeof pkgs)[0], (typeof pkgs)[0]];
    expect(a.version).toBe('A.01.00');
    expect(a.name).toBe('DATA');
    expect(a.variable).toBe('FREQ');
    expect(a.variableValues).toEqual([1e9, 1.5e9, 2e9, 2.5e9, 3e9]);
    expect(a.arrays.map((x) => x.name)).toEqual(['S[1,1]', 'S[2,1]', 'S[1,2]', 'S[2,2]']);
    expect(a.comments[0]).toMatch(/Synthetic two-port/);
    expect(citiPorts(a)).toBe(2);
    const s21 = citiArray(a, 2, 1)!;
    expect(s21.format).toBe('MAGANGLE');
    expect(cabs(s21.values[1]!)).toBeCloseTo(4 / 1.5, 3);
    expect(cargDeg(s21.values[1]!)).toBeCloseTo(60, 6);

    // The second package expands its SEG_LIST and holds RI values.
    expect(b.name).toBe('MEMORY');
    expect(b.variableValues).toEqual([1e8, 2e8, 3e8]);
    expect(citiPorts(b)).toBe(1);
    expect(cargDeg(citiArray(b, 1, 1)!.values[2]!)).toBeCloseTo(60, 2);
  });

  it('converts a package to Touchstone data for the lookup helpers', () => {
    const [pkg] = readCiti(load('twoport-synthetic.citi'));
    const t = touchstoneFromCiti(pkg!, 50);
    expect(t.ports).toBe(2);
    expect(t.points).toHaveLength(5);
    const at = sParametersAt(t, 2e9)!;
    expect(cabs(at.s.s21)).toBeCloseTo(2, 3);
    expect(cabs(at.s.s11)).toBeCloseTo(0.42, 3);
  });

  it('rejects files without a header or with inconsistent counts', () => {
    expect(() => readCiti('hello\n')).toThrow(CitiError);
    expect(() =>
      readCiti(
        'CITIFILE A.01.00\nVAR FREQ MAG 2\nDATA S[1,1] RI\nVAR_LIST_BEGIN\n1\n2\nVAR_LIST_END\nBEGIN\n0,0\nEND\n',
      ),
    ).toThrow(/has 1 values for 2 points/);
    expect(() =>
      readCiti(
        'CITIFILE A.01.00\nVAR FREQ MAG 1\nDATA S[1,1] RI\nVAR_LIST_BEGIN\n1\nVAR_LIST_END\nBEGIN\n0,0\n',
      ),
    ).toThrow(/BEGIN without END/);
  });
});

describe('readEznec', () => {
  it('reads the Lastz.txt sample with CRLF endings', () => {
    const d = readEznec(load('Lastz.txt'));
    expect(d.header).toEqual(['Synthetic dipole, made up for the tests', 'Frequency sweep']);
    expect(d.rows).toHaveLength(8);
    expect(d.rows[0]).toEqual({ frequency: 14e6, source: 1, z: { re: 68, im: -40 } });
    expect(d.rows[7]!.frequency).toBeCloseTo(14.35e6, 3);
    expect(d.rows[7]!.z.re).toBeCloseTo(75, 6);
  });

  it('rejects files without the column header', () => {
    expect(() => readEznec('"x"\n1,2,3\n')).toThrow(EznecError);
    expect(() => readEznec('"Freq MHz","Src #","R","X"\n')).toThrow(/No data rows/);
  });
});
