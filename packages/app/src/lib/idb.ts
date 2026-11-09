/** The IndexedDB connection the part library and the local projects share the rules of. */

/** How long a store waits for IndexedDB to open before it goes on in memory, ms. */
export const OPEN_TIMEOUT_MS = 5000;

/** IndexedDB did not answer: blocked by another tab, or no answer in time. */
export class IdbBusyError extends Error {}

function openDb(
  factory: IDBFactory,
  name: string,
  store: string,
  keyPath: string,
  onClosed: () => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // A request another tab blocks may never settle: the store does not wait for it forever.
    const timer = setTimeout(
      () => reject(new IdbBusyError('IndexedDB did not answer')),
      OPEN_TIMEOUT_MS,
    );
    const req = factory.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath });
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
      reject(new IdbBusyError('IndexedDB is blocked by another tab'));
    };
  });
}

/**
 * Transactions on one object store of database `name`. A failed open is tried again on the next
 * use, and a connection closed under it (another tab's upgrade) is opened again, once.
 */
export function idbTransactions(
  factory: IDBFactory,
  name: string,
  store: string,
  keyPath: string,
): (mode: IDBTransactionMode) => Promise<IDBTransaction> {
  let db: Promise<IDBDatabase> | null = null;
  const database = (): Promise<IDBDatabase> => {
    const opening = (db ??= openDb(factory, name, store, keyPath, () => {
      if (db === opening) db = null;
    }));
    opening.catch(() => {
      if (db === opening) db = null;
    });
    return opening;
  };
  return async (mode) => {
    const d = await database();
    try {
      return d.transaction(store, mode);
    } catch (err) {
      if ((err as { name?: unknown } | null)?.name !== 'InvalidStateError') throw err;
      db = null;
      return (await database()).transaction(store, mode);
    }
  };
}
