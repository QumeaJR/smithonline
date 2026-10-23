/** Adversarial tests, round 2, of the VNA CSV reader (commits 137ed2b and 4cf7e44). Each test states the correct behaviour. */
import { describe, expect, it } from 'vitest';
import {
  cabs,
  isTouchstoneText,
  readTouchstone,
  readVnaCsv,
  VnaCsvError,
  vnaCsvImpedance,
} from '../src/index';

const NAN = { re: NaN, im: NaN };

const readOrRefuse = (text: string): ReturnType<typeof readVnaCsv> | 'refused' => {
  try {
    return readVnaCsv(text);
  } catch (e) {
    if (e instanceof VnaCsvError) return 'refused';
    throw e;
  }
};

describe('adv2 vna: Touchstone text the detector misses', () => {
  it('an option line with a trailing ! comment is Touchstone, not RI in Hz', () => {
    const text = '# GHz S MA R 50 ! from the VNA\n1 0.5 90\n2 0.5 45\n3 0.4 30\n';
    expect(readTouchstone(text).points[0]?.frequency).toBe(1e9);
    expect(isTouchstoneText(text)).toBe(true);
    const r = readOrRefuse(text);
    if (r === 'refused') return;
    expect(r.frequencies[0]).toBe(1e9);
  });

  it('a bare "#" option line (all defaults: GHz S MA R 50) is Touchstone, not RI in Hz', () => {
    const text = '#\n1 0.5 90\n2 0.5 45\n3 0.4 30\n';
    expect(readTouchstone(text).points[0]?.frequency).toBe(1e9);
    expect(isTouchstoneText(text)).toBe(true);
    const r = readOrRefuse(text);
    if (r === 'refused') return;
    expect(r.frequencies[0]).toBe(1e9);
  });

  it('data rows with trailing ! comments are Touchstone', () => {
    const text = '# MHz S RI R 50\n100 0.5 0.1 ! marker 1\n200 0.4 0.2\n300 0.3 0.3\n';
    expect(readTouchstone(text).points).toHaveLength(3);
    expect(isTouchstoneText(text)).toBe(true);
  });

  it('Touchstone 2 text ([Version] 2.0) is recognized', () => {
    const text =
      '! TS2\n[Version] 2.0\n# GHz S MA R 50\n[Number of Ports] 1\n[Number of Frequencies] 3\n[Network Data]\n1 0.5 10\n2 0.5 20\n3 0.5 30\n[End]\n';
    expect(readTouchstone(text).points).toHaveLength(3);
    expect(isTouchstoneText(text)).toBe(true);
  });

  // Survived: a CSV with an option-like comment above a header is still a CSV.
  it('an option-like comment above a real header stays a CSV', () => {
    const text = '# Hz S RI R 75\nFreq(Hz),S11(REAL),S11(IMAG)\n1e9,0.1,0\n2e9,0.2,0\n3e9,0.3,0\n';
    expect(isTouchstoneText(text)).toBe(false);
    expect(readVnaCsv(text).z0).toBe(75);
  });
});

