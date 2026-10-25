/**
 * QA, redesign phase 4: the start guide's step logic (docs/07 section 4,
 * Start guide), the schematic cell width for every element kind
 * (`max(56, ceil(chars x 0.62 x 10 + 8))`, worked by hand: 6.2 drawing units
 * per character of the 10 px monospace value), and the phase 3 leftovers
 * broadbandProgressText and splitNameSuffix.
 */
import { complex, type Element } from '@smithonline/core';
import { describe, expect, it } from 'vitest';
import { broadbandProgressText } from '../src/lib/broadband';
import { designFromXmlsc, emptyDesign } from '../src/lib/design';
import { EXAMPLES } from '../src/lib/examples';
import { cellWidth, sig3, stripComplex, stripValue } from '../src/lib/schematicCells';
import { splitNameSuffix } from '../src/lib/splotNetwork';
import { startSteps } from '../src/lib/startGuide';

const example = (file: string) => {
  const e = EXAMPLES.find((x) => x.file === file);
  if (!e) throw new Error(`no ${file}`);
  return designFromXmlsc(e.xml, file);
};

describe('start guide steps', () => {
  it('datapoints with the default load: step 1 is done (a datapoint was added)', () => {
    const d = { ...emptyDesign(), datapoints: [{ frequency: 2e9, z: complex(40, 5) }] };
    expect(d.load).toEqual(complex(50, 0));
    expect(startSteps(d)).toEqual({ load: true, target: false, match: false });
  });

  it('an empty datapoint list with the default load is still the default', () => {
    expect(startSteps({ ...emptyDesign(), datapoints: [] }).load).toBe(false);
  });

  it('a target typed equal to Z0 counts as set (section 4: "done once a target is set")', () => {
    expect(startSteps({ ...emptyDesign(), target: complex(50, 0) }).target).toBe(true);
    expect(startSteps({ ...emptyDesign(), target: null }).target).toBe(false);
  });

  it('a load that differs only in its reactance, or by a tiny resistance, counts', () => {
    expect(startSteps({ ...emptyDesign(), load: complex(50, 0.001) }).load).toBe(true);
    expect(startSteps({ ...emptyDesign(), load: complex(50.000001, 0) }).load).toBe(true);
    expect(startSteps({ ...emptyDesign(), load: complex(50, -0) }).load).toBe(false);
  });

  it('Example 5 (load 20 - j12, five parts, no target): steps 1 and 3 done, 2 open', () => {
    const d = example('Example5.xmlsc');
    expect(d.load.re).toBeCloseTo(20, 6);
    expect(d.load.im).toBeCloseTo(-12, 6);
    expect(startSteps(d)).toEqual({ load: true, target: false, match: true });
  });

  it('Example 17 (a datapoint sweep over three loads): step 1 done', () => {
    const d = example('Example17.xmlsc');
    expect((d.datapoints ?? []).length).toBe(2);
    expect(startSteps(d).load).toBe(true);
  });
});

describe('schematic cell width for every element kind', () => {
  const cases: readonly [string, Element, string, number][] = [
    // text, chars, width: 7 x 6.2 + 8 = 51.4 -> 56 (the minimum)
    ['R', { kind: 'R', orientation: 'series', value: 1234 }, '1.23 kΩ', 56],
    ['L', { kind: 'L', orientation: 'series', value: 16.03e-9 }, '16 nH', 56],
    ['C', { kind: 'C', orientation: 'shunt', value: 4.725e-12 }, '4.73 pF', 56],
    ['C femto', { kind: 'C', orientation: 'shunt', value: 2e-15 }, '2 fF', 56],
    // 8 x 6.2 + 8 = 57.6 -> 58
    ['transformer', { kind: 'transformer', n: 1.4142 }, 'n = 1.41', 58],
    // 9 x 6.2 + 8 = 63.8 -> 64
    ['transformer large', { kind: 'transformer', n: 12345.6 }, 'n = 12300', 64],
    ['line', { kind: 'line', z0: 50, length: 0.12345 }, '0.123 λ', 56],
    ['openStub', { kind: 'openStub', z0: 50, length: 0.0125 }, '0.0125 λ', 58],
    ['shortStub', { kind: 'shortStub', z0: 75, length: 0.25 }, '0.25 λ', 56],
    [
      'RLC with R',
      { kind: 'RLC', orientation: 'series', connection: 'parallel', r: 47, l: 1e-9, c: 1e-12 },
      '47 Ω',
      56,
    ],
    [
      'RLC with C only',
      { kind: 'RLC', orientation: 'shunt', connection: 'series', c: 1.5e-12 },
      '1.5 pF',
      56,
    ],
    ['RLC empty', { kind: 'RLC', orientation: 'shunt', connection: 'series' }, '', 56],
  ];
  for (const [name, el, text, width] of cases) {
    it(`${name}: "${text}" in ${width} units`, () => {
      expect(stripValue(el)).toBe(text);
      expect(cellWidth(stripValue(el))).toBe(width);
    });
  }

  it('impedance cells: "1230 - j6790" is 12 x 6.2 + 8 = 82.4 -> 83', () => {
    expect(stripComplex(complex(1234.5, -6789.1))).toBe('1230 - j6790');
    expect(cellWidth('1230 - j6790')).toBe(83);
  });

  it('non-finite and rounding limits of sig3', () => {
    expect(sig3(999.5)).toBe('1000');
    expect(sig3(Number.NaN)).toBe('NaN');
    expect(sig3(Number.NEGATIVE_INFINITY)).toBe('-∞');
    expect(stripComplex(complex(Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY))).toBe(
      '∞ - j∞',
    );
  });
});

describe('broadbandProgressText', () => {
  it('first pass: the ladder being searched, 1-based', () => {
    expect(broadbandProgressText({ done: 0, total: 56 }, 40)).toBe('Searching ladder 1 of 40');
    expect(broadbandProgressText({ done: 39, total: 56 }, 40)).toBe('Searching ladder 40 of 40');
  });

  it('second pass of a two-pass search: 56 - 40 = 16 refined', () => {
    expect(broadbandProgressText({ done: 40, total: 56 }, 40)).toBe('Refining the best, 1 of 16');
    expect(broadbandProgressText({ done: 56, total: 56 }, 40)).toBe('Refining the best, 16 of 16');
  });

  it('a one-pass search that has finished its last ladder says nothing of refining', () => {
    // total = ladders: no second pass; the last tick is ladder 4 of 4.
    expect(broadbandProgressText({ done: 4, total: 4 }, 4)).toBe('Searching ladder 4 of 4');
  });

  it('before the ladder count is known (0) the worker total counts', () => {
    expect(broadbandProgressText({ done: 2, total: 10 }, 0)).toBe('Searching ladder 3 of 10');
  });
});

describe('splitNameSuffix', () => {
  it('splits only a trailing parenthesis after a blank', () => {
    expect(splitNameSuffix('Example 5 (network snapshot 2)')).toEqual({
      base: 'Example 5',
      suffix: ' (network snapshot 2)',
    });
    expect(splitNameSuffix('a (b) (c)')).toEqual({ base: 'a (b)', suffix: ' (c)' });
    expect(splitNameSuffix('(network)')).toEqual({ base: '(network)', suffix: '' });
    expect(splitNameSuffix('amp.s2p')).toEqual({ base: 'amp.s2p', suffix: '' });
    expect(splitNameSuffix('')).toEqual({ base: '', suffix: '' });
    expect(splitNameSuffix('x (a (b))')).toEqual({ base: 'x (a (b))', suffix: '' });
  });
});
