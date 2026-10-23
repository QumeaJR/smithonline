import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cabs,
  cargDeg,
  detectVnaCsv,
  readEznec,
  readVnaCsv,
  sIndex,
  VnaCsvError,
  vnaCsvImpedance,
  vnaCsvParameterNames,
  vnaCsvToTouchstone,
  zToGamma,
  complex,
} from '../src/index';

const FIXTURES = join(__dirname, 'fixtures', 'vna');
const load = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

describe('readVnaCsv: detection', () => {
  it('tells the layouts apart', () => {
    expect(detectVnaCsv(load('keysight-ena-synthetic.csv'))).toBe('keysight');
    expect(detectVnaCsv(load('generic-mhz-synthetic.csv'))).toBe('generic');
    expect(detectVnaCsv(load('decimal-comma-synthetic.csv'))).toBe('generic');
    expect(detectVnaCsv(load('impedance-rx-synthetic.txt'))).toBe('generic');
    expect(detectVnaCsv(load('nanovna-saver-synthetic.csv'))).toBe('nanovna');
    expect(detectVnaCsv(load('librevna-synthetic.csv'))).toBe('nanovna');
    expect(detectVnaCsv(load('malformed-synthetic.csv'))).toBeNull();
    expect(detectVnaCsv('hello\nworld\n')).toBeNull();
  });

  it('leaves an EZNEC Lastz.txt table to the EZNEC reader', () => {
    const lastz = readFileSync(join(__dirname, 'fixtures', 'sparams', 'Lastz.txt'), 'utf8');
    expect(detectVnaCsv(lastz)).toBeNull();
    expect(() => readVnaCsv(lastz)).toThrow(/EZNEC/);
    expect(readEznec(lastz).rows).toHaveLength(8);
  });

  it('reads headerless f re im rows as S11, and two triples as S11 and S21', () => {
    const one = readVnaCsv('1e6 0.1 0.2\n2e6 0.3 0.4\n');
    expect(one.kind).toBe('nanovna');
    expect(vnaCsvParameterNames(one)).toEqual(['S11']);
    expect(one.parameters.S11?.[1]).toEqual({ re: 0.3, im: 0.4 });
    const five = readVnaCsv('1e6,0.1,0.2,0.5,0\n2e6,0.3,0.4,0.6,0\n');
    expect(vnaCsvParameterNames(five)).toEqual(['S11', 'S21']);
    const six = readVnaCsv('1e6,0.1,0.2,1e6,0.5,0\n2e6,0.3,0.4,2e6,0.6,0\n');
    expect(six.parameters.S21?.[0]).toEqual({ re: 0.5, im: 0 });
  });
});

describe('readVnaCsv: Keysight ENA blocks', () => {
  const d = readVnaCsv(load('keysight-ena-synthetic.csv'));

  it('merges the blocks and keeps the header lines', () => {
    expect(d.frequencies).toEqual([1e9, 1.5e9, 2e9]);
    expect(vnaCsvParameterNames(d)).toEqual(['S11', 'S21', 'S12', 'S22']);
    expect(d.formats).toEqual({ S11: 'RI', S21: 'DB', S12: 'MA', S22: 'DB' });
    expect(d.comments[0]).toBe('CSV A.01.01');
    expect(d.z0).toBe(50);
    expect(d.z0Stated).toBe(false);
    expect(d.frequencyUnit).toBe('HZ');
    expect(d.dropped).toBe(0);
    expect(d.notes).toEqual([]);
  });

  it('reads re/im, dB/angle and mag/angle columns', () => {
    const s11 = d.parameters.S11 as readonly { re: number; im: number }[];
    expect(s11[0]).toEqual({ re: 0.2, im: -0.1 });
    const s21 = d.parameters.S21?.[0] as { re: number; im: number };
    expect(cabs(s21)).toBeCloseTo(10 ** 0.5, 9);
    expect(cargDeg(s21)).toBeCloseTo(90, 9);
    const s12 = d.parameters.S12?.[1] as { re: number; im: number };
    expect(cabs(s12)).toBeCloseTo(0.02, 12);
    expect(cargDeg(s12)).toBeCloseTo(-45, 9);
    expect(cabs(d.parameters.S22?.[2] as { re: number; im: number })).toBeCloseTo(0.1, 12);
  });

  it('skips a block whose frequencies differ, with a note', () => {
    const text = [
      'BEGIN CH1_DATA',
      'Freq(Hz),S11(REAL),S11(IMAG)',
      '1e9,0.1,0',
      '2e9,0.2,0',
      'END',
      'BEGIN CH2_DATA',
      'Freq(Hz),S21(REAL),S21(IMAG)',
      '1e9,0.5,0',
      '3e9,0.5,0',
      'END',
    ].join('\r\n');
    const k = readVnaCsv(text);
    expect(vnaCsvParameterNames(k)).toEqual(['S11']);
    expect(k.notes).toEqual(['CH2_DATA skipped: its frequencies differ from CH1_DATA']);
  });

  it('reads PNA style column names', () => {
    const k = readVnaCsv(
      '!Synthetic\nBEGIN CH1_DATA\n"Freq(Hz)","S11 Log Mag(dB)","S11 Phase(deg)"\n1e9,-20,90\n2e9,-6,180\nEND\n',
    );
    expect(k.formats.S11).toBe('DB');
    expect(cabs(k.parameters.S11?.[0] as { re: number; im: number })).toBeCloseTo(0.1, 12);
  });

  it('refuses a block without a column header', () => {
    expect(() => readVnaCsv('BEGIN CH1_DATA\n1e9,0.1,0\nEND\n')).toThrow(
      /CH1_DATA has no column header/,
    );
  });
});

