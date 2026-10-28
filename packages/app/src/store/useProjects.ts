import { create } from 'zustand';
import { appVersion, countBucket, track } from '../lib/analytics/track';
import { autosaveWritten, keepReplacedDesign } from '../lib/autosave';
import { MAX_DESIGN_NAME, type Design } from '../lib/design';
import { openedDesign, ownBuild } from '../lib/designBuild';
import { exportJson } from '../lib/export';
import { attachLibraryData } from '../lib/parts';
import { canOpen } from '../lib/projectWords';
import {
  browserProjectStore,
  cleanProjectName,
  MAX_PROJECT_CHARS,
  MAX_PROJECTS,
  newProjectId,
  projectDesign,
  projectFileOfDesign,
  projectsFileParts,
  readImportText,
  StoreFullError,
  thumbOf,
  type ProjectRecord,
  type ProjectStore,
  type PutResult,
} from '../lib/projectStore';
import { useDesignStore } from './useDesignStore';

/**
 * The local projects (docs/11): many named designs kept in this browser. The list lives in
 * IndexedDB (lib/projectStore.ts); the design on show is linked to one project (its id in the
 * design store, per design in the history) and every change is written back to it.
 *
 * The rule above all: no design is lost or written over unseen. Every write of a record goes
 * through one checked write (commit: the store's putIfUnchanged, against the modified time this
 * tab last wrote or read), one write at a time (exclusive). When another tab changed a project
 * since, both are kept: this tab's design becomes a new project.
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
  /** Projects a later version wrote while this tab had them open: never written here. */
  detached: readonly string[];
  /** The open project whose last write-back the browser refused: its changes are not stored. */
  failed: string | null;
  /** When Export all last ran in this browser (ms), or 0. */
  lastExport: number;
  /** The files the last Export all wrote, in this page. */
  exportedFiles: readonly string[];
  /** The Projects dialog is open. */
  open: boolean;
  /** Settings opened it (Data in this browser, Manage…): closing goes back there. */
  fromSettings: boolean;
  /** Save to projects opened it: it asks for a name, or offers the project of the same design. */
  saving: boolean;
  setOpen: (open: boolean, fromSettings?: boolean, saving?: boolean) => void;
  /** Read the stored projects, migrate the autosave once, and link the design on show. */
  init: (options?: ProjectsInit) => Promise<void>;
  /** Save the design on show as a new project and link it; the reason when refused. */
  saveCurrent: () => Promise<string | null>;
  /** A project holding exactly the design on show (opened from an exported file), or null. */
  sameProject: () => ProjectRecord | null;
  /** Link the design on show to a project of the same content (no new step, no new project). */
  linkTo: (id: string) => string | null;
  /** Open a project as one Undo step; the reason when it cannot be opened. */
  openProject: (id: string) => Promise<string | null>;
  rename: (id: string, name: string) => Promise<string | null>;
  /** The new project's id, or the reason. */
  duplicate: (id: string) => Promise<{ id: string } | { problem: string }>;
  /** Remove a project; its record as stored, for Undo, or null when it was not removed. */
  remove: (id: string) => Promise<ProjectRecord | null>;
  /** Put removed records back (Undo), with their ids. */
  restore: (records: readonly ProjectRecord[]) => Promise<void>;
  importFiles: (files: readonly { name: string; text: string }[]) => Promise<ImportReport>;
  exportOne: (id: string) => string | null;
  /** Export every project, in numbered files when one would pass the import limit; the count. */
  exportAll: () => number;
  /** Write the design on show to its project now (a pending write-back). */
  flush: () => Promise<void>;
  /** The design on show has changes its project does not hold (unsaved, refused or pending). */
  hasUnstored: () => boolean;
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
  /** Kept although this version cannot open them (a later version wrote them). */
  readonly unreadable: number;
  /** Kept although damaged (they cannot be decoded). */
  readonly damaged: number;
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
/** When Export all last ran (ms). */
export const EXPORTED_KEY = 'smithonline.projects.exported';
/** The pause between a change and its write-back, ms. */
export const WRITE_BACK_MS = 500;
/** A migration claimed by a tab that did not finish within this time is claimed again, ms. */
const CLAIM_MS = 60_000;
/** The name a design kept beside a project another tab changed gets. */
export const FROM_THIS_TAB = 'from this tab';

