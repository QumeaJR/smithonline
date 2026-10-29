/**
 * QA round 1: byte-level layout of the SPICE netlist and the LTspice schematic
 * for a one-element ladder, hand-placed from the writer's documented geometry,
 * plus the number formatting and the refusals the existing tests skip.
 */
import { describe, expect, it } from 'vitest';
import {
  complex,
  ladderStages,
  SpiceError,
  spiceNumber,
  writeLtspice,
  writeSpice,
  type Ladder,
} from '../src/index';

const F = 100e6;
const seriesL: Ladder = {
  z0: 50,
  frequency: F,
  load: complex(50, 0),
  elements: [{ kind: 'L', orientation: 'series', value: 1e-7 }],
};

describe('spiceNumber', () => {
  it('plain numbers, exponents, rounding to the digits and no unit suffixes', () => {
    expect(spiceNumber(0)).toBe('0');
    expect(spiceNumber(-0)).toBe('0');
    expect(spiceNumber(1e-12)).toBe('1e-12');
    expect(spiceNumber(1e-6)).toBe('0.000001');
    expect(spiceNumber(1234567, 3)).toBe('1230000');
    expect(spiceNumber(1 / 3)).toBe('0.333333');
    expect(spiceNumber(-2.5e-9)).toBe('-2.5e-9');
    expect(spiceNumber(1e21)).toBe('1e+21');
  });

  it('refuses NaN and infinities', () => {
    expect(() => spiceNumber(NaN)).toThrow(SpiceError);
    expect(() => spiceNumber(Infinity)).toThrow(/non-finite/);
    expect(() => spiceNumber(-Infinity)).toThrow(SpiceError);
  });
});

describe('writeSpice byte layout', () => {
  it('series 100 nH on 50 ohm at 100 MHz, named x', () => {
    expect(writeSpice(seriesL, { name: 'x' })).toBe(
      [
        '* SmithChart.Online matching network: x',
        '* Z0 50 ohm, design frequency 100000000 Hz, values as realized, loss resistors from Q',
        '* n0 is the load side, the highest node is the input; AC 1 is the source EMF',
        'VS src 0 AC 1',
        'RSRC src n1 50',
        'RLOAD n0 0 50',
        'L1 n0 n1 1e-7',
        '.ac lin 201 50000000 150000000',
        '.end',
      ].join('\n') + '\n',
    );
  });

  it('a capacitive load becomes R in series with C = -1/(w X): 50 - j50 at 100 MHz is 31.831 pF', () => {
    const text = writeSpice({ ...seriesL, load: complex(50, -50), elements: [] });
    expect(text).toContain('RLOAD n0 mload_c1 50\nCLOAD mload_c1 0 3.1831e-11\n');
    // No name: the header has no colon.
    expect(text.split('\n')[0]).toBe('* SmithChart.Online matching network');
  });

  it('a zero or negative load resistance is written as 1 uohm, an inductive load as L = X / w', () => {
    const text = writeSpice({ ...seriesL, load: complex(0, 62.83185307179586), elements: [] });
    // X = 2 pi 1e8 * 1e-7 = 62.831853; L = 1e-7.
    expect(text).toContain('RLOAD n0 mload_c1 0.000001\nLLOAD mload_c1 0 1e-7\n');
  });

  it('a Q splits the part into part and loss resistor via an inner node: R = w L / Q', () => {
    const text = writeSpice({
      ...seriesL,
      elements: [{ kind: 'L', orientation: 'series', value: 1e-7, q: 100 }],
    });
    // w L = 62.831853, / 100 = 0.628319 to six digits.
    expect(text).toContain('L1 n0 m1_1 1e-7\nRL1 m1_1 n1 0.628319\n');
  });

  it('a sweep option and digits are written as given; the point count is rounded and at least 2', () => {
    const text = writeSpice(seriesL, { sweep: { start: 1e6, stop: 2e6, points: 1.4 }, digits: 3 });
    expect(text).toContain('.ac lin 2 1000000 2000000');
  });

  it('a line of a quarter wave at its reference frequency has TD = 0.25 / fref', () => {
    const text = writeSpice({
      ...seriesL,
      elements: [{ kind: 'line', z0: 75, length: 0.25, refFrequency: 1e8 }],
    });
    expect(text).toContain('T1 n0 0 n1 0 Z0=75 TD=2.5e-9');
    expect(text).toContain('RSRC src n1 50');
  });

  it('an open stub ends in a 1e12 ohm far resistor and a shorted one in ground', () => {
    const open = writeSpice({
      ...seriesL,
      elements: [{ kind: 'openStub', z0: 50, length: 0.125 }],
    });
    expect(open).toContain('T1 n0 0 far1 0 Z0=50 TD=1.25e-9\nRFAR1 far1 0 1e12\n');
    // A stub does not advance the node: the source still sits on n0.
    expect(open).toContain('RSRC src n0 50');
    const short = writeSpice({
      ...seriesL,
      elements: [{ kind: 'shortStub', z0: 50, length: 0.125 }],
    });
    expect(short).toContain('T1 n0 0 0 0 Z0=50 TD=1.25e-9');
  });

  it('a lossy line gets a comment saying attenuation is not modelled', () => {
    const text = writeSpice({
      ...seriesL,
      elements: [{ kind: 'line', z0: 50, length: 0.1, alphaDbPerM: 2 }],
    });
    expect(text).toContain('* Element 1: line attenuation is not modelled by the ideal T element');
  });
});