describe('readVnaCsv: generic tables', () => {
  it('reads MHz mag/angle columns, the stated Z0 and drops the 0 Hz row', () => {
    const d = readVnaCsv(load('generic-mhz-synthetic.csv'));
    expect(d.frequencies).toEqual([100e6, 200e6, 300e6]);
    expect(d.frequencyUnit).toBe('MHZ');
    expect(d.dropped).toBe(1);
    expect(d.z0).toBe(75);
    expect(d.z0Stated).toBe(true);
    expect(d.formats).toEqual({ S11: 'MA', S21: 'MA' });
    const s21 = d.parameters.S21?.[1] as { re: number; im: number };
    expect(cabs(s21)).toBeCloseTo(0.7, 12);
    expect(cargDeg(s21)).toBeCloseTo(-40, 9);
  });

  it('reads semicolons with decimal commas and dB/angle pairs', () => {
    const d = readVnaCsv(load('decimal-comma-synthetic.csv'));
    expect(d.frequencies).toEqual([2.4e9, 2.45e9, 2.5e9]);
    expect(d.frequencyUnit).toBe('GHZ');
    const s = d.parameters.S11 as readonly { re: number; im: number }[];
    expect(cabs(s[1] as { re: number; im: number })).toBeCloseTo(0.1, 12);
    expect(cargDeg(s[0] as { re: number; im: number })).toBeCloseTo(45, 9);
  });

  it('reads R and X columns as an impedance and S11 against Z0', () => {
    const d = readVnaCsv(load('impedance-rx-synthetic.txt'));
    expect(d.frequencies).toEqual([144e6, 145e6, 146e6]);
    expect(d.dropped).toBe(1);
    expect(d.impedance).toEqual([complex(40, -20), complex(50, 0), complex(60, 20)]);
    expect(d.parameters.S11?.[1]).toEqual(zToGamma(complex(50, 0), 50));
    expect(vnaCsvImpedance(d)).toEqual([
      { frequency: 144e6, z: complex(40, -20) },
      { frequency: 145e6, z: complex(50, 0) },
      { frequency: 146e6, z: complex(60, 20) },
    ]);
  });

  it('takes the unit from the numbers when the header has none', () => {
    const d = readVnaCsv('Frequency,S11 re,S11 im\n1.5 GHz,0.1,0\n1.6GHz,0.2,0\n');
    expect(d.frequencies).toEqual([1.5e9, 1.6e9]);
    expect(d.frequencyUnit).toBe('GHZ');
  });

  it('reads radians and a Touchstone style option line in a comment', () => {
    const d = readVnaCsv(
      '# Hz S MA R 25\nf\tS11 mag\tS11 phase (rad)\n1e6\t0.5\t3.14159265358979\n2e6\t0.5\t0\n',
    );
    expect(d.z0).toBe(25);
    expect(cargDeg(d.parameters.S11?.[0] as { re: number; im: number })).toBeCloseTo(180, 6);
  });

  it('drops rows with a non-numeric value and notes columns it cannot pair', () => {
    const d = readVnaCsv('Freq Hz;S11 dB;S11 deg;S21 dB\n1;-10;0;-3\n2;x;0;-3\n3;-10;0;-3\n');
    expect(d.frequencies).toEqual([1, 3]);
    expect(d.dropped).toBe(1);
    expect(vnaCsvParameterNames(d)).toEqual(['S11']);
    expect(d.notes).toEqual([
      'S21 skipped: it needs re and im, mag and angle, or dB and angle columns',
    ]);
  });
});

