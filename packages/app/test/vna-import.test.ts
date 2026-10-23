import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readImportFile, readTableFile } from '../src/lib/import';
import { readSPlotFiles } from '../src/lib/splot';
import { hasPort, isCompleteTwoPort } from '../src/lib/splotActions';
import type { SPlotEntry } from '../src/store/useSPlotStore';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, '..', '..', 'core', 'test', 'fixtures', 'vna', name), 'utf8');

const entryOf = (fileName: string): SPlotEntry => {
  const [p] = readSPlotFiles(fileName, fixture(fileName));
  return {
    ...p!,
    id: `${fileName}#1`,
    original: p!.data,
    visible: true,
    color: '#000',
    unit: p!.data.frequencyUnit,
  };
};

describe('VNA CSV in the import dialog', () => {
  it('an S11 file is a row table for the datapoint sweep and stays out of the S-Plot list', () => {
    const f = readImportFile('return-loss.csv', fixture('decimal-comma-synthetic.csv'));
    expect(f.kind).toBe('rows');
    expect(f.sPlot).toBe(false);
    expect(f.rows.map((r) => r.frequency)).toEqual([2.4e9, 2.45e9, 2.5e9]);
    expect(f.description).toBe('VNA table, S11, 3 points, Z0 50 Ω assumed');
  });

  it('a file with S21 as well goes to the S-Plot list too', () => {
    const f = readImportFile('amp.csv', fixture('generic-mhz-synthetic.csv'));
    expect(f.kind).toBe('rows');
    expect(f.sPlot).toBe(true);
    expect(f.description).toBe('VNA table, S11, S21, 3 points, Z0 75 Ω, 1 row dropped');
  });

  it('a file with all four S-parameters fills the two-port panel', () => {
    const f = readImportFile('ena.csv', fixture('keysight-ena-synthetic.csv'));
    expect(f.kind).toBe('twoPort');
    expect(f.sPlot).toBe(true);
    expect(f.rows).toHaveLength(3);
  });

  it('a .txt with R and X columns is read as a VNA table', () => {
    const f = readImportFile('antenna.txt', fixture('impedance-rx-synthetic.txt'));
    expect(f.rows[1]?.z).toEqual({ re: 50, im: 0 });
    expect(f.description).toMatch(/^VNA table, R and X, 3 points/);
  });

  it('a .txt the VNA reader does not take falls back to EZNEC', () => {
    const lastz = readFileSync(
      join(__dirname, '..', '..', 'core', 'test', 'fixtures', 'sparams', 'Lastz.txt'),
      'utf8',
    );
    expect(readTableFile('Lastz.txt', lastz).kind).toBe('eznec');
    expect(readImportFile('Lastz.txt', lastz).rows).toHaveLength(8);
  });

  it('names both formats when neither reads a .txt; a .csv names the VNA reason only', () => {
    expect(() => readImportFile('notes.txt', 'hello\nworld\n')).toThrow(
      /^Neither a VNA table \(.+\) nor an EZNEC Lastz\.txt \(.+\)$/,
    );
    expect(() => readImportFile('bad.csv', fixture('malformed-synthetic.csv'))).toThrow(
      /^No frequency column/,
    );
  });

  it('a file without S11 is refused for the chart with a pointer to the S-Plot view', () => {
    expect(() =>
      readImportFile('thru.csv', 'Freq(Hz),S21(DB),S21(DEG)\n1e9,-1,0\n2e9,-2,-10\n'),
    ).toThrow(/holds S21 but no S11.*S-Plot view/);
  });
});

describe('VNA CSV in the S-Plot view', () => {
  it('reads each layout', () => {
    for (const name of [
      'keysight-ena-synthetic.csv',
      'generic-mhz-synthetic.csv',
      'decimal-comma-synthetic.csv',
      'impedance-rx-synthetic.txt',
      'nanovna-saver-synthetic.csv',
      'librevna-synthetic.csv',
    ]) {
      const [p] = readSPlotFiles(name, fixture(name));
      expect(p?.kind).toBe('vna');
      expect(p?.data.points.length).toBe(3);
    }
  });

  it('a two-port that lacks s12 and s22 can send s11 but not s22, and is no device', () => {
    const e = entryOf('librevna-synthetic.csv');
    expect(e.data.ports).toBe(2);
    expect(hasPort(e, 1)).toBe(true);
    expect(hasPort(e, 2)).toBe(false);
    expect(isCompleteTwoPort(e)).toBe(false);
    expect(isCompleteTwoPort(entryOf('keysight-ena-synthetic.csv'))).toBe(true);
  });
});
