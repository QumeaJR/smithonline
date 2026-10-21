import { describe, expect, it } from 'vitest';
import {
  buildXmlsc,
  complex,
  formatDotNetDouble,
  ladderFromXmlsc,
  newGuid,
  polarDeg,
  readXmlsc,
  writeXmlsc,
  type Ladder,
  type XmlscWriteDesign,
} from '../src/index';

const BOM = '﻿';
const HEAD =
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<CSmithChartDesign xmlns:xsd="http://www.w3.org/2001/XMLSchema" ' +
  'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">';
const TAIL = '</CSmithChartDesign>';
const guid = (): string => '00000000-0000-4000-8000-000000000000';

describe('qa: formatDotNetDouble around 1E-05, 1E+15 and negative values', () => {
  it('switches to the exponent form below 1E-04', () => {
    expect(formatDotNetDouble(0.000012345)).toBe('1.2345E-05');
    expect(formatDotNetDouble(0.00012345)).toBe('0.00012345');
    expect(formatDotNetDouble(9.99e-5)).toBe('9.99E-05');
    expect(formatDotNetDouble(0.0001)).toBe('0.0001');
  });

  it('switches to the exponent form from 1E+15', () => {
    expect(formatDotNetDouble(999999999999999)).toBe('999999999999999');
    expect(formatDotNetDouble(1.5e15)).toBe('1.5E+15');
    expect(formatDotNetDouble(1e14)).toBe('100000000000000');
    expect(formatDotNetDouble(1e16)).toBe('1E+16');
    expect(formatDotNetDouble(123456789012345000)).toBe('1.23456789012345E+17');
    expect(formatDotNetDouble(1.2345678901234567e19)).toBe('1.2345678901234567E+19');
  });

  it('keeps the sign in every form', () => {
    expect(formatDotNetDouble(-1e-5)).toBe('-1E-05');
    expect(formatDotNetDouble(-1e15)).toBe('-1E+15');
    expect(formatDotNetDouble(-123.456)).toBe('-123.456');
    expect(formatDotNetDouble(-0.0001)).toBe('-0.0001');
    expect(formatDotNetDouble(-(2.39 * 1e-9))).toBe('-2.3900000000000002E-09');
    expect(formatDotNetDouble(-(0.1 + 0.2))).toBe('-0.30000000000000004');
  });

  it('writes 17 digits only when 15 do not round-trip, and three-digit exponents', () => {
    expect(formatDotNetDouble(0.1)).toBe('0.1');
    expect(formatDotNetDouble(1 / 3)).toBe('0.33333333333333331');
    expect(formatDotNetDouble(1234.5)).toBe('1234.5');
    expect(formatDotNetDouble(1e100)).toBe('1E+100');
    expect(formatDotNetDouble(1e-100)).toBe('1E-100');
    expect(formatDotNetDouble(5e-324)).toBe('4.94065645841247E-324');
  });

  it('writes the XmlConvert spellings for infinities and NaN', () => {
    // The original's XmlSerializer writes doubles through XmlConvert.ToString,
    // which spells them INF, -INF and NaN.
    expect(formatDotNetDouble(NaN)).toBe('NaN');
    expect(formatDotNetDouble(Infinity)).toBe('INF');
    expect(formatDotNetDouble(-Infinity)).toBe('-INF');
  });
});

