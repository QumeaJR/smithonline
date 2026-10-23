/**
 * QA round for the VNA CSV reader (commit 137ed2b). Expected values are hand
 * calculations from the documented layouts (docs/06-user-guide.md section 9
 * and the header comment of src/io/vna-csv.ts).
 */
import { describe, expect, it } from 'vitest';
import {
  cabs,
  cargDeg,
  complex,
  detectVnaCsv,
  readVnaCsv,
  sIndex,
  VnaCsvError,
  vnaCsvImpedance,
  vnaCsvParameterNames,
  vnaCsvToTouchstone,
  type Complex,
} from '../src/index';

const c = (v: Complex | undefined): Complex => v as Complex;

describe('qa vna-csv: headerless rows', () => {
  it('nine columns are S11, S21, S12, S22 re/im pairs in that order', () => {
    const d = readVnaCsv('1e6 0.1 0 0.2 0 0.3 0 0.4 0\n2e6 0.1 0 0.2 0 0.3 0 0.4 0\n');
    expect(d.kind).toBe('nanovna');
    expect(vnaCsvParameterNames(d)).toEqual(['S11', 'S21', 'S12', 'S22']);
    expect(d.parameters.S11?.[0]).toEqual({ re: 0.1, im: 0 });
    expect(d.parameters.S21?.[0]).toEqual({ re: 0.2, im: 0 });
    expect(d.parameters.S12?.[0]).toEqual({ re: 0.3, im: 0 });
    expect(d.parameters.S22?.[0]).toEqual({ re: 0.4, im: 0 });
  });

  it('seven columns are S11, S21 and S12', () => {
    const d = readVnaCsv('1,0,0,1,0,0.5,0\n2,0,0,1,0,0.5,0\n');
    expect(vnaCsvParameterNames(d)).toEqual(['S11', 'S21', 'S12']);
  });

  it('two, four or ten columns are refused with the count', () => {
    expect(() => readVnaCsv('1e6 0.1\n2e6 0.2\n')).toThrow(/this one has 2 per row/);
    expect(() => readVnaCsv('1e6,0.1,0,0\n2e6,0.2,0,0\n')).toThrow(/this one has 4 per row/);
    expect(() => readVnaCsv('1;0;0;0;0;0;0;0;0;0\n2;0;0;0;0;0;0;0;0;0\n')).toThrow(VnaCsvError);
  });

  it('a multi-cell line before headerless rows is a missing frequency column', () => {
    expect(() => readVnaCsv('Index,Value\n1e6,0.1,0\n2e6,0.2,0\n')).toThrow(/^No frequency column/);
  });

  it('a one-word title before headerless rows is kept as a comment', () => {
    const d = readVnaCsv('Sweep\n1e6,0.1,0\n2e6,0.2,0\n');
    expect(d.frequencies).toEqual([1e6, 2e6]);
    expect(d.comments).toContain('Sweep');
  });

  it('tab separated with decimal commas', () => {
    const d = readVnaCsv('1000000\t0,25\t-0,5\n2000000\t0,1\t0\n');
    expect(d.parameters.S11?.[0]).toEqual({ re: 0.25, im: -0.5 });
  });

  // vna-csv.ts lines 16-17: "With a semicolon, tab or space delimiter a comma in a number is a decimal comma."
  it('space separated with decimal commas (as the reader header comment claims)', () => {
    const d = readVnaCsv('1000000 0,25 -0,5\n2000000 0,1 0\n');
    expect(d.frequencies).toEqual([1e6, 2e6]);
    expect(d.parameters.S11?.[0]).toEqual({ re: 0.25, im: -0.5 });
  });
});

