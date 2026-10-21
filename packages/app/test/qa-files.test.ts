import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateLadder, readTouchstone, readXmlsc } from '@smithonline/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SWEEP, designFromXmlsc, emptyDesign, type Design } from '../src/lib/design';
import { designSweep, designToAscii, designToXmlsc, ladderOf } from '../src/lib/files';
import { importKind, readImportFile, twoPortFromFile } from '../src/lib/import';

const fixture = (...parts: string[]): string =>
  readFileSync(join(__dirname, '..', '..', 'core', 'test', 'fixtures', ...parts), 'utf8');

const loads = [
  { frequency: 1e8, z: { re: 100, im: 0 } },
  { frequency: 2e8, z: { re: 50, im: 50 } },
  { frequency: 3e8, z: { re: 25, im: -25 } },
];

const s = {
  s11: { re: 0.3, im: -0.4 },
  s12: { re: 0.05, im: 0 },
  s21: { re: 2, im: 1 },
  s22: { re: 0.2, im: 0.1 },
};

describe('qa: designSweep', () => {
  it('returns nothing when disabled, the loads when present, and guards the frequency sweep', () => {
    const d = emptyDesign();
    expect(designSweep({ ...d, sweep: { ...DEFAULT_SWEEP, loads } })).toBeNull();
    const pts = designSweep({ ...d, sweep: { ...DEFAULT_SWEEP, enabled: true, loads } })!;
    expect(pts.map((p) => p.frequency)).toEqual([1e8, 2e8, 3e8]);
    expect(pts[1]!.zin).toEqual({ re: 50, im: 50 });
    expect(
      designSweep({ ...d, sweep: { enabled: true, start: 0, stop: 1e9, points: 3 } }),
    ).toBeNull();
    expect(
      designSweep({ ...d, sweep: { enabled: true, start: 1e8, stop: 1e9, points: 1 } }),
    ).toBeNull();
    const two = designSweep({ ...d, sweep: { enabled: true, start: 1e8, stop: 1e9, points: 2 } })!;
    expect(two.map((p) => p.frequency)).toEqual([1e8, 1e9]);
  });
});

describe('qa: designToAscii with a datapoint sweep', () => {
  it('lists DP1 at the design frequency and each SP at its own frequency', () => {
    const d: Design = { ...emptyDesign(), sweep: { ...DEFAULT_SWEEP, enabled: true, loads } };
    const text = designToAscii(d, evaluateLadder(ladderOf(d)), designSweep(d), 'semicolon');
    expect(text.split('\n')).toEqual([
      'Start DP;Point;R[Ohm];X[Ohm];Q;Frequency[Hz]',
      'true;DP1;50;0;0;1000000000',
      'false;SP1;100;0;0;100000000',
      'false;SP2;50;50;1;200000000',
      'false;SP3;25;-25;1;300000000',
      '',
    ]);
  });

  it('writes no noise circles when the device has no noise parameters', () => {
    const d: Design = { ...emptyDesign(), twoPort: { s, noise: null }, noiseCircles: [2, 3] };
    const text = designToAscii(d, evaluateLadder(ladderOf(d)), null, 'comma');
    expect(text).not.toMatch(/\nN1,/);
    expect(text.split('\n')).toHaveLength(3);
  });
});

describe('qa: designToXmlsc sweeps and circle types', () => {
  it('writes a datapoint sweep only while the sweep is enabled', () => {
    const on: Design = { ...emptyDesign(), sweep: { ...DEFAULT_SWEEP, enabled: true, loads } };
    const xOn = readXmlsc(designToXmlsc(on));
    expect(xOn.sweep?.sweepType).toBe('datapoint');
    expect(xOn.datapoints.filter((p) => p.isReal)).toHaveLength(4);
    expect(xOn.sweepDatapoints.map((p) => p.frequency)).toEqual([1e8, 2e8, 3e8, 1e9]);
    const off: Design = { ...emptyDesign(), sweep: { ...DEFAULT_SWEEP, loads } };
    const xOff = readXmlsc(designToXmlsc(off));
    expect(xOff.datapoints.filter((p) => p.isReal)).toHaveLength(4);
    expect(xOff.sweep).toBeUndefined();
    expect(xOff.sweepDatapoints).toEqual([]);
  });

  it('writes no frequency sweep when disabled or with fewer than two points', () => {
    const d = emptyDesign();
    expect(readXmlsc(designToXmlsc(d)).sweep).toBeUndefined();
    const one: Design = { ...d, sweep: { enabled: true, start: 1e8, stop: 1e9, points: 1 } };
    expect(readXmlsc(designToXmlsc(one)).sweep).toBeUndefined();
    const two: Design = { ...d, sweep: { enabled: true, start: 1e8, stop: 1e9, points: 2 } };
    expect(readXmlsc(designToXmlsc(two)).sweep).toEqual({
      sweepType: 'frequency',
      startFrequency: 1e8,
      stopFrequency: 1e9,
      stepFrequency: 9e8,
    });
  });

  it('maps the four gain circle types to GainType and plane and back', () => {
    const d: Design = {
      ...emptyDesign(),
      twoPort: { s, noise: null },
      noiseCircles: [2],
      gainCircles: [
        { type: 'available', gainDb: 10 },
        { type: 'operating', gainDb: 9 },
        { type: 'unilateralSource', gainDb: 8 },
        { type: 'unilateralLoad', gainDb: 7 },
      ],
    };
    const text = designToXmlsc(d);
    const x = readXmlsc(text);
    expect(x.gainCircles.map((g) => [g.gainType, g.plane, g.gainDb])).toEqual([
      [1, 1, 10],
      [2, 2, 9],
      [3, 1, 8],
      [3, 2, 7],
    ]);
    expect(x.noiseCircles).toEqual([]);
    expect(x.stabilityCircles).toEqual([]);
    const back = designFromXmlsc(text, 'back');
    expect(back.gainCircles).toEqual(d.gainCircles);
    expect(back.twoPort?.s).toEqual(s);
    expect(back.twoPort?.noise).toBeNull();
    expect(back.showStability).toBe(false);
  });
});