describe('qa: writeXmlsc layout', () => {
  it('writes an empty design as the bare root element', () => {
    const empty: XmlscWriteDesign = {
      datapoints: [],
      components: [],
      sweepDatapoints: [],
      qList: [],
      vswrList: [],
      stabilityCircles: [],
      noiseCircles: [],
      gainCircles: [],
    };
    expect(writeXmlsc(empty)).toBe(BOM + HEAD + TAIL);
  });

  it('orders datapoints, QList, VSWRList, sweep points and sweep parameters', () => {
    const d: XmlscWriteDesign = {
      datapoints: [{ index: 0, isReal: true, isStart: false, frequency: 1e9, r: 50, x: 0 }],
      components: [],
      qList: ['1.0', 2],
      vswrList: [1.5],
      sweepDatapoints: [{ index: 0, isReal: false, isStart: false, frequency: 1e8, r: 25, x: -10 }],
      sweep: {
        sweepType: 'frequency',
        startFrequency: 1e8,
        stopFrequency: 2e8,
        stepFrequency: 1e8,
      },
      stabilityCircles: [],
      noiseCircles: [],
      gainCircles: [],
    };
    expect(writeXmlsc(d)).toBe(
      BOM +
        HEAD +
        '<CDatapoint><StartDatapoint>0</StartDatapoint><IsRealDP>1</IsRealDP><IndexOfDP>0</IndexOfDP>' +
        '<Frequency>1000000000</Frequency><R>50</R><X>0</X><U>0</U><V>0</V></CDatapoint>' +
        '<QList>1.0</QList><QList>2</QList><VSWRList>1.5</VSWRList>' +
        '<CSweepDatapoint><StartDatapoint>0</StartDatapoint><IsRealDP>0</IsRealDP><IndexOfDP>0</IndexOfDP>' +
        '<Frequency>100000000</Frequency><R>25</R><X>-10</X><U>0</U><V>0</V></CSweepDatapoint>' +
        '<CSweepDatapointParameters><Sweeptype>2</Sweeptype><StartFrequency>100000000</StartFrequency>' +
        '<StopFrequency>200000000</StopFrequency><StepFrequency>100000000</StepFrequency></CSweepDatapointParameters>' +
        TAIL,
    );
  });

  it('fills FreqUnit 6 and Marked false when the circle records do not carry them', () => {
    const s = {
      s11: complex(0.5, 0),
      s12: complex(0.05, 0),
      s21: complex(3, 0),
      s22: complex(0.4, 0),
    };
    const d: XmlscWriteDesign = {
      datapoints: [],
      components: [],
      sweepDatapoints: [],
      qList: [],
      vswrList: [],
      stabilityCircles: [],
      noiseCircles: [
        {
          manual: false,
          visible: true,
          highlight: false,
          normalized: true,
          frequency: 2e9,
          nfDb: 1.5,
          rn: 0.3,
          gammaOpt: complex(0.2, 0.1),
          nfMinDb: 1,
        },
      ],
      gainCircles: [
        {
          plane: 2,
          manual: true,
          gainType: 2,
          visible: true,
          highlight: true,
          s,
          k: 1.2,
          gainDb: 10,
          gmaxDb: 12.5,
          frequency: 2e9,
        },
      ],
    };
    const text = writeXmlsc(d);
    expect(text).toContain(
      '<CNoiseList><ManualCyrcle>0</ManualCyrcle><FreqUnit>6</FreqUnit><Visible>true</Visible>' +
        '<Highlight>false</Highlight><Normalized>1</Normalized><F>2000000000</F><NF>1.5</NF>' +
        '<Rnoise>0.3</Rnoise><RNFminIM>0.1</RNFminIM><RNFminRE>0.2</RNFminRE><NFmin>1</NFmin></CNoiseList>',
    );
    expect(text).toContain(
      '<CGainCirclesList><Typ>2</Typ><ManualCyrcle>1</ManualCyrcle><GainType>2</GainType>' +
        '<Visible>true</Visible><Highlight>true</Highlight><Marked>false</Marked>' +
        '<S22im>0</S22im><S22re>0.4</S22re><S21re>3</S21re><S21im>0</S21im><S12im>0</S12im>' +
        '<S12re>0.05</S12re><S11im>0</S11im><S11re>0.5</S11re><K>1.2</K><P>10</P><Gmax>12.5</Gmax>' +
        '<F>2000000000</F></CGainCirclesList>',
    );
    const back = readXmlsc(text);
    expect(back.noiseCircles[0]!.freqUnit).toBe(6);
    expect(back.gainCircles[0]!.marked).toBe(false);
  });

  it('makes GUIDs in the 8-4-4-4-12 form', () => {
    expect(newGuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(newGuid()).not.toBe(newGuid());
  });
});

describe('qa: buildXmlsc with lines and stubs without refFrequency', () => {
  it('stores a quarter-wave line taken at the design frequency', () => {
    // 25 ohm through a quarter wave of 50 ohm is 50^2 / 25 = 100 ohm.
    const ladder: Ladder = {
      z0: 50,
      frequency: 1e9,
      load: complex(25, 0),
      elements: [{ kind: 'line', z0: 50, length: 0.25 }],
    };
    const d = buildXmlsc(ladder, { guid });
    expect(d.components[0]).toMatchObject({
      typ: 8,
      value: 0.25,
      lineImp: 50,
      er: 1,
      alpha: 0,
      lambda: 0.25,
      rBegin: 25,
      xBegin: 0,
    });
    expect(d.components[0]!.rEnd).toBeCloseTo(100, 6);
    expect(Math.abs(d.components[0]!.xEnd)).toBeLessThan(1e-6);
    expect(d.datapoints).toHaveLength(2);
    expect(d.datapoints[1]).toMatchObject({ index: 1, isReal: false, frequency: 1e9 });
    expect(d.datapoints[1]!.r).toBeCloseTo(100, 6);
    const back = ladderFromXmlsc(readXmlsc(writeXmlsc(d)));
    expect(back.elements[0]).toMatchObject({
      kind: 'line',
      z0: 50,
      length: 0.25,
      refFrequency: 1e9,
    });
  });

  it('keeps er and alpha of a lossy line without refFrequency', () => {
    const ladder: Ladder = {
      z0: 50,
      frequency: 1e9,
      load: complex(50, 0),
      elements: [{ kind: 'line', z0: 50, length: 0.1, er: 2.1, alphaDbPerM: 2 }],
    };
    const d = buildXmlsc(ladder, { guid });
    expect(d.components[0]).toMatchObject({ typ: 8, value: 0.1, er: 2.1, alpha: 2, lambda: 0.1 });
  });

  it('stores eighth-wave stubs with the impedance they produce', () => {
    // 50 ohm with a shorted 50 ohm stub of 0.125 wavelength: Y = 0.02 - j0.02 S, Z = 25 + j25.
    // With an open stub: Y = 0.02 + j0.02 S, Z = 25 - j25.
    const base = { z0: 50, frequency: 1e9, load: complex(50, 0) };
    const short = buildXmlsc(
      { ...base, elements: [{ kind: 'shortStub', z0: 50, length: 0.125 }] },
      { guid },
    );
    expect(short.components[0]).toMatchObject({ typ: 30, value: 0.125, lineImp: 50, er: 1 });
    expect(short.components[0]!.rEnd).toBeCloseTo(25, 9);
    expect(short.components[0]!.xEnd).toBeCloseTo(25, 9);
    const open = buildXmlsc(
      { ...base, elements: [{ kind: 'openStub', z0: 50, length: 0.125 }] },
      { guid },
    );
    expect(open.components[0]).toMatchObject({ typ: 9, lambda: 0.125 });
    expect(open.components[0]!.rEnd).toBeCloseTo(25, 9);
    expect(open.components[0]!.xEnd).toBeCloseTo(-25, 9);
  });
});

describe('qa: buildXmlsc datapoint bookkeeping', () => {
  const ladder: Ladder = {
    z0: 50,
    frequency: 1e9,
    load: complex(20, -12),
    elements: [{ kind: 'L', orientation: 'series', value: 5e-9 }],
  };

  it('writes a plain single datapoint without the start mark', () => {
    expect(buildXmlsc(ladder, { guid }).datapoints[0]!.isStart).toBe(false);
    expect(buildXmlsc(ladder, { guid, datapointSweep: [] }).datapoints[0]!.isStart).toBe(false);
    expect(buildXmlsc(ladder, { guid }).sweepDatapoints).toEqual([]);
    expect(buildXmlsc(ladder, { guid }).sweep).toBeUndefined();
  });

  it('drops the sweep load equal to the design load and marks the start', () => {
    const d = buildXmlsc(ladder, {
      guid,
      datapointSweep: [
        { frequency: 1e9, z: complex(20, -12) },
        { frequency: 2e9, z: complex(30, 5) },
      ],
    });
    expect(d.datapoints.map((p) => [p.index, p.isReal, p.isStart, p.frequency])).toEqual([
      [0, true, true, 1e9],
      [1, true, false, 2e9],
      [2, false, false, 1e9],
    ]);
    // Series 5 nH at 1 GHz adds 2 pi 1e9 5e-9 = 31.4159 ohm of reactance.
    expect(d.datapoints[2]!.r).toBeCloseTo(20, 9);
    expect(d.datapoints[2]!.x).toBeCloseTo(-12 + 2 * Math.PI * 5, 6);
    expect(d.sweepDatapoints).toHaveLength(2);
    expect(d.sweepDatapoints[1]!.frequency).toBe(2e9);
    expect(d.sweepDatapoints[1]!.x).toBeCloseTo(5 + 2 * Math.PI * 10, 6);
    expect(d.sweep).toEqual({
      sweepType: 'datapoint',
      startFrequency: 1e9,
      stopFrequency: 2e9,
      stepFrequency: 1e9,
    });
  });

  it('keeps a second user datapoint at the design frequency and marks only the load', () => {
    const d = buildXmlsc(ladder, {
      guid,
      datapointSweep: [{ frequency: 1e9, z: complex(40, 0) }],
    });
    expect(d.datapoints.filter((p) => p.isReal)).toHaveLength(2);
    expect(d.datapoints.filter((p) => p.isStart)).toHaveLength(1);
    expect(d.datapoints.find((p) => p.isStart)).toMatchObject({ r: 20, x: -12 });
  });

  it('writes no sweep for fewer than two frequencies', () => {
    expect(buildXmlsc(ladder, { guid, frequencySweep: [1e9] }).sweep).toBeUndefined();
    expect(buildXmlsc(ladder, { guid, frequencySweep: [] }).sweepDatapoints).toEqual([]);
    const d = buildXmlsc(ladder, { guid, frequencySweep: [1e9, 2e9] });
    expect(d.sweep).toEqual({
      sweepType: 'frequency',
      startFrequency: 1e9,
      stopFrequency: 2e9,
      stepFrequency: 1e9,
    });
    expect(d.sweepDatapoints.map((p) => p.frequency)).toEqual([1e9, 2e9]);
  });

  it('writes no noise circles without noise parameters and no stability circles unless asked', () => {
    const s = {
      s11: polarDeg(0.5, -120),
      s12: polarDeg(0.05, 50),
      s21: polarDeg(3, 80),
      s22: polarDeg(0.4, -40),
    };
    const d = buildXmlsc(ladder, {
      guid,
      twoPort: { s, noise: null },
      noiseCircles: [2],
      gainCircles: [{ gainType: 2, plane: 2, gainDb: 9 }],
    });
    expect(d.noiseCircles).toEqual([]);
    expect(d.stabilityCircles).toEqual([]);
    expect(d.gainCircles).toHaveLength(1);
    expect(d.gainCircles[0]).toMatchObject({ plane: 2, gainType: 2, gainDb: 9, manual: true });
    expect(Number.isFinite(d.gainCircles[0]!.k)).toBe(true);
    expect(Number.isFinite(d.gainCircles[0]!.gmaxDb)).toBe(true);
    // A device marks the single datapoint as the start (Example 13).
    expect(d.datapoints[0]!.isStart).toBe(true);
  });
});
