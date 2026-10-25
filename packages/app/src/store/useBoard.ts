import {
  DEFAULT_BOARD,
  DEFAULT_STACKUP,
  normalizeBoard,
  normalizeStackup,
  STACKUP_PRESETS,
  type BoardSettings,
  type Stackup,
} from '@smithonline/core';
import { create } from 'zustand';

/**
 * The board: the stackup every microstrip is built on and the layout the
 * network as built assumes (pads from the stackup, vias, traces between
 * parts). Like the package table it is a setting of the application, not of
 * one design: the board you build on stays the same across designs, so it is
 * kept in the browser and not in undo, files or share links. A microstrip
 * element carries a copy of the stackup it was made on, so a design file
 * evaluates the same everywhere.
 */
interface BoardState {
  board: BoardSettings;
  /** Change the board settings (not the stackup). */
  setBoard: (patch: Partial<Omit<BoardSettings, 'stackup'>>) => void;
  /** Change numbers of the stackup; the preset name goes when a number changes. */
  setStackup: (patch: Partial<Stackup>) => void;
  /** Take a laminate preset's stackup. */
  applyPreset: (id: string) => void;
  /** Back to the defaults (board off, FR-4 1.6 mm). */
  reset: () => void;
  /** Put back board settings taken before (the undo of a reset). */
  restore: (board: BoardSettings) => void;
}

export const BOARD_STORAGE_KEY = 'smithonline.board.v1';
/** The substrate of the Dimensions dialog before phase D4; its microstrip numbers seed the stackup once. */
const SUBSTRATE_KEY = 'smithonline.substrate.v1';

export function loadBoard(): BoardSettings {
  try {
    const raw = localStorage.getItem(BOARD_STORAGE_KEY);
    if (raw) return normalizeBoard(JSON.parse(raw));
    // A substrate typed before the stackup existed carries over (its er, h and t; the loss
    // figures of the default laminate), unless it still held the old defaults.
    const old = localStorage.getItem(SUBSTRATE_KEY);
    if (old) {
      const p = JSON.parse(old) as { er?: unknown; h?: unknown; t?: unknown };
      const isOldDefault = p.er === 4.3 && p.h === 1.6e-3 && p.t === 35e-6;
      if (!isOldDefault && (p.er !== undefined || p.h !== undefined || p.t !== undefined)) {
        const { name: _name, ...base } = DEFAULT_STACKUP;
        void _name;
        return {
          ...DEFAULT_BOARD,
          stackup: normalizeStackup({ ...base, er: p.er, h: p.h, t: p.t }),
        };
      }
    }
  } catch {
    // Unreadable storage: the defaults.
  }
  return DEFAULT_BOARD;
}

function store(board: BoardSettings): void {
  try {
    localStorage.setItem(BOARD_STORAGE_KEY, JSON.stringify(board));
  } catch {
    // Private mode or quota: the board lasts until the page is closed.
  }
}

export const useBoard = create<BoardState>()((set, get) => {
  const commit = (board: BoardSettings): void => {
    const clean = {
      ...normalizeBoard(board),
      stackup: normalizeStackup(board.stackup, get().board.stackup),
    };
    store(clean);
    set({ board: clean });
  };
  return {
    board: loadBoard(),
    setBoard: (patch) => commit({ ...get().board, ...patch }),
    setStackup: (patch) => {
      const { name: _name, ...rest } = get().board.stackup;
      void _name;
      const changed = Object.entries(patch).some(
        ([k, v]) =>
          k !== 'name' && (get().board.stackup as unknown as Record<string, unknown>)[k] !== v,
      );
      const next = changed ? { ...rest, ...patch } : { ...get().board.stackup, ...patch };
      // A number the model cannot use keeps the current one (the fields refuse it first).
      commit({ ...get().board, stackup: normalizeStackup(next, get().board.stackup) });
    },
    applyPreset: (id) => {
      const p = STACKUP_PRESETS.find((x) => x.id === id);
      if (p) commit({ ...get().board, stackup: p.stackup });
    },
    reset: () => commit(DEFAULT_BOARD),
    restore: (board) => commit(board),
  };
});
