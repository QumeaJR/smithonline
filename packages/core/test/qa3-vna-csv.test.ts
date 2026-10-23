/**
 * QA round 3 for the VNA CSV reader (commits 137ed2b, 4cf7e44, 778ad24):
 * the line-by-line Keysight merge, the header choice, the unnamed column
 * rule, the header/row delimiter split and the doc claims of
 * docs/06-user-guide.md section 9. Expected values are hand calculations.
 */
import { describe, expect, it } from 'vitest';
import { readVnaCsv, vnaCsvParameterNames, type Complex } from '../src/index';

const c = (v: Complex | undefined): Complex => v as Complex;

describe('qa3 vna-csv: Keysight line-by-line merge', () => {
  it('a second block with one row more is skipped with a note; the first stays whole', () => {
    const d = readVnaCsv(
      [
        'BEGIN CH1_DATA',
        'Freq(Hz),S11(REAL),S11(IMAG)',
        '1e9,0.1,0',
        '2e9,0.2,0',
        'END',
        'BEGIN CH2_DATA',
        'Freq(Hz),S21(REAL),S21(IMAG)',
        '1e9,0.5,0',
        '2e9,0.6,0',
        '3e9,0.7,0',
        'END',
      ].join('\n'),
    );
    expect(d.frequencies).toEqual([1e9, 2e9]);
    expect(d.parameters.S11?.map((v) => v.re)).toEqual([0.1, 0.2]);
    expect(d.parameters.S21).toBeUndefined();
    expect(d.notes).toContain('CH2_DATA skipped: its frequencies differ from CH1_DATA');
  });

  it('a second block with one row less is skipped with a note', () => {
    const d = readVnaCsv(
      [
        'BEGIN CH1_DATA',
        'Freq(Hz),S11(REAL),S11(IMAG)',
        '1e9,0.1,0',
        '2e9,0.2,0',
        '3e9,0.3,0',
        'END',
        'BEGIN CH2_DATA',
        'Freq(Hz),S21(REAL),S21(IMAG)',
        '1e9,0.5,0',
        '2e9,0.6,0',
        'END',
      ].join('\n'),
    );
    expect(d.frequencies).toEqual([1e9, 2e9, 3e9]);
    expect(d.parameters.S21).toBeUndefined();
    expect(d.notes).toContain('CH2_DATA skipped: its frequencies differ from CH1_DATA');
  });

  it("the second block's bad value drops that line in the first block too", () => {
    const d = readVnaCsv(
      [
        'BEGIN CH1_DATA',
        'Freq(Hz),S11(REAL),S11(IMAG)',
        '1e9,0.1,0',
        '2e9,0.2,0',
        '3e9,0.3,0',
        'END',
        'BEGIN CH2_DATA',
        'Freq(Hz),S21(DB),S21(DEG)',
        '1e9,-20,0',
        '2e9,NaN,0',
        '3e9,0,90',
        'END',
      ].join('\n'),
    );
    expect(d.frequencies).toEqual([1e9, 3e9]);
    expect(d.parameters.S11?.map((v) => v.re)).toEqual([0.1, 0.3]);
    // -20 dB at 0 deg = 0.1; 0 dB at 90 deg = j1.
    expect(c(d.parameters.S21?.[0]).re).toBeCloseTo(0.1, 12);
    expect(c(d.parameters.S21?.[1]).im).toBeCloseTo(1, 12);
    expect(d.droppedBy).toEqual({ frequency: 0, value: 1, duplicate: 0 });
    expect(d.dropped).toBe(1);
  });

  it('a bad value on different lines of each block drops both lines everywhere', () => {
    const d = readVnaCsv(
      [
        'BEGIN CH1_DATA',
        'Freq(Hz),S11(REAL),S11(IMAG)',
        '1e9,x,0',
        '2e9,0.2,0',
        '3e9,0.3,0',
        '4e9,0.4,0',
        'END',
        'BEGIN CH2_DATA',
        'Freq(Hz),S21(REAL),S21(IMAG)',
        '1e9,0.5,0',
        '2e9,0.6,0',
        '3e9,,0',
        '4e9,0.8,0',
        'END',
      ].join('\n'),
    );
    expect(d.frequencies).toEqual([2e9, 4e9]);
    expect(d.parameters.S11?.map((v) => v.re)).toEqual([0.2, 0.4]);
    expect(d.parameters.S21?.map((v) => v.re)).toEqual([0.6, 0.8]);
    expect(d.droppedBy.value).toBe(2);
  });

  it('a 0 Hz line in both blocks is a frequency drop, counted once', () => {
    const d = readVnaCsv(
      [
        'BEGIN CH1_DATA',
        'Freq(Hz),S11(REAL),S11(IMAG)',
        '0,0.9,0',
        '1e9,0.1,0',
        '2e9,0.2,0',
        'END',
        'BEGIN CH2_DATA',
        'Freq(Hz),S21(REAL),S21(IMAG)',
        '0,0.9,0',
        '1e9,0.5,0',
        '2e9,0.6,0',
        'END',
      ].join('\n'),
    );
    expect(d.frequencies).toEqual([1e9, 2e9]);
    expect(d.parameters.S21?.map((v) => v.re)).toEqual([0.5, 0.6]);
    expect(d.droppedBy).toEqual({ frequency: 1, value: 0, duplicate: 0 });
  });

  it('a block in MHz with the same sweep as a block in Hz is merged', () => {
    const d = readVnaCsv(
      [
        'BEGIN CH1_DATA',
        'Freq(Hz),S11(REAL),S11(IMAG)',
        '1000000,0.1,0',
        '2000000,0.2,0',
        'END',
        'BEGIN CH2_DATA',
        'Freq(MHz),S21(REAL),S21(IMAG)',
        '1,0.5,0',
        '2,0.6,0',
        'END',
      ].join('\n'),
    );
    expect(d.parameters.S21?.map((v) => v.re)).toEqual([0.5, 0.6]);
  });

  // Round 2 triage: "a bad row in one block drops that row everywhere instead of
  // skipping the block". A row whose frequency cell is unreadable in one block only
  // is such a bad row.
  it('an unreadable frequency on one line of the second block drops that line, not the block', () => {
    const d = readVnaCsv(
      [
        'BEGIN CH1_DATA',
        'Freq(Hz),S11(REAL),S11(IMAG)',
        '1e9,0.1,0',
        '2e9,0.2,0',
        '3e9,0.3,0',
        'END',
        'BEGIN CH2_DATA',
        'Freq(Hz),S21(REAL),S21(IMAG)',
        '1e9,0.5,0',
        'x,0.6,0',
        '3e9,0.7,0',
        'END',
      ].join('\n'),
    );
    expect(d.parameters.S21?.map((v) => v.re)).toEqual([0.5, 0.7]);
    expect(d.frequencies).toEqual([1e9, 3e9]);
    expect(d.dropped).toBe(1);
  });

  it('the same skip note from two blocks is listed once', () => {
    const d = readVnaCsv(
      [
        'BEGIN CH1_DATA',
        'Freq(Hz),S11(REAL),S11(IMAG),Y11(REAL),Y11(IMAG)',
        '1e9,0.1,0,1,0',
        '2e9,0.2,0,1,0',
        'END',
        'BEGIN CH2_DATA',
        'Freq(Hz),S21(REAL),S21(IMAG),Y11(REAL),Y11(IMAG)',
        '1e9,0.5,0,1,0',
        '2e9,0.6,0,1,0',
        'END',
      ].join('\n'),
    );
    expect(d.notes.filter((n) => n === 'Y11 skipped: only S-parameters are read')).toHaveLength(1);
  });
});

