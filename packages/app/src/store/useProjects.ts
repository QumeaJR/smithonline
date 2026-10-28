import { create } from 'zustand';
import { appVersion, countBucket, track } from '../lib/analytics/track';
import { keepReplacedAutosave } from '../lib/autosave';
import type { Design } from '../lib/design';
import { openedDesign, ownBuild } from '../lib/designBuild';
import { exportJson } from '../lib/export';
import { canOpen } from '../lib/projectWords';
import {
  browserProjectStore,
  cleanProjectName,
  MAX_PROJECT_CHARS,
  MAX_PROJECTS,
  newProjectId,
  projectDesign,
  projectFileOfDesign,
  projectsFileObject,
  readImportText,
  StoreFullError,
  thumbOf,
  type ProjectRecord,
  type ProjectStore,
} from '../lib/projectStore';
import { useDesignStore } from './useDesignStore';

/**
 * The local projects (docs/11): many named designs kept in this browser. The list lives in
 * IndexedDB (lib/projectStore.ts); the design on show is linked to one project (its id in the
 * design store, per design in the history) and every change is written back to it.
 */

/** What stopped the last write: no room, or a browser that refuses to store. */
export type ProjectsProblem = 'full' | 'refused' | null;

export interface ProjectsState {
  records: readonly ProjectRecord[];
  /** The stored projects have been read. */
  ready: boolean;
  /** False when the projects last only as long as the page. */
  persistent: boolean;
  /** IndexedDB did not answer (another tab holds it): memory for now. */
  busy: boolean;
  problem: ProjectsProblem;
  /** Stored records that are not projects, left as they are. */
  skipped: number;
  /** Projects another tab changed while this tab had them open: no longer written here. */
  detached: readonly string[];
  /** The Projects dialog is open. */
  open: boolean;
  /** Settings opened it (Data in this browser, Manage…): closing goes back there. */
  fromSettings: boolean;
  setOpen: (open: boolean, fromSettings?: boolean) => void;
  /** Read the stored projects, migrate the autosave once, and link the design on show. */
  init: (options?: ProjectsInit) => Promise<void>;
  /** Save the design on show as a new project and link it; the reason when refused. */
  saveCurrent: () => Promise<string | null>;
  /** Open a project as one Undo step; the reason when it cannot be opened. */
  openProject: (id: string) => Promise<string | null>;
  rename: (id: string, name: string) => Promise<string | null>;
  /** The new project's id, or the reason. */
  duplicate: (id: string) => Promise<{ id: string } | { problem: string }>;
  /** Remove a project; its record for Undo, or null. */
  remove: (id: string) => Promise<ProjectRecord | null>;
  /** Put removed records back (Undo), with their ids. */
  restore: (records: readonly ProjectRecord[]) => Promise<void>;
  importFiles: (files: readonly { name: string; text: string }[]) => Promise<ImportReport>;
  exportOne: (id: string) => string | null;
  exportAll: () => number;
  /** Write the design on show to its project now (a pending write-back). */
  flush: () => Promise<void>;
}

export interface ProjectsInit {
  /** A store to use (the tests); the browser's otherwise. */
  readonly store?: ProjectStore;
  /** The autosaved design read at the start, for the one migration. */
  readonly autosaved?: Design | null;
  /** The design the start put on show from the autosave (its object in the design store). */
  readonly autosaveShown?: Design | null;
}

export interface ImportReport {
  readonly added: number;
  /** Already in the list (same name and design). */
  readonly duplicates: number;
  /** Kept although this version cannot open them. */
  readonly unreadable: number;
  /** Left out at the count limit. */
  readonly overLimit: number;
  /** Entries of an Export all file that were not projects. */
  readonly skipped: number;
  readonly failed: readonly { readonly fileName: string; readonly reason: string }[];
}

/** The localStorage key of the open project, written beside the autosave (docs/11 section 1). */
export const OPEN_MARK_KEY = 'smithonline.projects.open';
/** Set once the autosave became the first project (docs/11 section 5). */
export const MIGRATED_KEY = 'smithonline.projects.migrated';
/** The pause between a change and its write-back, ms. */
export const WRITE_BACK_MS = 500;

export interface OpenMark {
  readonly id: string;
  /** The project's modified time this tab last wrote or read. */
  readonly at: number;
}