describe('qa vna-csv: header classification', () => {
  it('f [MHz] with semicolons and dot decimals', () => {
    const d = readVnaCsv('f [MHz];S11 re;S11 im\n1.5;0.1;0\n2.5;0.2;0\n');
    expect(d.frequencies).toEqual([1.5e6, 2.5e6]);
    expect(d.frequencyUnit).toBe('MHZ');
  });

  it('kHz in the header scales by 1e3', () => {
    const d = readVnaCsv('Freq (kHz),S11 re,S11 im\n100,0.1,0\n200,0.2,0\n');
    expect(d.frequencies).toEqual([1e5, 2e5]);
    expect(d.frequencyUnit).toBe('KHZ');
  });

  it('a unit on the cell wins over the header unit', () => {
    const d = readVnaCsv('Freq (MHz),S11 re,S11 im\n1 GHz,0,0\n2 GHz,0,0\n');
    expect(d.frequencies).toEqual([1e9, 2e9]);
  });

  it('quoted header cells may hold the delimiter', () => {
    const d = readVnaCsv('"Freq (Hz)","S11, re","S11, im"\n1,0.1,0.2\n2,0.3,0.4\n');
    expect(d.parameters.S11?.[1]).toEqual({ re: 0.3, im: 0.4 });
  });

  it('trailing delimiters on every line are ignored', () => {
    const d = readVnaCsv('Freq,S11 re,S11 im,\n1,0.1,0.2,\n2,0.3,0.4,\n');
    expect(d.frequencies).toEqual([1, 2]);
    expect(d.parameters.S11?.[0]).toEqual({ re: 0.1, im: 0.2 });
  });

  it('a space separated header with dot decimals', () => {
    const d = readVnaCsv('Freq(Hz) S11(REAL) S11(IMAG)\n1e6 0.1 0\n2e6 0.2 0\n');
    expect(d.parameters.S11?.[1]).toEqual({ re: 0.2, im: 0 });
  });

  it('dB is 20 log10 of the magnitude: -20 dB at 180 deg is -0.1', () => {
    const d = readVnaCsv('Freq,S21 dB,S21 deg\n1,-20,180\n2,0,0\n');
    const v = c(d.parameters.S21?.[0]);
    expect(v.re).toBeCloseTo(-0.1, 12);
    expect(v.im).toBeCloseTo(0, 12);
    expect(cabs(c(d.parameters.S21?.[1]))).toBeCloseTo(1, 12);
  });

  it('a lone rad column after a mag column is radians', () => {
    const d = readVnaCsv('Freq,S11 mag,S11 rad\n1,0.5,1.5707963267948966\n2,0.5,0\n');
    expect(cargDeg(c(d.parameters.S11?.[0]))).toBeCloseTo(90, 9);
  });

  it('unnamed Mag and Phase columns are S11 mag/angle', () => {
    const d = readVnaCsv('Frequency,Magnitude,Phase\n1,0.5,90\n2,0.5,0\n');
    expect(d.formats.S11).toBe('MA');
    expect(d.parameters.S11?.[0]?.im).toBeCloseTo(0.5, 12);
  });

  it('unnamed Re, Im, Re, Im under one frequency are S11 then S21', () => {
    const d = readVnaCsv('Frequency,Re,Im,Re,Im\n1,0.1,0,0.9,0\n2,0.1,0,0.9,0\n');
    expect(vnaCsvParameterNames(d)).toEqual(['S11', 'S21']);
    expect(d.parameters.S21?.[0]).toEqual({ re: 0.9, im: 0 });
  });

  it('unnamed Phase before Mag still pairs into S11', () => {
    const d = readVnaCsv('Frequency,Phase,Mag\n1,90,0.5\n2,0,0.5\n');
    expect(vnaCsvParameterNames(d)).toEqual(['S11']);
    expect(d.parameters.S11?.[0]?.im).toBeCloseTo(0.5, 12);
  });

  it('Return loss, SWR and Gain columns are not S-parameters', () => {
    const d = readVnaCsv(
      'Freq,Return loss (dB),SWR,S11 re,S11 im\n1,20,1.2,0.1,0\n2,20,1.2,0.1,0\n',
    );
    expect(vnaCsvParameterNames(d)).toEqual(['S11']);
    expect(() => readVnaCsv('Freq,Return loss (dB),Phase\n1,20,0\n2,20,0\n')).toThrow(
      /No S-parameter or impedance columns/,
    );
  });

  it('Z re and Z im are an impedance; S11 is computed against the stated Z0', () => {
    const d = readVnaCsv('! Z0 = 75\nFreq,Z re,Z im\n1,75,0\n2,150,0\n');
    expect(d.z0).toBe(75);
    expect(d.impedance).toEqual([complex(75, 0), complex(150, 0)]);
    // (150 - 75) / (150 + 75) = 1/3
    expect(c(d.parameters.S11?.[1]).re).toBeCloseTo(1 / 3, 12);
    expect(c(d.parameters.S11?.[0]).re).toBeCloseTo(0, 12);
    expect(d.formats.S11).toBe('RI');
  });

  it('an R column without X is noted; with no other values the file is refused', () => {
    expect(() => readVnaCsv('Freq,R\n1,50\n2,50\n')).toThrow(/No S-parameter or impedance/);
    const d = readVnaCsv('Freq,S11 re,S11 im,R\n1,0,0,50\n2,0,0,50\n');
    expect(d.impedance).toBeNull();
    expect(d.notes).toEqual(['Impedance skipped: it needs both an R and an X column']);
  });

  it('S31 is skipped with a note', () => {
    const d = readVnaCsv('Freq,S11 re,S11 im,S31 re,S31 im\n1,0,0,1,0\n2,0,0,1,0\n');
    expect(vnaCsvParameterNames(d)).toEqual(['S11']);
    expect(d.notes).toEqual(['S31 skipped: only S11 to S22 are read']);
  });

  it('a Src column is refused as EZNEC', () => {
    expect(() => readVnaCsv('Freq MHz,Src #,R,X\n14,1,50,0\n14.1,1,50,0\n')).toThrow(
      /EZNEC Lastz\.txt table/,
    );
  });

  it('a trace whose own frequency column differs is skipped with a note', () => {
    const d = readVnaCsv(
      'Frequency,S11_real,S11_imag,Frequency,S21_real,S21_imag\n1e6,0.5,0,1e6,0.1,0\n2e6,0.4,0,3e6,0.2,0\n',
    );
    expect(vnaCsvParameterNames(d)).toEqual(['S11']);
    expect(d.notes).toEqual(['S21 skipped: its frequency column differs from the first one']);
  });

  // vna-csv.ts:423 says a title line such as "Frequency sweep" is not a header.
  it('an unquoted title line "Frequency sweep" is not taken as the header', () => {
    const d = readVnaCsv('Frequency sweep\nFreq(Hz),S11(REAL),S11(IMAG)\n1e9,0.1,0\n2e9,0.2,0\n');
    expect(d.frequencies).toEqual([1e9, 2e9]);
  });
});

