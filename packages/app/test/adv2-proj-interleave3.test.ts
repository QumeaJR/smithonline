// @vitest-environment jsdom
/**
 * docs/11, local projects: a randomized interleaving of two tabs on one browser storage. Each
 * tab is its own copy of the app's modules (its own design store and project list) over one
 * shared project store and one localStorage, as two tabs of one origin are. The tabs edit, undo
 * and redo, open, save, rename, duplicate, delete and undo the delete, write back, are closed
 * (with or without a last write-back) and opened again from the autosave, while the browser
 * refuses some writes and some autosaves are lean (part data left out for room).
 *
 * Every design carries a stamp (its frequency) that each edit makes new. What must hold:
 * 1. no write replaces a stored design the writing tab never had on show (an edit that reached
 *    storage is never overwritten by an older one from another tab);
 * 2. no write strips the part data from a stored project;
 * 3. every design that reached storage ends up in a project, in the autosave or in a backup,
 *    unless the user deleted its project or the same line of edits went on from it;
 * 4. a design replaced by Open is kept (in a project, the autosave or a backup);
 * 5. after a last write-back, a tab's linked design is in its project.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';

/** Adversarial round 2: three tabs, crashes mid-write, slow writes, imports, Export all, Undo of deletes. */
const exportedFiles: { value: unknown; name: string }[] = [];
vi.mock('../src/lib/export', async (orig) => ({
  ...(await orig<typeof import('../src/lib/export')>()),
  exportJson: (value: unknown, name: string) => {
    exportedFiles.push({ value, name });
  },
}));
import { SYNTHETIC_PARTS, syntheticPart, withoutData } from '@smithonline/core';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { ownBuild } from '../src/lib/designBuild';
import {
  memoryProjectStore,
  projectDesign,
  projectFileOfDesign,
  type ProjectsFile,
  type ProjectRecord,
  type ProjectStore,
  type PutResult,
} from '../src/lib/projectStore';

type DesignStoreModule = typeof import('../src/store/useDesignStore');
type ProjectsModule = typeof import('../src/store/useProjects');
type AutosaveModule = typeof import('../src/lib/autosave');

const AUTOSAVE_KEY = 'smithonline.design.v1';
const REPLACED = 'smithonline.design.replaced';
/** A tab's own copy of a design no project holds, and a deleted project kept for its Undo. */
const TAB_COPY = 'smithonline.design.tab.';
const DELETED = 'smithonline.design.deleted.';

/** A small seeded random generator (mulberry32). */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const spec = SYNTHETIC_PARTS.find((p) => p.name === 'SYNTH-C0402-10P');
if (!spec) throw new Error('no synthetic part');
const part = syntheticPart(spec);

// Project files keep 6 significant digits: stamps step by 1e4 Hz from 100 MHz.
const BASE_F = 1e8;
const STEP = 1e4;
const stampOf = (d: Pick<Design, 'frequency'>): number => Math.round((d.frequency - BASE_F) / STEP);
const designAt = (name: string, stamp: number): Design =>
  ownBuild({
    ...emptyDesign(),
    name,
    frequency: BASE_F + stamp * STEP,
    load: { re: 25, im: -10 },
    elements: identify([
      { kind: 'part', orientation: 'shunt', part },
      { kind: 'L', orientation: 'series', value: 10e-9 },
    ]),
  });

/** The stamp and whether the part keeps its data, of a stored record. */
function readRecord(raw: unknown): { stamp: number; data: boolean } | null {
  const r = raw as ProjectRecord | null | undefined;
  if (!r || typeof r !== 'object' || !r.file) return null;
  const d = projectDesign(r);
  if (!('value' in d)) return null;
  const el = d.value.elements[0];
  return { stamp: stampOf(d.value), data: el?.kind === 'part' ? el.part.data !== undefined : true };
}

interface Tab {
  readonly name: string;
  readonly D: DesignStoreModule['useDesignStore'];
  readonly P: ProjectsModule['useProjects'];
  readonly projects: ProjectsModule;
  readonly autosave: AutosaveModule;
  /** Every stamp this tab had on show (and the lineage of the autosave it started from). */
  readonly shown: Set<number>;
  alive: boolean;
  removed: ProjectRecord[];
  off: () => void;
}

