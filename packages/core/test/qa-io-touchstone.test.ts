import { describe, expect, it } from 'vitest';
import {
  cabs,
  cargDeg,
  complex,
  impedanceRows,
  noiseAt,
  polarDeg,
  readTouchstone,
  reflectionAt,
  renormalizeGamma,
  sIndex,
  sParametersAt,
  TouchstoneError,
  writeTouchstone,
} from '../src/index';

// One frequency, two ports, RI: S11 = 0.1, S21 = 0.3, S12 = 0.2, S22 = 0.4.
const ONE_POINT_2P = '# MHZ S RI R 50\n100 0.1 0 0.3 0 0.2 0 0.4 0\n';

describe('qa: lookup at the ends, at a sample and in single-point files', () => {
  it('holds a single-point two-port at every frequency and reports the clamp', () => {
    const d = readTouchstone(ONE_POINT_2P, 2);
    for (const [f, clamped] of [
      [50e6, true],
      [100e6, false],
      [200e6, true],
    ] as const) {
      const at = sParametersAt(d, f)!;
      expect(at.s.s11.re).toBe(0.1);
      expect(at.s.s12.re).toBe(0.2);
      expect(at.s.s21.re).toBe(0.3);
      expect(at.s.s22.re).toBe(0.4);
      expect(at.clamped).toBe(clamped);
      expect(at.covers).toEqual([100e6, 100e6]);
    }
  });

  it('returns the sample at a sample frequency and the ends outside the range', () => {
    const one = readTouchstone('# GHZ S RI R 50\n1 0.1 0\n2 0.2 0\n3 0.9 0\n', 1);
    expect(reflectionAt(one, 1e9)!.re).toBeCloseTo(0.1, 15);
    expect(reflectionAt(one, 2e9)!.re).toBeCloseTo(0.2, 15);
    expect(reflectionAt(one, 3e9)!.re).toBeCloseTo(0.9, 15);
    expect(reflectionAt(one, 1.25e9)!.re).toBeCloseTo(0.125, 15);
    expect(reflectionAt(one, 2.5e9)!.re).toBeCloseTo(0.55, 15);
    expect(reflectionAt(one, 0.5e9)!.re).toBeCloseTo(0.1, 15);
    expect(reflectionAt(one, 4e9)!.re).toBeCloseTo(0.9, 15);

    const two = readTouchstone(
      '# GHZ S RI R 50\n1 0.1 0 0 0 0 0 0 0\n2 0.2 0 0 0 0 0 0 0\n3 0.9 0 0 0 0 0 0 0\n',
      2,
    );
    expect(sParametersAt(two, 3e9)).toMatchObject({ clamped: false });
    expect(sParametersAt(two, 3e9)!.s.s11.re).toBeCloseTo(0.9, 15);
    expect(sParametersAt(two, 3.5e9)).toMatchObject({ clamped: true });
    expect(sParametersAt(two, 3.5e9)!.s.s11.re).toBeCloseTo(0.9, 15);
    expect(sParametersAt(two, 1e9)!.s.s11.re).toBeCloseTo(0.1, 15);
  });

  it('does not produce NaN on duplicate sample frequencies', () => {
    const d = readTouchstone('# GHZ S RI R 50\n1 0.1 0\n1 0.3 0\n', 1);
    const g = reflectionAt(d, 1e9)!;
    expect(Number.isFinite(g.re)).toBe(true);
    expect(g.re).toBe(0.1);
  });

  it('interpolates noise exactly at a noise sample and holds a single noise point', () => {
    const d = readTouchstone(
      '# GHZ S MA R 50\n1 0.5 0 2 0 0.1 0 0.4 0\n3 0.5 0 2 0 0.1 0 0.4 0\n' +
        '1 0.9 0.55 50 0.18\n3 1.5 0.45 90 0.14\n',
      2,
    );
    const at = noiseAt(d, 3e9)!;
    expect(at.nfMinDb).toBe(1.5);
    expect(at.rn).toBe(0.14);
    expect(cabs(at.gammaOpt)).toBeCloseTo(0.45, 12);
    const single = readTouchstone(
      '# GHZ S MA R 50\n1 0.5 0 2 0 0.1 0 0.4 0\n1 0.9 0.55 50 0.18\n',
      2,
    );
    expect(noiseAt(single, 0.2e9)).toMatchObject({ nfMinDb: 0.9, rn: 0.18 });
    expect(noiseAt(single, 9e9)).toMatchObject({ nfMinDb: 0.9, rn: 0.18 });
  });
});