export interface OpenMark {
  readonly id: string;
  /** The project's modified time the autosaved design is based on (this tab wrote or read it). */
  readonly at: number;
  /** The autosave is the lean copy: its parts' data is in the project, not in it. */
  readonly lean?: true;
}

/** The open project as the autosave left it, or null. */
export function readOpenMark(): OpenMark | null {
  try {
    const raw = JSON.parse(localStorage.getItem(OPEN_MARK_KEY) ?? 'null') as unknown;
    if (typeof raw !== 'object' || raw === null) return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(r.id)) return null;
    const at = typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : 0;
    return { id: r.id, at, ...(r.lean === true ? { lean: true as const } : {}) };
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

function readLastExport(): number {
  try {
    const v = Number(localStorage.getItem(EXPORTED_KEY));
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

let backend: ProjectStore | null = null;
/** The modified time of each project as this tab last wrote or read it. */
const known = new Map<string, number>();
/** The mark read at the start, until the list is read. */
let startMark: OpenMark | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
/** Every write, one after another (exclusive). */
let writes: Promise<unknown> = Promise.resolve();
let unsubscribe: (() => void) | null = null;
let listening = false;
/** Projects whose too-large write-back was said once. */
const tooLargeSaid = new Set<string>();
/** The modified time this tab knew of each project it deleted, for Undo (restore). */
const removedKnown = new Map<string, number>();

async function storeOf(): Promise<ProjectStore> {
  backend ??= await browserProjectStore();
  return backend;
}

/** Run one write after the ones before it. `fn` must not wait for another exclusive call. */
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = writes.then(fn, fn);
  writes = run.catch(() => undefined);
  return run;
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
 * The mark carries the project's modified time this design is based on, and is written only
 * with the autosave it belongs to (never re-dated by a write-back: the autosave may be another
 * tab's by then).
 */
export function autosaveWithMark(write: () => boolean): boolean {
  writeOpenMark(null);
  const saved = write();
  const id = saved ? openProjectId() : null;
  if (id) {
    const at = known.get(id) ?? (startMark?.id === id ? startMark.at : 0);
    writeOpenMark({ id, at, ...(autosaveWritten.lean ? { lean: true as const } : {}) });
  }
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

/** The design file text of a design as a project holds it. */
const fileTextOf = (design: Design): string => projectFileOfDesign(ownBuild(design)).design;

const tooMany = `The list holds ${MAX_PROJECTS} projects at most: export and delete some to make room.`;
const tooLarge = 'it is larger than 20 MB';

/**
 * "X (copy)", then "X (copy 2)": a name no project has, within the name limit (the base is cut
 * to leave room for the suffix). `suffix` "from this tab" for a design kept beside a project
 * another tab changed.
 */
export function copyName(name: string, taken: readonly string[], suffix = 'copy'): string {
  const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const base = cleanProjectName(name).replace(new RegExp(` \\(${escaped}(?: \\d+)?\\)$`), '');
  const used = new Set(taken);
  const make = (tail: string): string =>
    `${base.slice(0, Math.max(0, MAX_DESIGN_NAME - tail.length)).trimEnd()}${tail}`;
  // Among the at most MAX_PROJECTS names taken, one of the first MAX_PROJECTS + 1 is free.
  for (let i = 1; i <= used.size + 1; i++) {
    const next = make(` (${suffix}${i === 1 ? '' : ` ${i}`})`);
    if (!used.has(next)) return next;
  }
  return make(` (${suffix} ${used.size + 2})`);
}

/** The key the list sorts names by: "X (copy)" before "X (copy 2)", "2" before "10". */
export function nameSortKey(name: string): string {
  return name.replace(/ \((copy|from this tab)\)$/, ' ($1 1)');
}

/** Compare names naturally (numbers by value, case ignored). */
export function compareNames(a: string, b: string): number {
  return nameSortKey(a).localeCompare(nameSortKey(b), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

/** True for a design name that asks for a better one before it becomes a project. */
export function needsName(name: string): boolean {
  const n = name.trim();
  return n === '' || n.toLowerCase() === 'untitled';
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
  const nameOf = (id: string): string => get().records.find((r) => r.id === id)?.name ?? '';

  /**
   * The one checked write (docs/11 section 4): written only when the stored record is still
   * the one this tab knows (`expected`, its modified time; null for a new record, which must
   * not be there yet). On success the list and the known time follow; a refusal by the browser
   * is 'refused', with the reason in the state.
   */
  const commit = async (
    next: ProjectRecord,
    expected: number | null,
  ): Promise<PutResult | 'refused'> => {
    let result: PutResult;
    try {
      result = await (await storeOf()).putIfUnchanged(next, expected);
    } catch (err) {
      refused(err);
      return 'refused';
    }
    if (result === 'ok') {
      known.set(next.id, next.modified);
      upsert(next);
      if (get().problem !== null) set({ problem: null, persistent: backend?.persistent ?? true });
    }
    return result;
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

  /**
   * A design on show whose library parts came without their data (a lean autosave) takes the
   * data from its project, so a write-back never strips it there. True when it took some.
   */
  const fillPartData = (record: ProjectRecord): boolean => {
    const store = useDesignStore.getState();
    if (!store.design.elements.some((el) => el.kind === 'part' && !el.part.data)) return false;
    const read = projectDesign(record);
    if ('problem' in read) return false;
    const parts = read.value.elements.flatMap((el) =>
      el.kind === 'part' && el.part.data ? [el.part] : [],
    );
    const filled = attachLibraryData(store.design.elements, parts);
    if (!filled) return false;
    store.attachPartData(filled);
    return true;
  };

  /** The open project's write-back was refused: said once, and the chip says "Not saved". */
  const markFailed = (id: string, name: string): void => {
    if (get().failed === id) return;
    set({ failed: id });
    say(
      get().problem === 'full'
        ? `Not saved to project "${name}": browser storage is full. The autosave keeps your design; Export all, then delete some projects to make room.`
        : `Not saved to project "${name}": this browser refused to store it. The autosave keeps your design.`,
      true,
    );
  };
  const clearFailed = (id: string): void => {
    if (get().failed === id) set({ failed: null });
  };

  /** A project a later version wrote is never written over: the design on show turns unsaved. */
  const detach = (id: string, name: string): void => {
    set({ detached: [...get().detached.filter((d) => d !== id), id] });
    useDesignStore.getState().adoptProject(null);
    say(
      `Project "${name}" was written by a later version of Smith Online, so your design here is not written over it and is unsaved now. Save to projects keeps it as a new project.`,
      true,
    );
  };

  /**
   * Another tab changed the open project since this tab read or wrote it: both are kept. The
   * design on show becomes a new project, "X (from this tab)", and stays linked to it.
   */
  const keepBoth = async (own: Design, name: string): Promise<void> => {
    const copy = copyName(
      own.name,
      get().records.map((r) => r.name),
      FROM_THIS_TAB,
    );
    const now = nextTime();
    const record = recordOf({ ...own, name: copy }, newProjectId(), now, now);
    const result = await commit(record, null);
    const store = useDesignStore.getState();
    if (result !== 'ok') {
      store.adoptProject(null);
      say(
        `Project "${name}" was changed in another tab, and this browser did not store your design beside it: it is unsaved here now (the autosave keeps it).`,
        true,
      );
      return;
    }
    store.adoptProject(record.id);
    if (store.design.name !== copy) useDesignStore.getState().setName(copy);
    say(
      `Project "${name}" was changed in another tab, so your design here is kept beside it as a new project, "${copy}". Both are in the list.`,
    );
  };

  /** The write-back of the design on show to its project: exclusive (via flush or schedule). */
  const writeBackNow = async (): Promise<void> => {
    const id = openProjectId();
    if (!id || !get().ready) return;
    const record = get().records.find((r) => r.id === id);
    if (!record) return;
    // A project this version cannot read (a later version wrote it) is never written over.
    if (!canOpen(record)) {
      detach(id, record.name);
      return;
    }
    fillPartData(record);
    const own = ownBuild(useDesignStore.getState().design);
    const file = projectFileOfDesign(own);
    if (file.design === record.file.design) {
      // The design on show is what the list holds: in step with it.
      known.set(id, record.modified);
      clearFailed(id);
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
    const expected = known.get(id) ?? record.modified;
    const next = recordOf(own, id, record.created, nextTime(Math.max(record.modified, expected)));
    const result = await commit(next, expected);
    if (result === 'ok') {
      clearFailed(id);
      return;
    }
    if (result === 'refused') {
      markFailed(id, record.name);
      return;
    }
    await reload();
    clearFailed(id);
    if (result === 'gone') {
      useDesignStore.getState().adoptProject(null);
      say(
        `Project "${record.name}" was deleted in another tab; your design is unsaved here now (the autosave keeps it). Save to projects keeps it again.`,
        true,
      );
      return;
    }
    await keepBoth(own, record.name);
  };

  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void exclusive(writeBackNow);
    }, WRITE_BACK_MS);
  };

  const flush = async (): Promise<void> => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    await exclusive(writeBackNow);
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

  /** Link a design of the start to a project (on show, or back in the history). */
  const linkStart = (shown: Design, record: ProjectRecord): void => {
    const store = useDesignStore.getState();
    if (store.design === shown) {
      store.adoptProject(record.id);
      writeOpenMark({ id: record.id, at: record.modified });
    } else {
      store.adoptProject(record.id, shown);
    }
  };

  /**
   * The autosave becomes the first project, once (docs/11 section 5). A tab claims the
   * migration in localStorage before it reads the list again, so two tabs starting together
   * make one project.
   */
  const migrate = async (
    s: ProjectStore,
    autosaved: Design | null | undefined,
    shown: Design | null | undefined,
  ): Promise<void> => {
    if (!s.persistent || get().records.length > 0 || get().skipped > 0) return;
    const claim = `claim ${Date.now()} ${newProjectId()}`;
    try {
      const flag = localStorage.getItem(MIGRATED_KEY);
      const claimedAt = flag?.startsWith('claim ') ? Number(flag.split(' ')[1]) : NaN;
      if (flag !== null && !(Date.now() - claimedAt > CLAIM_MS)) return;
      localStorage.setItem(MIGRATED_KEY, claim);
    } catch {
      return;
    }
    const finish = (done: boolean): void => {
      try {
        if (localStorage.getItem(MIGRATED_KEY) !== claim) return;
        if (done) localStorage.setItem(MIGRATED_KEY, '1');
        else localStorage.removeItem(MIGRATED_KEY);
      } catch {
        // The non-empty list keeps it from running again.
      }
    };
    if (!autosaved) {
      finish(true);
      return;
    }
    // Another tab may have migrated since this one read the list.
    let again: { records: ProjectRecord[]; skipped: number };
    try {
      again = await s.loadAll();
    } catch {
      finish(false);
      return;
    }
    if (again.records.length > 0 || again.skipped > 0) {
      for (const r of again.records) known.set(r.id, r.modified);
      set({ records: sortedByModified(again.records), skipped: again.skipped });
      finish(true);
      // The other tab's first project holds this autosave: the design is linked to it.
      const text = fileTextOf(autosaved);
      const same = again.records.find((r) => r.file.design === text);
      if (same && shown) linkStart(shown, same);
      return;
    }
    try {
      if (localStorage.getItem(MIGRATED_KEY) !== claim) return;
    } catch {
      return;
    }
    const now = Date.now();
    const record = recordOf(autosaved, newProjectId(), now, now);
    if (record.file.design.length > MAX_PROJECT_CHARS) {
      finish(true);
      return;
    }
    if ((await commit(record, null)) !== 'ok') {
      finish(false);
      return;
    }
    finish(true);
    track('project', 'migrate');
    if (shown) linkStart(shown, record);
    say(
      `Your design "${record.name}" is now the first project in File, Projects; changes are saved there as you work.`,
    );
  };

  /**
   * Whether a stored project holds exactly this design, read from the store (the list may be
   * older than it): the linked project first, then the projects the list says hold it.
   */
  const storedHolds = async (design: Design): Promise<boolean> => {
    const text = fileTextOf(design);
    const linked = openProjectId();
    const ids = [
      ...(linked ? [linked] : []),
      ...get()
        .records.filter((r) => r.file.design === text && r.id !== linked)
        .map((r) => r.id),
    ];
    for (const id of ids.slice(0, 4)) {
      try {
        const stored = await (await storeOf()).get(id);
        if (stored !== null && stored !== 'other' && stored.file.design === text) return true;
      } catch {
        // Not known to be held.
      }
    }
    return false;
  };

  /** The design on show has changes no project holds. */
  const hasUnstored = (): boolean => {
    const { design } = useDesignStore.getState();
    if (design.elements.length === 0) return false;
    const text = fileTextOf(design);
    return !get().records.some((r) => r.file.design === text);
  };

  return {
    records: [],
    ready: false,
    persistent: true,
    busy: false,
    problem: null,
    skipped: 0,
    detached: [],
    failed: null,
    lastExport: 0,
    exportedFiles: [],
    open: false,
    fromSettings: false,
    saving: false,
    setOpen: (open, fromSettings = false, saving = false) => {
      set({ open, fromSettings: open && fromSettings, saving: open && saving });
    },
    init: async (options = {}) => {
      if (options.store) backend = options.store;
      known.clear();
      removedKnown.clear();
      tooLargeSaid.clear();
      if (timer !== null) clearTimeout(timer);
      timer = null;
      writes = Promise.resolve();
      startMark = readOpenMark();
      set({
        ready: false,
        records: [],
        detached: [],
        problem: null,
        skipped: 0,
        failed: null,
        lastExport: readLastExport(),
        exportedFiles: [],
      });
      let s: ProjectStore;
      try {
        s = await storeOf();
        const { records, skipped } = await s.loadAll();
        for (const r of records) known.set(r.id, r.modified);
        // A project saved while the list was being read stays in it.
        const early = get().records.filter((e) => !records.some((r) => r.id === e.id));
        set({
          records: sortedByModified([...records, ...early]),
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
      // The autosave of the open project is based on the project's version in the mark: the
      // write-back writes it only when the project is still that version, else keeps both.
      const linked = useDesignStore.getState().projectId;
      if (linked && startMark?.id === linked) known.set(linked, startMark.at);
      set({ ready: true });
      watch();
      const record = linked ? get().records.find((r) => r.id === linked) : undefined;
      if (linked && record) {
        if (fillPartData(record) && startMark?.lean) {
          say(
            `The autosave of "${record.name}" had left out its parts' data for room; it is taken from the project again.`,
          );
        }
        await flush();
      } else if (linked && startMark?.id === linked && !get().busy && get().persistent) {
        useDesignStore.getState().adoptProject(null);
        say(
          'The project this design was saved in is no longer in the list (deleted in another tab?); the design is unsaved now and the autosave keeps it.',
        );
      }
      startMark = null;
    },
    saveCurrent: async () => {
      // A save before the list is read is written at once; the list read keeps it (init).
      const linked = openProjectId();
      if (linked) {
        const name = nameOf(linked) || useDesignStore.getState().design.name;
        return `"${name}" is in projects already; changes are saved there as you work`;
      }
      if (get().records.length >= MAX_PROJECTS) return tooMany;
      return exclusive(async () => {
        const now = nextTime();
        const record = recordOf(useDesignStore.getState().design, newProjectId(), now, now);
        if (record.file.design.length > MAX_PROJECT_CHARS) return `Not saved: ${tooLarge}`;
        const result = await commit(record, null);
        if (result === 'refused') return `Not saved: ${problemText()}`;
        if (result !== 'ok') return 'Not saved: the browser did not take it; try again';
        // The design on show and its steps since it was opened now belong to the project.
        useDesignStore.getState().adoptProject(record.id);
        writeOpenMark({ id: record.id, at: record.modified });
        set({ failed: null });
        track('project', 'save');
        return null;
      });
    },
    sameProject: () => {
      const text = fileTextOf(useDesignStore.getState().design);
      return get().records.find((r) => r.file.design === text) ?? null;
    },
    linkTo: (id) => {
      const record = get().records.find((r) => r.id === id);
      if (!record) return 'it is no longer in the list';
      if (fileTextOf(useDesignStore.getState().design) !== record.file.design) {
        return 'it holds another design now';
      }
      known.set(id, record.modified);
      set({ detached: get().detached.filter((d) => d !== id) });
      useDesignStore.getState().adoptProject(id);
      return null;
    },
    openProject: async (id) => {
      let record = get().records.find((r) => r.id === id);
      if (!record) return 'it is no longer in the list';
      await flush();
      // The stored record, which another tab may have written since the list was read.
      try {
        const stored = await (await storeOf()).get(id);
        if (stored === null) {
          await reload();
          return 'it is no longer in the list (deleted in another tab?)';
        }
        if (stored !== 'other') {
          record = stored;
          upsert(stored);
        }
      } catch {
        // The list's copy, then.
      }
      const checked = useDesignStore.getState().design;
      const held = await storedHolds(checked);
      const read = projectDesign(record);
      if ('problem' in read) return `this version cannot open it: ${read.problem}`;
      const store = useDesignStore.getState();
      const previous = store.design;
      const wasProject = openProjectId() !== null;
      // A design whose changes no stored project holds (unsaved, a write-back refused, too
      // large or overtaken, or its project deleted in another tab) is kept as a backup before
      // the project replaces it: the design itself, not the autosave, which another tab may
      // have written.
      const unstored = previous.elements.length > 0 && (previous !== checked || !held);
      const kept = unstored ? keepReplacedDesign(JSON.stringify(ownBuild(previous))) : null;
      const opened = openedDesign(read.value);
      known.set(id, record.modified);
      set({ detached: get().detached.filter((d) => d !== id) });
      store.loadDesign(opened.design, `Opened project "${record.name}"`, id);
      const what = wasProject
        ? `your changes to "${previous.name}" that its project does not hold`
        : `your unsaved design "${previous.name}"`;
      const them = wasProject ? 'them' : 'it';
      const tail = !unstored
        ? ' Undo brings back the previous design.'
        : kept?.key
          ? ` ${what} ${wasProject ? 'are' : 'is'} kept in this browser: Undo brings ${them} back now, and Settings, Data in this browser, opens ${them} later.`
          : ` Undo brings back ${what}; save ${them} before you close the tab.`;
      useDesignStore
        .getState()
        .setMessage(
          `Opened project "${record.name}".${tail.replace(/^ y/, ' Y')}${opened.notice ? ` ${opened.notice}` : ''}`,
          { undo: true },
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
        return get().failed === id ? problemText() : null;
      }
      return exclusive(async () => {
        // The stored record is renamed, read just before: never this tab's older copy of it.
        for (let attempt = 0; attempt < 3; attempt++) {
          let stored: ProjectRecord | null | 'other';
          try {
            stored = await (await storeOf()).get(id);
          } catch (err) {
            refused(err);
            return problemText();
          }
          if (stored === null) {
            await reload();
            return 'it is no longer in the list (deleted in another tab?)';
          }
          const read = stored === 'other' ? null : projectDesign(stored);
          if (stored === 'other' || !read || 'problem' in read) {
            return 'this version cannot open it, so it cannot rename it';
          }
          const next = recordOf(
            { ...read.value, name },
            id,
            stored.created,
            nextTime(stored.modified),
          );
          const result = await commit(next, stored.modified);
          if (result === 'ok') {
            track('project', 'rename');
            return null;
          }
          if (result === 'refused') return problemText();
          // Changed or deleted between the read and the write: read it again.
        }
        await reload();
        return 'another tab keeps changing it; try again';
      });
    },
    duplicate: async (id) => {
      if (!get().records.some((r) => r.id === id))
        return { problem: 'it is no longer in the list' };
      if (get().records.length >= MAX_PROJECTS) return { problem: tooMany };
      if (openProjectId() === id) await flush();
      return exclusive(async () => {
        let source = get().records.find((r) => r.id === id);
        try {
          const stored = await (await storeOf()).get(id);
          if (stored !== null && stored !== 'other') source = stored;
        } catch {
          // The list's copy, then.
        }
        if (!source) return { problem: 'it is no longer in the list' };
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
        const result = await commit(next, null);
        if (result === 'refused') return { problem: problemText() };
        if (result !== 'ok') return { problem: 'the browser did not take it; try again' };
        track('project', 'duplicate');
        return { id: next.id };
      });
    },
    remove: async (id) => {
      if (!get().records.some((r) => r.id === id)) return null;
      return exclusive(async () => {
        const listed = get().records.find((r) => r.id === id);
        if (!listed) return null;
        if (openProjectId() === id && timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        const s = await storeOf();
        // The record as stored is what Undo puts back: the latest write-back is in it.
        let stored: ProjectRecord | null = null;
        try {
          const got = await s.get(id);
          if (got !== null && got !== 'other') stored = got;
        } catch {
          // The list's copy, then.
        }
        try {
          await s.remove(id);
        } catch (err) {
          refused(err);
          return null;
        }
        removedKnown.set(id, known.get(id) ?? 0);
        known.delete(id);
        set({ records: get().records.filter((r) => r.id !== id) });
        clearFailed(id);
        track('project', 'delete', countBucket(1));
        return stored ?? listed;
      });
    },
    restore: (records) =>
      exclusive(async () => {
        for (const record of records) {
          if (get().records.some((r) => r.id === record.id)) continue;
          // Dated now, so a tab that knew the record before the delete does not write over it.
          const back = { ...record, modified: nextTime(record.modified) };
          const knew = removedKnown.get(record.id);
          const result = await commit(back, null);
          if (result === 'ok') {
            removedKnown.delete(record.id);
            // A record another tab had written last is not this tab's line of edits: a design
            // here linked to it is not written over it (the write-back keeps both).
            if (knew !== record.modified) known.set(record.id, knew ?? 0);
          } else if (result === 'changed') {
            // Something is stored under its id since: both are kept.
            const now = nextTime();
            const name = copyName(
              record.name,
              get().records.map((r) => r.name),
              FROM_THIS_TAB,
            );
            await commit({ ...back, id: newProjectId(), name, created: now, modified: now }, null);
          }
        }
        // The design on show, if it was the deleted project, is written back to it again.
        schedule();
      }),
    importFiles: (files) =>
      exclusive(async () => {
        let added = 0;
        let duplicates = 0;
        let unreadable = 0;
        let damaged = 0;
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
            const result = await commit(record, null);
            if (result !== 'ok') {
              failed.push({
                fileName: f.name,
                reason: result === 'refused' ? problemText() : 'the browser did not take it',
              });
              break;
            }
            added++;
            if (entry.damaged) damaged++;
            else if (!entry.readable) unreadable++;
          }
        }
        if (added > 0) track('project', 'import', countBucket(added));
        return { added, duplicates, unreadable, damaged, overLimit, skipped, failed };
      }),
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
      const parts = projectsFileParts(sortedByModified(records));
      const names = parts.map((_, i) =>
        parts.length === 1
          ? `smithonline-projects-${day}`
          : `smithonline-projects-${day}-part-${i + 1}-of-${parts.length}`,
      );
      parts.forEach((part, i) => exportJson(part, names[i] ?? `smithonline-projects-${day}`));
      const at = Date.now();
      try {
        localStorage.setItem(EXPORTED_KEY, String(at));
      } catch {
        // Shown for this page only.
      }
      set({ lastExport: at, exportedFiles: names.map((n) => `${n}.json`) });
      track('project', 'export_all', countBucket(records.length));
      return records.length;
    },
    flush,
    hasUnstored,
  };
});
