import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildXmlsc,
  complex,
  formatDotNetDouble,
  ladderFromXmlsc,
  polarDeg,
  readXmlsc,
  writeXmlsc,
  XmlscError,
  type Ladder,
} from '../src/index';

const FIXTURES = join(__dirname, 'fixtures', 'xmlsc');
const files = readdirSync(FIXTURES).filter((n) => n.endsWith('.xmlsc'));
const load = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

describe('formatDotNetDouble', () => {
  it('matches the .NET round-trip format', () => {
    expect(formatDotNetDouble(2000000000)).toBe('2000000000');
    expect(formatDotNetDouble(1e-11)).toBe('1E-11');
    expect(formatDotNetDouble(6.8e-8)).toBe('6.8E-08');
    expect(formatDotNetDouble(2.39 * 1e-9)).toBe('2.3900000000000002E-09');
    expect(formatDotNetDouble(30.033625768318426)).toBe('30.033625768318426');
    expect(formatDotNetDouble(50.268998069418018)).toBe('50.268998069418018');
    expect(formatDotNetDouble(0.0001)).toBe('0.0001');
    expect(formatDotNetDouble(0.00001)).toBe('1E-05');
    expect(formatDotNetDouble(1e15)).toBe('1E+15');
    expect(formatDotNetDouble(123456789012345)).toBe('123456789012345');
    expect(formatDotNetDouble(-0.5)).toBe('-0.5');
    expect(formatDotNetDouble(0)).toBe('0');
  });
});

describe('writeXmlsc round trip', () => {
  it('covers all 22 example projects', () => {
    expect(files).toHaveLength(22);
  });

  for (const name of files) {
    it(`reproduces ${name} byte for byte`, () => {
      const original = load(name);
      const d = readXmlsc(original);
      const text = writeXmlsc({ ...d, qList: d.qListText, vswrList: d.vswrListText });
      expect(text).toBe(original);
    });
  }
});

