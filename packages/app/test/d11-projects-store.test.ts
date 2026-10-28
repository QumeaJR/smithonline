// @vitest-environment jsdom
/**
 * docs/11, local projects: the record checks against hostile records, the store round trips,
 * quota and refused storage, the one migration, write-back and the autosave mark, Undo across
 * opening a project, a write another tab overtook, import and export.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { ownBuild } from '../src/lib/designBuild';
import { designFromJsonFile } from '../src/lib/share';
import {
  MAX_PROJECTS,
  memoryProjectStore,
  projectDesign,
  projectFileOfDesign,
  projectRecordOf,
  projectsFileObject,
  readImportText,
  StoreFullError,
  thumbOf,
  type ProjectRecord,
  type ProjectStore,
} from '../src/lib/projectStore';
import { importText } from '../src/lib/projectWords';
import { useDesignStore } from '../src/store/useDesignStore';
import {
  autosaveWithMark,
  copyName,
  MIGRATED_KEY,
  OPEN_MARK_KEY,
  openProjectId,
  readOpenMark,
  useProjects,
} from '../src/store/useProjects';

const D = () => useDesignStore.getState();
const P = () => useProjects.getState();

/** One design per name and value, with its own build, as the app writes it (stable ids). */
const designs = new Map<string, Design>();
const design = (name: string, l = 10e-9): Design => {
  const key = `${name}|${l}`;
  let d = designs.get(key);
  if (!d) {
    d = ownBuild({
      ...emptyDesign(),
      name,
      load: { re: 25, im: -10 },
      elements: identify([{ kind: 'L', orientation: 'series', value: l }]),
    });
    designs.set(key, d);
  }
  return d;
};

