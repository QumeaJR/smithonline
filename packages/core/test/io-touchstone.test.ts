import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cabs,
  cargDeg,
  complex,
  impedanceRows,
  noiseAt,
  polarDeg,
  portsFromFileName,
  readTouchstone,
  reflectionAt,
  renormalizeGamma,
  sIndex,
  sParametersAt,
  TouchstoneError,
  twoPortPoint,
  writeTouchstone,
} from '../src/index';

const FIXTURES = join(__dirname, 'fixtures', 'sparams');
const load = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

describe('readTouchstone', () => {
  it('reads a two-port MA file with its noise block', () => {
    const d = readTouchstone(load('amp-synthetic.s2p'), 2);
    expect(d.ports).toBe(2);
    expect(d.format).toBe('MA');
    expect(d.frequencyUnit).toBe('GHZ');
    expect(d.z0).toBe(50);
    expect(d.points).toHaveLength(12);
    expect(d.points[1]?.frequency).toBe(1e9);
    // Row order in the file is S11 S21 S12 S22; the matrix is row-major S11 S12 S21 S22.
    const p = d.points[1]!;
    expect(cabs(p.s[sIndex(2, 1, 1)]!)).toBeCloseTo(0.55, 12);
    expect(cargDeg(p.s[sIndex(2, 1, 1)]!)).toBeCloseTo(-55, 10);
    expect(cabs(p.s[sIndex(2, 2, 1)]!)).toBeCloseTo(8, 12);
    expect(cabs(p.s[sIndex(2, 1, 2)]!)).toBeCloseTo(0.04, 12);
    expect(cargDeg(p.s[sIndex(2, 2, 2)]!)).toBeCloseTo(-40, 10);
    expect(d.noise).toHaveLength(4);
    expect(d.noise[1]).toMatchObject({ frequency: 2e9, nfMinDb: 1.2, rn: 0.16 });
    expect(cabs(d.noise[1]!.gammaOpt)).toBeCloseTo(0.5, 12);
    expect(cargDeg(d.noise[1]!.gammaOpt)).toBeCloseTo(70, 10);
    expect(d.comments[0]).toMatch(/Synthetic small-signal amplifier/);
  });

  it('reads a one-port RI file in MHz and converts to impedance', () => {
    const d = readTouchstone(load('dipole-synthetic.s1p'));
    expect(d.ports).toBe(1);
    expect(d.format).toBe('RI');
    expect(d.points).toHaveLength(16);
    expect(d.points[0]?.frequency).toBe(130e6);
    const rows = impedanceRows(d);
    expect(rows[0]!.z.re).toBeCloseTo(60, 3);
    expect(rows[0]!.z.im).toBeCloseTo(-80, 3);
    expect(rows[15]!.z.re).toBeCloseTo(96, 3);
    expect(rows[15]!.z.im).toBeCloseTo(100, 3);
  });

  it('reads a three-port DB file written one matrix row per line', () => {
    const d = readTouchstone(load('splitter-synthetic.s3p'), 3);
    expect(d.ports).toBe(3);
    expect(d.format).toBe('DB');
    expect(d.points).toHaveLength(3);
    const p = d.points[0]!;
    expect(p.s).toHaveLength(9);
    expect(cabs(p.s[sIndex(3, 1, 2)]!)).toBeCloseTo(0.7, 3);
    expect(cargDeg(p.s[sIndex(3, 1, 2)]!)).toBeCloseTo(-45, 6);
    expect(cabs(p.s[sIndex(3, 2, 2)]!)).toBeCloseTo(0.15, 3);
    expect(cargDeg(p.s[sIndex(3, 2, 3)]!)).toBeCloseTo(10, 6);
  });

  it('infers three and four ports from the row shape when the name does not say', () => {
    expect(readTouchstone(load('splitter-synthetic.s3p')).ports).toBe(3);
    const d = readTouchstone(load('coupler-synthetic.s4p'));
    expect(d.ports).toBe(4);
    expect(d.points).toHaveLength(3);
    expect(d.points[0]?.frequency).toBe(900e6);
    expect(cabs(d.points[0]!.s[sIndex(4, 1, 3)]!)).toBeCloseTo(0.7, 3);
    expect(Math.abs(cargDeg(d.points[0]!.s[sIndex(4, 1, 3)]!))).toBeCloseTo(180, 2);
  });

  it('defaults the option line to GHz S MA R 50 and reads R', () => {
    const d = readTouchstone('1 0.5 10\n2 0.4 20\n');
    expect(d.frequencyUnit).toBe('GHZ');
    expect(d.z0).toBe(50);
    expect(d.points[1]?.frequency).toBe(2e9);
    const e = readTouchstone('# kHz Z RI R 75\n1 0.5 0.1\n');
    expect(e.z0).toBe(75);
    expect(e.parameter).toBe('Z');
    expect(e.points[0]?.frequency).toBe(1e3);
  });

  it('rejects garbage, empty files, descending frequencies and too many ports', () => {
    expect(() => readTouchstone('')).toThrow(TouchstoneError);
    expect(() => readTouchstone('# GHZ S MA R 50\n1 0.5 abc\n')).toThrow(/Not a number/);
    expect(() => readTouchstone('# GHZ S MA R 50\n2 0.5 1\n1 0.5 1\n')).toThrow(/ascending/);
    expect(() => readTouchstone('1 0.5 1 0 0 0 0 0 0 0 0\n', 5)).toThrow(/1 to 4 ports/);
    expect(() => readTouchstone('1 0.5 1 0\n', 1)).toThrow(/Expected 3 numbers/);
  });

  it('maps file names to port counts', () => {
    expect(portsFromFileName('amp.s2p')).toBe(2);
    expect(portsFromFileName('AMP.S4P')).toBe(4);
    expect(portsFromFileName('amp.citi')).toBeNull();
  });
});