describe('readVnaCsv: NanoVNA-Saver and LibreVNA triples', () => {
  it('names unnamed re/im columns S11', () => {
    const d = readVnaCsv(load('nanovna-saver-synthetic.csv'));
    expect(d.kind).toBe('nanovna');
    expect(d.frequencies).toEqual([7e6, 7.1e6, 7.2e6]);
    expect(vnaCsvParameterNames(d)).toEqual(['S11']);
    expect(d.parameters.S11?.[0]).toEqual({ re: 0.2, im: 0.1 });
  });

  it('reads one frequency, re, im triple per trace', () => {
    const d = readVnaCsv(load('librevna-synthetic.csv'));
    expect(vnaCsvParameterNames(d)).toEqual(['S11', 'S21']);
    expect(d.parameters.S21?.[2]).toEqual({ re: 0.3, im: 0.2 });
  });
});

describe('readVnaCsv: errors', () => {
  it('names a missing frequency column', () => {
    expect(() => readVnaCsv(load('malformed-synthetic.csv'))).toThrow(VnaCsvError);
    expect(() => readVnaCsv(load('malformed-synthetic.csv'))).toThrow(/No frequency column/);
  });

  it('names missing S-parameter columns', () => {
    expect(() => readVnaCsv('Freq (Hz),Gain\n1,2\n2,3\n')).toThrow(
      /No S-parameter or impedance columns/,
    );
  });

  it('needs two rows with a usable frequency', () => {
    expect(() => readVnaCsv('Freq(Hz),S11(REAL),S11(IMAG)\n1e9,0.1,0\n')).toThrow(
      /^Only 1 usable data row; at least two are needed$/,
    );
    expect(() =>
      readVnaCsv('Freq(Hz),S11(REAL),S11(IMAG)\n0,0.1,0\nNaN,0.1,0\n-1,0.1,0\n1e9,0.1,0\n'),
    ).toThrow('Only 1 usable data row (dropped: 3 for a zero or non-finite frequency)');
    expect(() => readVnaCsv('')).toThrow(/Empty file/);
  });
});

describe('VNA CSV helpers', () => {
  it('turns S11 into impedance points against the file Z0', () => {
    const d = readVnaCsv(load('generic-mhz-synthetic.csv'));
    const rows = vnaCsvImpedance(d);
    expect(rows).toHaveLength(3);
    expect(zToGamma(rows[0]?.z as { re: number; im: number }, 75).re).toBeCloseTo(
      (d.parameters.S11?.[0] as { re: number }).re,
      12,
    );
    expect(() => vnaCsvImpedance(d, 'S22')).toThrow(/has no S22/);
  });

  it('builds a two-port Touchstone table with NaN for the parameters it lacks', () => {
    const d = readVnaCsv(load('generic-mhz-synthetic.csv'));
    const t = vnaCsvToTouchstone(d);
    expect(t.ports).toBe(2);
    expect(t.z0).toBe(75);
    expect(t.frequencyUnit).toBe('MHZ');
    expect(t.format).toBe('MA');
    expect(t.points).toHaveLength(3);
    const p = t.points[0]?.s as readonly { re: number; im: number }[];
    expect(p[sIndex(2, 2, 1)]).toEqual(d.parameters.S21?.[0]);
    expect(Number.isNaN(p[sIndex(2, 1, 2)]?.re)).toBe(true);
    expect(Number.isNaN(p[sIndex(2, 2, 2)]?.re)).toBe(true);
  });

  it('builds a one-port table for an S11 file and keeps all four for a full export', () => {
    expect(vnaCsvToTouchstone(readVnaCsv(load('decimal-comma-synthetic.csv'))).ports).toBe(1);
    const t = vnaCsvToTouchstone(readVnaCsv(load('keysight-ena-synthetic.csv')));
    expect(t.ports).toBe(2);
    expect(t.points[2]?.s.every((c) => Number.isFinite(c.re))).toBe(true);
  });
});

describe('readVnaCsv: byte order mark', () => {
  it('ignores a byte order mark before the header', () => {
    const d = readVnaCsv('﻿Freq(Hz),S11(REAL),S11(IMAG)\r\n1e6,0.1,0\r\n2e6,0.2,0\r\n');
    expect(d.kind).toBe('generic');
    expect(d.frequencies).toEqual([1e6, 2e6]);
  });
});
