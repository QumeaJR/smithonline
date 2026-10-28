/**
 * Where the local projects live (docs/11): the browser's IndexedDB, like the part library.
 * Nothing leaves the browser. Where IndexedDB is missing or refuses (a private window, the
 * tests), the projects are kept in memory for the session and `persistent` says so.
 *
 * Every record read back is checked field by field (projectRecordOf): a record that is not a
 * project is skipped and counted, never shown and never deleted. The design itself is read
 * only when it is opened, with the reader of File, Open.
 */
import { evaluateLadder } from '@smithonline/core';
import { MAX_DESIGN_NAME, type Design } from './design';
import { effectiveElements, designLadder } from './realize';
import { designFileObject, readDesign } from './share';

/** A design file as File, Save as Smith Online writes it. */
export interface ProjectFile {
  readonly app: 'Smith Online';
  readonly version: number;
  readonly design: string;
}

/** One project, as stored. */
export interface ProjectRecord {
  readonly id: string;
  readonly name: string;
  /** ms since 1970. */
  readonly created: number;
  readonly modified: number;
  readonly file: ProjectFile;
  /** SVG path of the network's trace in a 2 by 2 box (thumbOf). */
  readonly thumb?: string;
  /** The version that last wrote it. */
  readonly appVersion?: string;
}

/** Most projects the list keeps. */
export const MAX_PROJECTS = 500;
/** Largest design file a project holds, characters. */
export const MAX_PROJECT_CHARS = 20 * 1024 * 1024;
/**
 * Largest file Import reads, characters: above one part of Export all (EXPORT_PART_CHARS) and
 * above the largest project as a file can grow (a 20 MB design, escaped), so every backup the
 * app writes imports again.
 */
export const MAX_IMPORT_CHARS = 128 * 1024 * 1024;
/** Export all starts a new numbered file before one would pass this, characters. */
export const EXPORT_PART_CHARS = 90 * 1024 * 1024;
/** Latest modified time taken as a time (the year 2286); a later one reads as unknown (0). */
export const MAX_TIME = 1e13;
/** Longest thumbnail path kept. */
export const MAX_THUMB = 4000;

const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const THUMB_RE = /^[ML0-9 .-]*$/;
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

