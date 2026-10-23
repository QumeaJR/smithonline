/**
 * QA round 2 for the VNA CSV import in the app (commits 137ed2b and 4cf7e44):
 * Touchstone text under .csv/.txt, descriptions, partial two-ports in the
 * S-Plot actions and the gain table, Z0 re-referencing, and the store guard.
 * Expected values are hand calculations.
 */
import { complex, type TouchstoneData } from '@smithonline/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDesign } from '../src/lib/design';
import { readImportFile, twoPortFromFile, vnaDescription } from '../src/lib/import';
import { readSPlotFiles } from '../src/lib/splot';
import {
  exportTouchstoneText,
  fillDeviceFromFile,
  hasPort,
  listNames,
  missingParameters,
} from '../src/lib/splotActions';
import { GainTable } from '../src/splot/GainTable';
import { useDesignStore } from '../src/store/useDesignStore';
import type { SPlotEntry } from '../src/store/useSPlotStore';
import { readVnaCsv } from '@smithonline/core';

const entryOf = (fileName: string, data: TouchstoneData): SPlotEntry => ({
  id: `${fileName}#1`,
  fileName,
  kind: 'vna',
  description: '',
  original: data,
  unit: data.frequencyUnit,
  data,
  color: '#123456',
  visible: true,
});

const fromText = (fileName: string, text: string): SPlotEntry => {
  const [p] = readSPlotFiles(fileName, text);
  return entryOf(fileName, p!.data);
};

beforeEach(() => {
  useDesignStore.setState({ design: emptyDesign(), past: [], future: [], message: null });
});

describe('qa2 vna import: Touchstone text under .csv and .txt', () => {
  // Gamma 0.5 against 50 ohm: Z = 50 (1.5 / 0.5) = 150 ohm; 100 MHz is 1e8 Hz.
  it('comma separated rows under "# mhz s ri r 50" in a .csv are read as Touchstone', () => {
    const f = readImportFile('ts.csv', '# mhz s ri r 50\n100,0.5,0\n200,0.5,0\n');
    expect(f.kind).toBe('rows');
    expect(f.rows.map((r) => r.frequency)).toEqual([1e8, 2e8]);
    expect(f.rows[0]?.z.re).toBeCloseTo(150, 9);
    expect(f.rows[0]?.z.im).toBeCloseTo(0, 9);
    expect(f.description).toBe('Touchstone text, 1-port, RI, 2 points, Z0 50 Ω');
  });

  it('Z-parameter Touchstone text in a .txt is refused in Open and in the S-Plot view', () => {
    const text = '# MHz Z RI R 50\n100 50 0\n200 50 0\n';
    expect(() => readImportFile('z.txt', text)).toThrow(
      'Z-parameter files are not supported; convert the file to S-parameters first',
    );
    expect(() => readSPlotFiles('z.txt', text)).toThrow(
      'Z-parameter files are not supported; convert the file to S-parameters first',
    );
  });
});

describe('qa2 vna import: description', () => {
  it('one repeated frequency, singular', () => {
    const d = readVnaCsv('Freq(Hz),S11(REAL),S11(IMAG)\n1e9,0.1,0\n1e9,0.2,0\n2e9,0.3,0\n');
    expect(vnaDescription(d)).toBe(
      'VNA table, S11, 2 points, Z0 50 Ω assumed; dropped 1 row repeating a frequency',
    );
  });

  it('all three drop reasons in order', () => {
    const d = readVnaCsv(
      'Freq(Hz),S11(REAL),S11(IMAG)\n0,0.1,0\n1e9,x,0\n1e9,0.1,0\n1e9,0.2,0\n2e9,0.3,0\n',
    );
    expect(vnaDescription(d)).toBe(
      'VNA table, S11, 2 points, Z0 50 Ω assumed; dropped 1 row at zero, negative or non-finite frequency, 1 row with a value that is not a number, 1 row repeating a frequency',
    );
  });
});