describe('qa: readImportFile and twoPortFromFile', () => {
  it('maps extensions case-insensitively', () => {
    expect(importKind('A.S2P')).toBe('touchstone');
    expect(importKind('a.cti')).toBe('citi');
    expect(importKind('a.CITI')).toBe('citi');
    expect(importKind('Lastz.TXT')).toBe('eznec');
    expect(importKind('a.XMLSC')).toBe('xmlsc');
    expect(importKind('a.s2p.bak')).toBeNull();
    expect(importKind('a')).toBeNull();
  });

  it('refuses project files and non-EZNEC text', () => {
    expect(() => readImportFile('a.xmlsc', '<x/>')).toThrow(/Not an S-parameter/);
    expect(() => readImportFile('a.json', '{}')).toThrow(/Not an S-parameter/);
    expect(() => readImportFile('notes.txt', 'hello\nworld\n')).toThrow(/Lastz/);
  });

  it('uses the first CITI package that holds S arrays', () => {
    const text =
      'CITIFILE A.01.00\nNAME CAL\nVAR FREQ MAG 1\nDATA E[1,1] RI\nVAR_LIST_BEGIN\n1\nVAR_LIST_END\nBEGIN\n0,0\nEND\n' +
      'CITIFILE A.01.00\nNAME DATA2\nVAR FREQ MAG 1\nDATA S[1,1] RI\nVAR_LIST_BEGIN\n1000000\nVAR_LIST_END\nBEGIN\n0.5,0\nEND\n';
    const f = readImportFile('x.citi', text);
    expect(f.kind).toBe('rows');
    expect(f.description).toMatch(/DATA2 1-port, 2 packages/);
    expect(f.rows[0]!.frequency).toBe(1e6);
    // Gamma 0.5 against 50 ohm is 150 ohm.
    expect(f.rows[0]!.z.re).toBeCloseTo(150, 9);
    const none =
      'CITIFILE A.01.00\nVAR FREQ MAG 1\nDATA E[1,1] RI\nVAR_LIST_BEGIN\n1\nVAR_LIST_END\nBEGIN\n0,0\nEND\n';
    expect(() => readImportFile('x.citi', none)).toThrow(/holds no S/);
  });

  it('keeps only the first source of an EZNEC table', () => {
    const text =
      '"Freq MHz","Src #","R","X","SWR (50 ohms)","SWR (alt. Z0)"\n' +
      '14,2,30,10,1.8,1.5\n14,1,68,-40,2.09,1.75\n14.1,2,32,12,1.7,1.4\n14.1,1,70,-20,1.61,1.33\n';
    const f = readImportFile('Lastz.txt', text);
    expect(f.kind).toBe('rows');
    expect(f.rows).toEqual([
      { frequency: 14e6, z: { re: 30, im: 10 } },
      { frequency: 14.1e6, z: { re: 32, im: 12 } },
    ]);
    expect(f.description).toBe('EZNEC Lastz.txt');
  });

  it('re-references S11, S22, Gamma_opt and rn to the design Z0', () => {
    // S11 = S22 = Gamma_opt = 0.5 against 50 ohm is 150 ohm; against 100 ohm that is 0.2.
    const f = readImportFile(
      'dev.s2p',
      '# GHZ S RI R 50\n1 0.5 0 0.3 0 0.2 0 0.5 0\n1 1.2 0.5 0 0.16\n',
    );
    if (f.kind !== 'twoPort') throw new Error('expected a two-port');
    const tp = twoPortFromFile(f.data, 1e9, f.fileName, 100)!;
    expect(tp.s.s11.re).toBeCloseTo(0.2, 12);
    expect(tp.s.s22.re).toBeCloseTo(0.2, 12);
    expect(tp.s.s21).toEqual({ re: 0.3, im: 0 });
    expect(tp.s.s12).toEqual({ re: 0.2, im: 0 });
    expect(tp.noise!.gammaOpt.re).toBeCloseTo(0.2, 12);
    expect(tp.noise!.rn).toBeCloseTo(0.08, 12);
    expect(tp.noise!.nfMinDb).toBe(1.2);
    const same = twoPortFromFile(f.data, 1e9, f.fileName, 50)!;
    expect(same.s.s11).toEqual({ re: 0.5, im: 0 });
    expect(same.noise!.rn).toBe(0.16);
    expect(same.source).toEqual({
      fileName: 'dev.s2p',
      frequency: 1e9,
      covers: [1e9, 1e9],
      clamped: false,
    });
  });

  it('returns null for a one-port', () => {
    const f = readImportFile('dipole-synthetic.s1p', fixture('sparams', 'dipole-synthetic.s1p'));
    expect(f.kind).toBe('rows');
    const one = readTouchstone('# MHZ S RI R 50\n130 0.405405 -0.432432\n', 1);
    expect(twoPortFromFile(one, 130e6, 'd.s1p', 50)).toBeNull();
  });
});
