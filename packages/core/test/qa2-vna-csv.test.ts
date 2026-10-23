/**
 * QA round 2 for the VNA CSV reader (commits 137ed2b and 4cf7e44). Expected
 * values are hand calculations from docs/06-user-guide.md section 9 and the
 * header comment of src/io/vna-csv.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  isTouchstoneText,
  readVnaCsv,
  VnaCsvError,
  vnaCsvImpedance,
  vnaCsvParameterNames,
  type Complex,
} from '../src/index';

const c = (v: Complex | undefined): Complex => v as Complex;

describe('qa2 vna-csv: Keysight blocks the reader cannot use', () => {
  // User guide section 9: "a block the reader cannot use is skipped with a note".
  it('a first block with a header but no rows does not refuse a full second block', () => {
    const text = [
      'BEGIN CH1_DATA',
      'Freq(Hz),S21(REAL),S21(IMAG)',
      'END',
      'BEGIN CH2_DATA',
      'Freq(Hz),S11(REAL),S11(IMAG)',
      '1e9,0.1,0',
      '2e9,0.2,0',
      'END',
    ].join('\n');
    const d = readVnaCsv(text);
    expect(d.frequencies).toEqual([1e9, 2e9]);
    expect(c(d.parameters.S11?.[0]).re).toBe(0.1);
    expect(d.notes.some((n) => n.includes('CH1_DATA'))).toBe(true);
  });

  // "several blocks with the same frequencies are merged": both blocks list 1, 2 and 3 GHz.
  it('one unreadable value in the first block does not discard the second block', () => {
    const text = [
      'BEGIN CH1_DATA',
      'Freq(Hz),S11(REAL),S11(IMAG)',
      '1e9,0.1,0',
      '2e9,x,0',
      '3e9,0.3,0',
      'END',
      'BEGIN CH2_DATA',
      'Freq(Hz),S21(REAL),S21(IMAG)',
      '1e9,0.5,0',
      '2e9,0.6,0',
      '3e9,0.7,0',
      'END',
    ].join('\n');
    const d = readVnaCsv(text);
    expect(d.frequencies).toEqual([1e9, 3e9]);
    expect(d.droppedBy.value).toBe(1);
    expect(d.parameters.S21?.map((v) => v.re)).toEqual([0.5, 0.7]);
  });
});

describe('qa2 vna-csv: parameter names the reader must not guess', () => {
  // S(2,1) is the transmission term; reading it as S11 turns a thru into a load.
  it('S(2,1) dB / deg columns are S21, not S11', () => {
    const d = readVnaCsv('Freq (Hz);S(2,1) dB;S(2,1) deg\n1e9;-1;0\n2e9;-2;-10\n');
    expect(d.parameters.S11).toBeUndefined();
    expect(vnaCsvParameterNames(d)).toEqual(['S21']);
  });

  it('S(2,2) re / im columns are S22, not S11', () => {
    const d = readVnaCsv('Freq\tS(2,2) re\tS(2,2) im\n1e9\t0.3\t0\n2e9\t0.4\t0\n');
    expect(d.parameters.S11).toBeUndefined();
    expect(vnaCsvParameterNames(d)).toEqual(['S22']);
  });

  it('S_21 re / im columns are S21, not S11', () => {
    const d = readVnaCsv('Freq,S_21 re,S_21 im\n1e9,0.5,0\n2e9,0.6,0\n');
    expect(d.parameters.S11).toBeUndefined();
    expect(vnaCsvParameterNames(d)).toEqual(['S21']);
  });
});

describe('qa2 vna-csv: header forms the guide lists', () => {
  // Guide: space separated tables, S11 as a dB/angle pair named like `S11 dB`.
  // -20 dB is a magnitude of 0.1; at 180 deg that is -0.1.
  it('a space separated header "Freq S11 dB S11 deg" reads S11 in dB and degrees', () => {
    const d = readVnaCsv('Freq S11 dB S11 deg\n1e6 -20 180\n2e6 -20 0\n');
    expect(c(d.parameters.S11?.[0]).re).toBeCloseTo(-0.1, 12);
    expect(c(d.parameters.S11?.[0]).im).toBeCloseTo(0, 12);
    expect(c(d.parameters.S11?.[1]).re).toBeCloseTo(0.1, 12);
  });

  // Freq_GHz is read as GHz (unit after an underscore); f_GHz should be as well.
  it('f_GHz is a frequency column in GHz like Freq_GHz', () => {
    const a = readVnaCsv('Freq_GHz,S11_re,S11_im\n1,0.1,0\n2,0.2,0\n');
    expect(a.frequencies).toEqual([1e9, 2e9]);
    const b = readVnaCsv('f_GHz,S11_re,S11_im\n1,0.1,0\n2,0.2,0\n');
    expect(b.frequencies).toEqual([1e9, 2e9]);
  });
});

describe('qa2 vna-csv: sorting and repeated frequencies', () => {
  it('unsorted rows with a repeat: ascending, first of the repeat kept, one note', () => {
    const d = readVnaCsv(
      'Freq(Hz),S11(REAL),S11(IMAG)\n3e9,0.3,0\n1e9,0.1,0\n2e9,0.2,0\n1e9,0.9,0\n',
    );
    expect(d.frequencies).toEqual([1e9, 2e9, 3e9]);
    expect(d.parameters.S11?.map((v) => v.re)).toEqual([0.1, 0.2, 0.3]);
    expect(d.dropped).toBe(1);
    expect(d.droppedBy).toEqual({ frequency: 0, value: 0, duplicate: 1 });
    expect(d.notes).toContain('1 row repeating a frequency dropped; the first was kept');
    expect(d.notes).not.toContain('Rows sorted by frequency');
  });

  it('descending rows without a repeat get the sorted note', () => {
    const d = readVnaCsv('Freq(Hz),S11(REAL),S11(IMAG)\n2e9,0.2,0\n1e9,0.1,0\n');
    expect(d.frequencies).toEqual([1e9, 2e9]);
    expect(d.notes).toContain('Rows sorted by frequency');
  });

  it('two repeats are counted in the plural', () => {
    const d = readVnaCsv(
      'Freq(Hz),S11(REAL),S11(IMAG)\n1e9,0.1,0\n1e9,0.2,0\n2e9,0.3,0\n2e9,0.4,0\n',
    );
    expect(d.notes).toContain('2 rows repeating a frequency dropped; the first was kept');
  });

  it('only one distinct frequency is refused with the repeat named', () => {
    expect(() => readVnaCsv('Freq(Hz),S11(REAL),S11(IMAG)\n1e9,0.1,0\n1e9,0.2,0\n')).toThrow(
      'Only 1 usable data row (dropped: 1 repeating a frequency); at least two are needed',
    );
  });

  it('a repeat across merged Keysight blocks keeps the same row of each block', () => {
    const d = readVnaCsv(
      [
        'BEGIN CH1_DATA',
        'Freq(Hz),S11(REAL),S11(IMAG)',
        '2e9,0.2,0',
        '1e9,0.1,0',
        '1e9,0.9,0',
        'END',
        'BEGIN CH2_DATA',
        'Freq(Hz),S21(REAL),S21(IMAG)',
        '2e9,0.6,0',
        '1e9,0.5,0',
        '1e9,0.8,0',
        'END',
      ].join('\n'),
    );
    expect(d.frequencies).toEqual([1e9, 2e9]);
    expect(d.parameters.S11?.map((v) => v.re)).toEqual([0.1, 0.2]);
    expect(d.parameters.S21?.map((v) => v.re)).toEqual([0.5, 0.6]);
  });
});

describe('qa2 vna-csv: Touchstone text detection', () => {
  it('an option line above comma separated rows is Touchstone text, and refused here', () => {
    const text = '# mhz s ri r 50\n100,0.5,0\n200,0.5,0\n';
    expect(isTouchstoneText(text)).toBe(true);
    expect(() => readVnaCsv(text)).toThrow(
      'Touchstone data (option line "# mhz s ri r 50"), not a VNA table: open it as .s1p or .s2p',
    );
  });

  it('an option line above a column header is not Touchstone text; its R is the Z0', () => {
    const text = '# Hz S RI R 75\nFreq,S11 re,S11 im\n1e6,0,0\n2e6,0,0\n';
    expect(isTouchstoneText(text)).toBe(false);
    const d = readVnaCsv(text);
    expect(d.z0).toBe(75);
    expect(d.z0Stated).toBe(true);
  });

  it('empty text, an option line alone, and rows without an option line are not Touchstone text', () => {
    expect(isTouchstoneText('')).toBe(false);
    expect(isTouchstoneText('# MHz S MA R 50\n')).toBe(false);
    expect(isTouchstoneText('1e6 0.1 0\n2e6 0.2 0\n')).toBe(false);
  });

  // optionLineR: "null when the comment is not an option line"; an R without a value is not one.
  it('"# Hz S RI R" without a value is a comment; the rows are a headerless VNA table at 50 ohm assumed', () => {
    const text = '# Hz S RI R\n1e6 0.1 0\n2e6 0.2 0\n';
    expect(isTouchstoneText(text)).toBe(false);
    const d = readVnaCsv(text);
    expect(d.kind).toBe('nanovna');
    expect(d.z0Stated).toBe(false);
    expect(c(d.parameters.S11?.[0])).toEqual({ re: 0.1, im: 0 });
  });
});

describe('qa2 vna-csv: error branches', () => {
  it('a header without rows: "No data rows below the header"', () => {
    expect(() => readVnaCsv('Freq(Hz),S11(REAL),S11(IMAG)\n')).toThrow(
      'No data rows below the header',
    );
  });

  it('a header naming a frequency only is refused for its missing value columns', () => {
    expect(() => readVnaCsv('Freq(Hz),Comment\n1e9,a\n2e9,b\n')).toThrow(VnaCsvError);
    expect(() => readVnaCsv('Freq(Hz),Comment\n1e9,a\n2e9,b\n')).toThrow(
      /^No S-parameter or impedance columns/,
    );
  });

  it('every reason is named when all rows are dropped', () => {
    expect(() =>
      readVnaCsv('Freq(Hz),S11(REAL),S11(IMAG)\n0,0.1,0\nx,0.1,0\n1e9,y,0\n2e9,0.1,0\n2e9,0.2,0\n'),
    ).toThrow(
      'Only 1 usable data row (dropped: 2 for a zero, negative or non-finite frequency, 1 for a value that is not a number, 1 repeating a frequency); at least two are needed',
    );
  });
});

describe('qa2 vna-csv: impedance helpers', () => {
  // S22 = 0 against 50 ohm is 50 ohm; S11 comes from R and X directly.
  it('vnaCsvImpedance of S22 in a file with R and X uses S22, not the impedance', () => {
    const d = readVnaCsv('Freq,R,X,S22 re,S22 im\n1e9,25,10,0,0\n2e9,30,0,0,0\n');
    expect(vnaCsvImpedance(d)[0]?.z).toEqual({ re: 25, im: 10 });
    const s22 = vnaCsvImpedance(d, 'S22');
    expect(s22[0]?.z.re).toBeCloseTo(50, 12);
    expect(s22[0]?.z.im).toBeCloseTo(0, 12);
  });

  // Gamma = (Z - Z0) / (Z + Z0) with Z = 100 and a stated Z0 of 75: 25 / 175 = 1/7.
  it('S11 from R and X uses the stated Z0', () => {
    const d = readVnaCsv('! Reference impedance: 75 Ohm\nFreq,R,X\n1e9,100,0\n2e9,75,0\n');
    expect(d.s11FromImpedance).toBe(true);
    expect(c(d.parameters.S11?.[0]).re).toBeCloseTo(1 / 7, 12);
    expect(c(d.parameters.S11?.[1]).re).toBeCloseTo(0, 12);
  });
});