describe('qa2 vna import: partial two-ports', () => {
  const S22_ONLY = 'Freq(Hz),S22(REAL),S22(IMAG)\n1e9,0.3,0\n2e9,0.4,0\n';

  it('an S22-only file lacks s11, s21 and s12, named in that order', () => {
    const e = fromText('s22.csv', S22_ONLY);
    expect(missingParameters(e)).toEqual(['s11', 's21', 's12']);
    expect(listNames(missingParameters(e))).toBe('s11, s21 and s12');
    expect(hasPort(e, 1)).toBe(false);
    expect(hasPort(e, 2)).toBe(true);
  });

  it('Use as device and Save Touchstone name the three missing terms', () => {
    const e = fromText('s22.csv', S22_ONLY);
    expect(fillDeviceFromFile(e)).toBe(
      's22.csv has no s11, s21 and s12; a device needs s11, s21, s12 and s22',
    );
    expect(() =>
      exportTouchstoneText(e, { parameter: 'S', normalized: false, format: 'RI', unit: 'HZ' }),
    ).toThrow('the file has no s11, s21 and s12, and a Touchstone file needs every S-parameter');
  });

  it('listNames of none and of one', () => {
    expect(listNames([])).toBe('');
    expect(listNames(['s12'])).toBe('s12');
    expect(listNames(['s12', 's22'])).toBe('s12 and s22');
  });

  it('the gain table names the missing terms of an S11 + S21 file', () => {
    const e = fromText(
      'thru.csv',
      'Freq(Hz),S11(REAL),S11(IMAG),S21(DB),S21(DEG)\n1e9,0.1,0,-1,0\n2e9,0.2,0,-2,0\n',
    );
    const html = renderToStaticMarkup(createElement(GainTable, { entry: e }));
    expect(html).toContain(
      'thru.csv has no s12 and s22: MAG, MSG, K and μ need s11, s21, s12 and s22.',
    );
  });

  // missingParameters treats a NaN imaginary part as missing; hasPort should agree.
  it('a point whose s11 has a NaN imaginary part makes port 1 unusable', () => {
    const data: TouchstoneData = {
      ports: 1,
      parameter: 'S',
      format: 'RI',
      frequencyUnit: 'HZ',
      z0: 50,
      points: [
        { frequency: 1e9, s: [complex(0.1, 0)] },
        { frequency: 2e9, s: [complex(0.1, NaN)] },
      ],
      noise: [],
      comments: [],
    };
    const e = entryOf('nanim.csv', data);
    expect(missingParameters(e)).toEqual(['s11']);
    expect(hasPort(e, 1)).toBe(false);
  });
});

describe('qa2 vna import: Z0 of the file against the design Z0', () => {
  // File Z0 75 stated, S11 = 0 means Z = 75 ohm; against 50 ohm Gamma = 25 / 125 = 0.2.
  // S22 = 0.2 at 75 ohm is Z = 75 * 1.2 / 0.8 = 112.5 ohm; against 50: 62.5 / 162.5 = 5/13.
  it('the reflection terms are re-referenced to the design Z0, the through terms kept', () => {
    const text =
      '! Z0 = 75\n' +
      'Freq(Hz),S11(REAL),S11(IMAG),S21(REAL),S21(IMAG),S12(REAL),S12(IMAG),S22(REAL),S22(IMAG)\n' +
      '1e9,0,0,0.9,0,0.1,0,0.2,0\n2e9,0,0,0.9,0,0.1,0,0.2,0\n';
    const f = readImportFile('z75.csv', text);
    expect(f.kind).toBe('twoPort');
    if (f.kind !== 'twoPort') return;
    expect(f.data.z0).toBe(75);
    const tp = twoPortFromFile(f.data, 1e9, 'z75.csv', 50);
    expect(tp).not.toBeNull();
    expect(tp?.s.s11.re).toBeCloseTo(0.2, 12);
    expect(tp?.s.s11.im).toBeCloseTo(0, 12);
    expect(tp?.s.s22.re).toBeCloseTo(5 / 13, 12);
    expect(tp?.s.s21).toEqual({ re: 0.9, im: 0 });
    expect(tp?.s.s12).toEqual({ re: 0.1, im: 0 });
  });
});

describe('qa2 vna import: store guard on sweep loads', () => {
  it('a sweep load with a NaN reactance is refused with the message', () => {
    const before = useDesignStore.getState().design;
    useDesignStore.getState().setSweep({
      enabled: true,
      loads: [
        { frequency: 1e9, z: complex(50, 0) },
        { frequency: 2e9, z: complex(25, NaN) },
      ],
    });
    expect(useDesignStore.getState().design).toBe(before);
    expect(useDesignStore.getState().message).toBe(
      'Refused: the frequency and Z0 must be positive and the load and sweep loads finite.',
    );
  });
});

describe('qa2 vna import: a transmission column named S(2,1)', () => {
  // A thru (-1 dB) has no S11; the guide sends a file without S11 to the S-Plot list only.
  it('is not offered as a load in the import dialog', () => {
    expect(() =>
      readImportFile('thru.csv', 'Freq (Hz);S(2,1) dB;S(2,1) deg\n1e9;-1;0\n2e9;-2;-10\n'),
    ).toThrow('The file holds S21 but no S11 to use as a load');
  });
});

describe('qa2 vna import: drop reason for a negative frequency', () => {
  // The reader drops "zero, negative or non-finite" frequencies (vna-csv.ts header); -1 GHz is none of zero or non-finite.
  it('names the negative frequency', () => {
    const d = readVnaCsv('Freq(Hz),S11(REAL),S11(IMAG)\n-1e9,0.1,0\n1e9,0.1,0\n2e9,0.2,0\n');
    expect(d.droppedBy.frequency).toBe(1);
    expect(vnaDescription(d)).toContain('negative');
  });
});
