/** Adversarial tests, round 3, of the VNA CSV reader (commits 137ed2b, 4cf7e44, 778ad24). Each test states the correct behaviour; synthetic inputs only. */
import { describe, expect, it } from 'vitest';
import { isTouchstoneText, readVnaCsv, VnaCsvError } from '../src/index';

const readOrRefuse = (text: string): ReturnType<typeof readVnaCsv> | string => {
  try {
    return readVnaCsv(text);
  } catch (e) {
    if (e instanceof VnaCsvError) return e.message;
    throw e;
  }
};

describe('adv3 vna: a blank # comment is taken for a Touchstone option line', () => {
  it('a blank "#" line above a commented header is not Touchstone text', () => {
    const text = '#\n# f S11_re S11_im\n1e6 0.1 0.2\n2e6 0.2 0.1\n3e6 0.3 0\n';
    expect(isTouchstoneText(text)).toBe(false);
    const r = readVnaCsv(text);
    expect(r.frequencies).toEqual([1e6, 2e6, 3e6]);
    expect(r.parameters.S11?.[0]?.im).toBeCloseTo(0.2, 9);
  });
  it('numpy savetxt with a header ending in a newline (a trailing "# " line) reads', () => {
    const text = '# f S11_re S11_im\n# \n1e6 0.1 0.2\n2e6 0.2 0.1\n3e6 0.3 0\n';
    expect(isTouchstoneText(text)).toBe(false);
    expect(readVnaCsv(text).parameters.S11?.[0]?.im).toBeCloseTo(0.2, 9);
  });
  it('a blank "#" separator between comment lines does not make the file Touchstone', () => {
    const text = '# Measured antenna\n#\n# f,S11_re,S11_im\n1e6,0.1,0.2\n2e6,0.2,0.1\n3e6,0.3,0\n';
    expect(isTouchstoneText(text)).toBe(false);
  });
});

describe('adv3 vna: the row delimiter comes from the line under the header', () => {
  it('a dashed underline under a comma header does not hide the rows', () => {
    const r = readVnaCsv('Freq,S11 dB,S11 deg\n-------------------\n1e9,-10,45\n2e9,-20,0\n');
    expect(r.frequencies).toEqual([1e9, 2e9]);
    expect(r.parameters.S11?.[1]?.re).toBeCloseTo(0.1, 9);
  });
  it('a dashed underline under a semicolon header does not hide the rows', () => {
    const r = readVnaCsv('Freq;S11 dB;S11 deg\n---\n1e9;-10;45\n2e9;-20;0\n');
    expect(r.frequencies).toEqual([1e9, 2e9]);
  });
  // Survived.
  it('a "=====" underline under a tab header reads', () => {
    const r = readVnaCsv('Freq\tS11 dB\tS11 deg\n=================\n1e9\t-10\t45\n2e9\t-20\t0\n');
    expect(r.frequencies).toEqual([1e9, 2e9]);
  });
});

describe('adv3 vna: one parameter written twice becomes S21', () => {
  it('Real, Imaginary, Magnitude, Phase of one reflection do not invent an S21', () => {
    const r = readVnaCsv(
      'Frequency (Hz),Real,Imaginary,Magnitude,Phase\n1e6,0.1,0.2,0.2236,63.43\n2e6,0.2,0.1,0.2236,26.57\n',
    );
    expect(r.parameters.S11?.[0]?.im).toBeCloseTo(0.2, 9);
    expect(r.parameters.S21).toBeUndefined();
  });
  it('S11 Re, S11 Im followed by unnamed Mag, Phase do not invent an S21', () => {
    const r = readVnaCsv(
      'Freq,S11 Re,S11 Im,Mag,Phase\n1e6,0.1,0.2,0.2236,63.43\n2e6,0.2,0.1,0.2236,26.57\n',
    );
    expect(r.parameters.S21).toBeUndefined();
  });
});