describe('lookup at a frequency', () => {
  const d = readTouchstone(load('amp-synthetic.s2p'), 2);

  it('returns the sample itself at a sample frequency', () => {
    const at = sParametersAt(d, 2e9)!;
    expect(at.clamped).toBe(false);
    expect(at.covers).toEqual([0.5e9, 6e9]);
    expect(cabs(at.s.s11)).toBeCloseTo(0.5, 12);
    expect(cabs(at.s.s21)).toBeCloseTo(4.9246, 12);
    expect(cabs(at.s.s12)).toBeCloseTo(0.05, 12);
    expect(cabs(at.s.s22)).toBeCloseTo(0.44, 12);
  });

  it('interpolates linearly in rectangular form between samples', () => {
    const a = d.points[2]!.s[0]!;
    const b = d.points[3]!.s[0]!;
    const at = sParametersAt(d, 1.75e9)!;
    expect(at.s.s11.re).toBeCloseTo((a.re + b.re) / 2, 12);
    expect(at.s.s11.im).toBeCloseTo((a.im + b.im) / 2, 12);
  });

  it('holds the nearest end outside the measured range and says so', () => {
    const lo = sParametersAt(d, 0.1e9)!;
    expect(lo.clamped).toBe(true);
    expect(lo.s.s11).toEqual(d.points[0]!.s[0]);
    const hi = sParametersAt(d, 10e9)!;
    expect(hi.clamped).toBe(true);
    expect(hi.s.s22).toEqual(d.points[11]!.s[3]);
  });

  it('interpolates the noise parameters and returns null without a block', () => {
    const n = noiseAt(d, 2.5e9)!;
    expect(n.nfMinDb).toBeCloseTo(1.35, 12);
    expect(n.rn).toBeCloseTo(0.15, 12);
    const g2 = polarDeg(0.5, 70);
    const g3 = polarDeg(0.45, 90);
    expect(n.gammaOpt.re).toBeCloseTo((g2.re + g3.re) / 2, 12);
    expect(noiseAt(readTouchstone(load('dipole-synthetic.s1p')), 1e8)).toBeNull();
    expect(sParametersAt(readTouchstone(load('dipole-synthetic.s1p')), 1e8)).toBeNull();
  });

  it('reads a single reflection coefficient and renormalizes it', () => {
    const one = readTouchstone(load('dipole-synthetic.s1p'));
    const g = reflectionAt(one, 131e6)!;
    const a = one.points[0]!.s[0]!;
    const b = one.points[1]!.s[0]!;
    expect(g.re).toBeCloseTo((a.re + b.re) / 2, 12);
    // Gamma of 100 ohm against 50 is 1/3; against 100 it is 0.
    const r = renormalizeGamma(complex(1 / 3, 0), 50, 100);
    expect(cabs(r)).toBeLessThan(1e-12);
  });
});

describe('writeTouchstone', () => {
  it('round-trips a two-port with noise through MA, DB and RI', () => {
    const d = readTouchstone(load('amp-synthetic.s2p'), 2);
    for (const format of ['MA', 'DB', 'RI'] as const) {
      const text = writeTouchstone(d, { format, frequencyUnit: 'MHZ', comments: ['round trip'] });
      expect(text).toMatch(/^! round trip\n# MHZ S (MA|DB|RI) R 50\n/);
      const back = readTouchstone(text, 2);
      expect(back.points).toHaveLength(12);
      expect(back.noise).toHaveLength(4);
      back.points.forEach((p, i) => {
        expect(p.frequency).toBeCloseTo(d.points[i]!.frequency, 3);
        p.s.forEach((s, k) => {
          expect(s.re).toBeCloseTo(d.points[i]!.s[k]!.re, 6);
          expect(s.im).toBeCloseTo(d.points[i]!.s[k]!.im, 6);
        });
      });
      expect(back.noise[2]!.rn).toBeCloseTo(0.14, 9);
      expect(cargDeg(back.noise[2]!.gammaOpt)).toBeCloseTo(90, 6);
    }
  });

  it('writes two-port rows as S11 S21 S12 S22', () => {
    const text = writeTouchstone(
      {
        ports: 2,
        z0: 50,
        points: [
          twoPortPoint(1e9, {
            s11: complex(0.1, 0),
            s12: complex(0.2, 0),
            s21: complex(0.3, 0),
            s22: complex(0.4, 0),
          }),
        ],
      },
      { format: 'RI' },
    );
    expect(text.split('\n')[2]).toBe('1 0.1 0 0.3 0 0.2 0 0.4 0');
  });

  it('round-trips three- and four-port files', () => {
    for (const [name, ports] of [
      ['splitter-synthetic.s3p', 3],
      ['coupler-synthetic.s4p', 4],
    ] as const) {
      const d = readTouchstone(load(name), ports);
      const back = readTouchstone(writeTouchstone(d, { format: 'RI' }), ports);
      expect(back.points).toHaveLength(d.points.length);
      back.points.forEach((p, i) =>
        p.s.forEach((s, k) => {
          expect(s.re).toBeCloseTo(d.points[i]!.s[k]!.re, 6);
          expect(s.im).toBeCloseTo(d.points[i]!.s[k]!.im, 6);
        }),
      );
    }
  });

  it('refuses a noise block on anything but a two-port', () => {
    expect(() =>
      writeTouchstone({
        ports: 1,
        z0: 50,
        points: [{ frequency: 1e9, s: [complex(0.5, 0)] }],
        noise: [{ frequency: 1e9, nfMinDb: 1, gammaOpt: complex(0.1, 0), rn: 0.2 }],
      }),
    ).toThrow(/two-port/);
  });
});