interface World {
  readonly inner: ProjectStore;
  refusing: boolean;
  lean: boolean;
  /** The lineage of the tab that wrote the autosave last. */
  autosaveLineage: Set<number>;
  readonly everStored: Set<number>;
  /** Stamps a write replaced legitimately (the same line of edits went on). */
  readonly superseded: Set<number>;
  /** Stamps whose project the user deleted. */
  readonly deleted: Set<number>;
  readonly violations: string[];
  readonly staleExports: string[];
  /** Stamps in a file the user holds (Export all). */
  readonly exportedStamps: Set<number>;
  counter: number;
}

let slowNow = false;
let restoring = 0;
export const trace: string[] = [];
const T = (x: string): void => {
  if (process.env.IL_TRACE) trace.push(x);
};
const tick = (rand: () => number): Promise<void> =>
  new Promise((r) => setTimeout(r, Math.floor(rand() * (slowNow ? 15 : 3))));

/** The tab's view of the shared store: async like IndexedDB, checked on every write. */
function facade(world: World, tab: () => Tab, rand: () => number): ProjectStore {
  const { inner } = world;
  const dead = (): Error => new Error('the tab is closed');
  const refuse = (): Error => Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
  const check = async (record: ProjectRecord, write: () => Promise<PutResult>) => {
    const t = tab();
    // Read and write in one step, as one IndexedDB transaction does.
    const beforeRaw = inner.get(record.id);
    const result = await write();
    const before = await beforeRaw;
    T(
      `${t.name} write ${record.id} ${readRecord(record)?.stamp} over ${before && before !== 'other' ? readRecord(before)?.stamp : before} -> ${result}`,
    );
    if (result !== 'ok') return result;
    const next = readRecord(record);
    if (next) world.everStored.add(next.stamp);
    if (before && before !== 'other') {
      const old = readRecord(before);
      if (old && next) {
        if (old.stamp !== next.stamp && !t.shown.has(old.stamp)) {
          world.violations.push(
            `${t.name} wrote ${next.stamp} over ${old.stamp} in ${record.id}, a design it never had on show`,
          );
        }
        if (old.data && !next.data) {
          world.violations.push(`${t.name} stripped the part data of ${record.id}`);
        }
        if (old.stamp !== next.stamp) world.superseded.add(old.stamp);
      }
    }
    return result;
  };
  return {
    persistent: true,
    loadAll: async () => {
      await tick(rand);
      if (!tab().alive) throw dead();
      return inner.loadAll();
    },
    get: async (id) => {
      await tick(rand);
      if (!tab().alive) throw dead();
      return inner.get(id);
    },
    put: async (record) => {
      await tick(rand);
      if (!tab().alive) throw dead();
      if (world.refusing) throw refuse();
      await check(record, async () => {
        await inner.put(record);
        return 'ok';
      });
    },
    putIfUnchanged: async (record, expected) => {
      await tick(rand);
      if (!tab().alive) throw dead();
      if (world.refusing && !(process.env.IL_SKIP_KNOWN && restoring > 0)) {
        T(`${tab().name} REFUSED ${record.id} ${readRecord(record)?.stamp}`);
        throw refuse();
      }
      return check(record, () => inner.putIfUnchanged(record, expected));
    },
    remove: async (id) => {
      await tick(rand);
      if (!tab().alive) throw dead();
      const before = await inner.get(id);
      await inner.remove(id);
      T(`${tab().name} remove ${id}`);
      const old = before && before !== 'other' ? readRecord(before) : null;
      if (old) world.deleted.add(old.stamp);
    },
  };
}