describe('adv3 vna: files round 1 read that round 2 refuses', () => {
  const s11 = (header: string): void => {
    const r = readOrRefuse(`${header}\n1e6,0.1,0.2\n2e6,0.2,0.1\n`);
    expect(typeof r).not.toBe('string');
    if (typeof r === 'string') return;
    expect(r.parameters.S11?.[0]?.im).toBeCloseTo(0.2, 9);
  };
  it('"Real (U)", "Imag (U)" (unitless unit token)', () => s11('Freq,Real (U),Imag (U)'));
  it('"Gamma Re", "Gamma Im"', () => s11('Frequency,Gamma Re,Gamma Im'));
  it('"Reflection Real", "Reflection Imag"', () =>
    s11('Frequency,Reflection Real,Reflection Imag'));
  it('"s_re 11", "s_im 11"', () => s11('Freq(Hz),s_re 11,s_im 11'));
  it('"s_db 11, s_deg 11, s_db 21, s_deg 21" keep S11 and S21', () => {
    const r = readOrRefuse(
      'Freq(Hz),s_db 11,s_deg 11,s_db 21,s_deg 21\n1e9,-10,45,-3,10\n2e9,-20,0,-4,20\n',
    );
    expect(typeof r).not.toBe('string');
    if (typeof r === 'string') return;
    expect(r.formats.S11).toBe('DB');
    expect(r.formats.S21).toBe('DB');
  });
});

describe('adv3 vna: Keysight blocks matched line by line', () => {
  it('a units line under the second block header does not skip that block', () => {
    const r = readVnaCsv(
      'BEGIN CH1_DATA\nFreq(Hz),S11(REAL),S11(IMAG)\n1e9,0.1,0.2\n2e9,0.2,0.1\nEND\n' +
        'BEGIN CH2_DATA\nFreq(Hz),S21(REAL),S21(IMAG)\nHz,U,U\n1e9,0.5,0\n2e9,0.4,0\nEND\n',
    );
    expect(r.parameters.S21?.[0]?.re).toBeCloseTo(0.5, 9);
  });
  it('an unreadable frequency on one line of the first block does not skip the second block', () => {
    const r = readVnaCsv(
      'BEGIN CH1_DATA\nFreq(Hz),S11(REAL),S11(IMAG)\n1e9,0.1,0.2\nxx,0.2,0.1\n3e9,0.3,0\nEND\n' +
        'BEGIN CH2_DATA\nFreq(Hz),S21(REAL),S21(IMAG)\n1e9,0.5,0\n2e9,0.4,0\n3e9,0.4,0\nEND\n',
    );
    expect(r.parameters.S21).toBeDefined();
  });
  // Survived.
  it('blocks with different layouts, delimiters and units merge', () => {
    const r = readVnaCsv(
      'BEGIN CH1_DATA\nFreq(Hz),S11(REAL),S11(IMAG)\n1e9,0.1,0.2\n2e9,0.2,0.1\nEND\n' +
        'BEGIN CH2_DATA\nFreq(GHz);S21(DB);S21(DEG)\n1;-3;10\n2;-4;20\nEND\n',
    );
    expect(r.formats.S21).toBe('DB');
    expect(r.frequencies).toEqual([1e9, 2e9]);
  });
  it('a bad value in the second block drops that row in both blocks', () => {
    const r = readVnaCsv(
      'BEGIN CH1_DATA\nFreq(Hz),S11(REAL),S11(IMAG)\n1e9,0.1,0.2\n2e9,0.2,0.1\n3e9,0.3,0\nEND\n' +
        'BEGIN CH2_DATA\nFreq(Hz),S21(REAL),S21(IMAG)\n1e9,0.5,0\n2e9,,0\n3e9,0.4,0\nEND\n',
    );
    expect(r.frequencies).toEqual([1e9, 3e9]);
    expect(r.parameters.S21?.[1]?.re).toBeCloseTo(0.4, 9);
  });
  it('a shorter second block is skipped with a note', () => {
    const r = readVnaCsv(
      'BEGIN CH1_DATA\nFreq(Hz),S11(REAL),S11(IMAG)\n1e9,0.1,0.2\n2e9,0.2,0.1\n3e9,0.3,0\nEND\n' +
        'BEGIN CH2_DATA\nFreq(Hz),S21(REAL),S21(IMAG)\n1e9,0.5,0\n2e9,0.4,0\nEND\n',
    );
    expect(r.parameters.S21).toBeUndefined();
    expect(r.notes.join(' ')).toMatch(/CH2_DATA skipped/);
  });
});

