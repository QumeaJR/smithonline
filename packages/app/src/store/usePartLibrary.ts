import {
  cleanPartName,
  partKey,
  PartFileError,
  readPartFile,
  SYNTHETIC_PARTS,
  syntheticPart,
  TouchstoneError,
  withFixture,
  type LibraryPart,
  type PartFixture,
} from '@smithonline/core';
import { create } from 'zustand';
import { browserPartStore, type PartStore, type StoredPart } from '../lib/partStore';

/**
 * The part library (phase D5): real parts read from the S-parameter files
 * their manufacturers publish, which the user downloads and loads here. The
 * app bundles no vendor data. Like the board and the package table it belongs
 * to the browser, not to one design; a design that uses a part carries its
 * own copy (lib/share.ts), so it reopens complete elsewhere.
 */
export interface PartLibraryState {
  parts: readonly StoredPart[];
  /** The stored parts have been read. */
  ready: boolean;
  /** False when the parts last only as long as the page (no IndexedDB in this browser). */
  persistent: boolean;
  /** The Part library dialog is open. */
  open: boolean;
  /** Settings opened the dialog (Libraries, Manage…): closing it goes back there. */
  fromSettings: boolean;
  setOpen: (open: boolean, fromSettings?: boolean) => void;
  /** Read the stored parts (once at startup; tests pass a memory store). */
  init: (store?: PartStore) => Promise<void>;
  /** Read part files and add them; a part already in the library is replaced. */
  addFiles: (files: readonly PartFileText[]) => Promise<AddReport>;
  /**
   * Add parts as they are (the synthetic examples), up to MAX_LIBRARY_PARTS; a part already in
   * the library is replaced. Returns how many were added and how many the limit left out.
   */
  addParts: (
    parts: readonly { part: LibraryPart; fileName: string }[],
  ) => Promise<{ added: number; skipped: number }>;
  /** Remove a part; returns its record (for Undo), or null when it was not there. */
  remove: (key: string) => Promise<StoredPart | null>;
  /** Remove every part; returns the records (for Undo). */
  removeAll: () => Promise<StoredPart[]>;
  /** Put removed records back (Undo of a removal), up to MAX_LIBRARY_PARTS. */
  restore: (records: readonly StoredPart[]) => Promise<void>;
  /** Read a part's data as the other fixture; the reason when the data cannot be read that way. */
  setFixture: (key: string, fixture: PartFixture) => Promise<string | null>;
  /** Change a part's manufacturer and part number; the reason when the new name is refused. */
  rename: (
    key: string,
    names: { manufacturer: string; partNumber: string },
  ) => Promise<string | null>;
}

export interface PartFileText {
  readonly name: string;
  readonly text: string;
}

export interface AddReport {
  /** Part numbers added. */
  readonly added: readonly string[];
  /** Part numbers that replaced a part of the same name. */
  readonly replaced: readonly string[];
  /** Files that could not be read, with the reason. */
  readonly failed: readonly { readonly fileName: string; readonly reason: string }[];
  /** Part numbers whose fixture was a guess (check it in the list). */
  readonly unsure: readonly string[];
}

/** Most parts the library keeps. */
export const MAX_LIBRARY_PARTS = 500;
/** Largest part file read, characters. */
export const MAX_PART_FILE = 16 * 1024 * 1024;

let backend: PartStore | null = null;

async function storeOf(): Promise<PartStore> {
  backend ??= await browserPartStore();
  return backend;
}

const sorted = (parts: readonly StoredPart[]): StoredPart[] =>
  [...parts].sort((a, b) => a.part.partNumber.localeCompare(b.part.partNumber));