const recordOf = (name: string, over: Partial<ProjectRecord> = {}): ProjectRecord => ({
  id: `p-${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
  name,
  created: 1000,
  modified: 2000,
  file: projectFileOfDesign(design(name)),
  ...over,
});

/** A memory store that reports itself persistent (for the migration), optionally refusing. */
function store(initial: unknown[] = [], refuse?: () => Error | null): ProjectStore {
  return { ...memoryProjectStore(initial, refuse), persistent: true };
}

beforeEach(() => {
  localStorage.clear();
  D().init(design('Start'));
});
afterEach(() => {
  localStorage.clear();
});

describe('records', () => {
  it('skips what is not a project and cleans what it keeps', () => {
    const good = recordOf('Good');
    for (const bad of [
      null,
      42,
      'x',
      [],
      { ...good, id: 7 },
      { ...good, id: '' },
      { ...good, id: '<script>' },
      { ...good, id: 'a'.repeat(65) },
      { ...good, file: 'x' },
      { ...good, file: { app: 'Other', version: 1, design: 'x' } },
      { ...good, file: { app: 'Smith Online', version: 1, design: 5 } },
    ]) {
      expect(projectRecordOf(bad)).toBeNull();
    }
    const cleaned = projectRecordOf({
      ...good,
      name: 'A\u0000<b>bold</b>\nname',
      created: Number.NaN,
      modified: -5,
      thumb: 'M0 0L1 1"/><script>alert(1)</script>',
      appVersion: 'evil',
    });
    expect(cleaned?.name).toBe('A <b>bold</b> name');
    expect(cleaned?.created).toBe(0);
    expect(cleaned?.modified).toBe(0);
    expect(cleaned?.thumb).toBeUndefined();
    expect(cleaned?.appVersion).toBeUndefined();
    expect(projectRecordOf({ ...good, name: '   ' })?.name).toBe('Untitled');
    expect(
      projectRecordOf({ ...good, thumb: `M0 0${'L1 1'.repeat(2000)}` })?.thumb,
    ).toBeUndefined();
  });

  it('keeps a record whose design this version cannot read, and says why it cannot open it', async () => {
    const odd = { ...recordOf('Later'), file: { app: 'Smith Online', version: 9, design: '!!' } };
    const s = store([odd, recordOf('Fine'), { id: 'junk' }]);
    const { records, skipped } = await s.loadAll();
    expect(records.map((r) => r.name).sort()).toEqual(['Fine', 'Later']);
    expect(skipped).toBe(1);
    const later = records.find((r) => r.name === 'Later');
    expect(later && 'problem' in projectDesign(later)).toBe(true);
  });

  it('round trips a design through a record', () => {
    const d = design('Round', 12.5e-9);
    const r = recordOf('Round', { file: projectFileOfDesign(d) });
    const read = projectDesign(r);
    expect('value' in read && read.value.name).toBe('Round');
    expect('value' in read && read.value.elements[0]).toMatchObject({ kind: 'L', value: 12.5e-9 });
  });

  it('draws a thumbnail of the network from the load, of letters and numbers only', () => {
    const t = thumbOf(design('T'));
    expect(t).toMatch(/^M[-0-9. ML]+$/);
    expect(thumbOf({ ...design('Z'), z0: Number.NaN })).toBeUndefined();
  });

  it('names copies without clashing', () => {
    expect(copyName('A', ['A'])).toBe('A (copy)');
    expect(copyName('A', ['A', 'A (copy)'])).toBe('A (copy 2)');
    expect(copyName('A (copy)', ['A', 'A (copy)'])).toBe('A (copy 2)');
  });
});

describe('import and export files', () => {
  it('reads design files and Export all files, and refuses what is not a Smith Online file', () => {
    const one = readImportText(JSON.stringify(projectFileOfDesign(design('One'))), 'one.json');
    expect('entries' in one && one.entries[0]?.name).toBe('One');
    const all = projectsFileObject([recordOf('A'), recordOf('B')]);
    const both = readImportText(
      JSON.stringify({ ...all, projects: [...all.projects, { file: 3 }] }),
      'all.json',
    );
    expect('entries' in both && both.entries.map((e) => e.name)).toEqual(['A', 'B']);
    expect('entries' in both && both.skipped).toBe(1);
    expect('entries' in both && both.entries[0]?.modified).toBe(2000);
    expect(readImportText('', 'x.json')).toEqual({ problem: 'the file is empty' });
    expect(readImportText('{', 'x.json')).toMatchObject({
      problem: expect.stringContaining('JSON'),
    });
    expect(readImportText('{"a":1}', 'x.json')).toEqual({
      problem: 'not a Smith Online design file',
    });
    const later = readImportText(
      JSON.stringify({ app: 'Smith Online', version: 5, design: 'zz' }),
      'From later.json',
    );
    expect('entries' in later && later.entries[0]).toMatchObject({
      name: 'From later',
      readable: false,
    });
  });

  it('File, Open says to import an Export all file in Projects', () => {
    const text = JSON.stringify(projectsFileObject([recordOf('A')]));
    expect(designFromJsonFile(text)).toMatchObject({
      problem: expect.stringContaining('File, Projects'),
    });
  });
});

describe('the list', () => {
  it('saves the design on show, writes changes back and keeps the mark beside the autosave', async () => {
    const s = store();
    await P().init({ store: s });
    expect(openProjectId()).toBeNull();
    expect(await P().saveCurrent()).toBeNull();
    const id = openProjectId();
    expect(id).toMatch(/^p-[0-9a-f]{16}$/);
    expect(readOpenMark()?.id).toBe(id);
    D().setName('Renamed');
    await P().flush();
    const { records } = await s.loadAll();
    expect(records[0]?.name).toBe('Renamed');
    expect(P().records[0]?.name).toBe('Renamed');
    // The mark goes while the autosave is written and comes back only when it was.
    expect(autosaveWithMark(() => false)).toBe(false);
    expect(localStorage.getItem(OPEN_MARK_KEY)).toBeNull();
    expect(autosaveWithMark(() => true)).toBe(true);
    expect(readOpenMark()?.id).toBe(id);
    expect(await P().saveCurrent()).toContain('in projects already');
  });

  it('opens a project as one Undo step; Undo and Redo bring each design back with its project', async () => {
    const a = recordOf('A');
    const b = recordOf('B');
    await P().init({ store: store([a, b]) });
    await P().openProject(a.id);
    expect(openProjectId()).toBe(a.id);
    D().setName('A edited');
    await P().openProject(b.id);
    expect(D().design.name).toBe('B');
    expect(openProjectId()).toBe(b.id);
    D().undo();
    expect(D().design.name).toBe('A edited');
    expect(openProjectId()).toBe(a.id);
    D().redo();
    expect(openProjectId()).toBe(b.id);
    // A file or New opens unsaved; Undo goes back to the project.
    D().newDesign();
    expect(openProjectId()).toBeNull();
    D().undo();
    expect(openProjectId()).toBe(b.id);
    // B was never changed by stepping back and forth.
    await P().flush();
    expect(P().records.find((r) => r.id === b.id)?.modified).toBe(2000);
    expect(P().records.find((r) => r.id === a.id)?.name).toBe('A edited');
  });

  it('Save to projects links the steps of Undo since the design was opened', async () => {
    await P().init({ store: store() });
    D().newDesign();
    D().setName('Step 1');
    D().setName('Step 2');
    await P().saveCurrent();
    const id = openProjectId();
    D().undo();
    expect(openProjectId()).toBe(id);
    D().undo();
    expect(openProjectId()).toBe(id);
    // The design before New is another line: not linked.
    D().undo();
    expect(openProjectId()).toBeNull();
  });

  it('keeps an unsaved design as a backup before a project replaces it', async () => {
    const a = recordOf('A');
    await P().init({ store: store([a]) });
    localStorage.setItem('smithonline.design.v1', JSON.stringify(D().design));
    await P().openProject(a.id);
    expect(localStorage.getItem('smithonline.design.replaced')).not.toBeNull();
    expect(D().message).toContain('Your unsaved design "Start" is kept in this browser');
  });

  it('renames, duplicates, deletes with Undo, and refuses an empty name', async () => {
    const a = recordOf('A');
    const b = recordOf('B');
    await P().init({ store: store([a, b]) });
    await P().openProject(a.id);
    expect(await P().rename(b.id, '  ')).toBe('a project needs a name');
    expect(await P().rename(b.id, 'Bee')).toBeNull();
    const bee = P().records.find((r) => r.id === b.id);
    expect(bee?.name).toBe('Bee');
    expect(bee && 'value' in projectDesign(bee) && projectDesign(bee)).toMatchObject({
      value: { name: 'Bee' },
    });
    // The open project's rename is the design's: one Undo step.
    expect(await P().rename(a.id, 'Ay')).toBeNull();
    expect(D().design.name).toBe('Ay');
    D().undo();
    await P().flush();
    expect(P().records.find((r) => r.id === a.id)?.name).toBe('A');
    const dup = await P().duplicate(b.id);
    expect('id' in dup && P().records.find((r) => r.id === dup.id)?.name).toBe('Bee (copy)');
    // Deleting the open project leaves the design on show, unsaved; Undo links it again.
    const removed = await P().remove(a.id);
    expect(openProjectId()).toBeNull();
    expect(D().design.name).toBe('A');
    await P().restore(removed ? [removed] : []);
    expect(openProjectId()).toBe(a.id);
  });

  it('a full browser or one that refuses keeps the design on show and says so', async () => {
    let refuse: Error | null = null;
    const s = store([], () => refuse);
    await P().init({ store: s });
    refuse = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    const why = await P().saveCurrent();
    expect(why).toContain('no room');
    expect(P().problem).toBe('full');
    expect(openProjectId()).toBeNull();
    expect(D().design.name).toBe('Start');
    refuse = new Error('denied');
    expect(await P().saveCurrent()).toContain('does not let the app store');
    expect(P().problem).toBe('refused');
    expect(P().persistent).toBe(false);
    refuse = null;
    expect(await P().saveCurrent()).toBeNull();
    // A write-back the browser refuses for space: the design stays, the list says full.
    refuse = new StoreFullError('full');
    D().setName('Bigger');
    await P().flush();
    expect(P().problem).toBe('full');
    expect(D().design.name).toBe('Bigger');
  });

  it('a project another tab changed is not written over: both are kept', async () => {
    const a = recordOf('A');
    const s = store([a]);
    await P().init({ store: s });
    await P().openProject(a.id);
    // Another tab writes the project.
    await s.put({ ...a, modified: 9000, name: 'Other tab' });
    D().setName('This tab');
    await P().flush();
    expect(D().message).toContain('was changed in another tab');
    const { records } = await s.loadAll();
    expect(records.find((r) => r.id === a.id)?.modified).toBe(9000);
    // This tab's design is a new project of its own, linked.
    const mine = records.find((r) => r.id !== a.id);
    expect(mine?.name).toBe('This tab (from this tab)');
    expect(openProjectId()).toBe(mine?.id);
    expect(D().design.name).toBe('This tab (from this tab)');
    // Opening the other one links it.
    await P().openProject(a.id);
    expect(openProjectId()).toBe(a.id);
  });

  it('at the start the autosave is written to its project unless another tab changed it since', async () => {
    const a = recordOf('A');
    const s = store([a]);
    localStorage.setItem(OPEN_MARK_KEY, JSON.stringify({ id: a.id, at: 2000 }));
    D().init(design('A newer'), { project: a.id });
    await P().init({ store: s });
    expect(openProjectId()).toBe(a.id);
    expect((await s.loadAll()).records[0]?.name).toBe('A newer');
    // Changed by another tab since this tab's mark: not overwritten, the autosave kept beside it.
    const b = recordOf('B', { modified: 5000 });
    const s2 = store([b]);
    localStorage.setItem(OPEN_MARK_KEY, JSON.stringify({ id: b.id, at: 2000 }));
    D().init(design('B mine'), { project: b.id });
    await P().init({ store: s2 });
    const all = (await s2.loadAll()).records;
    expect(all.find((r) => r.id === b.id)?.name).toBe('B');
    expect(all.find((r) => r.id !== b.id)?.name).toBe('B mine (from this tab)');
    expect(openProjectId()).not.toBe(b.id);
  });

  it('migrates the autosave once into the first project and links it', async () => {
    const saved = design('Autosaved');
    D().init(saved);
    const shown = D().design;
    const s = store();
    await P().init({ store: s, autosaved: saved, autosaveShown: shown });
    expect(P().records.map((r) => r.name)).toEqual(['Autosaved']);
    expect(openProjectId()).toBe(P().records[0]?.id);
    expect(localStorage.getItem(MIGRATED_KEY)).toBe('1');
    await P().init({ store: s, autosaved: saved, autosaveShown: shown });
    expect(P().records).toHaveLength(1);
    // Without storage nothing is migrated and nothing is set.
    localStorage.clear();
    await P().init({ store: memoryProjectStore(), autosaved: saved, autosaveShown: shown });
    expect(P().records).toHaveLength(0);
    expect(localStorage.getItem(MIGRATED_KEY)).toBeNull();
  });

  it('a link opened over the autosave: the project is made, the link stays unsaved', async () => {
    const saved = design('Mine');
    D().init(saved);
    const shown = D().design;
    D().loadDesign(design('From link'), 'Opened "From link" from the link');
    await P().init({ store: store(), autosaved: saved, autosaveShown: shown });
    expect(P().records.map((r) => r.name)).toEqual(['Mine']);
    expect(openProjectId()).toBeNull();
    D().undo();
    expect(openProjectId()).toBe(P().records[0]?.id);
  });

  it('imports, skips what is in the list already, and stops at the count limit', async () => {
    const many = Array.from({ length: MAX_PROJECTS - 1 }, (_, i) =>
      recordOf(`N${i}`, { id: `p-n${i}` }),
    );
    await P().init({ store: store(many) });
    const all = JSON.stringify(
      projectsFileObject([recordOf('N1', { id: 'p-n1' }), recordOf('X'), recordOf('Y')]),
    );
    const report = await P().importFiles([
      { name: 'all.json', text: all },
      { name: 'bad.json', text: 'nope' },
    ]);
    expect(report).toMatchObject({ added: 1, duplicates: 1, overLimit: 1 });
    expect(report.failed[0]?.fileName).toBe('bad.json');
    expect(importText(report)).toContain('Added 1 project');
    expect(await P().saveCurrent()).toContain(`${MAX_PROJECTS} projects at most`);
    expect(await P().duplicate('p-n1')).toMatchObject({
      problem: expect.stringContaining('at most'),
    });
  });
  it('never writes the autosave over a project this version cannot read', async () => {
    const later = recordOf('Later', {
      file: { app: 'Smith Online', version: 7, design: 'written-by-a-later-version' },
    });
    const s = store([later]);
    localStorage.setItem(OPEN_MARK_KEY, JSON.stringify({ id: later.id, at: 2000 }));
    D().init(design('Mine'), { project: later.id });
    await P().init({ store: s });
    expect(openProjectId()).toBeNull();
    expect((await s.loadAll()).records[0]?.file.design).toBe('written-by-a-later-version');
    expect(await P().openProject(later.id)).toContain('this version cannot open it');
    expect(await P().rename(later.id, 'X')).toContain('cannot rename');
  });
});