describe('qa3 vna-csv: header choice', () => {
  it('a units row below the header is not the header; the values are read', () => {
    const d = readVnaCsv('Freq,S11 re,S11 im\nHz,U,U\n1e6,0.1,0.2\n2e6,0.3,0.4\n');
    expect(d.frequencies).toEqual([1e6, 2e6]);
    expect(c(d.parameters.S11?.[0]).im).toBeCloseTo(0.2, 12);
  });

  it('of two full headers above the data the last one is used', () => {
    const d = readVnaCsv(
      'Freq(Hz),S21(REAL),S21(IMAG)\nFreq(Hz),S11(REAL),S11(IMAG)\n1e9,0.1,0\n2e9,0.2,0\n',
    );
    expect(vnaCsvParameterNames(d)).toEqual(['S11']);
  });

  it('a commented header above a non-comment frequency-only header with no values wins', () => {
    const d = readVnaCsv('# Freq,S11 re,S11 im\nFrequency\n1e6,0.1,0.2\n2e6,0.3,0.4\n');
    expect(c(d.parameters.S11?.[1]).re).toBeCloseTo(0.3, 12);
  });

  // A lone count line such as "201" between a title and the header made the
  // reader stop looking at the header and refuse with "No frequency column".
  it('a lone number line in the preamble does not hide the header below it', () => {
    const d = readVnaCsv('My DUT\n201\nFreq(Hz),S11(REAL),S11(IMAG)\n1e9,0.1,0.2\n2e9,0.3,0.4\n');
    expect(d.frequencies).toEqual([1e9, 2e9]);
    expect(c(d.parameters.S11?.[0]).re).toBeCloseTo(0.1, 12);
  });
});

describe('qa3 vna-csv: space separated headers with unit tokens', () => {
  // -20 dB at 0 deg is 0.1; -6.0206 dB is 0.5.
  it('"S21 Mag (dB) S21 Phase (deg)" is S21, not S11', () => {
    const d = readVnaCsv('Freq S21 Mag (dB) S21 Phase (deg)\n1e9 -20 0\n2e9 -20 0\n');
    expect(d.parameters.S11).toBeUndefined();
    expect(c(d.parameters.S21?.[0]).re).toBeCloseTo(0.1, 12);
  });

  it('"S22 Magnitude (dB) S22 Phase (deg)" is S22, not S11', () => {
    const d = readVnaCsv('Freq S22 Magnitude (dB) S22 Phase (deg)\n1e9 -20 0\n2e9 -20 0\n');
    expect(vnaCsvParameterNames(d)).toEqual(['S22']);
  });

  // The guide's own example "S11 Phase (deg)" in a space separated header.
  it('"Freq S11 dB S11 Phase (deg)" is S11 dB/deg', () => {
    const d = readVnaCsv('Freq S11 dB S11 Phase (deg)\n1e9 -20 0\n2e9 -20 0\n');
    expect(c(d.parameters.S11?.[0]).re).toBeCloseTo(0.1, 12);
  });
});

