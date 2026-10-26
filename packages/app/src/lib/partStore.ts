/**
 * Where the part library lives: the browser's IndexedDB (a vendor file can
 * hold thousands of frequencies, too much for localStorage). Nothing leaves
 * the browser. Where IndexedDB is missing or refuses (a private window, the
 * tests), the parts are kept in memory for the session and `persistent` says
 * so.
 *
 * Every record read back goes through core's `libraryPartOf`, like a share
 * link or a file: a record that is not a valid part is skipped and counted,
 * never shown.
 */
import { libraryPartOf, partKey, type LibraryPart } from '@smithonline/core';

/** One part in the library, as stored. */
export interface StoredPart {
  /** partKey of the part: manufacturer and part number. */
  readonly key: string;
  readonly part: LibraryPart;
  /** The file it was read from. */
  readonly fileName: string;
  /** When it was added, ms since 1970. */
  readonly added: number;
}

export interface PartStore {
  /** False when the parts last only as long as the page (no IndexedDB). */
  readonly persistent: boolean;
  /**
   * True for the memory store that stands in because IndexedDB did not answer (blocked by another
   * tab, or no answer within OPEN_TIMEOUT_MS): the stored parts are there, but out of reach now.
   */
  readonly busy?: boolean;
  /** Every valid stored part, and how many records were skipped as invalid. */
  loadAll: () => Promise<{ parts: StoredPart[]; skipped: number }>;
  put: (record: StoredPart) => Promise<void>;
  remove: (key: string) => Promise<void>;
}

const DB_NAME = 'smithonline-parts';
const STORE = 'parts';
const MAX_FILE_NAME = 200;

/** A stored record checked field by field; null when it is not a part. */
export function storedPartOf(raw: unknown): StoredPart | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const part = libraryPartOf(r.part);
  if (!part) return null;
  return {
    key: partKey(part),
    part,
    fileName: typeof r.fileName === 'string' ? r.fileName.slice(0, MAX_FILE_NAME) : '',
    added: typeof r.added === 'number' && Number.isFinite(r.added) ? r.added : 0,
  };
}

/** A store in memory: for a browser without IndexedDB, and for the tests. */
export function memoryPartStore(initial: readonly unknown[] = []): PartStore {
  const records = new Map<string, unknown>();
  for (const r of initial) {
    const key = (r as { key?: unknown } | null)?.key;
    records.set(typeof key === 'string' ? key : String(records.size), r);
  }
  return {
    persistent: false,
    loadAll: () => Promise.resolve(collect([...records.values()])),
    put: (record) => {
      records.set(record.key, record);
      return Promise.resolve();
    },
    remove: (key) => {
      records.delete(key);
      return Promise.resolve();
    },
  };
}

function collect(raw: readonly unknown[]): { parts: StoredPart[]; skipped: number } {
  const parts: StoredPart[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const r of raw) {
    const p = storedPartOf(r);
    if (!p || seen.has(p.key)) {
      skipped += p ? 0 : 1;
      continue;
    }
    seen.add(p.key);
    parts.push(p);
  }
  parts.sort((a, b) => a.part.partNumber.localeCompare(b.part.partNumber));
  return { parts, skipped };
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/** How long the library waits for IndexedDB to open before it goes on in memory, ms. */
export const OPEN_TIMEOUT_MS = 5000;

/** IndexedDB did not answer: blocked by another tab, or no answer in time. */
export class StoreBusyError extends Error {}

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // A request another tab blocks may never settle: the library does not wait for it forever.
    const timer = setTimeout(
      () => reject(new StoreBusyError('IndexedDB did not answer')),
      OPEN_TIMEOUT_MS,
    );
    const req = factory.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => {
      clearTimeout(timer);
      const db = req.result;
      // A newer version opened in another tab: this tab lets go rather than block it.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => {
      clearTimeout(timer);
      reject(req.error ?? new Error('IndexedDB could not be opened'));
    };
    req.onblocked = () => {
      clearTimeout(timer);
      reject(new StoreBusyError('IndexedDB is blocked by another tab'));
    };
  });
}

/** The IndexedDB store, or null when the browser has none. */
export function indexedDbPartStore(factory: IDBFactory | undefined): PartStore | null {
  if (!factory) return null;
  let db: Promise<IDBDatabase> | null = null;
  const database = (): Promise<IDBDatabase> => {
    db ??= openDb(factory);
    return db;
  };
  const tx = async <T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const d = await database();
    const t = d.transaction(STORE, mode);
    const done = new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error ?? new Error('IndexedDB transaction failed'));
      t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted'));
    });
    const [result] = await Promise.all([request(fn(t.objectStore(STORE))), done]);
    return result;
  };
  return {
    persistent: true,
    loadAll: async () => collect(await tx('readonly', (s) => s.getAll() as IDBRequest<unknown[]>)),
    put: async (record) => {
      await tx('readwrite', (s) => s.put(record));
    },
    remove: async (key) => {
      await tx('readwrite', (s) => s.delete(key));
    },
  };
}

/** The store this browser offers: IndexedDB when it can be opened, else memory. */
export async function browserPartStore(): Promise<PartStore> {
  try {
    const store = indexedDbPartStore(
      typeof indexedDB === 'undefined' ? undefined : (indexedDB as IDBFactory),
    );
    if (store) {
      // Opening proves it works (a private window may refuse).
      await store.loadAll();
      return store;
    }
  } catch (err) {
    // Blocked or no answer: memory for now, and the library says why.
    if (err instanceof StoreBusyError) return { ...memoryPartStore(), busy: true };
  }
  return memoryPartStore();
}
