import {
  DEFAULT_PACKAGES,
  normalizePackageTable,
  type PackageId,
  type PackageParasitics,
  type PackageTable,
} from '@smithonline/core';
import { create } from 'zustand';

/**
 * The parasitics table behind the component packages. Like the substrate it
 * is a setting of the application, not of one design: the parts you buy stay
 * the same across designs, so the table is kept in the browser and not in
 * undo, files or share links. A design only names the package of each part.
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
}

const STORAGE_KEY = 'smithonline.packages.v1';

export function loadPackageTable(): PackageTable {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizePackageTable(JSON.parse(raw)) : DEFAULT_PACKAGES;
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
  };
});
