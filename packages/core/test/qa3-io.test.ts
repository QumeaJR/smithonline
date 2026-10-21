import { describe, expect, it } from 'vitest';
import {
  complex,
  impedanceRows,
  readTouchstone,
  TouchstoneError,
  tryParseEngineering,
  writeTouchstone,
} from '../src/index';

const onePort = { ports: 1, z0: 50, points: [{ frequency: 1e9, s: [complex(1 / 3, 0)] }] };

describe('qa3: Touchstone writer digits clamp', () => {
  it('digits 0 is clamped to one significant digit', () => {
    const text = writeTouchstone(onePort, { format: 'RI', digits: 0 });
    // 1/3 to one digit is 0.3; the frequency 1 GHz and the zero imaginary part are exact.
    expect(text.split('\n')[1]).toBe('1 0.3 0');
    expect(text.split('\n')[0]).toBe('# GHZ S RI R 50');
  });

  it('digits 100 is clamped to 17, which reproduces the double exactly', () => {
    const text = writeTouchstone(onePort, { format: 'RI', digits: 100 });
    expect(readTouchstone(text, 1).points[0]!.s[0]!.re).toBe(1 / 3);
  });

  it('a non-numeric digits option does not escape as a RangeError', () => {
    for (const digits of [NaN, -Infinity]) {
      try {
        const text = writeTouchstone(onePort, { format: 'RI', digits });
        expect(() => readTouchstone(text, 1)).not.toThrow();
      } catch (e) {
        expect(e).toBeInstanceOf(TouchstoneError);
      }
    }
  });
});

describe('qa3: Touchstone 2 [Reference] values and rn', () => {
  const v2 = (reference: string, noise: string): string =>
    [
      '[Version] 2.0',
      '# GHz S MA R 50',
      '[Number of Ports] 2',
      reference,
      '[Number of Frequencies] 1',
      '[Number of Noise Frequencies] 1',
      '[Network Data]',
      '1 0.5 0 2 0 0.1 0 0.4 0',
      '[Noise Data]',
      noise,
      '[End]',
    ].join('\n');

  it('refuses a zero, negative or non-numeric reference', () => {
    for (const ref of ['[Reference] 0 0', '[Reference] -50 -50', '[Reference] abc']) {
      expect(() => readTouchstone(v2(ref, '1 1.5 0.6 45 15'), 2)).toThrow(/Invalid \[Reference\]/);
    }
  });

  it('divides rn in ohm by the [Reference] impedance, not by the option line R', () => {
    const d = readTouchstone(v2('[Reference] 75 75', '1 1.5 0.6 45 15'), 2);
    expect(d.z0).toBe(75);
    // 15 ohm against 75 ohm.
    expect(d.noise[0]!.rn).toBeCloseTo(0.2, 12);
  });

  it('a version 1 file keeps rn as the normalized ratio whatever R says', () => {
    const d = readTouchstone(
      ['# GHZ S MA R 75', '1 0.5 0 2 0 0.1 0 0.4 0', '1 1.5 0.6 45 0.3'].join('\n'),
      2,
    );
    expect(d.z0).toBe(75);
    expect(d.noise[0]!.rn).toBe(0.3);
  });

  it('a [Reference] with the values on the next line still sets Z0 and the rn divisor', () => {
    const text = [
      '[Version] 2.0',
      '# GHz S MA R 50',
      '[Number of Ports] 2',
      '[Reference]',
      '100 100',
      '[Number of Frequencies] 1',
      '[Number of Noise Frequencies] 1',
      '[Network Data]',
      '1 0.5 0 2 0 0.1 0 0.4 0',
      '[Noise Data]',
      '1 1.5 0.6 45 20',
      '[End]',
    ].join('\n');
    const d = readTouchstone(text, 2);
    expect(d.z0).toBe(100);
    expect(d.points).toHaveLength(1);
    expect(d.noise[0]!.rn).toBeCloseTo(0.2, 12);
  });
});

describe('qa3: lookup and parser limits', () => {
  it('impedanceRows of port 0 or a port above the count is empty', () => {
    const d = readTouchstone('# GHZ S RI R 50\n1 0.1 0 0.3 0 0.2 0 0.4 0\n', 2);
    expect(impedanceRows(d, 0)).toEqual([]);
    expect(impedanceRows(d, 3)).toEqual([]);
    expect(impedanceRows(d, 2)).toHaveLength(1);
  });

  it('tryParseEngineering: overflow through a prefix or a sign is null, underflow is 0', () => {
    expect(tryParseEngineering('-1e400')).toBeNull();
    expect(tryParseEngineering('1e308k')).toBeNull();
    expect(tryParseEngineering('1e-400')).toEqual({ value: 0, unit: '' });
  });
});
