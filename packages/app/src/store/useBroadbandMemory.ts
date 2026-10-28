import { create } from 'zustand';
import type { SearchRan } from '../components/BroadbandMatch';
import type { RftRan } from '../components/RealFrequency';
import type { Design } from '../lib/design';

/** The design a memory belongs to, by identity: another design starts the tool afresh. */
export interface MemoryOwner {
  readonly elements: unknown;
  readonly load: unknown;
  readonly loads: unknown;
  readonly z0: number;
}

export const ownerOf = (elements: unknown, design: Design): MemoryOwner => ({
  elements,
  load: design.load,
  loads: design.sweep.loads,
  z0: design.z0,
});

const sameOwner = (a: MemoryOwner | null, b: MemoryOwner): boolean =>
  a !== null &&
  a.elements === b.elements &&
  a.load === b.load &&
  a.loads === b.loads &&
  a.z0 === b.z0;

/**
 * What the Broadband method of Auto match had on show, kept when the tool
 * closes: the last search and real frequency results (each still checked
 * against the design and band before it is shown), the band the user typed,
 * and the Max parts, Parts and other choices. A run that finishes while the
 * tool is closed lands here, so reopening shows it and Apply still works. It
 * belongs to one design: opened on another, the tool starts afresh.
 */
interface BroadbandMemory {
  owner: MemoryOwner | null;
  search: SearchRan | null;
  rft: RftRan | null;
  /** The band the user typed; null while the band follows the design. */
  band: { readonly start: number; readonly stop: number } | null;
  maxElements: number;
  /** The real frequency Parts; null until chosen (it then follows Max parts). */
  rftParts: number | null;
  keep: boolean | null;
  allowLine: boolean;
  /** Remember these for the design `owner`. */
  remember: (owner: MemoryOwner, patch: MemoryPatch) => void;
  /** The memory for this design, or (another design) a fresh one. */
  recall: (owner: MemoryOwner) => BroadbandMemory;
}

type Fns = 'remember' | 'recall';

/** Choices and results to remember. */
export type MemoryPatch = Partial<Omit<BroadbandMemory, 'owner' | Fns>>;

const EMPTY = {
  owner: null,
  search: null,
  rft: null,
  band: null,
  maxElements: 4,
  rftParts: null,
  keep: null,
  allowLine: false,
} as const;

export const useBroadbandMemory = create<BroadbandMemory>()((set, get) => ({
  ...EMPTY,
  remember: (owner, patch) =>
    set(sameOwner(get().owner, owner) ? { ...patch, owner } : { ...EMPTY, ...patch, owner }),
  recall: (owner) => {
    if (!sameOwner(get().owner, owner)) set({ ...EMPTY, owner });
    return get();
  },
}));