/** Open a tab: a fresh copy of the modules, started from the autosave as main.tsx does. */
async function openTab(world: World, name: string, rand: () => number): Promise<Tab> {
  vi.resetModules();
  // Each tab has its own session storage (its id survives its reloads).
  sessionStorage.setItem('smithonline.tab', name.replace(/W+/g, '-'));
  const ds = await import('../src/store/useDesignStore');
  const projects = await import('../src/store/useProjects');
  const autosave = await import('../src/lib/autosave');
  const D = ds.useDesignStore;
  const P = projects.useProjects;
  const tab: Tab = {
    name,
    D,
    P,
    projects,
    autosave,
    shown: new Set(world.autosaveLineage),
    alive: true,
    removed: [],
    off: () => undefined,
  };
  // As main.tsx: this tab's own copy first (a reload), else the autosave.
  const shared = autosave.readSavedDesign();
  const own = projects.claimTabCopy();
  const fromCopy =
    own !== null &&
    !(shared !== null && stampOf(own) === stampOf(shared) && own.name === shared.name);
  if (fromCopy && shared && !projects.tabCopyHolds(shared)) autosave.keepReplacedAutosave();
  const saved = fromCopy ? own : shared;
  projects.pruneTabCopies(saved);
  if (fromCopy && own) tab.shown.add(stampOf(own));
  const start = saved ?? designAt(`${name} start`, ++world.counter);
  D.getState().init(start, {
    project: saved && !fromCopy ? (projects.readOpenMark()?.id ?? null) : null,
  });
  tab.shown.add(stampOf(D.getState().design));
  // The autosave as App.tsx writes it, on every change of the design or its project.
  const write = (): void => {
    if (!tab.alive) return;
    const own = ownBuild(D.getState().design);
    const saved2 = projects.autosaveWithMark(() =>
      autosave.writeAutosave(own, () => ({
        ...own,
        elements: own.elements.map((el) =>
          el.kind === 'part' ? { ...el, part: withoutData(el.part) } : el,
        ),
      })),
    );
    if (saved2) world.autosaveLineage = new Set(tab.shown);
  };
  const offShown = D.subscribe((s, prev) => {
    if (s.design !== prev.design) tab.shown.add(stampOf(s.design));
    if (s.design !== prev.design || s.projectId !== prev.projectId) write();
  });
  tab.off = offShown;
  write();
  const store = facade(world, () => tab, rand);
  await P.getState().init({
    store,
    autosaved: saved,
    autosaveShown: saved ? D.getState().design : null,
  });
  return tab;
}

/** The stamps in the autosave and the backups. */
function keptStamps(): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (
      !key ||
      !(
        key === AUTOSAVE_KEY ||
        key.startsWith(REPLACED) ||
        key.startsWith(TAB_COPY) ||
        key.startsWith(DELETED)
      )
    )
      continue;
    try {
      const d = JSON.parse(localStorage.getItem(key) ?? 'null') as Design | null;
      if (d && typeof d.frequency === 'number') out.add(stampOf(d));
    } catch {
      // not a design
    }
  }
  return out;
}

async function storedStamps(inner: ProjectStore): Promise<Set<number>> {
  const out = new Set<number>();
  for (const r of (await inner.loadAll()).records) {
    const s = readRecord(r);
    if (s) out.add(s.stamp);
  }
  return out;
}

/** Keep the autosave's lean copy honest: with `lean`, a design with part data is refused. */
function installLeanStorage(world: World): () => void {
  const proto = Object.getPrototypeOf(localStorage) as Storage;
  const original = proto.setItem.bind(localStorage);
  const spy = vi.spyOn(proto, 'setItem').mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    if (world.lean && key === AUTOSAVE_KEY) {
      const d = JSON.parse(value) as Design;
      if (d.elements.some((el) => el.kind === 'part' && el.part.data !== undefined)) {
        throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
      }
    }
    original(key, value);
  });
  return () => spy.mockRestore();
}