describe('qa: DB format', () => {
  it('reads negative and positive dB magnitudes', () => {
    // 20 log10(0.5) = -6.0206 dB, 20 log10(2) = +6.0206 dB.
    const d = readTouchstone('# GHZ S DB R 50\n1 -6.0206 90\n2 6.0206 0\n', 1);
    expect(d.points[0]!.s[0]!.re).toBeCloseTo(0, 5);
    expect(d.points[0]!.s[0]!.im).toBeCloseTo(0.5, 5);
    expect(d.points[1]!.s[0]!.re).toBeCloseTo(2, 5);
    expect(d.points[1]!.s[0]!.im).toBeCloseTo(0, 5);
  });

  it('writes |S| = 0.5 as -6.0205999 dB with eight digits', () => {
    const text = writeTouchstone(
      { ports: 1, z0: 50, points: [{ frequency: 1e9, s: [complex(0, 0.5)] }] },
      { format: 'DB' },
    );
    expect(text.split('\n')[0]).toBe('# GHZ S DB R 50');
    expect(text.split('\n')[1]).toBe('1 -6.0205999 90');
  });

  it('writes a zero S-parameter in DB format as something the reader accepts', () => {
    // A perfect match or S12 = 0 has no finite dB value; the writer must still
    // produce a readable file (for example a floor like -200 dB), not "-Infinity".
    const text = writeTouchstone(
      { ports: 1, z0: 50, points: [{ frequency: 1e9, s: [complex(0, 0)] }] },
      { format: 'DB' },
    );
    expect(text).not.toMatch(/Infinity|NaN/);
    expect(() => readTouchstone(text, 1)).not.toThrow();
  });
});

describe('qa: noise block Gamma_opt format', () => {
  // docs/01-original-analysis.md section 7 and the Touchstone 1.x specification:
  // the noise row is "f NFmin(dB) |Gopt| ang(Gopt) rn", magnitude and angle in
  // degrees whatever the option line's number format says.
  it('reads |Gopt| and its angle from an RI file', () => {
    const d = readTouchstone(
      '# GHZ S RI R 50\n1 0.1 0 0.3 0 0.2 0 0.4 0\n2 0.1 0 0.3 0 0.2 0 0.4 0\n2 0.9 0.55 50 0.18\n',
      2,
    );
    expect(d.noise).toHaveLength(1);
    expect(cabs(d.noise[0]!.gammaOpt)).toBeCloseTo(0.55, 12);
    expect(cargDeg(d.noise[0]!.gammaOpt)).toBeCloseTo(50, 10);
  });

  it('round-trips |Gopt| through a DB file', () => {
    const data = {
      ports: 2,
      z0: 50,
      points: [
        { frequency: 1e9, s: [complex(0.5, 0), complex(0.1, 0), complex(2, 0), complex(0.4, 0)] },
      ],
      noise: [{ frequency: 1e9, nfMinDb: 1.2, gammaOpt: polarDeg(0.5, 70), rn: 0.16 }],
    };
    const back = readTouchstone(writeTouchstone(data, { format: 'DB' }), 2);
    expect(back.noise).toHaveLength(1);
    expect(cabs(back.noise[0]!.gammaOpt)).toBeCloseTo(0.5, 6);
    expect(cargDeg(back.noise[0]!.gammaOpt)).toBeCloseTo(70, 6);
  });
});

