// @vitest-environment jsdom
/**
 * Adversarial QA, local projects (docs/11) round 1. Each test asserts the correct behaviour;
 * a failure is a defect. "Another tab" is the shared store and the shared localStorage, as two
 * tabs of one origin see them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  libraryPartOf,
  MAX_PART_POINTS,
  SYNTHETIC_PARTS,
  syntheticPart,
  withoutData,
  type LibraryPart,
} from '@smithonline/core';

const exported: { value: unknown; name: string }[] = [];
vi.mock('../src/lib/export', async (orig) => ({
  ...(await orig<typeof import('../src/lib/export')>()),
  exportJson: (value: unknown, name: string) => {
    exported.push({ value, name });
  },
}));

import { emptyDesign, identify, type Design } from '../src/lib/design';
import { ownBuild } from '../src/lib/designBuild';
import { DESIGN_STORAGE_KEY, readSavedDesign } from '../src/lib/autosave';
import {
  memoryProjectStore,
  projectDesign,
  projectFileOfDesign,
  readImportText,
  type ProjectRecord,
  type ProjectStore,
} from '../src/lib/projectStore';
import { useDesignStore } from '../src/store/useDesignStore';
import {
  autosaveWithMark,
  MIGRATED_KEY,
  OPEN_MARK_KEY,
  openProjectId,
  readOpenMark,
  useProjects,
} from '../src/store/useProjects';

void libraryPartOf;
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

function store(initial: unknown[] = [], refuse?: () => Error | null): ProjectStore {
  return { ...memoryProjectStore(initial, refuse), persistent: true };
}

/** A store whose operations run one after another, each taking `ms` (an IndexedDB disk). */
function slowStore(inner: ProjectStore, ms = 30): ProjectStore {
  let q: Promise<unknown> = Promise.resolve();
  const later = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = q.then(() => new Promise((r) => setTimeout(r, ms))).then(fn);
    q = p.catch(() => undefined);
    return p;
  };
  return {
    ...inner,
    loadAll: () => later(() => inner.loadAll()),
    put: (r) => later(() => inner.put(r)),
    putIfUnchanged: (r, e) => later(() => inner.putIfUnchanged(r, e)),
    remove: (id) => later(() => inner.remove(id)),
  };
}

const nameIn = (r: ProjectRecord | undefined): string | null => {
  if (!r) return null;
  const d = projectDesign(r);
  return 'value' in d ? d.value.name : null;
};

/** The autosave as App.tsx writes it, mark around it. */
const autosave = (d: Design): void => {
  autosaveWithMark(() => {
    localStorage.setItem(DESIGN_STORAGE_KEY, JSON.stringify(d));
    return true;
  });
};

beforeEach(() => {
  localStorage.clear();
  exported.length = 0;
  D().init(design('Start'));
});
afterEach(() => localStorage.clear());

describe('two tabs', () => {
  it('Rename in a tab whose list is stale does not write over the newer design of another tab', async () => {
    const a = recordOf('A');
    const s = store([a]);
    await P().init({ store: s }); // tab 1 reads the list
    // Tab 2 opens A, edits it, its write-back lands; tab 2 is closed.
    const newer = {
      ...recordOf('A'),
      file: projectFileOfDesign(design('A', 99e-9)),
      modified: 3000,
    };
    expect(await s.putIfUnchanged(newer, 2000)).toBe('ok');
    // Tab 1 renames A in its list.
    expect(await P().rename(a.id, 'A final')).toBeNull();
    const stored = (await s.loadAll()).records[0];
    const d = stored && projectDesign(stored);
    const l =
      d && 'value' in d && d.value.elements[0]?.kind === 'L' ? d.value.elements[0].value : 0;
    expect(l).toBeCloseTo(99e-9, 15); // tab 2's edit must survive
  });

  it("a write-back does not re-date the mark over another tab's autosave", async () => {
    const a = recordOf('A');
    const s = store([a]);
    await P().init({ store: s });
    await P().openProject(a.id);
    D().setName('A by tab 1');
    autosave(D().design); // tab 1's autosave, mark {A, 2000}
    // Tab 2 (A open too, from the same list) edits and is closed within 0.5 s: its autosave and
    // mark are the last ones written, its write-back never reached IndexedDB.
    localStorage.setItem(DESIGN_STORAGE_KEY, JSON.stringify(design('A by tab 2')));
    localStorage.setItem(OPEN_MARK_KEY, JSON.stringify({ id: a.id, at: 2000 }));
    await P().flush(); // tab 1's write-back lands
    expect(nameIn((await s.loadAll()).records[0])).toBe('A by tab 1');
    // Tab 1 is closed later without another edit. The next start:
    const saved = readSavedDesign();
    expect(saved?.name).toBe('A by tab 2');
    D().init(saved as Design, { project: readOpenMark()?.id ?? null });
    await P().init({ store: s });
    // Tab 1's design, the newer one in the project, must not be replaced by tab 2's older one.
    expect(nameIn((await s.loadAll()).records[0])).toBe('A by tab 1');
  });

  it('the open project deleted in another tab: the write-back says the design is now unsaved', async () => {
    const a = recordOf('A');
    const s = store([a]);
    await P().init({ store: s });
    await P().openProject(a.id);
    D().setMessage('');
    await s.remove(a.id); // another tab deletes it
    D().setName('Work after the delete');
    await P().flush();
    expect(openProjectId()).toBeNull();
    expect(D().message ?? '(no message)').toMatch(/unsaved|deleted|no longer/i);
  });

  it('two tabs migrating at once make one project, not two', async () => {
    const saved = design('Autosaved');
    D().init(saved);
    const shown = D().design;
    const inner = store();
    // The other tab started at the same moment: it read an empty list too, and its migration
    // lands while this tab is between reading the list and writing.
    const s: ProjectStore = {
      ...inner,
      loadAll: async () => {
        const r = await inner.loadAll();
        await inner.put({ ...recordOf('Autosaved'), id: 'p-othertab0000000' });
        return r;
      },
    };
    await P().init({ store: s, autosaved: saved, autosaveShown: shown });
    expect(localStorage.getItem(MIGRATED_KEY)).toBe('1');
    expect((await inner.loadAll()).records).toHaveLength(1);
  });
});

