import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateLadder, readXmlsc, XmlscError } from '@smithonline/core';
import { describe, expect, it } from 'vitest';
import { designFromXmlsc, emptyDesign, identify, type Design } from '../src/lib/design';
import {
  designSweep,
  designToAscii,
  designToNetlist,
  designToXmlsc,
  ladderOf,
} from '../src/lib/files';
import { readImportFile, twoPortFromFile } from '../src/lib/import';

const fixture = (...parts: string[]): string =>
  readFileSync(join(__dirname, '..', '..', 'core', 'test', 'fixtures', ...parts), 'utf8');

describe('designToXmlsc', () => {
  it('stores Example 5 so that the original reader gets the same ladder back', () => {
    const d = designFromXmlsc(fixture('xmlsc', 'Example5.xmlsc'), 'Example 5');
    const back = readXmlsc(designToXmlsc(d));
    const original = readXmlsc(fixture('xmlsc', 'Example5.xmlsc'));
    expect(back.components.map((c) => [c.typ, c.value])).toEqual(
      original.components.map((c) => [c.typ, c.value]),
    );
    back.datapoints.forEach((p, i) => expect(p.r).toBeCloseTo(original.datapoints[i]!.r, 4));
    expect(back.qList).toEqual([0.6]);
  });

  it('keeps Example 13 circles and Example 17 datapoint sweep', () => {
    const d13 = designFromXmlsc(fixture('xmlsc', 'Example13-input.xmlsc'), 'x');
    const b13 = readXmlsc(designToXmlsc(d13));
    expect(b13.stabilityCircles).toHaveLength(2);
    expect(b13.gainCircles.map((g) => g.gainDb)).toEqual([12.942000389099121, 12.5, 12]);
    expect(b13.noiseCircles.map((n) => n.nfDb)).toEqual([3.601, 3.7, 3.8, 3.9, 4]);
    const d17 = designFromXmlsc(fixture('xmlsc', 'Example17.xmlsc'), 'x');
    expect(d17.sweep.loads).toHaveLength(3);
    expect(d17.sweep.enabled).toBe(true);
    const b17 = readXmlsc(designToXmlsc(d17));
    expect(b17.sweep?.sweepType).toBe('datapoint');
    expect(b17.datapoints.filter((p) => p.isReal)).toHaveLength(3);
    expect(b17.sweepDatapoints).toHaveLength(3);
  });

  it('refuses designs with elements the format cannot hold', () => {
    const d: Design = {
      ...emptyDesign(),
      elements: identify([{ kind: 'R', orientation: 'series', value: 10 }]),
    };
    expect(() => designToXmlsc(d)).toThrow(XmlscError);
  });
});

describe('netlist and ASCII', () => {
  const d = designFromXmlsc(fixture('xmlsc', 'Example5.xmlsc'), 'Example 5');

  it('writes the netlist with the design name', () => {
    const text = designToNetlist(d, 'Example_5');
    expect(text).toContain('! INPUT FILE: Example_5.xmlsc');
    expect(text.split('\n')[7]).toMatch(/^IND 1 0 L=16\.0334$/);
    expect(text).toContain('FIXED 450');
  });

  it('writes datapoints, sweep points and circles', () => {
    const result = evaluateLadder(ladderOf(d));
    const swept: Design = { ...d, sweep: { enabled: true, start: 400e6, stop: 500e6, points: 3 } };
    const text = designToAscii(swept, result, designSweep(swept), 'semicolon');
    const lines = text.split('\n');
    expect(lines[0]).toBe('Start DP;Point;R[Ohm];X[Ohm];Q;Frequency[Hz]');
    expect(lines[1]).toBe('true;DP1;20;-12;0.6;450000000');
    expect(lines[7]).toMatch(/^false;SP1;.*;400000000$/);
    expect(lines).toHaveLength(11);
    const d13 = designFromXmlsc(fixture('xmlsc', 'Example13-input.xmlsc'), 'x');
    const t13 = designToAscii(d13, evaluateLadder(ladderOf(d13)), null, 'comma');
    expect(t13).toContain('G1,input plane const. gain circle,12.94200039,');
    expect(t13).toContain('S1,Input plane stability circle,stable inside,');
    expect(t13).toContain('N1,3.601,3.6,');
  });
});

describe('import', () => {
  it('reads a two-port file and fills the device at the design frequency', () => {
    const f = readImportFile('amp-synthetic.s2p', fixture('sparams', 'amp-synthetic.s2p'));
    expect(f.kind).toBe('twoPort');
    if (f.kind !== 'twoPort') return;
    expect(f.rows).toHaveLength(12);
    const tp = twoPortFromFile(f.data, 2.25e9, f.fileName, 50)!;
    expect(tp.source).toMatchObject({
      fileName: 'amp-synthetic.s2p',
      frequency: 2.25e9,
      clamped: false,
    });
    expect(tp.noise?.nfMinDb).toBeCloseTo(1.275, 9);
    const far = twoPortFromFile(f.data, 20e9, f.fileName, 50)!;
    expect(far.source?.clamped).toBe(true);
  });

  it('reads one-port, CITI and EZNEC files as impedance rows', () => {
    const s1p = readImportFile('dipole-synthetic.s1p', fixture('sparams', 'dipole-synthetic.s1p'));
    expect(s1p.kind).toBe('rows');
    expect(s1p.rows).toHaveLength(16);
    expect(s1p.rows[0]!.z.re).toBeCloseTo(60, 3);
    const citi = readImportFile(
      'twoport-synthetic.citi',
      fixture('sparams', 'twoport-synthetic.citi'),
    );
    expect(citi.kind).toBe('twoPort');
    expect(citi.description).toMatch(/2 packages/);
    const ez = readImportFile('Lastz.txt', fixture('sparams', 'Lastz.txt'));
    expect(ez.kind).toBe('rows');
    expect(ez.rows).toHaveLength(8);
    expect(ez.rows[0]).toEqual({ frequency: 14e6, z: { re: 68, im: -40 } });
    expect(() => readImportFile('x.bin', '')).toThrow(/Not an S-parameter/);
  });
});