describe('qa: four-port write then read', () => {
  // S(i,j) = (i/10 + j/100) - j (4(i-1) + (j-1))/100, all sixteen entries distinct.
  const s = Array.from({ length: 16 }, (_, k) => {
    const i = Math.floor(k / 4);
    const j = k % 4;
    return complex((i + 1) / 10 + (j + 1) / 100, -k / 100);
  });
  const data = { ports: 4, z0: 50, points: [{ frequency: 1e9, s }] };

  it('writes one matrix row per line, continuation lines indented', () => {
    const lines = writeTouchstone(data, { format: 'RI' }).split('\n');
    expect(lines[0]).toBe('# GHZ S RI R 50');
    expect(lines[1]!.split(' ')).toHaveLength(9);
    expect(lines[1]!.startsWith('1 0.11 0 0.12 -0.01 ')).toBe(true);
    for (const k of [2, 3, 4]) {
      expect(lines[k]!.startsWith('    ')).toBe(true);
      expect(lines[k]!.trim().split(' ')).toHaveLength(8);
    }
    expect(lines[4]).toBe('    0.41 -0.12 0.42 -0.13 0.43 -0.14 0.44 -0.15');
    expect(lines[5]).toBe('');
  });

  it('reads back every entry, with and without the port count', () => {
    for (const format of ['RI', 'MA', 'DB'] as const) {
      const text = writeTouchstone(data, { format });
      for (const ports of [4, null]) {
        const back = readTouchstone(text, ports);
        expect(back.ports).toBe(4);
        expect(back.points).toHaveLength(1);
        back.points[0]!.s.forEach((v, k) => {
          expect(v.re).toBeCloseTo(s[k]!.re, 6);
          expect(v.im).toBeCloseTo(s[k]!.im, 6);
        });
        expect(back.points[0]!.s[sIndex(4, 2, 3)]!.re).toBeCloseTo(0.23, 6);
      }
    }
  });
});

describe('qa: option line and line syntax', () => {
  it('keeps the default 50 ohm for R 0 or a missing R value', () => {
    expect(readTouchstone('# GHZ S MA R 0\n1 0.5 0\n', 1).z0).toBe(50);
    expect(readTouchstone('# GHZ S MA R\n1 0.5 0\n', 1).z0).toBe(50);
    expect(readTouchstone('# GHZ S MA R 50.5\n1 0.5 0\n', 1).z0).toBe(50.5);
  });

  it('reads Hz, a bare # and only the first option line', () => {
    expect(readTouchstone('# hz\n1 0.5 0\n', 1).points[0]!.frequency).toBe(1);
    const bare = readTouchstone('#\n1 0.5 0\n', 1);
    expect(bare).toMatchObject({ frequencyUnit: 'GHZ', format: 'MA', parameter: 'S', z0: 50 });
    expect(readTouchstone('# GHZ\n# MHZ\n1 0.5 0\n', 1).points[0]!.frequency).toBe(1e9);
  });

  it('accepts trailing comments, commas, CRLF and v2 keywords', () => {
    const d = readTouchstone(
      '[Version] 2.0\r\n# MHZ S RI R 50\r\n1,0.5,0 ! first\r\n2 0.4 0\r\n',
      1,
    );
    expect(d.points).toHaveLength(2);
    expect(d.points[0]!.frequency).toBe(1e6);
    expect(d.comments).toEqual(['first']);
    expect(d.points[1]!.s[0]!.re).toBe(0.4);
  });

  it('finds a noise block that starts at the last S frequency behind wrapped rows', () => {
    const d = readTouchstone(
      '# GHZ S MA R 50\n1 0.1 0\n0.3 0 0.2 0 0.4 0\n2 0.1 0\n0.3 0 0.2 0 0.4 0\n2 0.9 0.55 50 0.18\n',
      2,
    );
    expect(d.points).toHaveLength(2);
    expect(d.noise).toHaveLength(1);
    expect(d.noise[0]).toMatchObject({ frequency: 2e9, nfMinDb: 0.9, rn: 0.18 });
  });

  it('rejects a noise block with the wrong number count', () => {
    expect(() =>
      readTouchstone('# GHZ S MA R 50\n1 0.1 0 0.3 0 0.2 0 0.4 0\n1 0.9 0.55 50\n', 2),
    ).toThrow(TouchstoneError);
  });

  it('infers two ports from a single nine-number row and four from 9 then 8', () => {
    expect(readTouchstone('1 0.1 0 0.3 0 0.2 0 0.4 0\n').ports).toBe(2);
    expect(
      readTouchstone('1 0 0 0 0 0 0 0 0\n 0 0 0 0 0 0 0 0\n 0 0 0 0 0 0 0 0\n 0 0 0 0 0 0 0 0\n')
        .ports,
    ).toBe(4);
  });
});