describe('qa3 vna-csv: unnamed column words', () => {
  it('"Real part", "Imaginary part" are S11 re/im', () => {
    const d = readVnaCsv('Frequency (Hz),Real part,Imaginary part\n1e9,0.1,0.2\n2e9,0.3,0.4\n');
    expect(c(d.parameters.S11?.[0]).im).toBeCloseTo(0.2, 12);
  });

  it('"Log Mag (dB)", "Phase (°)" are S11 dB/deg', () => {
    const d = readVnaCsv('Frequency (Hz),Log Mag (dB),Phase (°)\n1e9,-20,90\n2e9,-20,90\n');
    // -20 dB at 90 deg = j0.1.
    expect(c(d.parameters.S11?.[0]).re).toBeCloseTo(0, 12);
    expect(c(d.parameters.S11?.[0]).im).toBeCloseTo(0.1, 12);
  });

  it('"Magnitude [linear]", "Phase [rad]" are S11 mag/rad', () => {
    const d = readVnaCsv('Freq [MHz],Magnitude [linear],Phase [rad]\n1,0.5,0\n2,0.5,0\n');
    expect(d.formats.S11).toBe('MA');
    expect(c(d.parameters.S11?.[0]).re).toBeCloseTo(0.5, 12);
    expect(d.frequencies).toEqual([1e6, 2e6]);
  });

  // Decision (round 3, with the adversary): gamma is the reflection coefficient, so
  // "Gamma Real", "Gamma Imag" are read as S11 like "Re", "Im".
  it('"Gamma Real", "Gamma Imag" are read as S11', () => {
    const d = readVnaCsv('Freq,Gamma Real,Gamma Imag\n1e9,0.1,0.2\n2e9,0.3,0.4\n');
    expect(d.parameters.S11?.[0]).toEqual({ re: 0.1, im: 0.2 });
  });

  // Guide section 9: "return loss, SWR and delay columns are skipped with a note".
  it('VSWR, Return Loss and Group Delay columns without a parameter name get a note', () => {
    const d = readVnaCsv(
      'Freq,S11 re,S11 im,VSWR,Return Loss,Group Delay\n1e9,0.1,0,1.2,20,1e-9\n2e9,0.2,0,1.5,14,1e-9\n',
    );
    expect(d.notes.some((n) => n.includes('VSWR'))).toBe(true);
    expect(d.notes.some((n) => n.includes('Return Loss'))).toBe(true);
    expect(d.notes.some((n) => n.includes('Group Delay'))).toBe(true);
  });
});

describe('qa3 vna-csv: header and row delimiters', () => {
  it('a tab header over semicolon rows with decimal commas', () => {
    const d = readVnaCsv('Freq\tS11 re\tS11 im\n1000000;0,1;0,2\n2000000;0,3;0,4\n');
    expect(c(d.parameters.S11?.[0]).re).toBeCloseTo(0.1, 12);
    expect(c(d.parameters.S11?.[1]).im).toBeCloseTo(0.4, 12);
  });

  it('a semicolon header over comma rows with dot decimals', () => {
    const d = readVnaCsv('Freq [kHz];S11 re;S11 im\n1,0.1,0.2\n2,0.3,0.4\n');
    expect(d.frequencies).toEqual([1e3, 2e3]);
    expect(c(d.parameters.S11?.[0]).im).toBeCloseTo(0.2, 12);
  });

  it('a comma header over space rows with decimal commas', () => {
    const d = readVnaCsv('Freq,S11 re,S11 im\n1000000 0,1 0,2\n2000000 0,3 0,4\n');
    expect(c(d.parameters.S11?.[0]).re).toBeCloseTo(0.1, 12);
  });

  it('a space header with S(1,1) names over comma rows', () => {
    const d = readVnaCsv('freq S(1,1) re S(1,1) im\n1e9,0.1,0.2\n2e9,0.3,0.4\n');
    expect(c(d.parameters.S11?.[0]).im).toBeCloseTo(0.2, 12);
  });

  it('a Keysight block with a semicolon header over comma rows', () => {
    const d = readVnaCsv(
      'BEGIN CH1_DATA\nFreq(Hz);S11(REAL);S11(IMAG)\n1e9,0.1,0.2\n2e9,0.3,0.4\nEND\n',
    );
    expect(c(d.parameters.S11?.[1]).re).toBeCloseTo(0.3, 12);
  });
});