/** The open project as the autosave left it, or null. */
export function readOpenMark(): OpenMark | null {
  try {
    const raw = JSON.parse(localStorage.getItem(OPEN_MARK_KEY) ?? 'null') as unknown;
    if (typeof raw !== 'object' || raw === null) return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(r.id)) return null;
    const at = typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : 0;
    return { id: r.id, at };
  } catch {
    return null;
  }
}

function writeOpenMark(mark: OpenMark | null): void {
  try {
    if (mark) localStorage.setItem(OPEN_MARK_KEY, JSON.stringify(mark));
    else localStorage.removeItem(OPEN_MARK_KEY);
  } catch {
    // No storage: a reload opens the autosave unsaved, which loses nothing.
  }
}

let backend: ProjectStore | null = null;
/** The modified time of each project as this tab last wrote or read it. */
const known = new Map<string, number>();
/** The mark read at the start, until the list is read. */
let startMark: OpenMark | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let chain: Promise<void> = Promise.resolve();
let unsubscribe: (() => void) | null = null;
let listening = false;
/** Projects whose too-large write-back was said once. */
const tooLargeSaid = new Set<string>();

async function storeOf(): Promise<ProjectStore> {
  backend ??= await browserProjectStore();
  return backend;
}

/** The project the design on show is linked to and written to, or null for an unsaved design. */
export function openProjectId(): string | null {
  const { projectId } = useDesignStore.getState();
  if (!projectId) return null;
  const s = useProjects.getState();
  if (!s.ready) return projectId;
  return s.records.some((r) => r.id === projectId) && !s.detached.includes(projectId)
    ? projectId
    : null;
}

/** The record of the open project, for the header's chip and the list. */
export function useOpenProject(): ProjectRecord | null {
  const projectId = useDesignStore((s) => s.projectId);
  const records = useProjects((s) => s.records);
  const detached = useProjects((s) => s.detached);
  if (!projectId || detached.includes(projectId)) return null;
  return records.find((r) => r.id === projectId) ?? null;
}

/**
 * Around the autosave (App.tsx): the mark goes before it is written and comes back after it,
 * so a failure between the two leaves the design unsaved, never linked to the wrong project.
 */
export function autosaveWithMark(write: () => boolean): boolean {
  writeOpenMark(null);
  const saved = write();
  const id = saved ? openProjectId() : null;
  if (id) writeOpenMark({ id, at: known.get(id) ?? (startMark?.id === id ? startMark.at : 0) });
  return saved;
}

const say = (text: string, error = false): void =>
  useDesignStore.getState().setMessage(text, error ? { error: true } : undefined);

const sortedByModified = (records: readonly ProjectRecord[]): ProjectRecord[] =>
  [...records].sort((a, b) => b.modified - a.modified);

/** A new project's record of a design. */
function recordOf(design: Design, id: string, created: number, modified: number): ProjectRecord {
  const own = ownBuild(design);
  const thumb = thumbOf(own);
  const name = cleanProjectName(own.name);
  return {
    id,
    name: name.trim() ? name : 'Untitled',
    created,
    modified,
    file: projectFileOfDesign(own),
    ...(thumb !== undefined ? { thumb } : {}),
    appVersion: appVersion(),
  };
}

const tooMany = `The list holds ${MAX_PROJECTS} projects at most: export and delete some to make room.`;
const tooLarge = 'it is larger than 20 MB';

/** "X (copy)", then "X (copy 2)", a name no project has. */
export function copyName(name: string, taken: readonly string[]): string {
  const base = name.replace(/ \(copy(?: \d+)?\)$/, '');
  for (let i = 1; ; i++) {
    const next = cleanProjectName(`${base} (copy${i === 1 ? '' : ` ${i}`})`);
    if (!taken.includes(next)) return next;
  }
}

