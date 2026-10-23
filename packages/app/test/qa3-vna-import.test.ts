/**
 * QA round 3 for the VNA CSV import in the app (commit 778ad24): skip notes
 * passed to the import dialog and the S-Plot description, and the .txt and
 * empty-file refusals. Expected strings follow the code comments and
 * docs/06-user-guide.md section 9.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ImportDialog } from '../src/components/ImportDialog';
import { readImportFile, readTableFile } from '../src/lib/import';
import { readSPlotFiles } from '../src/lib/splot';

const Y_NOTE = 'Y11 skipped: only S-parameters are read';

describe('qa3 vna-import: skip notes', () => {
  it('an S11-only file passes its notes on with the rows', () => {
    const f = readImportFile(
      'a.csv',
      'Freq(Hz),S11(REAL),S11(IMAG),Y11(REAL),Y11(IMAG)\n1e9,0.1,0,1,0\n2e9,0.2,0,1,0\n',
    );
    expect(f.kind).toBe('rows');
    expect(f.notes).toEqual([Y_NOTE]);
  });

  it('a full two-port passes its notes on', () => {
    const f = readImportFile(
      'a.csv',
      'Freq(Hz),S11(REAL),S11(IMAG),S21(REAL),S21(IMAG),S12(REAL),S12(IMAG),S22(REAL),S22(IMAG),Y11(REAL),Y11(IMAG)\n' +
        '1e9,0.1,0,0.9,0,0.01,0,0.2,0,1,0\n2e9,0.1,0,0.9,0,0.01,0,0.2,0,1,0\n',
    );
    expect(f.kind).toBe('twoPort');
    expect(f.notes).toEqual([Y_NOTE]);
  });

  it('the S-Plot description ends with the notes as sentences', () => {
    const [p] = readSPlotFiles(
      'a.csv',
      'Freq(Hz),S11(REAL),S11(IMAG),S21(REAL),S21(IMAG),Y11(REAL),Y11(IMAG)\n1e9,0.1,0,0.9,0,1,0\n2e9,0.1,0,0.9,0,1,0\n',
    );
    expect(p?.description).toBe(`VNA table, S11, S21, 2 points, Z0 50 Ω assumed. ${Y_NOTE}`);
  });

  it('the import dialog lists each note once, with one full stop', () => {
    const f = readImportFile(
      'a.csv',
      'Freq(Hz),S11(REAL),S11(IMAG),Y11(REAL),Y11(IMAG)\n1e9,0.1,0,1,0\n2e9,0.2,0,1,0\n',
    );
    const html = renderToStaticMarkup(
      createElement(ImportDialog, { file: f, top: 0, onClose: () => undefined }),
    );
    expect(html).toContain(`<span>${Y_NOTE}.</span>`);
    expect(html).not.toContain(`${Y_NOTE}..`);
  });

  it('a file without notes renders no notes element', () => {
    const f = readImportFile('a.csv', 'Freq(Hz),S11(REAL),S11(IMAG)\n1e9,0.1,0\n2e9,0.2,0\n');
    const html = renderToStaticMarkup(
      createElement(ImportDialog, { file: f, top: 0, onClose: () => undefined }),
    );
    expect(html).not.toContain('import-notes');
  });
});

describe('qa3 vna-import: refusals', () => {
  it('whitespace only is "The file is empty" for .csv and .txt', () => {
    expect(() => readTableFile('a.csv', ' \r\n\t\n')).toThrow(/^The file is empty$/);
    expect(() => readTableFile('a.txt', '﻿\n')).toThrow(/^The file is empty$/);
  });

  it('a .txt that is neither table names both readers in one statement', () => {
    expect(() => readTableFile('a.txt', 'hello world\nfoo bar\n')).toThrow(
      /^Neither a VNA table nor an EZNEC Lastz\.txt\. As a VNA table: .+\. As an EZNEC table: .+\.$/,
    );
  });

  it('bad Touchstone text under .csv says it was read as Touchstone', () => {
    expect(() => readTableFile('a.csv', '# MHz S MA R 50\n1 0.5\n')).toThrow(
      /^Read as Touchstone text \(it has an option line\): /,
    );
  });
});