async function runSeed(seed: number, steps: number): Promise<World> {
  localStorage.clear();
  const rand = random(seed);
  const pick = <T>(list: readonly T[]): T | undefined =>
    list.length === 0 ? undefined : list[Math.floor(rand() * list.length)];
  const world: World = {
    inner: { ...memoryProjectStore(), persistent: true },
    refusing: false,
    lean: false,
    autosaveLineage: new Set(),
    everStored: new Set(),
    superseded: new Set(),
    deleted: new Set(),
    violations: [],
    staleExports: [],
    exportedStamps: new Set(),
    counter: 0,
  };
  const restore = installLeanStorage(world);
  // The first start: an autosave becomes the first project (the migration).
  localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(designAt('First', ++world.counter)));
  world.autosaveLineage = new Set([world.counter]);
  exportedFiles.length = 0;
  slowNow = false;
  const tabs: Tab[] = [await openTab(world, 'tab 1', rand)];
  tabs.push(await openTab(world, 'tab 2', rand));
  tabs.push(await openTab(world, 'tab 3', rand));

  /** One user or browser action in a tab. */
  const act = async (i: number): Promise<void> => {
    const tab = tabs[i];
    if (!tab) return;
    const D = tab.D.getState();
    const P = tab.P.getState();
    const roll = rand();
    T(`${tab.name} act ${roll.toFixed(3)} showing ${stampOf(D.design)} linked ${D.projectId}`);
    if (roll < 0.3) {
      const stamp = ++world.counter;
      D.update((d) => ({ ...d, frequency: BASE_F + stamp * STEP }));
    } else if (roll < 0.38) {
      D.undo();
    } else if (roll < 0.42) {
      D.redo();
    } else if (roll < 0.52) {
      await P.flush();
    } else if (roll < 0.6) {
      const target = pick(P.records);
      if (!target) return;
      const previous = D.design;
      const before = stampOf(previous);
      const why = await P.openProject(target.id);
      if (why === null) {
        const kept = keptStamps();
        const stored = await storedStamps(world.inner);
        // Kept, or another tab went on from it (its line of edits continued there).
        if (!kept.has(before) && !stored.has(before) && !world.superseded.has(before)) {
          world.violations.push(`${tab.name}: opening a project lost design ${before}`);
        }
        // The user clears that backup (Settings), so the five slots stay free; the other
        // tab's backups stay until it has checked them.
        for (let k = 1; k <= 5; k++) {
          const key = k === 1 ? REPLACED : `${REPLACED}.${k}`;
          const text = localStorage.getItem(key);
          if (text && stampOf(JSON.parse(text) as Design) === before) localStorage.removeItem(key);
        }
      }
    } else if (roll < 0.66) {
      await P.saveCurrent();
    } else if (roll < 0.7) {
      const target = pick(P.records);
      if (target) await P.rename(target.id, `${target.name.slice(0, 20)} r${++world.counter}`);
    } else if (roll < 0.74) {
      const target = pick(P.records);
      if (target && P.records.length < 30) await P.duplicate(target.id);
    } else if (roll < 0.79) {
      const target = pick(P.records);
      if (target) {
        const removed = await P.remove(target.id);
        if (removed) tab.removed.push(removed);
      }
    } else if (roll < 0.82) {
      const back = tab.removed.pop();
      if (back) {
        // The user undid the delete: that design must come back.
        const st = readRecord(back);
        if (st) world.deleted.delete(st.stamp);
        // IL_SKIP_KNOWN: leave out the refused Undo of a delete (reported on its own).
        const was = world.refusing;
        restoring++;
        await P.restore([back]);
        restoring--;
        void was;
      }
    } else if (roll < 0.85) {
      world.refusing = !world.refusing;
    } else if (roll < 0.87) {
      world.lean = !world.lean;
    } else if (roll < 0.89) {
      slowNow = !slowNow;
    } else if (roll < 0.91) {
      // Import a saved design file, or the last Export all.
      if (rand() < 0.5) {
        const stamp = ++world.counter;
        tab.shown.add(stamp);
        const file = projectFileOfDesign(designAt(`Imported ${stamp}`, stamp));
        await P.importFiles([{ name: 'x.json', text: JSON.stringify(file) }]);
      } else if (exportedFiles.length > 0) {
        const last = exportedFiles[exportedFiles.length - 1];
        await P.importFiles([{ name: 'all.json', text: JSON.stringify(last?.value) }]);
      }
    } else if (roll < 0.93) {
      // Export all: the backup. It must hold what is stored now.
      // What was stored when Export all was asked for, and is still stored after (the other
      // tabs go on writing while it reads the store).
      const before = exportedFiles.length;
      const storedBefore = await storedStamps(world.inner);
      if ((await P.exportAll()) > 0) {
        const after = await storedStamps(world.inner);
        const stored = [...storedBefore].filter((x) => after.has(x));
        const out = new Set<number>();
        for (const f of exportedFiles.slice(before)) {
          for (const p of (f.value as ProjectsFile).projects) {
            const r = readRecord(p);
            if (r) out.add(r.stamp);
          }
        }
        for (const st of out) world.exportedStamps.add(st);
        const missing = [...stored].filter((x) => !out.has(x));
        if (missing.length > 0)
          world.staleExports.push(`${tab.name} Export all lacks stored ${missing.join(',')}`);
      }
    } else if (roll < 0.95) {
      await new Promise((r) => setTimeout(r, Math.floor(rand() * 20)));
    } else if (roll < 0.975) {
      // A crash mid-write: an edit, its write-back on its way, the page dies at a random point.
      const stamp = ++world.counter;
      D.update((d) => ({ ...d, frequency: BASE_F + stamp * STEP }));
      void P.flush().catch(() => undefined);
      await new Promise((r) => setTimeout(r, Math.floor(rand() * 4)));
      tab.alive = false;
      tab.off();
      tabs[i] = await openTab(world, tab.name, rand);
    } else {
      // The tab is closed (with its last write-back, or not) and opened again.
      if (rand() < 0.5) await P.flush();
      tab.alive = false;
      tab.off();
      tabs[i] = await openTab(world, tab.name, rand);
    }
  };

  for (let step = 0; step < steps; step++) {
    // Sometimes both tabs act at once, their steps interleaved by the store's delays.
    const r = rand();
    if (r < 0.2) await Promise.all([act(0), act(1), act(2)]);
    else if (r < 0.45) await Promise.all([act(0), act(2)]);
    else await act(Math.floor(rand() * 3));
  }

  // The end: the browser takes writes again; each tab writes back what it holds.
  world.refusing = false;
  world.lean = false;
  slowNow = false;
  for (const tab of tabs) {
    await tab.P.getState().flush();
    await tab.P.getState().flush();
  }
  const stored = await storedStamps(world.inner);
  for (const tab of tabs) {
    const id = tab.projects.openProjectId();
    if (id) {
      const record = (await world.inner.loadAll()).records.find((r) => r.id === id);
      const s = record && readRecord(record);
      const want = stampOf(tab.D.getState().design);
      // In its project; or another tab went on from it there (its line of edits continued), or
      // the user deleted that project in another tab (this tab learns it on its next write).
      const gone = record === undefined && world.deleted.has(want);
      if (s?.stamp !== want && !world.superseded.has(want) && !gone) {
        world.violations.push(`${tab.name}: its design ${want} is not in its project ${id}`);
      }
    }
  }
  const kept = keptStamps();
  T(`END stored ${[...stored].join(',')} kept ${[...keptStamps()].join(',')}`);
  for (const s of world.everStored) {
    if (stored.has(s) || kept.has(s) || world.superseded.has(s) || world.deleted.has(s)) continue;
    if (world.exportedStamps.has(s)) continue;
    world.violations.push(`design ${s} reached storage and is now nowhere`);
  }
  for (const tab of tabs) {
    tab.alive = false;
    tab.off();
  }
  restore();
  return world;
}

