import {
  DEFAULT_PACKAGES,
  droppedPackageNumbers,
  normalizePackageTable,
  type PackageNumberDropped,
  type PackageId,
  type PackageParasitics,
  type PackageTable,
} from '@smithonline/core';
import { create } from 'zustand';

/**
 * The default package models for new designs (docs/09b section 2.3 d). Each
 * design saves the rows that differ from the built-in table
 * (`design.build.packages`, lib/designBuild.ts), edited in Build; this store
 * keeps the table new designs copy, under its key from before 0.6.0, so a
 * design saved before then opens with the table it evaluated against.
 */
interface PackagesState {
  table: PackageTable;
  /** Change the numbers of one row; labels and source notes stay. */
  setRow: (
    id: PackageId,
    patch: Partial<
      Pick<PackageParasitics, 'esl' | 'cp' | 'esr' | 'pad' | 'padLength' | 'padWidth'>
    >,
  ) => void;
  /** Bring one row back to its default numbers. */
  resetRow: (id: PackageId) => void;
  /** Bring the whole table back to the defaults. */
  reset: () => void;
  /** Put back a table taken before (the undo of a reset). */
  restore: (table: PackageTable) => void;
}

const STORAGE_KEY = 'smithonline.packages.v1';

/**
 * The stored numbers outside PACKAGE_LIMITS that the last read of the table set back to the
 * built-in ones (0.5.0 had no upper limits, so "10" typed for 10 nH was kept as 10 H). The start
 * says so once (main.tsx); the table is stored back without them, so it is said only once.
 */
export const packagesDropped: { list: readonly PackageNumberDropped[] } = { list: [] };

export function loadPackageTable(): PackageTable {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PACKAGES;
    const parsed = JSON.parse(raw) as unknown;
    const table = normalizePackageTable(parsed);
    const dropped = droppedPackageNumbers(parsed);
    if (dropped.length > 0) {
      packagesDropped.list = dropped;
      store(table);
    }
    return table;
  } catch {
    return DEFAULT_PACKAGES;
  }
}

function store(table: PackageTable): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(
        table.map(({ id, esl, cp, esr, pad, padLength, padWidth }) => ({
          id,
          esl,
          cp,
          esr,
          pad,
          padLength,
          padWidth,
        })),
      ),
    );
  } catch {
    // Private mode or quota: the table lasts until the page is closed.
  }
}

export const usePackages = create<PackagesState>()((set, get) => {
  const commit = (table: PackageTable): void => {
    store(table);
    set({ table });
  };
  return {
    table: loadPackageTable(),
    setRow: (id, patch) =>
      commit(
        normalizePackageTable(
          get().table.map((row) => (row.id === id ? { ...row, ...patch } : row)),
        ),
      ),
    resetRow: (id) =>
      commit(
        get().table.map((row) =>
          row.id === id ? (DEFAULT_PACKAGES.find((d) => d.id === id) ?? row) : row,
        ),
      ),
    reset: () => commit(DEFAULT_PACKAGES),
    restore: (table) => commit(normalizePackageTable(table)),
  };
});
