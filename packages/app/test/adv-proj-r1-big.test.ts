// @vitest-environment jsdom
/**
 * Adversarial QA, local projects (docs/11) round 1: big imports and hostile names.
 * Each test asserts the correct behaviour; a failure is a defect.
 */
import { describe, expect, it } from 'vitest';
import { emptyDesign, identify } from '../src/lib/design';
import { ownBuild } from '../src/lib/designBuild';
import {
  MAX_IMPORT_CHARS,
  projectFileOfDesign,
  projectRecordOf,
  readImportText,
} from '../src/lib/projectStore';

const file = projectFileOfDesign(
  ownBuild({
    ...emptyDesign(),
    name: 'N',
    load: { re: 25, im: -10 },
    elements: identify([{ kind: 'L', orientation: 'series', value: 10e-9 }]),
  }),
);

describe('import of a hostile Export all file', () => {
  it('a 100 MB file of small entries does not freeze the page for long', () => {
    const entry = JSON.stringify({ name: 'x', created: 1, modified: 1, file });
    const n = Math.floor((MAX_IMPORT_CHARS * 0.95) / (entry.length + 1));
    const text = `{"app":"Smith Online","kind":"projects","version":1,"projects":[${Array(n).fill(entry).join(',')}]}`;
    const t0 = performance.now();
    const read = readImportText(text, 'all.json');
    const ms = performance.now() - t0;
    expect('entries' in read).toBe(true);
    // 20 MB of the 100 MB allowed; only 500 can be kept, yet every entry's design is decoded.
    expect(ms).toBeLessThan(2000);
  });
});

describe('names', () => {
  it('a stored name keeps no control or direction-override characters', () => {
    const r = projectRecordOf({ id: 'p-x', name: 'Fil\u0085ter ‮gnp.exe', file });
    const bad = new RegExp(
      '[' +
        String.fromCharCode(0x80) +
        '-' +
        String.fromCharCode(0x9f, 0x2028, 0x2029, 0x202a) +
        '-' +
        String.fromCharCode(0x202e) +
        ']',
    );
    expect(bad.test(r?.name ?? '')).toBe(false);
  });
});
