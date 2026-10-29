// @vitest-environment jsdom
/**
 * Adversarial QA, local projects (docs/11) round 2: targeted attacks. Each test asserts the
 * correct behaviour; a failure is a defect. "Another tab" is the shared store and localStorage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  type ProjectRecord,
  type ProjectStore,
  type ProjectsFile,
} from '../src/lib/projectStore';
import { useDesignStore } from '../src/store/useDesignStore';
import {
  autosaveWithMark,
  MIGRATED_KEY,
  openProjectId,
  readOpenMark,
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
const store = (initial: unknown[] = [], refuse?: () => Error | null): ProjectStore => ({
  ...memoryProjectStore(initial, refuse),
  persistent: true,
});
const lOf = (r: { file: ProjectRecord['file'] } | undefined): number | null => {
  if (!r) return null;
  const d = projectDesign(r);
  const el = 'value' in d ? d.value.elements[0] : undefined;
  return el?.kind === 'L' ? el.value : null;
};
const nameIn = (r: ProjectRecord | undefined): string | null => {
  if (!r) return null;
  const d = projectDesign(r);
  return 'value' in d ? d.value.name : null;
};
const quota = (): Error => Object.assign(new Error('quota'), { name: 'QuotaExceededError' });

beforeEach(() => {
  localStorage.clear();
  exported.length = 0;
  D().init(design('Start'));
});
afterEach(() => localStorage.clear());

describe('round 1 blocker 1, the other writes', () => {
  it('Duplicate in a tab whose list is stale copies the stored record, not its old copy', async () => {
    const a = recordOf('A');
    const s = store([a]);
    await P().init({ store: s });
    await s.putIfUnchanged(
      { ...a, file: projectFileOfDesign(design('A', 77e-9)), modified: 3000 },
      2000,
    );
    const r = await P().duplicate(a.id);
    expect('id' in r).toBe(true);
    const all = (await s.loadAll()).records;
    expect(lOf(all.find((x) => x.id === a.id))).toBeCloseTo(77e-9, 15);
    expect(lOf(all.find((x) => 'id' in r && x.id === r.id))).toBeCloseTo(77e-9, 15);
  });

  it('Undo of a delete in a stale tab does not write over a record another tab put back', async () => {
    const a = recordOf('A');
    const s = store([a]);
    await P().init({ store: s });
    const removed = await P().remove(a.id);
    // Another tab (its Undo of the same delete, or a write) puts newer work under the id.
    await s.putIfUnchanged(
      { ...a, file: projectFileOfDesign(design('A', 55e-9)), modified: 4000 },
      null,
    );
    await P().restore(removed ? [removed] : []);
    const all = (await s.loadAll()).records;
    expect(lOf(all.find((x) => x.id === a.id))).toBeCloseTo(55e-9, 15);
    expect(all.length).toBe(2); // ours kept beside it
  });
});

describe("Export all and the list are this tab's snapshot", () => {
  it('Export all holds every stored project at its stored version', async () => {
    const a = recordOf('A');
    const s = store([a]);
    await P().init({ store: s }); // this tab read the list at its start
    // Another tab, open for an hour: edits A and saves a new project B.
    await s.putIfUnchanged(
      { ...a, file: projectFileOfDesign(design('A', 88e-9)), modified: 9000 },
      2000,
    );
    await s.putIfUnchanged(recordOf('B'), null);
    // This tab: Export all, "the backup" (docs/11 section 7).
    expect(await P().exportAll()).toBeGreaterThan(0);
    const file = exported[0]?.value as ProjectsFile;
    const names = file.projects.map((p) => p.name).sort();
    const aOut = file.projects.find((p) => p.name === 'A');
    expect({ names, aL: aOut ? lOf(aOut) : null }).toEqual({ names: ['A', 'B'], aL: 88e-9 });
  });

  it('Export .json of one project gives its stored version', async () => {
    const a = recordOf('A');
    const s = store([a]);
    await P().init({ store: s });
    await s.putIfUnchanged(
      { ...a, file: projectFileOfDesign(design('A', 88e-9)), modified: 9000 },
      2000,
    );
    await P().exportOne(a.id);
    expect(lOf({ file: exported[0]?.value as ProjectRecord['file'] })).toBeCloseTo(88e-9, 15);
  });
});

describe('Undo of a delete refused by the browser', () => {
  it('the deleted design is not lost, and the user is not told it is back', async () => {
    let refuse: Error | null = null;
    const a = recordOf('A');
    const s = store([a], () => refuse);
    await P().init({ store: s });
    const removed = await P().remove(a.id); // "delete some to make room"
    expect(removed).not.toBeNull();
    refuse = quota(); // the room went to another write (another tab, the part library)
    let threw = false;
    let result: string | null = null;
    try {
      result = await P().restore(removed ? [removed] : []); // Undo
    } catch {
      threw = true;
    }
    const inStore = (await s.loadAll()).records.some((r) => r.id === a.id);
    const backups = Object.keys(localStorage).filter(
      (k) =>
        k.startsWith('smithonline.design.replaced') || k.startsWith('smithonline.design.deleted.'),
    );
    // ProjectsDialog.undo says "Put "A" back in projects" only when restore resolves 'ok'.
    expect({ inStore, keptSomewhere: backups.length > 0 || threw, result }).toEqual({
      inStore: false,
      keptSomewhere: true,
      result: 'refused',
    });
    // The browser takes writes again: the next write puts it back.
    refuse = null;
    await P().saveCurrent();
    await new Promise((r) => setTimeout(r, 0));
    await P().flush();
    expect((await s.loadAll()).records.some((r) => r.id === a.id)).toBe(true);
    expect(Object.keys(localStorage).some((k) => k.startsWith('smithonline.design.deleted.'))).toBe(
      false,
    );
  });
});

describe('the shared autosave (docs/11 section 11, first known limit)', () => {
  it('"the autosave keeps it" after a delete in another tab is not true once that tab edits', async () => {
    const a = recordOf('A');
    const s = store([a]);
    await P().init({ store: s });
    await P().openProject(a.id);
    D().setName('Tab 1 work');
    autosaveWithMark(() => {
      localStorage.setItem(DESIGN_STORAGE_KEY, JSON.stringify(D().design));
      return true;
    });
    await s.remove(a.id); // tab 2 deletes A
    D().setName('Tab 1 more work');
    autosaveWithMark(() => {
      localStorage.setItem(DESIGN_STORAGE_KEY, JSON.stringify(D().design));
      return true;
    });
    await P().flush();
    const said = D().message ?? '';
    // Tab 2 goes on with its own design: its autosave is the one autosave.
    localStorage.setItem(DESIGN_STORAGE_KEY, JSON.stringify(design('Tab 2 design')));
    const claim = /autosave keeps it/.test(said);
    const kept = readSavedDesign()?.name === 'Tab 1 more work';
    expect({ said, claimHolds: !claim || kept }).toEqual({ said, claimHolds: true });
  });
});

describe('one tab, a write-back in flight when the page closes', () => {
  it('the next start does not report a change "in another tab" when there was none', async () => {
    const a = recordOf('A');
    const inner = store([a]);
    let gate: (() => void) | null = null;
    const s: ProjectStore = {
      ...inner,
      putIfUnchanged: async (r, e) => {
        if (gate === null) {
          await new Promise<void>((res) => (gate = res));
        }
        return inner.putIfUnchanged(r, e);
      },
    };
    await P().init({ store: s });
    await P().openProject(a.id);
    const save = (): void => {
      autosaveWithMark(() => {
        localStorage.setItem(DESIGN_STORAGE_KEY, JSON.stringify(D().design));
        return true;
      });
    };
    D().setName('Edit 1');
    save();
    const writing = P().flush(); // the write-back of Edit 1 is in IndexedDB
    await new Promise((r) => setTimeout(r, 5));
    D().setName('Edit 2'); // typed while it was on its way
    save();
    (gate as unknown as () => void)?.();
    await writing; // Edit 1 lands; the page is closed before Edit 2's write-back
    // The next start, one tab only.
    const saved = readSavedDesign();
    vi.resetModules();
    const ds = await import('../src/store/useDesignStore');
    const pj = await import('../src/store/useProjects');
    ds.useDesignStore.getState().init(saved as Design, { project: pj.readOpenMark()?.id ?? null });
    await pj.useProjects.getState().init({ store: inner });
    const msg = ds.useDesignStore.getState().message ?? '';
    const records = (await inner.loadAll()).records;
    expect({ count: records.length, msg }).toEqual({
      count: 1,
      msg: expect.not.stringMatching(/another tab/),
    });
    void readOpenMark;
  });
});

describe('migration, the claim of the other tab', () => {
  it('a tab whose claim was overtaken links its design to the project the other tab made', async () => {
    const saved = design('Autosaved');
    D().init(saved);
    const shown = D().design;
    const inner = store();
    // The other tab claimed first and is writing the project now.
    localStorage.setItem(MIGRATED_KEY, `claim ${Date.now()} p-other`);
    await inner.putIfUnchanged(
      { ...recordOf('Autosaved'), file: projectFileOfDesign(saved), id: 'p-firstproject00' },
      null,
    );
    const s: ProjectStore = { ...inner, loadAll: async () => ({ records: [], skipped: 0 }) };
    // This tab read the list before the other tab's write landed.
    let first = true;
    const s2: ProjectStore = {
      ...inner,
      loadAll: async () => {
        if (first) {
          first = false;
          return s.loadAll();
        }
        return inner.loadAll();
      },
    };
    await P().init({ store: s2, autosaved: saved, autosaveShown: shown });
    expect({ listed: P().records.length, linked: openProjectId() }).toEqual({
      listed: 1,
      linked: 'p-firstproject00',
    });
    void nameIn;
  });
});

describe('the shared autosave after a refused write-back', () => {
  it('"Not saved ... The autosave keeps your design" is not true once another tab edits', async () => {
    let refuse: Error | null = null;
    const a = recordOf('A');
    const s = store([a, recordOf('B')], () => refuse);
    await P().init({ store: s });
    await P().openProject(a.id);
    refuse = quota();
    D().setName('Hours of work on A');
    autosaveWithMark(() => {
      localStorage.setItem(DESIGN_STORAGE_KEY, JSON.stringify(D().design));
      return true;
    });
    await P().flush();
    const said = D().message ?? '';
    // Tab 2, open on project B, edits B: App.tsx autosaves its design.
    localStorage.setItem(DESIGN_STORAGE_KEY, JSON.stringify(design('B edited in tab 2')));
    // Tab 1 is closed: its last write-back (page hidden) is refused again.
    await P().flush();
    const inProject =
      nameIn((await s.loadAll()).records.find((r) => r.id === a.id)) === 'Hours of work on A';
    const inAutosave = readSavedDesign()?.name === 'Hours of work on A';
    const backups = Object.values(localStorage).some((v) =>
      String(v).includes('Hours of work on A'),
    );
    expect({ said, keptSomewhere: inProject || inAutosave || backups }).toEqual({
      said,
      keptSomewhere: true,
    });
  });
});
