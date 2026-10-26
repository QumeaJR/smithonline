/** Adversarial tests of the VNA CSV reader (commit 137ed2b). Each test states the correct behaviour. */
import { describe, expect, it } from 'vitest';
import {
  cabs,
  readVnaCsv,
  sParametersAt,
  VnaCsvError,
  vnaCsvImpedance,
  vnaCsvToTouchstone,
} from '../src/index';

const finiteC = (c: { re: number; im: number }): boolean =>
  Number.isFinite(c.re) && Number.isFinite(c.im);

const readOrRefuse = (text: string): ReturnType<typeof readVnaCsv> | 'refused' => {
  try {
    return readVnaCsv(text);
  } catch (e) {
    if (e instanceof VnaCsvError) return 'refused';
    throw e;
  }
};

describe('adv vna: Touchstone text under .csv/.txt', () => {
  it('a 1-port Touchstone "# MHz S MA R 50" is not silently read as RI in Hz', () => {
    const text = '! made by a script\n# MHz S MA R 50\n100 0.5 90\n200 0.5 45\n';
    const r = readOrRefuse(text);
    if (r === 'refused') return;
    // If it is read at all, frequency must be 100 MHz and S11 = 0.5 at 90 deg.
    expect(r.frequencies[0]).toBe(100e6);
    expect(r.parameters.S11?.[0]?.im).toBeCloseTo(0.5, 9);
  });
  it('a 2-port "# GHz S DB R 50" is not read as RI in Hz', () => {
    const text = '# GHz S DB R 50\n1 -20 30 10 45 -40 0 -15 -60\n2 -21 31 9 40 -41 0 -16 -61\n';
    const r = readOrRefuse(text);
    if (r === 'refused') return;
    expect(r.frequencies[0]).toBe(1e9);
    expect(cabs(r.parameters.S11?.[0] ?? { re: NaN, im: NaN })).toBeCloseTo(0.1, 9);
  });
});

describe('adv vna: headers that are not S-parameters', () => {
  it('"Impedance Real/Imag" columns are impedance, not S11', () => {
    const r = readOrRefuse('Frequency (Hz),Impedance Real,Impedance Imag\n1e9,50,10\n2e9,60,-5\n');
    if (r === 'refused') return;
    expect(r.impedance?.[0]).toEqual({ re: 50, im: 10 });
  });
  it('"Zin Re/Im" columns are impedance, not S11', () => {
    const r = readOrRefuse('Freq [MHz],Zin Re,Zin Im\n100,50,10\n200,60,-5\n');
    if (r === 'refused') return;
    expect(r.impedance?.[0]).toEqual({ re: 50, im: 10 });
  });
  it('Y11(REAL), Y11(IMAG) are admittances, not S11', () => {
    const r = readOrRefuse('Freq(Hz),Y11(REAL),Y11(IMAG)\n1e9,0.02,0.001\n2e9,0.019,0.002\n');
    if (r === 'refused') return;
    // Admittance 0.02 S is 50 ohm, Gamma 0; read as S11 it is Gamma 0.02.
    expect(r.parameters.S11).toBeUndefined();
  });
  it('"S11 Return Loss (dB)" (positive dB) is not read as S11 in dB', () => {
    const r = readOrRefuse(
      'Frequency (Hz),S11 Return Loss (dB),S11 Phase (deg)\n1e9,20,0\n2e9,20,0\n',
    );
    if (r === 'refused') return;
    // A 20 dB return loss is |Gamma| = 0.1, never 10.
    expect(cabs(r.parameters.S11?.[0] ?? { re: 0, im: 0 })).toBeLessThanOrEqual(1);
  });
  it('a commented header (numpy savetxt "# f,S11_dB,S11_deg") is not read as re/im', () => {
    const r = readOrRefuse('# f,S11_dB,S11_deg\n1e9,-20,0\n2e9,-20,0\n');
    if (r === 'refused') return;
    expect(cabs(r.parameters.S11?.[0] ?? { re: 0, im: 0 })).toBeCloseTo(0.1, 9);
  });
});

describe('adv vna: frequency order', () => {
  it('descending frequencies are sorted or refused (the Touchstone reader refuses them)', () => {
    const text =
      'Freq(Hz),S11(REAL),S11(IMAG),S21(REAL),S21(IMAG),S12(REAL),S12(IMAG),S22(REAL),S22(IMAG)\n' +
      '3e9,0.3,0,1,0,0.1,0,0.3,0\n2e9,0.2,0,1,0,0.1,0,0.2,0\n1e9,0.1,0,1,0,0.1,0,0.1,0\n';
    const r = readOrRefuse(text);
    if (r === 'refused') return;
    const at = sParametersAt(vnaCsvToTouchstone(r), 1.5e9);
    expect(at?.s.s11.re).toBeCloseTo(0.15, 9);
    expect(at?.clamped).toBe(false);
  });
  it('unsorted frequencies give the right interpolated value', () => {
    const text =
      'Freq(Hz),S11(REAL),S11(IMAG),S21(REAL),S21(IMAG),S12(REAL),S12(IMAG),S22(REAL),S22(IMAG)\n' +
      '1e9,0.1,0,1,0,0.1,0,0.1,0\n3e9,0.3,0,1,0,0.1,0,0.3,0\n2e9,0.9,0,1,0,0.1,0,0.2,0\n';
    const r = readOrRefuse(text);
    if (r === 'refused') return;
    const at = sParametersAt(vnaCsvToTouchstone(r), 2.5e9);
    expect(at?.s.s11.re).toBeCloseTo(0.6, 9);
  });
});

