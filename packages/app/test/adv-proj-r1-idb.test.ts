// @vitest-environment jsdom
/**
 * Adversarial QA, local projects (docs/11) round 1: the IndexedDB store against a minimal fake
 * IndexedDB (another tab upgrading the database, quota on commit), hostile times, the start.
 * Each test asserts the correct behaviour; a failure is a defect.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { ownBuild } from '../src/lib/designBuild';
import {
  indexedDbProjectStore,
  memoryProjectStore,
  projectFileOfDesign,
  projectRecordOf,
  readImportText,
  type ProjectRecord,
  type ProjectStore,
} from '../src/lib/projectStore';
import { useDesignStore } from '../src/store/useDesignStore';
import { openProjectId, useProjects } from '../src/store/useProjects';

const D = () => useDesignStore.getState();
const P = () => useProjects.getState();
const design = (name: string): Design =>
  ownBuild({
    ...emptyDesign(),
    name,
    load: { re: 25, im: -10 },
    elements: identify([{ kind: 'L', orientation: 'series', value: 10e-9 }]),
  });
const recordOf = (name: string, over: Partial<ProjectRecord> = {}): ProjectRecord => ({
  id: `p-${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
  name,
  created: 1000,
  modified: 2000,
  file: projectFileOfDesign(design(name)),
  ...over,
});

/** A fake IndexedDB: one database, one object store, async requests, versionchange. */
function fakeIdb() {
  const data = new Map<string, unknown>();
  const dbs: { closed: boolean; onversionchange: (() => void) | null }[] = [];
  const later = (fn: () => void) => setTimeout(fn, 0);
  const factory = {
    open: () => {
      const req: Record<string, unknown> = {};
      later(() => {
        const db = {
          closed: false,
          onversionchange: null as (() => void) | null,
          objectStoreNames: { contains: () => true },
          close() {
            this.closed = true;
          },
          transaction() {
            if (db.closed) {
              throw new DOMException('The database connection is closing.', 'InvalidStateError');
            }
            const t: Record<string, unknown> = { error: null };
            let pending = 0;
            const settle = () => {
              if (--pending === 0) later(() => (t.oncomplete as () => void)?.());
            };
            const request = (fn: () => unknown) => {
              const r: Record<string, unknown> = {};
              pending++;
              later(() => {
                r.result = fn();
                (r.onsuccess as (() => void) | undefined)?.();
                settle();
              });
              return r;
            };
            t.objectStore = () => ({
              getAll: () => request(() => [...data.values()]),
              get: (k: string) => request(() => data.get(k)),
              put: (v: { id: string }) => request(() => data.set(v.id, structuredClone(v))),
              delete: (k: string) => request(() => data.delete(k)),
            });
            t.abort = () => undefined;
            return t;
          },
        };
        dbs.push(db);
        req.result = db;
        (req.onsuccess as () => void)();
      });
      return req;
    },
  };
  /** Another tab opens the database at a higher version: every open connection is told. */
  const upgradeElsewhere = () => {
    for (const db of dbs) db.onversionchange?.();
  };
  return { factory: factory as unknown as IDBFactory, data, upgradeElsewhere };
}

beforeEach(() => {
  localStorage.clear();
  D().init(design('Start'));
});

describe('IndexedDB in use', () => {
  it('another tab upgrading the database does not leave this tab unable to save for good', async () => {
    const idb = fakeIdb();
    const s = indexedDbProjectStore(idb.factory) as ProjectStore;
    await s.put(recordOf('A'));
    await P().init({ store: s });
    await P().openProject('p-a');
    idb.upgradeElsewhere(); // a newer version of the app opened in another tab
    D().setName('A after the upgrade elsewhere');
    await P().flush();
    // Observed: every write now fails with InvalidStateError; the list says "a private window?"
    // and the chip still says "In projects ... saved as you work".
    const stored = projectRecordOf(idb.data.get('p-a'));
    const saved = stored?.name === 'A after the upgrade elsewhere';
    const said = P().problem !== null && openProjectId() === null;
    expect({ saved, problem: P().problem, persistent: P().persistent, said }).toMatchObject({
      saved: true,
    });
  });
});

describe('hostile times', () => {
  it('an imported project with a modified time past 2^53 still tells another tab its write apart', async () => {
    const all = JSON.stringify({
      app: 'Smith Online',
      kind: 'projects',
      version: 1,
      projects: [{ name: 'X', created: 1, modified: 1e300, file: recordOf('X').file }],
    });
    const read = readImportText(all, 'all.json');
    const m = 'entries' in read ? (read.entries[0]?.modified ?? 0) : 0;
    // Every later write is dated max(now, m + 1) = m: the overtaken-write check compares equal
    // times, so two tabs write over each other unseen.
    expect(m + 1).not.toBe(m);
  });
});

describe('the start', () => {
  it('Save to projects while the list is still being read keeps the new project in the list', async () => {
    const inner = { ...memoryProjectStore([recordOf('Old')]), persistent: true };
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const s: ProjectStore = {
      ...inner,
      loadAll: async () => {
        const r = await inner.loadAll();
        await gate; // a large list takes a while to read
        return r;
      },
    };
    const init = P().init({ store: s });
    // File, Save to projects is enabled before the list is read (the chip is hidden).
    D().setName('Saved early');
    expect(await P().saveCurrent()).toBeNull();
    release();
    await init;
    const id = D().projectId;
    expect({
      inList: P().records.some((r) => r.id === id),
      linked: openProjectId() === id,
    }).toEqual({ inList: true, linked: true });
  });
});