describe('buildXmlsc', () => {
  const guid = (): string => '00000000-0000-4000-8000-000000000000';

  it('stores a ladder so that reading it back gives the same elements and nodes', () => {
    const ladder: Ladder = {
      z0: 50,
      frequency: 1e9,
      load: complex(20, -12),
      elements: [
        { kind: 'L', orientation: 'shunt', value: 5e-9 },
        { kind: 'C', orientation: 'series', value: 3e-12 },
        { kind: 'line', z0: 75, length: 0.125, refFrequency: 1e9, er: 2.1, alphaDbPerM: 2 },
        { kind: 'openStub', z0: 50, length: 0.1, refFrequency: 1e9 },
        { kind: 'shortStub', z0: 60, length: 0.2, refFrequency: 1e9 },
        { kind: 'C', orientation: 'shunt', value: 1e-12 },
        { kind: 'L', orientation: 'series', value: 2e-9 },
      ],
    };
    const text = writeXmlsc(buildXmlsc(ladder, { qList: [0.6], guid }));
    expect(text.startsWith('﻿<?xml')).toBe(true);
    const d = readXmlsc(text);
    expect(d.datapoints).toHaveLength(8);
    expect(d.datapoints[0]).toMatchObject({ isReal: true, isStart: false, r: 20, x: -12 });
    expect(d.components.map((c) => c.typ)).toEqual([5, 2, 8, 9, 30, 3, 4]);
    expect(d.components[2]).toMatchObject({ lineImp: 75, er: 2.1, alpha: 2, lambda: 0.125 });
    expect(d.components[3]).toMatchObject({ lineImp: 50, er: 1, lambda: 0.1 });
    expect(d.qList).toEqual([0.6]);
    const back = ladderFromXmlsc(d);
    expect(back.elements).toEqual(ladder.elements);
    // Rend / Xend of each component equal the following datapoint.
    d.components.forEach((c, i) => {
      expect(c.rEnd).toBe(d.datapoints[i + 1]!.r);
      expect(c.xEnd).toBe(d.datapoints[i + 1]!.x);
      expect(c.rBegin).toBe(d.datapoints[i]!.r);
    });
  });

  it('writes a frequency sweep like Example 16', () => {
    const ex = ladderFromXmlsc(readXmlsc(load('Example16.xmlsc')));
    const fs = Array.from({ length: 45 }, (_, i) => 10e6 * (i + 1));
    const d = readXmlsc(writeXmlsc(buildXmlsc(ex, { frequencySweep: fs, guid })));
    expect(d.sweep).toEqual({
      sweepType: 'frequency',
      startFrequency: 10e6,
      stopFrequency: 450e6,
      stepFrequency: 10e6,
    });
    expect(d.sweepDatapoints).toHaveLength(45);
    const stored = readXmlsc(load('Example16.xmlsc')).sweepDatapoints;
    d.sweepDatapoints.forEach((p, i) => {
      expect(p.frequency).toBe(stored[i]!.frequency);
      expect(p.r).toBeCloseTo(stored[i]!.r, 4);
      expect(p.x).toBeCloseTo(stored[i]!.x, 4);
    });
  });

  it('writes a datapoint sweep like Example 17 with the start datapoint marked', () => {
    const ex = ladderFromXmlsc(readXmlsc(load('Example17.xmlsc')));
    const d = readXmlsc(
      writeXmlsc(buildXmlsc(ex, { datapointSweep: ex.sweepLoads, vswrList: [1.2], guid })),
    );
    expect(d.datapoints.slice(0, 3).map((p) => [p.isReal, p.isStart, p.frequency])).toEqual([
      [true, false, 140e6],
      [true, true, 145e6],
      [true, false, 150e6],
    ]);
    expect(d.datapoints).toHaveLength(7);
    expect(d.sweep).toEqual({
      sweepType: 'datapoint',
      startFrequency: 140e6,
      stopFrequency: 150e6,
      stepFrequency: 10e6,
    });
    const stored = readXmlsc(load('Example17.xmlsc')).sweepDatapoints;
    expect(d.sweepDatapoints).toHaveLength(3);
    d.sweepDatapoints.forEach((p, i) => {
      expect(p.r).toBeCloseTo(stored[i]!.r, 4);
      expect(p.x).toBeCloseTo(stored[i]!.x, 4);
    });
    expect(d.vswrList).toEqual([1.2]);
  });

  it('writes stability, gain and noise circle records from a two-port', () => {
    const s = {
      s11: polarDeg(0.5, -120),
      s12: polarDeg(0.05, 50),
      s21: polarDeg(3, 80),
      s22: polarDeg(0.4, -40),
    };
    const noise = { nfMinDb: 1, gammaOpt: polarDeg(0.4, 60), rn: 0.3 };
    const ladder: Ladder = { z0: 50, frequency: 2e9, load: complex(50, 0), elements: [] };
    const d = readXmlsc(
      writeXmlsc(
        buildXmlsc(ladder, {
          twoPort: { s, noise },
          stabilityCircles: true,
          gainCircles: [{ gainType: 1, plane: 1, gainDb: 10 }],
          noiseCircles: [1.5, 2],
          guid,
        }),
      ),
    );
    expect(d.datapoints[0]?.isStart).toBe(true);
    expect(d.stabilityCircles.map((c) => c.plane)).toEqual([1, 2]);
    expect(d.stabilityCircles[0]!.s.s21.re).toBeCloseTo(s.s21.re, 15);
    expect(d.gainCircles[0]).toMatchObject({ gainType: 1, plane: 1, gainDb: 10, frequency: 2e9 });
    expect(d.noiseCircles.map((c) => c.nfDb)).toEqual([1.5, 2]);
    expect(d.noiseCircles[0]!.rn).toBe(0.3);
    expect(d.noiseCircles[0]!.gammaOpt.im).toBeCloseTo(noise.gammaOpt.im, 15);
  });

  it('refuses elements whose type code is unknown', () => {
    const ladder: Ladder = {
      z0: 50,
      frequency: 1e9,
      load: complex(50, 0),
      elements: [{ kind: 'R', orientation: 'series', value: 10 }],
    };
    expect(() => buildXmlsc(ladder, { guid })).toThrow(XmlscError);
    expect(() => buildXmlsc(ladder, { guid })).toThrow(/cannot be saved as .xmlsc/);
  });
});