/** A new project id: `p-` and 16 hex digits. */
export function newProjectId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return `p-${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * A name as a project keeps it: no control characters (C0, C1, line and paragraph separators),
 * no direction marks, overrides or isolates, at most MAX_DESIGN_NAME.
 */
export function cleanProjectName(name: string): string {
  let out = '';
  let space = false;
  for (const ch of name) {
    const c = ch.codePointAt(0) ?? 0;
    // Direction marks, embeddings, overrides and isolates: left out.
    if (
      (c >= 0x200e && c <= 0x200f) ||
      (c >= 0x202a && c <= 0x202e) ||
      (c >= 0x2066 && c <= 0x2069)
    ) {
      continue;
    }
    // C0 and C1 controls, line and paragraph separators: one space for a run of them.
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029) {
      if (!space) out += ' ';
      space = true;
      continue;
    }
    space = false;
    out += ch;
  }
  return out.slice(0, MAX_DESIGN_NAME);
}

/** A time as kept: finite, positive and at most MAX_TIME; else 0 (unknown). */
const time = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_TIME ? v : 0;

/** The design file of a record or an import, checked; null when it is not one. */
export function projectFileOf(raw: unknown): ProjectFile | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.app !== 'Smith Online' || typeof r.design !== 'string') return null;
  if (r.design.length > MAX_PROJECT_CHARS) return null;
  const version = typeof r.version === 'number' && Number.isFinite(r.version) ? r.version : 1;
  return { app: 'Smith Online', version, design: r.design };
}

/** A stored record checked field by field; null when it is not a project. */
export function projectRecordOf(raw: unknown): ProjectRecord | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !ID_RE.test(r.id)) return null;
  const file = projectFileOf(r.file);
  if (!file) return null;
  const name = typeof r.name === 'string' ? cleanProjectName(r.name) : '';
  const thumb =
    typeof r.thumb === 'string' && r.thumb.length <= MAX_THUMB && THUMB_RE.test(r.thumb)
      ? r.thumb
      : undefined;
  const appVersion =
    typeof r.appVersion === 'string' && VERSION_RE.test(r.appVersion) ? r.appVersion : undefined;
  return {
    id: r.id,
    name: name.trim() ? name : 'Untitled',
    created: time(r.created),
    modified: time(r.modified),
    file,
    ...(thumb !== undefined ? { thumb } : {}),
    ...(appVersion !== undefined ? { appVersion } : {}),
  };
}

/** The design of a project, or why this version cannot open it. */
export function projectDesign(
  record: Pick<ProjectRecord, 'file'>,
): { value: Design } | { problem: string } {
  try {
    return readDesign(record.file.design);
  } catch {
    return { problem: 'the design in it cannot be read' };
  }
}

/** The design file of a design, as a project keeps it (designFileObject). */
export function projectFileOfDesign(design: Design): ProjectFile {
  return designFileObject(design);
}

const r3 = (v: number): string => {
  const s = (Math.round(v * 1000) / 1000).toString();
  return s === '-0' ? '0' : s;
};

/**
 * The network's trace at the design frequency, the load then each element's arc, as an SVG
 * path on the unit circle (y up is -y in the path). Undefined when the network cannot be
 * evaluated or the path would be too long.
 */
export function thumbOf(design: Design): string | undefined {
  try {
    const r = evaluateLadder(designLadder(design, effectiveElements(design)), { arcSteps: 12 });
    const z0 = design.z0;
    const gamma = (z: { re: number; im: number }): [number, number] | null => {
      const dr = z.re + z0;
      const den = dr * dr + z.im * z.im;
      if (!(den > 0) || !Number.isFinite(den)) return null;
      const nr = z.re - z0;
      const re = (nr * dr + z.im * z.im) / den;
      const im = (z.im * dr - nr * z.im) / den;
      if (!Number.isFinite(re) || !Number.isFinite(im)) return null;
      return [Math.max(-1, Math.min(1, re)), Math.max(-1, Math.min(1, -im))];
    };
    const parts: string[] = [];
    const start = gamma(design.load);
    if (start) parts.push(`M${r3(start[0])} ${r3(start[1])}`);
    for (const arc of r.arcs) {
      for (const z of arc) {
        const g = gamma(z);
        if (g) parts.push(`${parts.length === 0 ? 'M' : 'L'}${r3(g[0])} ${r3(g[1])}`);
      }
    }
    const path = parts.join('');
    return path.length > 0 && path.length <= MAX_THUMB && THUMB_RE.test(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

/** The file Export all writes. */
export interface ProjectsFile {
  readonly app: 'Smith Online';
  readonly kind: 'projects';
  readonly version: 1;
  readonly exported: string;
  readonly projects: readonly {
    readonly name: string;
    readonly created: number;
    readonly modified: number;
    readonly file: ProjectFile;
  }[];
}

/** Every project as stored, the unreadable ones too (Export all). */
export function projectsFileObject(
  records: readonly ProjectRecord[],
  now = new Date(),
): ProjectsFile {
  return {
    app: 'Smith Online',
    kind: 'projects',
    version: 1,
    exported: now.toISOString(),
    projects: records.map((r) => ({
      name: r.name,
      created: r.created,
      modified: r.modified,
      file: r.file,
    })),
  };
}

/**
 * Export all in parts: each part a whole Export all file of at most `limit` characters as
 * exportJson writes it (indented), so each imports again (MAX_IMPORT_CHARS). A project larger
 * than the limit on its own goes in a part of its own (at most 6 times 20 MB escaped, still under
 * MAX_IMPORT_CHARS).
 */
export function projectsFileParts(
  records: readonly ProjectRecord[],
  now = new Date(),
  limit = EXPORT_PART_CHARS,
): ProjectsFile[] {
  /** The head, the brackets and the indentation of one entry, characters, generously. */
  const HEAD = 1024;
  const PER_ENTRY = 512;
  const parts: ProjectRecord[][] = [];
  let part: ProjectRecord[] = [];
  let size = HEAD;
  for (const r of records) {
    const n = JSON.stringify(r.file.design).length + r.name.length * 6 + PER_ENTRY;
    if (part.length > 0 && size + n > limit) {
      parts.push(part);
      part = [];
      size = HEAD;
    }
    part.push(r);
    size += n;
  }
  if (part.length > 0) parts.push(part);
  return parts.map((p) => projectsFileObject(p, now));
}

/** True when a JSON value is an Export all file. */
export function isProjectsFile(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
  const r = raw as Record<string, unknown>;
  return r.app === 'Smith Online' && r.kind === 'projects' && Array.isArray(r.projects);
}

/** One project an import adds. `readable` false: this version cannot open it (kept as is). */
export interface ImportEntry {
  readonly name: string;
  readonly created: number;
  readonly modified: number;
  readonly file: ProjectFile;
  readonly readable: boolean;
  /** Not readable because it is damaged (cannot be decoded), not because a later version wrote it. */
  readonly damaged: boolean;
}

/** True when a design this version cannot open is damaged rather than from a later version. */
export function isDamaged(problem: string): boolean {
  return /damaged/.test(problem);
}

/** The name of a file without its extension. */
const baseName = (fileName: string): string => fileName.replace(/\.[^.]*$/, '') || fileName;

/**
 * The projects in an imported .json file: one for a design file, one per entry of an Export
 * all file; or the reason the file is not a Smith Online file. A Smith Online design this
 * version cannot read is kept, marked unreadable, not refused.
 */
export function readImportText(
  text: string,
  fileName: string,
  now = Date.now(),
): { entries: ImportEntry[]; skipped: number } | { problem: string } {
  if (text.length > MAX_IMPORT_CHARS) return { problem: 'larger than 128 MB' };
  if (text.trim() === '') return { problem: 'the file is empty' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { problem: 'the file is not JSON (it may be cut short)' };
  }
  /**
   * One entry. Its design is decoded only when needed: for its name when the file gives none,
   * and for `readable` and `damaged` when the import keeps it (at most MAX_PROJECTS of a file
   * that may hold many more).
   */
  const entryOf = (
    file: ProjectFile,
    name: unknown,
    created: unknown,
    modified: unknown,
  ): ImportEntry => {
    let read: ReturnType<typeof projectDesign> | null = null;
    const decoded = (): ReturnType<typeof projectDesign> => (read ??= projectDesign({ file }));
    const given = typeof name === 'string' && name.trim() ? name : null;
    const first =
      given ??
      (() => {
        const r = decoded();
        return 'value' in r ? r.value.name : baseName(fileName);
      })();
    const clean = cleanProjectName(first);
    return {
      name: clean.trim() ? clean : 'Untitled',
      created: time(created) || now,
      modified: time(modified) || now,
      file,
      get readable() {
        return 'value' in decoded();
      },
      get damaged() {
        const r = decoded();
        return 'problem' in r && file.version <= 1 && isDamaged(r.problem);
      },
    };
  };
  if (isProjectsFile(raw)) {
    const list = (raw as { projects: unknown[] }).projects;
    const entries: ImportEntry[] = [];
    let skipped = 0;
    for (const item of list) {
      const p = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
      const file = projectFileOf(p.file);
      if (!file) {
        skipped++;
        continue;
      }
      entries.push(entryOf(file, p.name, p.created, p.modified));
    }
    if (entries.length === 0) return { problem: 'the list of projects in it is empty' };
    return { entries, skipped };
  }
  const file = projectFileOf(raw);
  if (file) return { entries: [entryOf(file, undefined, undefined, undefined)], skipped: 0 };
  if (
    typeof raw === 'object' &&
    raw !== null &&
    (raw as Record<string, unknown>).app === 'Smith Online' &&
    typeof (raw as Record<string, unknown>).design === 'string'
  ) {
    return { problem: 'the design in it is larger than 20 MB' };
  }
  return { problem: 'not a Smith Online design file' };
}

/* ---------------------------------------------------------------------------------------------
 * The stores
 * ------------------------------------------------------------------------------------------- */

/** The browser refused a write for lack of space. */
export class StoreFullError extends Error {}
/** IndexedDB did not answer: blocked by another tab, or no answer in time. */
export class ProjectsBusyError extends Error {}

/** What a checked write found: written, or the record changed (or went) since it was known. */
export type PutResult = 'ok' | 'changed' | 'gone';

export interface ProjectStore {
  /** False when the projects last only as long as the page (no IndexedDB). */
  readonly persistent: boolean;
  /** True for the memory store standing in because IndexedDB did not answer. */
  readonly busy?: boolean;
  loadAll: () => Promise<{ records: ProjectRecord[]; skipped: number }>;
  /** The stored record of an id: null when there is none, 'other' when it is not a project. */
  get: (id: string) => Promise<ProjectRecord | null | 'other'>;
  /** Write a record; throws StoreFullError when the browser has no room. */
  put: (record: ProjectRecord) => Promise<void>;
  /**
   * The one checked write. With a number, the record is written only when the stored one still
   * has `expected` as its modified time ('changed' when it has another, 'gone' when it is no
   * longer there or is not a project). With null, only when nothing is stored under its id
   * ('changed' otherwise). Throws StoreFullError when the browser has no room.
   */
  putIfUnchanged: (record: ProjectRecord, expected: number | null) => Promise<PutResult>;
  remove: (id: string) => Promise<void>;
}

function collect(raw: readonly unknown[]): { records: ProjectRecord[]; skipped: number } {
  const records: ProjectRecord[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const r of raw) {
    const p = projectRecordOf(r);
    if (!p || seen.has(p.id)) {
      skipped++;
      continue;
    }
    seen.add(p.id);
    records.push(p);
  }
  return { records, skipped };
}

/** What the checked write does with what is stored under the id: write, or why not. */
function checkStored(raw: unknown, expected: number | null): PutResult {
  if (expected === null) return raw === undefined ? 'ok' : 'changed';
  const stored = projectRecordOf(raw);
  if (!stored) return 'gone';
  return stored.modified === expected ? 'ok' : 'changed';
}

/** A stored value as `get` reports it. */
const gotten = (raw: unknown): ProjectRecord | null | 'other' =>
  raw === undefined ? null : (projectRecordOf(raw) ?? 'other');

const isQuota = (err: unknown): boolean =>
  err instanceof StoreFullError ||
  (typeof err === 'object' &&
    err !== null &&
    ((err as { name?: unknown }).name === 'QuotaExceededError' ||
      (err as { code?: unknown }).code === 22));

/** A refused write as the store reports it: StoreFullError for space, else the error. */
function asStoreError(err: unknown): Error {
  if (isQuota(err)) return err instanceof StoreFullError ? err : new StoreFullError('full');
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * A store in memory: for a browser without IndexedDB, and for the tests. `refuse` (tests) makes
 * a write throw what it returns.
 */
export function memoryProjectStore(
  initial: readonly unknown[] = [],
  refuse?: (record: ProjectRecord) => Error | null,
): ProjectStore {
  const records = new Map<string, unknown>();
  for (const r of initial) {
    const id = (r as { id?: unknown } | null)?.id;
    records.set(typeof id === 'string' ? id : `#${records.size}`, r);
  }
  const check = (record: ProjectRecord): void => {
    const err = refuse?.(record);
    if (err) throw asStoreError(err);
  };
  return {
    persistent: false,
    loadAll: () => Promise.resolve(collect([...records.values()])),
    get: (id) => Promise.resolve(gotten(records.get(id))),
    put: (record) => {
      try {
        check(record);
      } catch (err) {
        return Promise.reject(err as Error);
      }
      records.set(record.id, record);
      return Promise.resolve();
    },
    putIfUnchanged: (record, expected) => {
      const found = checkStored(records.get(record.id), expected);
      if (found !== 'ok') return Promise.resolve(found);
      try {
        check(record);
      } catch (err) {
        return Promise.reject(err as Error);
      }
      records.set(record.id, record);
      return Promise.resolve('ok');
    },
    remove: (id) => {
      records.delete(id);
      return Promise.resolve();
    },
  };
}

