import {
  isUsableStackup,
  normalizeStackup,
  sameStackupNumbers,
  STACKUP_NAME_MAX,
  type Stackup,
} from '@smithonline/core';
import { create } from 'zustand';

/**
 * Your own laminates (docs/09b section 2.2): a library kept in this browser
 * next to the built-in presets. A design never points into it; picking one
 * copies its stackup into the design's build, as a library part is copied.
 */
export interface Laminate {
  readonly id: string;
  readonly label: string;
  readonly stackup: Stackup;
}

export const LAMINATES_KEY = 'smithonline.laminates.v1';
/** More than anyone keeps; a longer stored list is cut. */
export const MAX_LAMINATES = 50;

/** The laminates of stored JSON: each with a name and a stackup the model can use; others dropped. */
export function parseLaminates(text: string | null): Laminate[] {
  if (!text) return [];
  try {
    const raw = JSON.parse(text) as unknown;
    if (!Array.isArray(raw)) return [];
    const out: Laminate[] = [];
    for (const item of raw.slice(0, MAX_LAMINATES)) {
      if (typeof item !== 'object' || item === null) continue;
      const r = item as Record<string, unknown>;
      if (typeof r.label !== 'string' || r.label.trim() === '') continue;
      if (typeof r.stackup !== 'object' || r.stackup === null) continue;
      const label = r.label.trim().slice(0, STACKUP_NAME_MAX);
      // A stored number the model cannot use drops the laminate: normalizing would put FR-4's
      // number under this laminate's name.
      const stackup = normalizeStackup(r.stackup);
      if (!isUsableStackup(stackup) || !sameStackupNumbers(r.stackup as Stackup, stackup)) continue;
      out.push({
        id: typeof r.id === 'string' && r.id ? r.id.slice(0, 40) : `l${out.length + 1}`,
        label,
        stackup: { ...stackup, name: label },
      });
    }
    return out;
  } catch {
    return [];
  }
}

function load(): Laminate[] {
  try {
    return parseLaminates(localStorage.getItem(LAMINATES_KEY));
  } catch {
    return [];
  }
}

function store(laminates: readonly Laminate[]): void {
  try {
    localStorage.setItem(LAMINATES_KEY, JSON.stringify(laminates));
  } catch {
    // Private mode or quota: the laminates last until the page is closed.
  }
}

interface LaminatesState {
  laminates: readonly Laminate[];
  /** Keep a stackup under a name; a laminate of the same name is replaced. Returns it. */
  save: (label: string, stackup: Stackup) => Laminate;
  remove: (id: string) => void;
  clear: () => void;
}

export const useLaminates = create<LaminatesState>()((set, get) => {
  const commit = (laminates: readonly Laminate[]): void => {
    store(laminates);
    set({ laminates });
  };
  return {
    laminates: load(),
    save: (rawLabel, stackup) => {
      const label = rawLabel.trim().slice(0, STACKUP_NAME_MAX) || 'My laminate';
      const others = get().laminates.filter((l) => l.label !== label);
      const laminate: Laminate = {
        id: Math.random().toString(36).slice(2, 10),
        label,
        stackup: { ...normalizeStackup(stackup), name: label },
      };
      commit([...others, laminate].slice(-MAX_LAMINATES));
      return laminate;
    },
    remove: (id) => commit(get().laminates.filter((l) => l.id !== id)),
    clear: () => commit([]),
  };
});

/** The laminate of the list whose numbers the stackup holds, if any. */
export function laminateOf(laminates: readonly Laminate[], s: Stackup): Laminate | undefined {
  return laminates.find(
    (l) =>
      l.stackup.h === s.h &&
      l.stackup.er === s.er &&
      l.stackup.tanD === s.tanD &&
      l.stackup.fRef === s.fRef &&
      l.stackup.t === s.t &&
      l.stackup.roughness === s.roughness &&
      (l.stackup.rho ?? null) === (s.rho ?? null),
  );
}