describe('adv vna: values that overflow', () => {
  it('a dB value that overflows does not produce a non-finite S11', () => {
    const r = readOrRefuse('Freq(Hz),S11(DB),S11(DEG)\n1e9,7000,0\n2e9,-10,0\n');
    if (r === 'refused') return;
    for (const v of r.parameters.S11 ?? []) expect(finiteC(v)).toBe(true);
  });
  it('a huge RI Gamma does not produce a NaN impedance row', () => {
    const r = readOrRefuse('Freq(Hz),S11(REAL),S11(IMAG)\n1e9,1e200,0\n2e9,0.1,0\n');
    if (r === 'refused') return;
    for (const row of vnaCsvImpedance(r)) expect(finiteC(row.z)).toBe(true);
  });
  it('Gamma = 1 (open) gives a finite impedance row', () => {
    const r = readVnaCsv('Freq(Hz),S11(REAL),S11(IMAG)\n1e9,1,0\n2e9,1,0\n');
    for (const row of vnaCsvImpedance(r)) expect(finiteC(row.z)).toBe(true);
  });
  it('R = -Z0 (Gamma infinite) gives a finite S11', () => {
    const r = readVnaCsv('Freq(Hz),R,X\n1e9,-50,0\n2e9,25,0\n');
    for (const v of r.parameters.S11 ?? []) expect(finiteC(v)).toBe(true);
  });
  it('huge R gives a finite S11', () => {
    const r = readVnaCsv('Freq(Hz),R,X\n1e9,1e200,0\n2e9,25,0\n');
    for (const v of r.parameters.S11 ?? []) expect(finiteC(v)).toBe(true);
  });
});

describe('adv vna: Z0 statements', () => {
  it('Z0 0 or garbage falls back to 50 assumed', () => {
    expect(readVnaCsv('! Z0 = 0\nFreq,S11 re,S11 im\n1e9,0,0\n2e9,0,0\n').z0Stated).toBe(false);
    expect(readVnaCsv('! Z0 = abc\nFreq,S11 re,S11 im\n1e9,0,0\n2e9,0,0\n').z0Stated).toBe(false);
  });
  it('Z0 written with an exponent is read in full', () => {
    const r = readOrRefuse('! Z0 = 7.5e1\nFreq,S11 re,S11 im\n1e9,0,0\n2e9,0,0\n');
    if (r === 'refused') return;
    expect([75, 50]).toContain(r.z0);
  });
  it('Touchstone option line in another legal order still gives its R', () => {
    const r = readVnaCsv('# R 75 S RI GHz\nFreq(Hz),S11(REAL),S11(IMAG)\n1e9,0,0\n2e9,0,0\n');
    expect(r.z0).toBe(75);
  });
});

describe('adv vna: layout edge cases that survived', () => {
  it('BEGIN without END reads to the end of the file', () => {
    const r = readVnaCsv('BEGIN CH1_DATA\nFreq(Hz),S11(REAL),S11(IMAG)\n1e9,0.1,0\n2e9,0.2,0\n');
    expect(r.frequencies).toEqual([1e9, 2e9]);
  });
  it('BOM, CR endings, tabs, decimal commas', () => {
    const r = readVnaCsv('﻿Freq [MHz]\tS11 re\tS11 im\r1,5\t0,1\t0\r2,5\t0,2\t0\r');
    expect(r.frequencies).toEqual([1.5e6, 2.5e6]);
  });
  it('empty, BOM only, comments only, binary garbage are refused with VnaCsvError', () => {
    for (const t of ['', '﻿', '! a\n# b\n', '\u0000\u0001\u0002ÿ\n\u0003']) {
      expect(() => readVnaCsv(t)).toThrow(VnaCsvError);
    }
  });
  it('NaN, Infinity and empty cells drop the row', () => {
    const r = readVnaCsv(
      'Freq,S11 re,S11 im\n1e9,NaN,0\n2e9,Infinity,0\n3e9,,0\n4e9,0.1,0\n5e9,0.2,0\n',
    );
    expect(r.frequencies).toEqual([4e9, 5e9]);
    expect(r.dropped).toBe(3);
  });
  it('a 200k-row file reads in reasonable time', () => {
    const rows = ['Freq(Hz),S11(REAL),S11(IMAG)'];
    for (let i = 1; i <= 200_000; i++) rows.push(`${i * 1e3},0.1,0.2`);
    const t0 = performance.now();
    const r = readVnaCsv(rows.join('\n'));
    expect(r.frequencies.length).toBe(200_000);
    expect(performance.now() - t0).toBeLessThan(15000);
  });
  it('space-delimited header with a separate unit token keeps the unit or refuses', () => {
    const r = readOrRefuse('Freq (MHz) Re Im\n100 0.1 0\n200 0.2 0\n');
    if (r === 'refused') return;
    expect(r.frequencies[0]).toBe(100e6);
  });
});

describe('adv vna: error wording and preambles', () => {
  it('quoted decimal-comma cells in a comma file: the error does not blame the frequency', () => {
    const text = '"Freq [MHz]","S11 re","S11 im"\n"100","0,5","0,1"\n"200","0,4","0,2"\n';
    let msg: string;
    try {
      const r = readVnaCsv(text);
      expect(r.parameters.S11?.[0]?.re).toBeCloseTo(0.5, 9);
      return;
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).not.toMatch(/finite, non-zero frequency/);
  });
  it('an unquoted title line with a comma that mentions Frequency does not hide the real header', () => {
    const r = readOrRefuse(
      'DUT 7, Frequency sweep\nFreq(Hz),S11(REAL),S11(IMAG)\n1e9,0.1,0\n2e9,0.2,0\n',
    );
    expect(r).not.toBe('refused');
  });
});