const DB_NAME = 'smithonline-projects';
const STORE = 'projects';
/** How long the list waits for IndexedDB to open before it goes on in memory, ms. */
export const OPEN_TIMEOUT_MS = 5000;

function openDb(factory: IDBFactory, onClosed: () => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new ProjectsBusyError('IndexedDB did not answer')),
      OPEN_TIMEOUT_MS,
    );
    const req = factory.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => {
      clearTimeout(timer);
      const db = req.result;
      // Another tab upgrades the database: let it, and open it again on the next use.
      db.onversionchange = () => {
        db.close();
        onClosed();
      };
      resolve(db);
    };
    req.onerror = () => {
      clearTimeout(timer);
      reject(req.error ?? new Error('IndexedDB could not be opened'));
    };
    req.onblocked = () => {
      clearTimeout(timer);
      reject(new ProjectsBusyError('IndexedDB is blocked by another tab'));
    };
  });
}

/** The IndexedDB store, or null when the browser has none. */
export function indexedDbProjectStore(factory: IDBFactory | undefined): ProjectStore | null {
  if (!factory) return null;
  let db: Promise<IDBDatabase> | null = null;
  const database = (): Promise<IDBDatabase> => {
    const opening = (db ??= openDb(factory, () => {
      if (db === opening) db = null;
    }));
    // A failed open is tried again on the next use.
    opening.catch(() => {
      if (db === opening) db = null;
    });
    return opening;
  };
  /** A transaction on the open database; a connection closed under it is opened again, once. */
  const transaction = async (mode: IDBTransactionMode): Promise<IDBTransaction> => {
    const d = await database();
    try {
      return d.transaction(STORE, mode);
    } catch (err) {
      if ((err as { name?: unknown } | null)?.name !== 'InvalidStateError') throw err;
      db = null;
      return (await database()).transaction(STORE, mode);
    }
  };
  /** Run `fn` in one transaction; resolves with its result once the transaction completes. */
  const tx = async <T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore, done: (value: T) => void) => void,
  ): Promise<T> => {
    let t: IDBTransaction;
    try {
      t = await transaction(mode);
    } catch (err) {
      throw asStoreError(err);
    }
    return new Promise<T>((resolve, reject) => {
      let result: T | undefined;
      t.oncomplete = () => resolve(result as T);
      t.onerror = () => reject(asStoreError(t.error ?? new Error('IndexedDB transaction failed')));
      t.onabort = () => reject(asStoreError(t.error ?? new Error('IndexedDB transaction aborted')));
      try {
        fn(t.objectStore(STORE), (value) => {
          result = value;
        });
      } catch (err) {
        reject(asStoreError(err));
        try {
          t.abort();
        } catch {
          // already finished
        }
      }
    });
  };
  return {
    persistent: true,
    loadAll: async () => {
      const raw = await tx<unknown[]>('readonly', (s, done) => {
        const req = s.getAll();
        req.onsuccess = () => done(req.result as unknown[]);
      });
      return collect(raw ?? []);
    },
    get: async (id) =>
      gotten(
        await tx<unknown>('readonly', (s, done) => {
          const req = s.get(id);
          req.onsuccess = () => done(req.result);
        }),
      ),
    put: async (record) => {
      await tx<void>('readwrite', (s) => {
        s.put(record);
      });
    },
    putIfUnchanged: (record, expected) =>
      tx<PutResult>('readwrite', (s, done) => {
        const get = s.get(record.id);
        get.onsuccess = () => {
          const found = checkStored(get.result, expected);
          if (found === 'ok') s.put(record);
          done(found);
        };
      }),
    remove: async (id) => {
      await tx<void>('readwrite', (s) => {
        s.delete(id);
      });
    },
  };
}

/** The store this browser offers: IndexedDB when it can be opened, else memory. */
export async function browserProjectStore(): Promise<ProjectStore> {
  try {
    const store = indexedDbProjectStore(
      typeof indexedDB === 'undefined' ? undefined : (indexedDB as IDBFactory),
    );
    if (store) {
      // Opening proves it works (a private window may refuse).
      await store.loadAll();
      return store;
    }
  } catch (err) {
    if (err instanceof ProjectsBusyError) return { ...memoryProjectStore(), busy: true };
  }
  return memoryProjectStore();
}
