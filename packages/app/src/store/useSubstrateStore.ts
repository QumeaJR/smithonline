import { create } from 'zustand';

/**
 * The medium of the Dimensions dialog and the coax dielectric. Since phase D4
 * the microstrip substrate is the board stackup (useBoard, Settings > Board);
 * the microstrip fields here are kept only so an older stored substrate still
 * reads, and seed the stackup once (loadBoard). It is a setting of the
 * application, kept in the browser and not in undo, files or share links.
 * Lengths are metres.
 */
export interface SubstrateSettings {
  readonly medium: 'microstrip' | 'coax';
  /** Microstrip: substrate relative permittivity. */
  readonly er: number;
  /** Microstrip: substrate height, m. */
  readonly h: number;
  /** Microstrip: conductor thickness, m (0 for none). */
  readonly t: number;
  /** Coax: dielectric relative permittivity. */
  readonly coaxEr: number;
  /** Coax: which diameter is given. */
  readonly coaxGiven: 'inner' | 'outer';
  /** Coax: the given diameter, m. */
  readonly coaxDiameter: number;
}

export const DEFAULT_SUBSTRATE: SubstrateSettings = {
  medium: 'microstrip',
  er: 4.3,
  h: 1.6e-3,
  t: 35e-6,
  coaxEr: 2.1,
  coaxGiven: 'outer',
  coaxDiameter: 4.6e-3,
};

/** Typical substrates for a one-click start; values are nominal datasheet figures. */
export const SUBSTRATE_PRESETS: readonly {
  readonly id: string;
  readonly label: string;
  readonly er: number;
  readonly h: number;
}[] = [
  { id: 'fr4', label: 'FR-4, 1.6 mm', er: 4.3, h: 1.6e-3 },
  { id: 'ro4350b', label: 'RO4350B, 0.508 mm', er: 3.66, h: 0.508e-3 },
  { id: 'rt5880', label: 'RT/duroid 5880, 0.787 mm', er: 2.2, h: 0.787e-3 },
  { id: 'alumina', label: 'Alumina, 0.635 mm', er: 9.8, h: 0.635e-3 },
];

const STORAGE_KEY = 'smithonline.substrate.v1';

function load(): SubstrateSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SUBSTRATE;
    const p = JSON.parse(raw) as Partial<SubstrateSettings>;
    const num = (v: unknown, d: number, min: number): number =>
      typeof v === 'number' && Number.isFinite(v) && v >= min ? v : d;
    const d = DEFAULT_SUBSTRATE;
    return {
      medium: p.medium === 'coax' ? 'coax' : 'microstrip',
      er: num(p.er, d.er, 1),
      h: num(p.h, d.h, 1e-9),
      t: num(p.t, d.t, 0),
      coaxEr: num(p.coaxEr, d.coaxEr, 1),
      coaxGiven: p.coaxGiven === 'inner' ? 'inner' : 'outer',
      coaxDiameter: num(p.coaxDiameter, d.coaxDiameter, 1e-9),
    };
  } catch {
    return DEFAULT_SUBSTRATE;
  }
}

interface SubstrateState {
  readonly substrate: SubstrateSettings;
  readonly setSubstrate: (patch: Partial<SubstrateSettings>) => void;
}

export const useSubstrateStore = create<SubstrateState>()((set, get) => ({
  substrate: load(),
  setSubstrate: (patch) => {
    const substrate = { ...get().substrate, ...patch };
    set({ substrate });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(substrate));
    } catch {
      // private mode or full storage: the setting lasts for the session
    }
  },
}));