describe('three tabs, random interleavings (adversarial round 2)', () => {
  afterAll(() => localStorage.clear());

  it('never write over a design unseen, never strip part data, never lose a stored design', async () => {
    const report: string[] = [];
    const stale: string[] = [];
    let writes = 0;
    for (
      let seed = Number(process.env.IL_FROM ?? 1);
      // The full set (IL_SEEDS=20) before a commit; the suite runs the first four.
      seed <= Number(process.env.IL_SEEDS ?? 4);
      seed++
    ) {
      const world = await runSeed(seed, Number(process.env.IL_STEPS ?? 90));
      writes += world.everStored.size;
      for (const v of world.violations) report.push(`seed ${seed}: ${v}`);
      if (process.env.IL_TRACE) console.log(trace.join(String.fromCharCode(10)));
      trace.length = 0;
      for (const v of world.staleExports) stale.push(`seed ${seed}: ${v}`);
    }
    console.log(`STALE EXPORTS ${stale.length}: ${stale.slice(0, 5).join(' | ')}`);
    expect(report).toEqual([]);
    expect(stale).toEqual([]);
    // The runs did write: the check is not empty.
    expect(writes).toBeGreaterThan(Number(process.env.IL_SEEDS ?? 4) * 5);
  }, 600_000);
});