export const useProjects = create<ProjectsState>()((set, get) => {
  /** A refused write: the reason in the state, counted. */
  const refused = (err: unknown): void => {
    track('error', 'projects');
    set(
      err instanceof StoreFullError
        ? { problem: 'full' }
        : { problem: 'refused', persistent: false },
    );
  };
  const problemText = (): string =>
    get().problem === 'full'
      ? 'This browser has no room for more projects. Export all keeps them as a file; delete some to make room.'
      : 'This browser does not let the app store projects (a private window?).';
  const upsert = (record: ProjectRecord): void => {
    set({ records: [...get().records.filter((r) => r.id !== record.id), record] });
  };
  const nextTime = (after = 0): number => Math.max(Date.now(), after + 1);

  /** The write-back of the design on show to its project, serialized. */
  const writeBack = (): Promise<void> => {
    chain = chain.then(async () => {
      const id = openProjectId();
      if (!id || !get().ready) return;
      const record = get().records.find((r) => r.id === id);
      if (!record) return;
      // A project this version cannot read (a later version wrote it) is never written over.
      if (!canOpen(record)) {
        detach(id, record.name);
        return;
      }
      const { design } = useDesignStore.getState();
      const own = ownBuild(design);
      const file = projectFileOfDesign(own);
      if (file.design === record.file.design) {
        known.set(id, known.get(id) ?? record.modified);
        return;
      }
      if (file.design.length > MAX_PROJECT_CHARS) {
        if (!tooLargeSaid.has(id)) {
          tooLargeSaid.add(id);
          say(
            `"${record.name}" is now too large for the project list (over 20 MB): it keeps its last version. File, Save as Smith Online (.json) keeps the design as a file.`,
            true,
          );
        }
        return;
      }
      tooLargeSaid.delete(id);
      const next = { ...recordOf(own, id, record.created, nextTime(record.modified)) };
      const expected = known.get(id) ?? record.modified;
      let result;
      try {
        result = await (await storeOf()).putIfUnchanged(next, expected);
      } catch (err) {
        refused(err);
        return;
      }
      if (result === 'ok') {
        known.set(id, next.modified);
        if (get().problem === 'full') set({ problem: null });
        upsert(next);
        if (readOpenMark()?.id === id) writeOpenMark({ id, at: next.modified });
        return;
      }
      // Another tab wrote it (or deleted it) since: nothing is forced over it.
      await reload();
      if (result === 'changed') detach(id, record.name);
    });
    return chain;
  };

  /** Stop writing to a project changed elsewhere: the design on show turns unsaved. */
  const detach = (id: string, name: string): void => {
    set({ detached: [...get().detached.filter((d) => d !== id), id] });
    useDesignStore.getState().adoptProject(null);
    say(
      `Project "${name}" was changed in another tab or version; your design here is now unsaved. Save to projects keeps it as a new project.`,
      true,
    );
  };

  const reload = async (): Promise<void> => {
    try {
      const { records, skipped } = await (await storeOf()).loadAll();
      for (const r of records) if (!known.has(r.id)) known.set(r.id, r.modified);
      set({ records: sortedByModified(records), skipped });
    } catch {
      // The list stays as it was.
    }
  };

  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void writeBack();
    }, WRITE_BACK_MS);
  };

  const flush = async (): Promise<void> => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    await writeBack();
  };

  const watch = (): void => {
    unsubscribe?.();
    unsubscribe = useDesignStore.subscribe((s, prev) => {
      if (s.design !== prev.design || s.projectId !== prev.projectId) schedule();
    });
    if (typeof document !== 'undefined' && !listening) {
      listening = true;
      // A pending write goes when the page is hidden; the autosave holds it if the page dies.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void flush();
      });
    }
  };

  /** The autosave becomes the first project, once (docs/11 section 5). */
  const migrate = async (
    s: ProjectStore,
    autosaved: Design | null | undefined,
    shown: Design | null | undefined,
  ): Promise<void> => {
    if (!s.persistent || get().records.length > 0 || get().skipped > 0) return;
    try {
      if (localStorage.getItem(MIGRATED_KEY) !== null) return;
    } catch {
      return;
    }
    const markDone = (): void => {
      try {
        localStorage.setItem(MIGRATED_KEY, '1');
      } catch {
        // The non-empty list keeps it from running again.
      }
    };
    if (!autosaved) {
      markDone();
      return;
    }
    const now = Date.now();
    const record = recordOf(autosaved, newProjectId(), now, now);
    if (record.file.design.length > MAX_PROJECT_CHARS) {
      markDone();
      return;
    }
    try {
      await s.put(record);
    } catch (err) {
      refused(err);
      return;
    }
    markDone();
    known.set(record.id, record.modified);
    upsert(record);
    track('project', 'migrate');
    const store = useDesignStore.getState();
    if (shown && store.design === shown) {
      store.adoptProject(record.id);
      writeOpenMark({ id: record.id, at: record.modified });
    } else if (shown) {
      store.adoptProject(record.id, shown);
    }
  };

  return {
    records: [],
    ready: false,
    persistent: true,
    busy: false,
    problem: null,
    skipped: 0,
    detached: [],
    open: false,
    fromSettings: false,
    setOpen: (open, fromSettings = false) => {
      set({ open, fromSettings: open && fromSettings });
    },
    init: async (options = {}) => {
      if (options.store) backend = options.store;
      known.clear();
      tooLargeSaid.clear();
      startMark = readOpenMark();
      set({ ready: false, records: [], detached: [], problem: null, skipped: 0 });
      let s: ProjectStore;
      try {
        s = await storeOf();
        const { records, skipped } = await s.loadAll();
        for (const r of records) known.set(r.id, r.modified);
        set({
          records: sortedByModified(records),
          skipped,
          persistent: s.persistent,
          busy: s.busy === true,
        });
      } catch {
        set({ ready: true, persistent: false });
        watch();
        return;
      }
      await migrate(s, options.autosaved, options.autosaveShown);
      // The autosave of the open project is the newest copy: the write-back checks that the
      // project is still the one this tab knew when it wrote the autosave.
      const linked = useDesignStore.getState().projectId;
      if (linked && startMark?.id === linked) known.set(linked, startMark.at);
      set({ ready: true });
      watch();
      if (linked && get().records.some((r) => r.id === linked)) await writeBack();
      startMark = null;
    },
    saveCurrent: async () => {
      const store = useDesignStore.getState();
      const linked = openProjectId();
      if (linked) {
        const name = get().records.find((r) => r.id === linked)?.name ?? store.design.name;
        return `"${name}" is in projects already; changes are saved there as you work`;
      }
      if (get().records.length >= MAX_PROJECTS) return tooMany;
      const now = nextTime();
      const record = recordOf(store.design, newProjectId(), now, now);
      if (record.file.design.length > MAX_PROJECT_CHARS) return `Not saved: ${tooLarge}`;
      try {
        await (await storeOf()).put(record);
      } catch (err) {
        refused(err);
        return `Not saved: ${problemText()}`;
      }
      known.set(record.id, record.modified);
      upsert(record);
      // The design on show and its steps since it was opened now belong to the project.
      useDesignStore.getState().adoptProject(record.id);
      writeOpenMark({ id: record.id, at: record.modified });
      track('project', 'save');
      return null;
    },
    openProject: async (id) => {
      const record = get().records.find((r) => r.id === id);
      if (!record) return 'it is no longer in the list';
      const read = projectDesign(record);
      if ('problem' in read) return `this version cannot open it: ${read.problem}`;
      await flush();
      const store = useDesignStore.getState();
      const previous = store.design;
      const unsaved = openProjectId() === null && previous.elements.length > 0;
      // The unsaved design is kept as a backup before the project replaces it (as for a link).
      const kept = unsaved ? keepReplacedAutosave() : null;
      const opened = openedDesign(read.value);
      known.set(id, record.modified);
      set({ detached: get().detached.filter((d) => d !== id) });
      store.loadDesign(opened.design, `Opened project "${record.name}"`, id);
      const tail = !unsaved
        ? ' Undo brings back the previous design.'
        : kept?.key
          ? ` Your unsaved design "${previous.name}" is kept in this browser: Undo brings it back now, and Settings, Data in this browser, opens it later.`
          : ` Undo brings back your unsaved design "${previous.name}"; save it to projects before you close the tab.`;
      useDesignStore
        .getState()
        .setMessage(
          `Opened project "${record.name}".${tail}${opened.notice ? ` ${opened.notice}` : ''}`,
          {
            undo: true,
          },
        );
      track('project', 'open');
      return null;
    },
    rename: async (id, given) => {
      const name = cleanProjectName(given).trim();
      if (!name) return 'a project needs a name';
      const record = get().records.find((r) => r.id === id);
      if (!record) return 'it is no longer in the list';
      if (name === record.name) return null;
      if (openProjectId() === id) {
        // The open project's name is the design's: one Undo step, as in the header.
        useDesignStore.getState().setName(name);
        await flush();
        track('project', 'rename');
        return null;
      }
      const read = projectDesign(record);
      if ('problem' in read) return 'this version cannot open it, so it cannot rename it';
      const next = recordOf({ ...read.value, name }, id, record.created, nextTime(record.modified));
      try {
        await (await storeOf()).put(next);
      } catch (err) {
        refused(err);
        return problemText();
      }
      known.set(id, next.modified);
      upsert(next);
      track('project', 'rename');
      return null;
    },
    duplicate: async (id) => {
      const record = get().records.find((r) => r.id === id);
      if (!record) return { problem: 'it is no longer in the list' };
      if (get().records.length >= MAX_PROJECTS) return { problem: tooMany };
      if (openProjectId() === id) await flush();
      const source = get().records.find((r) => r.id === id) ?? record;
      const name = copyName(
        source.name,
        get().records.map((r) => r.name),
      );
      const now = nextTime();
      const read = projectDesign(source);
      const next: ProjectRecord =
        'value' in read
          ? recordOf({ ...read.value, name }, newProjectId(), now, now)
          : { ...source, id: newProjectId(), name, created: now, modified: now };
      try {
        await (await storeOf()).put(next);
      } catch (err) {
        refused(err);
        return { problem: problemText() };
      }
      known.set(next.id, next.modified);
      upsert(next);
      track('project', 'duplicate');
      return { id: next.id };
    },
    remove: async (id) => {
      const record = get().records.find((r) => r.id === id) ?? null;
      if (!record) return null;
      if (openProjectId() === id && timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      set({ records: get().records.filter((r) => r.id !== id) });
      try {
        await (await storeOf()).remove(id);
      } catch (err) {
        refused(err);
      }
      track('project', 'delete', countBucket(1));
      return record;
    },
    restore: async (records) => {
      for (const record of records) {
        if (get().records.some((r) => r.id === record.id)) continue;
        try {
          await (await storeOf()).put(record);
        } catch (err) {
          refused(err);
          continue;
        }
        known.set(record.id, record.modified);
        upsert(record);
      }
      // The design on show, if it was the deleted project, is written back to it again.
      schedule();
    },
    importFiles: async (files) => {
      let added = 0;
      let duplicates = 0;
      let unreadable = 0;
      let overLimit = 0;
      let skipped = 0;
      const failed: { fileName: string; reason: string }[] = [];
      for (const f of files) {
        const read = readImportText(f.text, f.name);
        if ('problem' in read) {
          failed.push({ fileName: f.name, reason: read.problem });
          continue;
        }
        skipped += read.skipped;
        for (const entry of read.entries) {
          const same = get().records.some(
            (r) => r.name === entry.name && r.file.design === entry.file.design,
          );
          if (same) {
            duplicates++;
            continue;
          }
          if (get().records.length >= MAX_PROJECTS) {
            overLimit++;
            continue;
          }
          let record: ProjectRecord = {
            id: newProjectId(),
            name: entry.name,
            created: entry.created,
            modified: entry.modified,
            file: entry.file,
          };
          if (entry.readable) {
            const design = projectDesign(record);
            const thumb = 'value' in design ? thumbOf(design.value) : undefined;
            if (thumb) record = { ...record, thumb };
          }
          try {
            await (await storeOf()).put(record);
          } catch (err) {
            refused(err);
            failed.push({ fileName: f.name, reason: problemText() });
            break;
          }
          known.set(record.id, record.modified);
          upsert(record);
          added++;
          if (!entry.readable) unreadable++;
        }
      }
      if (added > 0) track('project', 'import', countBucket(added));
      return { added, duplicates, unreadable, overLimit, skipped, failed };
    },
    exportOne: (id) => {
      const record = get().records.find((r) => r.id === id);
      if (!record) return null;
      const safe = record.name.replace(/[^\w.-]+/g, '_') || 'design';
      exportJson(record.file, safe);
      track('project', 'export');
      return `${safe}.json`;
    },
    exportAll: () => {
      const { records } = get();
      if (records.length === 0) return 0;
      const day = new Date().toISOString().slice(0, 10);
      exportJson(projectsFileObject(sortedByModified(records)), `smithonline-projects-${day}`);
      track('project', 'export_all', countBucket(records.length));
      return records.length;
    },
    flush,
  };
});
