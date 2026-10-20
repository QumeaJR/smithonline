import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  componentToElement,
  ladderFromXmlsc,
  readXmlsc,
  startDatapoint,
  XmlscError,
  type XmlscComponent,
} from '../src/index';

const FIXTURES = join(__dirname, 'fixtures', 'xmlsc');
const load = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

const base: XmlscComponent = {
  guid: 'test',
  typ: 2,
  value: 1e-12,
  rBegin: 50,
  xBegin: 0,
  rEnd: 50,
  xEnd: -1,
  lineImp: 0,
  er: 0,
  alpha: 0,
  lambda: 0,
  rRlc: 0,
  lRlc: 0,
  cRlc: 0,
};

describe('readXmlsc', () => {
  it('reads datapoints, components and lists of Example 5', () => {
    const d = readXmlsc(load('Example5.xmlsc'));
    expect(d.datapoints).toHaveLength(6);
    expect(d.datapoints[0]).toEqual({
      index: 0,
      isReal: true,
      isStart: false,
      frequency: 450e6,
      r: 20,
      x: -12,
    });
    expect(d.components).toHaveLength(5);
    expect(d.components[0]).toMatchObject({
      guid: '548067fa-902d-490d-9bee-5ebaaad2ae43',
      typ: 5,
      value: 1.6033386409903585e-8,
      rBegin: 20,
      xBegin: -12,
      rEnd: 27.2,
    });
    expect(d.qList).toEqual([0.6]);
    expect(d.vswrList).toEqual([]);
    expect(d.sweep).toBeUndefined();
    expect(d.sweepDatapoints).toEqual([]);
  });

  it('reads the lossy line fields of Example 15', () => {
    const d = readXmlsc(load('Example15.xmlsc'));
    expect(d.components[0]).toMatchObject({
      typ: 8,
      value: 2.006,
      lineImp: 50,
      er: 2.1,
      alpha: 2,
      lambda: 2.006,
    });
    expect(d.datapoints[0]?.isStart).toBe(true);
  });

  it('reads sweep parameters and points', () => {
    const d16 = readXmlsc(load('Example16.xmlsc'));
    expect(d16.sweep).toEqual({
      sweepType: 'frequency',
      startFrequency: 10e6,
      stopFrequency: 450e6,
      stepFrequency: 10e6,
    });
    expect(d16.sweepDatapoints).toHaveLength(45);
    const d17 = readXmlsc(load('Example17.xmlsc'));
    expect(d17.sweep?.sweepType).toBe('datapoint');
    expect(d17.vswrList).toEqual([1.2]);
  });

  it('rejects files without the root element', () => {
    expect(() => readXmlsc('<html></html>')).toThrow(XmlscError);
    expect(() => readXmlsc('<html></html>')).toThrow(/CSmithChartDesign/);
  });

  it('rejects unknown element type codes with a clear message', () => {
    const xml = load('Example1.xmlsc').replace('<Typ>5</Typ>', '<Typ>7</Typ>');
    expect(() => readXmlsc(xml)).toThrow(XmlscError);
    expect(() => readXmlsc(xml)).toThrow(
      /Unsupported element type code 7 \(component [0-9a-f-]+\)/,
    );
    expect(() => componentToElement({ ...base, typ: 99 }, 1e9)).toThrow(/code 99/);
  });

  it('rejects missing or malformed numbers', () => {
    const xml = load('Example1.xmlsc').replace(/<R>[^<]*<\/R>/, '<R>abc</R>');
    expect(() => readXmlsc(xml)).toThrow(/Invalid number "abc" in <R>/);
    const missing = load('Example1.xmlsc').replace(/<Value>[^<]*<\/Value>/, '');
    expect(() => readXmlsc(missing)).toThrow(/Missing <Value> in CComponent 0/);
  });

  it('does not choke on circle records it does not interpret yet', () => {
    const d = readXmlsc(load('Example13-input.xmlsc'));
    expect(d.components).toHaveLength(1);
    expect(d.datapoints).toHaveLength(2);
  });
});

describe('componentToElement', () => {
  it('maps the seven known codes', () => {
    expect(componentToElement({ ...base, typ: 2 }, 1e9)).toEqual({
      kind: 'C',
      orientation: 'series',
      value: 1e-12,
    });
    expect(componentToElement({ ...base, typ: 3 }, 1e9)).toEqual({
      kind: 'C',
      orientation: 'shunt',
      value: 1e-12,
    });
    expect(componentToElement({ ...base, typ: 4 }, 1e9)).toEqual({
      kind: 'L',
      orientation: 'series',
      value: 1e-12,
    });
    expect(componentToElement({ ...base, typ: 5 }, 1e9)).toEqual({
      kind: 'L',
      orientation: 'shunt',
      value: 1e-12,
    });
    expect(componentToElement({ ...base, typ: 8, value: 0.2, lineImp: 75, er: 1 }, 1e9)).toEqual({
      kind: 'line',
      z0: 75,
      length: 0.2,
      refFrequency: 1e9,
      er: 1,
      alphaDbPerM: 0,
    });
    expect(
      componentToElement({ ...base, typ: 8, value: 2, lineImp: 50, er: 2.1, alpha: 2 }, 5e8),
    ).toMatchObject({
      kind: 'line',
      er: 2.1,
      alphaDbPerM: 2,
    });
    expect(componentToElement({ ...base, typ: 9, value: 0.1, lineImp: 50 }, 1e9)).toEqual({
      kind: 'openStub',
      z0: 50,
      length: 0.1,
      refFrequency: 1e9,
    });
    expect(componentToElement({ ...base, typ: 30, value: 0.1, lineImp: 50 }, 1e9)).toEqual({
      kind: 'shortStub',
      z0: 50,
      length: 0.1,
      refFrequency: 1e9,
    });
  });

  it('treats an Er below 1 as air', () => {
    expect(componentToElement({ ...base, typ: 8, lineImp: 50, er: 0 }, 1e9)).toMatchObject({
      er: 1,
    });
  });
});

describe('ladderFromXmlsc', () => {
  it('starts from the marked user datapoint when several exist (Example 17)', () => {
    const d = readXmlsc(load('Example17.xmlsc'));
    expect(startDatapoint(d).index).toBe(1);
    const ladder = ladderFromXmlsc(d);
    expect(ladder.frequency).toBe(145e6);
    expect(ladder.load).toEqual({ re: 106.9, im: 41.7 });
    expect(ladder.elements).toHaveLength(4);
    expect(ladder.storedNodes).toHaveLength(4);
    expect(ladder.sweepLoads.map((l) => l.frequency)).toEqual([140e6, 145e6, 150e6]);
    expect(ladder.z0).toBe(50);
    expect(ladderFromXmlsc(d, 75).z0).toBe(75);
  });

  it('falls back to the first user datapoint', () => {
    const d = readXmlsc(load('Example5.xmlsc'));
    expect(startDatapoint(d).index).toBe(0);
    expect(() => startDatapoint({ ...d, datapoints: [] })).toThrow(/no datapoints/);
  });
});