export const usePartLibrary = create<PartLibraryState>()((set, get) => {
  const save = async (record: StoredPart): Promise<void> => {
    try {
      await (await storeOf()).put(record);
    } catch {
      // Quota or a refusing browser: the part stays for this session.
      set({ persistent: false });
    }
  };
  const upsert = (record: StoredPart): void => {
    set({ parts: sorted([...get().parts.filter((p) => p.key !== record.key), record]) });
  };
  return {
    parts: [],
    ready: false,
    persistent: true,
    open: false,
    fromSettings: false,
    setOpen: (open, fromSettings = false) => set({ open, fromSettings: open && fromSettings }),
    init: async (store) => {
      if (store) backend = store;
      try {
        const s = await storeOf();
        const { parts } = await s.loadAll();
        set({ parts: sorted(parts), ready: true, persistent: s.persistent });
      } catch {
        set({ ready: true, persistent: false });
      }
    },
    addFiles: async (files) => {
      const added: string[] = [];
      const replaced: string[] = [];
      const failed: { fileName: string; reason: string }[] = [];
      const unsure: string[] = [];
      for (const file of files) {
        if (file.text.length > MAX_PART_FILE) {
          failed.push({ fileName: file.name, reason: 'larger than 16 MB' });
          continue;
        }
        try {
          const { part, guess } = readPartFile(file.text, file.name);
          const key = partKey(part);
          const exists = get().parts.some((p) => p.key === key);
          if (!exists && get().parts.length >= MAX_LIBRARY_PARTS) {
            failed.push({
              fileName: file.name,
              reason: `the library holds ${MAX_LIBRARY_PARTS} parts at most`,
            });
            continue;
          }
          const record: StoredPart = {
            key,
            part,
            fileName: file.name.slice(0, 200),
            added: Date.now(),
          };
          upsert(record);
          await save(record);
          (exists ? replaced : added).push(part.partNumber);
          if (!guess.confident) unsure.push(part.partNumber);
        } catch (err) {
          const reason =
            err instanceof PartFileError || err instanceof TouchstoneError
              ? err.message
              : err instanceof Error
                ? err.message
                : String(err);
          failed.push({ fileName: file.name, reason });
        }
      }
      return { added, replaced, failed, unsure };
    },
    addParts: async (parts) => {
      let added = 0;
      let skipped = 0;
      for (const { part, fileName } of parts) {
        const record: StoredPart = { key: partKey(part), part, fileName, added: Date.now() };
        // The same limit as for files: a part of a new name past it is left out.
        const exists = get().parts.some((p) => p.key === record.key);
        if (!exists && get().parts.length >= MAX_LIBRARY_PARTS) {
          skipped++;
          continue;
        }
        upsert(record);
        await save(record);
        added++;
      }
      return { added, skipped };
    },
    remove: async (key) => {
      const record = get().parts.find((p) => p.key === key) ?? null;
      set({ parts: get().parts.filter((p) => p.key !== key) });
      try {
        await (await storeOf()).remove(key);
      } catch {
        set({ persistent: false });
      }
      return record;
    },
    removeAll: async () => {
      const records = [...get().parts];
      set({ parts: [] });
      try {
        const s = await storeOf();
        for (const r of records) await s.remove(r.key);
      } catch {
        set({ persistent: false });
      }
      return records;
    },
    restore: async (records) => {
      for (const record of records) {
        const exists = get().parts.some((p) => p.key === record.key);
        if (!exists && get().parts.length >= MAX_LIBRARY_PARTS) continue;
        upsert(record);
        await save(record);
      }
    },
    setFixture: async (key, fixture) => {
      const record = get().parts.find((p) => p.key === key);
      if (!record) return 'the part is no longer in the library';
      try {
        const next = { ...record, part: withFixture(record.part, fixture) };
        upsert(next);
        await save(next);
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    },
    rename: async (key, names) => {
      const record = get().parts.find((p) => p.key === key);
      if (!record) return 'the part is no longer in the library';
      const part = {
        ...record.part,
        manufacturer: cleanPartName(names.manufacturer),
        partNumber: cleanPartName(names.partNumber),
      };
      const nextKey = partKey(part);
      if (!part.partNumber.trim()) return 'a part needs a part number';
      if (nextKey !== key && get().parts.some((p) => p.key === nextKey)) {
        return 'a part of that manufacturer and part number is already in the library';
      }
      const next: StoredPart = { ...record, key: nextKey, part };
      set({ parts: sorted([...get().parts.filter((p) => p.key !== key), next]) });
      try {
        const s = await storeOf();
        if (nextKey !== key) await s.remove(key);
        await s.put(next);
      } catch {
        set({ persistent: false });
      }
      return null;
    },
  };
});

/** The synthetic example parts (made from equivalent circuits, not measured), for a first look. */
export function syntheticLibraryParts(): { part: LibraryPart; fileName: string }[] {
  return SYNTHETIC_PARTS.map((spec) => ({
    part: syntheticPart(spec),
    fileName: `${spec.name}.s2p (generated)`,
  }));
}

/** The library's parts as Realize uses them. */
export function libraryParts(): LibraryPart[] {
  return usePartLibrary.getState().parts.map((p) => p.part);
}