describe('qa: three-port lookup, port 2 impedance, renormalization', () => {
  const three = readTouchstone(
    '# GHZ S RI R 50\n1 0.11 0 0.12 0 0.13 0\n 0.21 0 0.22 0 0.23 0\n 0.31 0 0.32 0 0.33 0\n',
    3,
  );

  it('uses ports 1 and 2 of a three-port', () => {
    const at = sParametersAt(three, 1e9)!;
    expect(at.s.s11.re).toBe(0.11);
    expect(at.s.s12.re).toBe(0.12);
    expect(at.s.s21.re).toBe(0.21);
    expect(at.s.s22.re).toBe(0.22);
    expect(reflectionAt(three, 1e9, 3)!.re).toBe(0.33);
    expect(reflectionAt(three, 1e9, 4)).toBeNull();
    expect(reflectionAt(three, 1e9, 0)).toBeNull();
  });

  it('gives the port 2 impedance and renormalizes Gamma = 0', () => {
    const d = readTouchstone('# GHZ S RI R 50\n1 0.1 0 0.3 0 0.2 0 0.5 0\n', 2);
    // Gamma 0.5 against 50 ohm is 150 ohm.
    expect(impedanceRows(d, 2)[0]!.z.re).toBeCloseTo(150, 9);
    expect(impedanceRows(d, 2)[0]!.z.im).toBeCloseTo(0, 9);
    // 50 ohm seen from 100 ohm: (50 - 100) / (50 + 100) = -1/3.
    const g = renormalizeGamma(complex(0, 0), 50, 100);
    expect(g.re).toBeCloseTo(-1 / 3, 12);
    expect(g.im).toBeCloseTo(0, 12);
    const same = complex(0.2, 0.1);
    expect(renormalizeGamma(same, 50, 50)).toBe(same);
  });
});

describe('qa: writer options and validation', () => {
  it('rejects bad port counts and short points', () => {
    expect(() => writeTouchstone({ ports: 0, z0: 50, points: [] })).toThrow(TouchstoneError);
    expect(() => writeTouchstone({ ports: 5, z0: 50, points: [] })).toThrow(/1 to 4 ports/);
    expect(() =>
      writeTouchstone({ ports: 2, z0: 50, points: [{ frequency: 1e9, s: [complex(0, 0)] }] }),
    ).toThrow(/expected 4/);
  });

  it('honours digits and the frequency unit', () => {
    const text = writeTouchstone(
      { ports: 1, z0: 50, points: [{ frequency: 2.5e9, s: [complex(1 / 3, 0)] }] },
      { format: 'RI', frequencyUnit: 'MHZ', digits: 3 },
    );
    expect(text.split('\n')[1]).toBe('2500 0.333 0');
    const hz = writeTouchstone(
      { ports: 1, z0: 50, points: [{ frequency: 1e9, s: [complex(1e-7, 0)] }] },
      { format: 'RI', frequencyUnit: 'HZ' },
    );
    expect(hz.split('\n')[1]).toBe('1000000000 1.0000000e-7 0');
    expect(readTouchstone(hz, 1).points[0]!.s[0]!.re).toBe(1e-7);
  });

  it('writes the two-port header comment and a MA noise block', () => {
    const text = writeTouchstone({
      ports: 2,
      z0: 50,
      points: [
        { frequency: 1e9, s: [complex(0.5, 0), complex(0.1, 0), complex(2, 0), complex(0.4, 0)] },
      ],
      noise: [{ frequency: 1e9, nfMinDb: 1.2, gammaOpt: polarDeg(0.5, 70), rn: 0.16 }],
    });
    const lines = text.split('\n');
    expect(lines[0]).toBe('# GHZ S MA R 50');
    expect(lines[1]).toBe('! f S11 S21 S12 S22');
    expect(lines[2]).toBe('1 0.5 0 2 0 0.1 0 0.4 0');
    expect(lines[3]).toBe('! f NFmin(dB) |Gopt| ang(Gopt) rn/Z0');
    expect(lines[4]).toBe('1 1.2 0.5 70 0.16');
  });
});