describe('adv3 vna: quoted thousands separators', () => {
  it('"1,400" in a MHz column of a comma file is not 1.4 MHz', () => {
    const r = readOrRefuse(
      'Freq (MHz),S11 dB,S11 deg\n"1,400",-10,45\n"1,500",-20,0\n"1,600",-15,10\n',
    );
    if (typeof r === 'string') return;
    expect(r.frequencies[0]).not.toBeCloseTo(1.4e6, 0);
  });
  it('"900,000" Hz is not 900 Hz while "1,000,000" in the same column is dropped', () => {
    const r = readOrRefuse(
      'Freq (Hz),S11 dB,S11 deg\n"800,000",-10,45\n"900,000",-12,40\n"1,000,000",-20,0\n',
    );
    if (typeof r === 'string') return;
    expect(r.frequencies[0]).toBe(8e5);
  });
});

describe('adv3 vna: preamble rows of numbers', () => {
  it('a settings row of numbers above the header does not give "No frequency column"', () => {
    const r = readOrRefuse(
      'Start,Stop,Points\n1000000,3000000,3\nFreq,S11 re,S11 im\n1e6,0.1,0.2\n2e6,0.2,0.1\n3e6,0.3,0\n',
    );
    if (typeof r === 'string') expect(r).not.toMatch(/No frequency column/);
    else expect(r.frequencies).toEqual([1e6, 2e6, 3e6]);
  });
});

describe('adv3 vna: survived', () => {
  it('S_NAME false positives: Pass 12, Ports 12, S/N 12 dB, Sweeps 12, Time_s 12', () => {
    for (const extra of ['Pass 12', 'Sweeps 12', 'Time_s 12', 'S/N 12 dB']) {
      const r = readVnaCsv(`Freq,S11 re,S11 im,${extra}\n1e6,0.1,0.2,1\n2e6,0.2,0.1,1\n`);
      expect(Object.keys(r.parameters)).toEqual(['S11']);
    }
    expect(readOrRefuse('Freq,Ports 12 Re,Ports 12 Im\n1e9,0.1,0.2\n2e9,0.2,0.1\n')).toBeTypeOf(
      'string',
    );
  });
  it('R&S style re:Trc1_S11; im:Trc1_S11 with decimal commas', () => {
    const r = readVnaCsv(
      'freq[Hz];re:Trc1_S11;im:Trc1_S11;re:Trc2_S21;im:Trc2_S21\n1000000;0,1;0,2;0,5;0\n2000000;0,2;0,1;0,4;0\n',
    );
    expect(r.parameters.S21?.[0]?.re).toBeCloseTo(0.5, 9);
  });
  it('NanoVNA-Saver and LibreVNA fixture shapes still read', () => {
    expect(readVnaCsv('Frequency,Re,Im\n7000000,0.2,0.1\n7100000,0.1,0\n').kind).toBe('nanovna');
    const r = readVnaCsv(
      'Frequency,S11_real,S11_imag,Frequency,S21_real,S21_imag\n1000000,0.5,0,1000000,0.1,0\n2000000,0.4,0.1,2000000,0.2,0.1\n',
    );
    expect(r.parameters.S21?.[1]?.im).toBeCloseTo(0.1, 9);
  });
  it('space header merges: "Freq S11 re im S21 re im", "Freq Hz Re Im", "Freq S11 Real S11 Imag"', () => {
    expect(
      readVnaCsv('Freq S11 re im S21 re im\n1e9 0.1 0.2 0.5 0\n2e9 0.2 0.1 0.4 0\n').parameters
        .S21?.[0]?.re,
    ).toBeCloseTo(0.5, 9);
    expect(readVnaCsv('Freq Hz Re Im\n1e9 0.1 0.2\n2e9 0.2 0.1\n').frequencies).toEqual([1e9, 2e9]);
    expect(
      readVnaCsv('Freq S11 Real S11 Imag\n1e9 0.1 0.2\n2e9 0.2 0.1\n').parameters.S11?.[0]?.im,
    ).toBeCloseTo(0.2, 9);
  });
  it('an option line above headerless comma rows is Touchstone text; a "[Data]" line is not', () => {
    expect(isTouchstoneText('# Hz S RI R 50\n1e6,0.1,0.2\n2e6,0.2,0.1\n')).toBe(true);
    expect(isTouchstoneText('[Data]\nFreq,S11 re,S11 im\n1e6,0.1,0.2\n2e6,0.2,0.1\n')).toBe(false);
  });
});
