// @vitest-environment jsdom
/**
 * docs/11, local projects, QA round 1 fixes: Export all in parts that each import again, names
 * and sort, the restore of a project another tab wrote last, a refused write-back on the chip,
 * a damaged import told apart from one of a later version.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { ownBuild } from '../src/lib/designBuild';
import {
  cleanProjectName,
  MAX_IMPORT_CHARS,
  MAX_PROJECT_CHARS,
  memoryProjectStore,
  projectDesign,
  projectFileOfDesign,
  projectRecordOf,
  projectsFileParts,
  readImportText,
  type ProjectRecord,
  type ProjectStore,
} from '../src/lib/projectStore';
import { importText } from '../src/lib/projectWords';
import { useDesignStore } from '../src/store/useDesignStore';
import {
  compareNames,
  copyName,
  FROM_THIS_TAB,
  needsName,
  openProjectId,
  useProjects,
} from '../src/store/useProjects';

const D = () => useDesignStore.getState();
const P = () => useProjects.getState();
const design = (name: string, l = 10e-9): Design =>
  ownBuild({
    ...emptyDesign(),
    name,
    load: { re: 25, im: -10 },
    elements: identify([{ kind: 'L', orientation: 'series', value: l }]),
  });
const recordOf = (name: string, over: Partial<ProjectRecord> = {}): ProjectRecord => ({
  id: `p-${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
  name,
  created: 1000,
  modified: 2000,
  file: projectFileOfDesign(design(name)),
  ...over,
});
const store = (initial: unknown[] = []): ProjectStore => ({
  ...memoryProjectStore(initial),
  persistent: true,
});
const lOf = (r: ProjectRecord | undefined): number => {
  const d = r && projectDesign(r);
  const el = d && 'value' in d ? d.value.elements[0] : undefined;
  return el?.kind === 'L' ? el.value : 0;
};

beforeEach(() => {
  localStorage.clear();
  D().init(design('Start'));
});

describe('Export all imports again', () => {
  it('splits into parts under the limit, and every part imports with all its projects', () => {
    // 1 MB parts, designs of 300 k characters full of quotes (escaped twice as long).
    const big = '"'.repeat(300_000);
    const records = Array.from({ length: 7 }, (_, i) =>
      recordOf(`Big ${i}`, { file: { app: 'Smith Online', version: 1, design: big } }),
    );
    const parts = projectsFileParts(records, new Date(0), 1024 * 1024);
    expect(parts.length).toBeGreaterThan(1);
    let n = 0;
    for (const part of parts) {
      const text = JSON.stringify(part, null, 2);
      expect(text.length).toBeLessThanOrEqual(1024 * 1024);
      const read = readImportText(text, 'part.json');
      expect('entries' in read).toBe(true);
      n += 'entries' in read ? read.entries.length : 0;
    }
    expect(n).toBe(7);
  });

  it('the largest project, escaped, still fits one import', () => {
    const worst = JSON.stringify('"'.repeat(MAX_PROJECT_CHARS)).length * 3;
    expect(worst).toBeLessThan(MAX_IMPORT_CHARS);
  });
});

describe('names', () => {
  it('a copy name fits the name limit and the loop ends when names are taken', () => {
    const name = 'N'.repeat(200);
    const taken = [name, copyName(name, [name])];
    const next = copyName(name, taken);
    expect(next.length).toBeLessThanOrEqual(200);
    expect(next.endsWith('(copy 2)')).toBe(true);
    expect(copyName('A (copy 3)', ['A (copy)'])).toBe('A (copy 2)');
    expect(copyName('A', ['A (from this tab)'], FROM_THIS_TAB)).toBe('A (from this tab 2)');
  });

  it('sorts naturally: "copy" before "copy 2", 2 before 10', () => {
    const names = ['X (copy 10)', 'X (copy 2)', 'X (copy)', 'X'];
    expect([...names].sort(compareNames)).toEqual(['X', 'X (copy)', 'X (copy 2)', 'X (copy 10)']);
  });

  it('asks for a name for "Untitled" or an empty name only', () => {
    expect(needsName('Untitled')).toBe(true);
    expect(needsName('  ')).toBe(true);
    expect(needsName('Filter')).toBe(false);
  });

  it('strips C1 controls, separators and direction overrides; clamps far-future times', () => {
    const bidi = String.fromCharCode(0x202e);
    expect(cleanProjectName(`a${String.fromCharCode(0x85)}b${bidi}c`)).toBe('a bc');
    expect(projectRecordOf({ ...recordOf('T'), modified: 1e300 })?.modified).toBe(0);
  });
});

describe('two tabs', () => {
  it('Undo of a delete puts back a record another tab wrote last without writing over it', async () => {
    const a = recordOf('A');
    const s = store([a]);
    await P().init({ store: s });
    await P().openProject(a.id);
    // Another tab writes A; this tab deletes A (its list is older) and takes the delete back.
    await s.putIfUnchanged(
      { ...a, modified: 5000, file: projectFileOfDesign(design('A', 77e-9)) },
      2000,
    );
    const removed = await P().remove(a.id);
    expect(removed?.modified).toBe(5000);
    await P().restore(removed ? [removed] : []);
    // This tab's design (never the other tab's) is then edited: both are kept.
    D().update((d) => ({ ...d, name: 'A here' }));
    await P().flush();
    const all = (await s.loadAll()).records;
    expect(lOf(all.find((r) => r.id === a.id))).toBeCloseTo(77e-9, 15);
    expect(all.some((r) => r.name === 'A here (from this tab)')).toBe(true);
  });

  it('a refused write-back is said once and the design is no longer shown as saved', async () => {
    let refuse = false;
    const a = recordOf('A');
    const s: ProjectStore = {
      ...memoryProjectStore([a], () =>
        refuse ? Object.assign(new Error('quota'), { name: 'QuotaExceededError' }) : null,
      ),
      persistent: true,
    };
    await P().init({ store: s });
    await P().openProject(a.id);
    refuse = true;
    D().setName('A edited');
    await P().flush();
    expect(P().failed).toBe(a.id);
    expect(D().message).toContain('Not saved to project "A": browser storage is full');
    // The browser takes it again: saved, and the mark goes.
    refuse = false;
    D().setName('A edited again');
    await P().flush();
    expect(P().failed).toBeNull();
    expect(openProjectId()).toBe(a.id);
  });
});

describe('import', () => {
  it('tells a damaged design apart from one of a later version', () => {
    const damaged = JSON.stringify({ app: 'Smith Online', version: 1, design: '###' });
    const read = readImportText(damaged, 'broken.json');
    const entry = 'entries' in read ? read.entries[0] : undefined;
    expect(entry?.readable).toBe(false);
    expect(entry?.damaged).toBe(true);
    const words = importText({
      added: 1,
      duplicates: 0,
      unreadable: 0,
      damaged: 1,
      overLimit: 0,
      skipped: 0,
      failed: [],
    });
    expect(words).toContain('damaged');
    expect(words).not.toContain('later');
  });
});
