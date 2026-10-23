import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { designHasDatapointSweep, startIndex, userDatapoints } from '../src/lib/datapoints';
import { designFromXmlsc, nameFromFile } from '../src/lib/design';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '..', '..', 'core', 'test', 'fixtures', 'xmlsc', name), 'utf8');

describe('designFromXmlsc', () => {
  it('maps Example 5 with its Q contour', () => {
    const d = designFromXmlsc(fixture('Example5.xmlsc'), 'Example 5');
    expect(d.name).toBe('Example 5');
    expect(d.frequency).toBe(450e6);
    expect(d.load).toEqual({ re: 20, im: -12 });
    expect(d.elements).toHaveLength(5);
    expect(d.qContours).toEqual([0.6]);
    expect(d.vswrCircles).toEqual([]);
    expect(d.sweep.enabled).toBe(false);
    expect(d.sweep.start).toBe(225e6);
    expect(d.sweep.stop).toBe(900e6);
  });

  it('turns the stored frequency sweep of Example 16 into sweep settings', () => {
    const d = designFromXmlsc(fixture('Example16.xmlsc'), 'Example 16');
    expect(d.sweep).toEqual({ enabled: true, start: 10e6, stop: 450e6, points: 45 });
  });

  it('starts Example 17 from the marked datapoint and keeps the VSWR circle', () => {
    const d = designFromXmlsc(fixture('Example17.xmlsc'), 'Example 17');
    expect(d.load).toEqual({ re: 106.9, im: 41.7 });
    expect(d.vswrCircles).toEqual([1.2]);
    // The three user datapoints are kept in DP order, 145 MHz is the start (DP2).
    expect(d.sweep.enabled).toBe(true);
    expect(userDatapoints(d).map((l) => l.frequency)).toEqual([140e6, 145e6, 150e6]);
    expect(startIndex(d)).toBe(1);
    expect(designHasDatapointSweep(d)).toBe(true);
  });

  it('rejects unknown element codes', () => {
    const xml = fixture('Example1.xmlsc').replace('<Typ>5</Typ>', '<Typ>7</Typ>');
    expect(() => designFromXmlsc(xml, 'x')).toThrow(/Unsupported element type code 7/);
  });

  it('derives a display name from a file name', () => {
    expect(nameFromFile('Example13-output1.xmlsc')).toBe('Example13 output1');
    expect(nameFromFile('my_design.json')).toBe('my design');
  });
});