describe('refused writes', () => {
  it('a write-back refused for space says so, and the design is not shown as in projects', async () => {
    let refuse: Error | null = null;
    const a = recordOf('A');
    const s = store([a], () => refuse);
    await P().init({ store: s });
    await P().openProject(a.id);
    D().setMessage('');
    refuse = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    D().setName('Edit that is not stored');
    await P().flush();
    expect(nameIn((await s.loadAll()).records[0])).toBe('A');
    // The chip shows "In projects ... changes are saved there as you work" while openProjectId
    // is the project; the status line should say the edit did not go in.
    const told = /room|not saved|could not/i.test(D().message ?? '');
    expect(told || openProjectId() === null).toBe(true);
  });

  it('opening another project after a refused write-back keeps the unwritten design as a backup', async () => {
    let refuse: Error | null = null;
    const a = recordOf('A');
    const b = recordOf('B');
    const s = store([a, b], () => refuse);
    await P().init({ store: s });
    await P().openProject(a.id);
    refuse = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    D().setName('Hours of work on A');
    localStorage.setItem(DESIGN_STORAGE_KEY, JSON.stringify(D().design)); // the autosave holds it
    await P().flush();
    await P().openProject(b.id);
    // Project A still holds the old design; the edit lives only in Undo memory unless kept.
    expect(nameIn((await s.loadAll()).records.find((r) => r.id === a.id))).toBe('A');
    expect(localStorage.getItem('smithonline.design.replaced')).not.toBeNull();
  });
});

describe('autosave at the start', () => {
  const synth = (name: string): LibraryPart => {
    const spec = SYNTHETIC_PARTS.find((p) => p.name === name);
    if (!spec) throw new Error(name);
    return syntheticPart(spec);
  };
  it('a lean autosave (part data left out for room) does not strip the part data from its project', async () => {
    const part = synth('SYNTH-C0402-10P');
    expect(part.data).toBeDefined();
    const full = ownBuild({
      ...emptyDesign(),
      name: 'With part',
      load: { re: 25, im: -10 },
      elements: identify([{ kind: 'part', orientation: 'shunt', part }]),
    });
    const p = { ...recordOf('With part'), file: projectFileOfDesign(full) };
    const s = store([p]);
    // App.tsx wrote the lean copy (storage refused the full one), with the mark of the project.
    const lean: Design = {
      ...full,
      elements: full.elements.map((el) =>
        el.kind === 'part' ? { ...el, part: withoutData(el.part) } : el,
      ) as Design['elements'],
    };
    localStorage.setItem(OPEN_MARK_KEY, JSON.stringify({ id: p.id, at: 2000 }));
    D().init(lean, { project: p.id });
    await P().init({ store: s });
    const stored = (await s.loadAll()).records[0];
    const d = stored && projectDesign(stored);
    const el = d && 'value' in d ? d.value.elements[0] : undefined;
    expect(el?.kind === 'part' ? el.part.data !== undefined : false).toBe(true);
    void MAX_PART_POINTS;
  });
});

describe('delete during a write-back', () => {
  it('Undo of a delete made while the write-back was on its way puts the project back', async () => {
    const a = recordOf('A');
    const inner = store([a]);
    const s = slowStore(inner);
    await P().init({ store: s });
    await P().openProject(a.id);
    D().setName('A edited');
    const writing = P().flush(); // the write-back is in IndexedDB
    await new Promise((r) => setTimeout(r, 5));
    const removed = await P().remove(a.id); // Delete in the list
    await writing;
    const ghost = P().records.some((r) => r.id === a.id);
    await P().restore(removed ? [removed] : []); // Undo
    const inStore = (await inner.loadAll()).records.some((r) => r.id === a.id);
    expect({ ghost, inStore }).toEqual({ ghost: false, inStore: true });
  });
});

describe('Export all round trip', () => {
  it('an Export all file of projects within the limits imports again', async () => {
    // Six projects of 18 M characters each (within the 20 MB per project).
    const big = 'A'.repeat(18 * 1024 * 1024);
    const records = Array.from({ length: 6 }, (_, i) =>
      recordOf(`Big${i}`, { file: { app: 'Smith Online', version: 1, design: big } }),
    );
    await P().init({ store: store(records) });
    expect(await P().exportAll()).toBe(6);
    const text = JSON.stringify(exported[0]?.value, null, 2); // as exportJson writes it
    const read = readImportText(text, 'smithonline-projects.json');
    expect('problem' in read ? read.problem : 'ok').toBe('ok');
  });
});