describe('adv2 vna: S(i,j) names (HFSS, ADS, Microwave Office)', () => {
  it('HFSS "dB(S(2,1)) []" alone is S21, not S11', () => {
    const text = '"Freq [GHz]","dB(S(2,1)) []","ang_deg(S(2,1)) [deg]"\n1,20,0\n2,19,0\n3,18,0\n';
    const r = readOrRefuse(text);
    if (r === 'refused') return;
    expect(r.parameters.S11).toBeUndefined();
    expect(cabs(r.parameters.S21?.[0] ?? NAN)).toBeCloseTo(10, 6);
  });

  it('HFSS "re(S(2,2))" alone is S22, not S11', () => {
    const text = '"Freq [GHz]","re(S(2,2)) []","im(S(2,2)) []"\n1,0.2,0\n2,0.2,0\n3,0.2,0\n';
    const r = readOrRefuse(text);
    if (r === 'refused') return;
    expect(r.parameters.S11).toBeUndefined();
  });

  it('Microwave Office "DB(|S(2,1)|)[1]" is S21, not S11', () => {
    const text = 'Freq(GHz)\tDB(|S(2,1)|)[1]\tAng(S(2,1))[1]\n1\t20\t0\n2\t20\t0\n3\t20\t0\n';
    const r = readOrRefuse(text);
    if (r === 'refused') return;
    expect(r.parameters.S11).toBeUndefined();
  });

  it('ADS dB(S(i,j)) columns in S11 S12 S21 S22 order keep their names', () => {
    const header =
      'freq\tdB(S(1,1))\tphase(S(1,1))\tdB(S(1,2))\tphase(S(1,2))\tdB(S(2,1))\tphase(S(2,1))\tdB(S(2,2))\tphase(S(2,2))';
    const row = (f: number): string => `${f}\t-10\t0\t-40\t0\t20\t0\t-12\t0`;
    const r = readOrRefuse([header, row(1e9), row(2e9), row(3e9)].join('\n'));
    if (r === 'refused') return;
    expect(cabs(r.parameters.S21?.[0] ?? NAN)).toBeCloseTo(10, 6);
    expect(cabs(r.parameters.S12?.[0] ?? NAN)).toBeCloseTo(0.01, 6);
  });

  it('quoted "S(1,2) re" columns in row-major order keep their names', () => {
    const header =
      'Freq,"S(1,1) re","S(1,1) im","S(1,2) re","S(1,2) im","S(2,1) re","S(2,1) im","S(2,2) re","S(2,2) im"';
    const row = (f: number): string => `${f},0.1,0,0.01,0,5,0,0.2,0`;
    const r = readOrRefuse([header, row(1e9), row(2e9), row(3e9)].join('\n'));
    if (r === 'refused') return;
    expect(r.parameters.S21?.[0]?.re).toBeCloseTo(5, 9);
    expect(r.parameters.S12?.[0]?.re).toBeCloseTo(0.01, 9);
  });

  // Survived: S[1,1] with a comma between digits in a space separated header.
  it('a space separated header "S[1,1]_re" reads', () => {
    const r = readVnaCsv('Freq S[1,1]_re S[1,1]_im\n1e9 0.1 0.2\n2e9 0.1 0.2\n3e9 0.1 0.2\n');
    expect(r.parameters.S11?.[0]?.im).toBeCloseTo(0.2, 9);
  });
});

describe('adv2 vna: columns that are not a reflection read as S11', () => {
  it('"Admittance Real", "Admittance Imag" are not S11', () => {
    const r = readOrRefuse(
      'Frequency,Admittance Real,Admittance Imag\n1e9,0.02,0\n2e9,0.02,0.01\n3e9,0.02,0.02\n',
    );
    if (r === 'refused') return;
    expect(r.parameters.S11).toBeUndefined();
  });

  it('"Re(Y)", "Im(Y)" are not S11', () => {
    const r = readOrRefuse('Freq(Hz),Re(Y),Im(Y)\n1e9,0.02,0\n2e9,0.02,0.01\n3e9,0.02,0.02\n');
    if (r === 'refused') return;
    expect(r.parameters.S11).toBeUndefined();
  });

  it('"Yin Re", "Yin Im" are not S11', () => {
    const r = readOrRefuse('Freq(Hz),Yin Re,Yin Im\n1e9,0.02,0\n2e9,0.02,0.01\n3e9,0.02,0.02\n');
    if (r === 'refused') return;
    expect(r.parameters.S11).toBeUndefined();
  });

  it('"Transmission (dB)", "Transmission Phase" are not S11', () => {
    const r = readOrRefuse(
      'Frequency (Hz),Transmission (dB),Transmission Phase (deg)\n1e9,-3,10\n2e9,-3,20\n3e9,-3,30\n',
    );
    if (r === 'refused') return;
    expect(r.parameters.S11).toBeUndefined();
  });

  it('"Thru Mag", "Thru Phase" are not S11', () => {
    const r = readOrRefuse('Frequency,Thru Mag,Thru Phase\n1e9,0.7,10\n2e9,0.7,20\n3e9,0.7,30\n');
    if (r === 'refused') return;
    expect(r.parameters.S11).toBeUndefined();
  });
});

