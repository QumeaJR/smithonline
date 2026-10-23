/**
 * QA round for the VNA CSV import in the app (commit 137ed2b): file kinds,
 * the .txt fallback, the S-Plot routing rules of docs/06-user-guide.md
 * section 9, and the S-Plot helpers and loci with missing (NaN) parameters.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { complex, type TouchstoneData } from '@smithonline/core';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { importKind, readImportFile, readTableFile, vnaDescription } from '../src/lib/import';
import { analysisOf, isSPlotFile, readSPlotFiles } from '../src/lib/splot';
import {
  fillDeviceFromFile,
  hasPort,
  isCompleteTwoPort,
  sendLoadToChart,
  sendSweepToChart,
} from '../src/lib/splotActions';
import type { SPlotEntry } from '../src/store/useSPlotStore';
import { PolarLocus, SmithLocus } from '../src/splot/Locus';
import { readVnaCsv } from '@smithonline/core';

const LASTZ = readFileSync(
  join(__dirname, '..', '..', 'core', 'test', 'fixtures', 'sparams', 'Lastz.txt'),
  'utf8',
);
const THRU = 'Freq(Hz),S21(DB),S21(DEG)\n1e9,-1,0\n2e9,-2,-10\n';

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

const ALL_ON = { s11: true, s12: true, s21: true, s22: true } as const;

describe('qa vna import: file kinds', () => {
  it('csv and txt in any case; others null', () => {
    expect(importKind('a.Csv')).toBe('csv');
    expect(importKind('a.TxT')).toBe('text');
    expect(importKind('a.csv.bak')).toBeNull();
    expect(isSPlotFile('trace.CSV')).toBe(true);
    expect(isSPlotFile('Lastz.txt')).toBe(true);
    expect(isSPlotFile('a.xmlsc')).toBe(false);
  });
});

describe('qa vna import: readTableFile', () => {
  it('a .csv holding an EZNEC table is not handed to the EZNEC reader', () => {
    expect(() => readTableFile('lastz.csv', LASTZ)).toThrow(/EZNEC Lastz\.txt table/);
  });

  it('a .TXT holding a VNA table is read as VNA', () => {
    expect(readTableFile('S.TXT', 'Freq,S11 re,S11 im\n1,0,0\n2,0,0\n').kind).toBe('vna');
  });

  it('a .txt VNA file without S11 gives the S11 message, not the combined one', () => {
    expect(() => readImportFile('thru.txt', THRU)).toThrow(/^The file holds S21 but no S11/);
  });
});

describe('qa vna import: description', () => {
  it('stated Z0, plural dropped rows', () => {
    const d = readVnaCsv('! Z0 = 75\nFreq,S11 re,S11 im\n0,0,0\n-1,0,0\n1,0,0\n2,0,0\n');
    expect(vnaDescription(d)).toBe(
      'VNA table, S11, 2 points, Z0 75 Ω; dropped 2 rows at zero or non-finite frequency',
    );
  });

  it('the NanoVNA and Keysight labels', () => {
    expect(vnaDescription(readVnaCsv('1 0 0\n2 0 0\n'))).toBe(
      'NanoVNA/LibreVNA CSV, S11, 2 points, Z0 50 Ω assumed',
    );
    expect(
      vnaDescription(
        readVnaCsv('BEGIN CH1_DATA\nFreq(Hz),S11(REAL),S11(IMAG)\n1,0,0\n2,0,0\nEND\n'),
      ),
    ).toBe('Keysight/Agilent VNA CSV, S11, 2 points, Z0 50 Ω assumed');
  });

  it('a table with S11, S21 and R and X names S21 as well', () => {
    const d = readVnaCsv('Freq,S11 re,S11 im,S21 re,S21 im,R,X\n1,0,0,1,0,50,0\n2,0,0,1,0,50,0\n');
    expect(vnaDescription(d)).toMatch(/S21/);
  });
});

describe('qa vna import: routing', () => {
  it('an R and X file is S11 only: row table, not for the S-Plot list', () => {
    const f = readImportFile('ant.txt', 'Freq (MHz)\tR\tX\n144\t40\t-20\n145\t50\t0\n');
    expect(f.kind).toBe('rows');
    expect(f.sPlot).toBe(false);
    expect(f.rows[0]?.frequency).toBe(144e6);
    expect(f.rows[0]?.z).toEqual(complex(40, -20));
  });

  it('EZNEC from the chart view still goes to the S-Plot list', () => {
    expect(readImportFile('Lastz.txt', LASTZ).sPlot).toBe(true);
    expect(readSPlotFiles('Lastz.txt', LASTZ)[0]?.kind).toBe('eznec');
  });

  it('the S-Plot view takes an S11-only file as a one-port and refuses garbage', () => {
    const [p] = readSPlotFiles('rl.csv', 'Freq,S11 re,S11 im\n1,0.1,0\n2,0.2,0\n');
    expect(p?.kind).toBe('vna');
    expect(p?.data.ports).toBe(1);
    expect(() => readSPlotFiles('x.csv', 'hello,world\n')).toThrow(/No frequency column/);
  });
});

describe('qa vna import: S-Plot actions with missing parameters', () => {
  const thru = fromText('thru.csv', THRU);

  it('an S21-only file has neither port and is no device', () => {
    expect(thru.data.ports).toBe(2);
    expect(hasPort(thru, 1)).toBe(false);
    expect(hasPort(thru, 2)).toBe(false);
    expect(isCompleteTwoPort(thru)).toBe(false);
  });

  it('send and use refuse with a message naming the missing term', () => {
    expect(sendLoadToChart(thru, 1, 1e9)).toBe('thru.csv has no s11');
    expect(sendSweepToChart(thru, 2)).toBe('thru.csv has no s22');
    expect(fillDeviceFromFile(thru)).toBe(
      'thru.csv has no s11, s12 and s22; a device needs s11, s21, s12 and s22',
    );
  });

  it('a one-port or an empty file has no port 2 and is no device', () => {
    const one = fromText('rl.csv', 'Freq,S11 re,S11 im\n1,0.1,0\n2,0.2,0\n');
    expect(hasPort(one, 1)).toBe(true);
    expect(hasPort(one, 2)).toBe(false);
    expect(isCompleteTwoPort(one)).toBe(false);
    expect(fillDeviceFromFile(one)).toBe('rl.csv is a 1-port; a device needs two ports');
    const empty = entryOf('e.csv', { ...one.data, ports: 2, points: [] });
    expect(hasPort(empty, 1)).toBe(false);
    expect(isCompleteTwoPort(empty)).toBe(false);
  });

  it('a point with one NaN s11 makes port 1 unusable', () => {
    const nan = complex(NaN, NaN);
    const data: TouchstoneData = {
      ports: 1,
      parameter: 'S',
      format: 'RI',
      frequencyUnit: 'HZ',
      z0: 50,
      points: [
        { frequency: 1, s: [complex(0.1, 0)] },
        { frequency: 2, s: [nan] },
      ],
      noise: [],
      comments: [],
    };
    expect(hasPort(entryOf('n.csv', data), 1)).toBe(false);
  });
});

describe('qa vna import: loci with NaN', () => {
  const nan = complex(NaN, NaN);
  // s11: 0.5, gap, 0.5j; s21, s12, s22 missing everywhere.
  const data: TouchstoneData = {
    ports: 2,
    parameter: 'S',
    format: 'RI',
    frequencyUnit: 'HZ',
    z0: 50,
    points: [
      { frequency: 1e9, s: [complex(0.5, 0), nan, nan, nan] },
      { frequency: 2e9, s: [nan, nan, nan, nan] },
      { frequency: 3e9, s: [complex(0, 0.5), nan, nan, nan] },
    ],
    noise: [],
    comments: [],
  };
  const entry = entryOf('gap.csv', data);
  const files = [{ entry, analysis: analysisOf(data) }];

  it('the Smith locus breaks the s11 path at the gap and writes no NaN', () => {
    const svg = renderToStaticMarkup(
      createElement(SmithLocus, { files, traces: ALL_ON, selected: 2e9, cursor: 2e9 }),
    );
    expect(svg).not.toMatch(/NaN/);
    // y is -im: (0.5, 0) then a move to (0, -0.5).
    expect(svg).toContain('d="M0.5000 0.0000M0.0000 -0.5000"');
    // s22 is all NaN: one path only.
    expect(svg.match(/<path /g)?.length).toBe(1);
  });

  it('the polar locus draws nothing for all-NaN s21 and s12', () => {
    const svg = renderToStaticMarkup(
      createElement(PolarLocus, { files, traces: ALL_ON, selected: null, cursor: null }),
    );
    expect(svg).not.toMatch(/NaN/);
    expect(svg).not.toMatch(/<path [^>]*d="M/);
  });
});