describe('ladderStages refusals', () => {
  it('an RLC block with no positive part has nothing to write', () => {
    expect(() =>
      ladderStages({
        ...seriesL,
        elements: [{ kind: 'RLC', orientation: 'series', connection: 'series' }],
      }),
    ).toThrow(/has no parts/);
  });

  it('a negative frequency, NaN frequency, and a line with Z0 = 0 are refused', () => {
    expect(() => ladderStages({ ...seriesL, frequency: -1 })).toThrow(/must be positive/);
    expect(() => ladderStages({ ...seriesL, frequency: NaN })).toThrow(SpiceError);
    expect(() =>
      ladderStages({ ...seriesL, elements: [{ kind: 'line', z0: 0, length: 0.1 }] }),
    ).toThrow(/Z0 of element 1/);
  });

  it('a negative length is written as its absolute delay', () => {
    const [s] = ladderStages({ ...seriesL, elements: [{ kind: 'line', z0: 50, length: -0.25 }] });
    expect(s).toMatchObject({ type: 'line', delay: 2.5e-9, lossy: false });
  });
});

describe('writeLtspice byte layout', () => {
  it('series 100 nH on 50 ohm: source at the top, one series symbol, the load at the bottom', () => {
    expect(writeLtspice(seriesL, { name: 'x' })).toBe(
      [
        'Version 4',
        'SHEET 1 976 544',
        'WIRE 96 80 320 80',
        'WIRE 320 160 320 192',
        'WIRE 320 272 320 304',
        'FLAG 96 160 0',
        'FLAG 320 160 in',
        'FLAG 320 272 load',
        'FLAG 320 384 0',
        'SYMBOL voltage 96 64 R0',
        'SYMATTR InstName VS',
        'SYMATTR Value AC 1',
        'SYMBOL res 304 64 R0',
        'SYMATTR InstName RSRC',
        'SYMATTR Value 50',
        'SYMBOL ind 304 176 R0',
        'SYMATTR InstName L1',
        'SYMATTR Value 1e-7',
        'SYMBOL res 304 288 R0',
        'SYMATTR InstName RLOAD',
        'SYMATTR Value 50',
        'TEXT 416 32 Left 2 ;SmithChart.Online matching network: x',
        'TEXT 416 64 Left 2 ;Z0 50 ohm, 100000000 Hz, realized values, loss resistors from Q',
        'TEXT 416 96 Left 2 !.ac lin 201 50000000 150000000',
      ].join('\r\n') + '\r\n',
    );
  });

  it('a shunt part hangs one column to the right of the chain and ends in a ground flag', () => {
    const text = writeLtspice({
      ...seriesL,
      elements: [{ kind: 'C', orientation: 'shunt', value: 1e-11 }],
    });
    // From the input node (320, 160) a wire goes right to x = 384, the cap sits there (pins at +0 and +64).
    expect(text).toContain('WIRE 320 160 384 160\r\n');
    expect(text).toContain('SYMBOL cap 368 160 R0\r\n');
    expect(text).toContain('FLAG 384 224 0\r\n');
  });

  it('refuses a transformer with the SpiceError of the stages', () => {
    expect(() => writeLtspice({ ...seriesL, elements: [{ kind: 'transformer', n: 2 }] })).toThrow(
      /ideal transformer/,
    );
  });
});