describe('adv2 vna: header search', () => {
  it('a commented header after the data does not convert the rows above it', () => {
    const r = readOrRefuse('1e9 0.1 0.2\n2e9 0.1 0.2\n3e9 0.1 0.2\n# Freq S11_dB S11_deg\n');
    if (r === 'refused') return;
    // Headerless f re im is the documented reading.
    expect(r.parameters.S11?.[0]?.re).toBeCloseTo(0.1, 9);
  });

  it('a title line naming frequency and S11 dB does not hide the real header', () => {
    const r = readOrRefuse(
      'Frequency sweep,S11 dB plot\nFreq(Hz),S11(DB),S11(DEG)\n1e9,-10,30\n2e9,-11,31\n3e9,-12,32\n',
    );
    expect(r).not.toBe('refused');
  });

  it('S11 dB with an unnamed Phase column next to it pairs as S11', () => {
    const r = readOrRefuse('Freq (Hz),S11 dB,Phase\n1e9,-10,30\n2e9,-11,31\n3e9,-12,32\n');
    expect(r).not.toBe('refused');
  });

  it('a numpy header written with spaces over comma rows is read', () => {
    const r = readOrRefuse('# f S11_re S11_im\n1e9,0.1,0.2\n2e9,0.1,0.2\n3e9,0.1,0.2\n');
    expect(r).not.toBe('refused');
  });

  // Survived.
  it('a lone number in the preamble is not mistaken for the data', () => {
    const r = readOrRefuse(
      'My DUT\n3\nFreq(Hz),S11(REAL),S11(IMAG)\n1e9,0.1,0.2\n2e9,0.1,0.2\n3e9,0.1,0.2\n',
    );
    if (r === 'refused') return;
    expect(r.parameters.S11?.[0]?.re).toBeCloseTo(0.1, 9);
  });
  it('space separated rows with a decimal comma in the frequency only', () => {
    const r = readVnaCsv('Freq_GHz S11_re S11_im\n1,5 0.1 0.2\n2,5 0.1 0.2\n3,5 0.1 0.2\n');
    expect(r.frequencies[0]).toBeCloseTo(1.5e9, 0);
  });
  it('comma rows of integers under a header with spaces', () => {
    const r = readVnaCsv('Freq (Hz),S11 re,S11 im\n1000000,0,1\n2000000,0,1\n3000000,0,1\n');
    expect(r.parameters.S11?.[0]?.im).toBe(1);
  });
  it('unit token merging keeps "Re [S11]" apart from the next column', () => {
    const r = readVnaCsv(
      'Freq (Hz) Re [S11] Im [S11] Re [S21] Im [S21]\n1e9 0.1 0.2 3 0\n2e9 0.1 0.2 3 0\n3e9 0.1 0.2 3 0\n',
    );
    expect(r.parameters.S21?.[0]?.re).toBeCloseTo(3, 9);
  });
});

describe('adv2 vna: sorting and values (survived)', () => {
  it('descending R/X rows with a repeated frequency stay aligned', () => {
    const r = readVnaCsv('Freq(Hz),R,X\n3e9,30,3\n1e9,10,1\n2e9,20,2\n1e9,99,9\n');
    expect(r.frequencies).toEqual([1e9, 2e9, 3e9]);
    expect(vnaCsvImpedance(r).map((l) => l.z.re)).toEqual([10, 20, 30]);
    expect(r.droppedBy.duplicate).toBe(1);
  });
  it('two descending Keysight blocks are sorted together', () => {
    const text = [
      'BEGIN CH1_DATA',
      'Freq(Hz),S11(REAL),S11(IMAG)',
      '3e9,0.3,0',
      '2e9,0.2,0',
      '1e9,0.1,0',
      'END',
      'BEGIN CH2_DATA',
      'Freq(Hz),S21(REAL),S21(IMAG)',
      '3e9,3,0',
      '2e9,2,0',
      '1e9,1,0',
      'END',
    ].join('\n');
    const r = readVnaCsv(text);
    expect(r.parameters.S11?.map((c) => c.re)).toEqual([0.1, 0.2, 0.3]);
    expect(r.parameters.S21?.map((c) => c.re)).toEqual([1, 2, 3]);
  });
  it('NanoVNA two frequency columns, unsorted, stay aligned', () => {
    const r = readVnaCsv(
      'Frequency,S11 Re,S11 Im,Frequency,S21 Re,S21 Im\n3e9,0.3,0,3e9,3,0\n1e9,0.1,0,1e9,1,0\n2e9,0.2,0,2e9,2,0\n',
    );
    expect(r.parameters.S21?.map((c) => c.re)).toEqual([1, 2, 3]);
  });
  it('an ideal open (S11 = 1) row is kept and gives a finite impedance', () => {
    const r = readVnaCsv('Freq(Hz),S11(MAG),S11(DEG)\n1e6,1,0\n2e6,1,-10\n3e6,1,-20\n');
    expect(r.frequencies).toHaveLength(3);
    for (const l of vnaCsvImpedance(r)) expect(Number.isFinite(l.z.re)).toBe(true);
  });
  it('a "Port impedance check: 0" comment does not set Z0', () => {
    const r = readVnaCsv(
      '! Port impedance check: 0 errors\nFreq(Hz),S11(REAL),S11(IMAG)\n1e9,0.1,0\n2e9,0.2,0\n3e9,0.3,0\n',
    );
    expect(r.z0).toBe(50);
  });
});