describe('qa vna-csv: rows dropped', () => {
  it('negative, huge and non-finite frequencies and infinite values are dropped and counted', () => {
    const d = readVnaCsv(
      'Freq,S11 re,S11 im\n-1,0,0\n1e400,0,0\ninf,0,0\n1,1e400,0\n2,0.1,0\n3,0.2,0\n',
    );
    expect(d.frequencies).toEqual([2, 3]);
    expect(d.dropped).toBe(4);
  });

  it('a missing middle cell drops the row', () => {
    const d = readVnaCsv('Freq,S11 re,S11 im\n1,,0\n2,0.1,0\n3,0.2,0\n');
    expect(d.frequencies).toEqual([2, 3]);
    expect(d.dropped).toBe(1);
  });

  it('when every frequency is fine but values are not numbers, the message does not blame the frequency', () => {
    let msg = '';
    try {
      readVnaCsv('Freq,S11 re,S11 im\n1e9,x,0\n2e9,y,0\n');
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toBe(
      'Only 0 usable data rows (dropped: 2 for a value that is not a number); at least two are needed',
    );
    expect(msg).not.toMatch(/finite, non-zero frequency/);
  });
});

describe('qa vna-csv: stated Z0', () => {
  it('Z0 = 0 is ignored and 50 is assumed', () => {
    const d = readVnaCsv('! Z0 = 0 Ohm\nFreq,S11 re,S11 im\n1,0,0\n2,0,0\n');
    expect(d.z0).toBe(50);
    expect(d.z0Stated).toBe(false);
  });

  it('a decimal comma in the stated Z0', () => {
    const d = readVnaCsv('# Z0: 75,5 Ohm\nFreq;S11 re;S11 im\n1;0;0\n2;0;0\n');
    expect(d.z0).toBe(75.5);
    expect(d.z0Stated).toBe(true);
  });

  it('a Touchstone option line with MHz and DB', () => {
    const d = readVnaCsv('# MHz S DB R 75\nFreq,S11 re,S11 im\n1,0,0\n2,0,0\n');
    expect(d.z0).toBe(75);
  });
});

describe('qa vna-csv: Keysight blocks', () => {
  it('unlabelled blocks are named block 1, block 2 in notes', () => {
    const d = readVnaCsv(
      'BEGIN\nFreq(Hz),S11(REAL),S11(IMAG)\n1,0,0\n2,0,0\nEND\nBEGIN\nFreq(Hz),S21(REAL),S21(IMAG)\n1,0,0\n3,0,0\nEND\n',
    );
    expect(d.kind).toBe('keysight');
    expect(d.notes).toEqual(['block 2 skipped: its frequencies differ from block 1']);
  });

  it('a block without END runs to the end of the file', () => {
    const d = readVnaCsv('BEGIN CH1_DATA\nFreq(Hz),S11(REAL),S11(IMAG)\n1,0.1,0\n2,0.2,0\n');
    expect(d.frequencies).toEqual([1, 2]);
  });

  it('an empty block is refused', () => {
    expect(() => readVnaCsv('BEGIN CH1_DATA\nEND\n')).toThrow(
      /CH1_DATA skipped: no column header after BEGIN/,
    );
  });

  it('text outside the blocks goes to the comments', () => {
    const d = readVnaCsv(
      'Instrument E5071C\nBEGIN CH1_DATA\nFreq(Hz),S11(REAL),S11(IMAG)\n1,0,0\n2,0,0\nEND\n',
    );
    expect(d.comments).toContain('Instrument E5071C');
  });

  // The doc comment on VnaCsvData.notes: "Columns or blocks the reader could not use, one sentence each."
  it('a second block with no usable columns is noted, not fatal for the first', () => {
    const d = readVnaCsv(
      [
        'BEGIN CH1_DATA',
        'Freq(Hz),S11(REAL),S11(IMAG)',
        '1e9,0.1,0',
        '2e9,0.2,0',
        'END',
        'BEGIN CH2_DATA',
        'Freq(Hz),S21(SWR)',
        '1e9,1.5',
        '2e9,1.6',
        'END',
      ].join('\n'),
    );
    expect(vnaCsvParameterNames(d)).toEqual(['S11']);
    expect(d.notes.length).toBeGreaterThan(0);
  });
});

describe('qa vna-csv: helpers', () => {
  const thru = readVnaCsv('Freq(Hz),S21(DB),S21(DEG)\n1e9,-20,0\n2e9,0,90\n');

  it('vnaCsvImpedance needs S11 when there is no R and X', () => {
    expect(() => vnaCsvImpedance(thru)).toThrow(/The file has no S11/);
  });

  it('vnaCsvToTouchstone of an S21-only file is a two-port with NaN s11, s12, s22', () => {
    const t = vnaCsvToTouchstone(thru);
    expect(t.ports).toBe(2);
    expect(t.format).toBe('DB');
    const s = t.points[0]?.s as readonly Complex[];
    expect(Number.isNaN(s[sIndex(2, 1, 1)]?.re)).toBe(true);
    expect(Number.isNaN(s[sIndex(2, 1, 2)]?.re)).toBe(true);
    expect(Number.isNaN(s[sIndex(2, 2, 2)]?.re)).toBe(true);
    expect(c(s[sIndex(2, 2, 1)]).re).toBeCloseTo(0.1, 12);
    const s1 = t.points[1]?.s as readonly Complex[];
    expect(c(s1[sIndex(2, 2, 1)]).im).toBeCloseTo(1, 12);
  });

  it('an R and X file is a one-port RI table with s11 from the impedance', () => {
    const d = readVnaCsv('Freq,R,X\n1,50,0\n2,150,0\n');
    const t = vnaCsvToTouchstone(d);
    expect(t.ports).toBe(1);
    expect(t.format).toBe('RI');
    // (150 - 50) / (150 + 50) = 0.5
    expect(c(t.points[1]?.s[0]).re).toBeCloseTo(0.5, 12);
  });

  it('vnaCsvImpedance S22: 0.1 at -90 deg against 50 ohm is 49.0099 - j9.90099', () => {
    const d = readVnaCsv(
      'Freq(Hz),S11(REAL),S11(IMAG),S22(MAG),S22(DEG)\n1e9,0,0,0.1,-90\n2e9,0,0,0.1,-90\n',
    );
    const z = c(vnaCsvImpedance(d, 'S22')[0]?.z);
    // 50 (1 - 0.1j) / (1 + 0.1j) = 50 (0.99 - 0.2j) / 1.01
    expect(z.re).toBeCloseTo((50 * 0.99) / 1.01, 9);
    expect(z.im).toBeCloseTo((-50 * 0.2) / 1.01, 9);
  });

  it('detectVnaCsv is null for fewer than two rows', () => {
    expect(detectVnaCsv('Freq,S11 re,S11 im\n1,0,0\n')).toBeNull();
    expect(detectVnaCsv('! only a comment\n')).toBeNull();
  });
});
