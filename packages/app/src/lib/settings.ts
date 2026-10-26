import { ARC_COLORS, setPalette } from './colors';

/**
 * Application settings, the counterpart of the original's settings dialog:
 * colours, line widths, label density, defaults for new designs, the
 * next-step suggestions and the schematic direction. Stored in localStorage; colours and widths reach the
 * chart through the CSS variables that index.css already reads.
 */

/** Colours that replace a theme colour; null keeps the theme's own. */
export interface SettingsColors {
  readonly gridZ: string | null;
  readonly gridY: string | null;
  /** Datapoint markers: the chain and the hollow user datapoints. */
  readonly datapoints: string | null;
  readonly sweep: string | null;
  readonly vswr: string | null;
  readonly q: string | null;
}

export type ColorKey = keyof SettingsColors;

export type LabelDensity = 'few' | 'auto' | 'many';
export type SchematicDirection = 'horizontal' | 'vertical';

export interface Settings {
  readonly colors: SettingsColors;
  /** Colours handed to new elements, in order. */
  readonly palette: readonly string[];
  /** Width of the major grid lines in px; the minor lines are half of it. */
  readonly gridWidth: number;
  /** Width of the sweep locus in px; the element loci scale with it. */
  readonly locusWidth: number;
  /** Chart label density: few, as the grid density sets it, or many. */
  readonly labelDensity: LabelDensity;
  /** Frequency, Hz, and reference impedance, ohm, of a new design. */
  readonly defaultFrequency: number;
  readonly defaultZ0: number;
  readonly schematic: SchematicDirection;
  /** Offer the next step after a match, a run or an export (docs/09 section 4). */
  readonly suggestNextSteps: boolean;
}

export const PALETTE_SIZE = ARC_COLORS.length;

export const DEFAULT_SETTINGS: Settings = {
  colors: { gridZ: null, gridY: null, datapoints: null, sweep: null, vswr: null, q: null },
  palette: ARC_COLORS,
  gridWidth: 1,
  locusWidth: 2,
  labelDensity: 'auto',
  defaultFrequency: 1e9,
  defaultZ0: 50,
  schematic: 'horizontal',
  suggestNextSteps: true,
};

export const WIDTH_RANGE = { min: 0.5, max: 4, step: 0.5 } as const;

export const COLOR_LABELS: Readonly<Record<ColorKey, string>> = {
  gridZ: 'Impedance grid',
  gridY: 'Admittance grid',
  datapoints: 'Datapoints',
  sweep: 'Sweep',
  vswr: 'VSWR circles',
  q: 'Q contours',
};

/** The CSS variable each colour setting drives. */
const COLOR_VARS: Readonly<Record<ColorKey, readonly string[]>> = {
  gridZ: ['--grid-z'],
  gridY: ['--grid-y'],
  datapoints: ['--marker', '--dp-user'],
  sweep: ['--sweep'],
  vswr: ['--vswr'],
  q: ['--q'],
};

const HEX = /^#[0-9a-f]{6}$/i;

function color(v: unknown): string | null {
  return typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : null;
}

function inRange(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v)
    ? Math.min(WIDTH_RANGE.max, Math.max(WIDTH_RANGE.min, v))
    : fallback;
}

function positive(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Settings from stored JSON: anything missing or malformed takes its default. */
export function parseSettings(raw: unknown): Settings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const c = (typeof r.colors === 'object' && r.colors !== null ? r.colors : {}) as Record<
    string,
    unknown
  >;
  const colors = Object.fromEntries(
    (Object.keys(DEFAULT_SETTINGS.colors) as ColorKey[]).map((k) => [k, color(c[k])]),
  ) as unknown as SettingsColors;
  const given: unknown[] = Array.isArray(r.palette) ? r.palette : [];
  const palette = Array.from({ length: PALETTE_SIZE }, (_, i) => color(given[i]) ?? ARC_COLORS[i]!);
  return {
    colors,
    palette,
    gridWidth: inRange(r.gridWidth, DEFAULT_SETTINGS.gridWidth),
    locusWidth: inRange(r.locusWidth, DEFAULT_SETTINGS.locusWidth),
    labelDensity: r.labelDensity === 'few' || r.labelDensity === 'many' ? r.labelDensity : 'auto',
    defaultFrequency: positive(r.defaultFrequency, DEFAULT_SETTINGS.defaultFrequency),
    defaultZ0: positive(r.defaultZ0, DEFAULT_SETTINGS.defaultZ0),
    schematic: r.schematic === 'vertical' ? 'vertical' : 'horizontal',
    suggestNextSteps: r.suggestNextSteps !== false,
  };
}

/** The CSS custom properties the settings set; absent colours are left to the theme. */
export function settingsVars(s: Settings): Record<string, string> {
  const vars: Record<string, string> = {
    '--w-grid': `${s.gridWidth}px`,
    '--w-grid-minor': `${s.gridWidth / 2}px`,
    '--w-locus': `${s.locusWidth}px`,
  };
  for (const key of Object.keys(COLOR_VARS) as ColorKey[]) {
    const value = s.colors[key];
    if (value) for (const name of COLOR_VARS[key]) vars[name] = value;
  }
  return vars;
}

/** Every custom property a settings change can have set, so a reset can remove them. */
const ALL_VARS = [
  '--w-grid',
  '--w-grid-minor',
  '--w-locus',
  ...Object.values(COLOR_VARS).flat(),
] as const;

/** Write the settings to the document root and hand the palette to the element colours. */
export function applySettings(s: Settings, root?: HTMLElement): void {
  setPalette(s.palette);
  const el = root ?? (typeof document === 'undefined' ? undefined : document.documentElement);
  if (!el) return;
  const vars = settingsVars(s);
  for (const name of ALL_VARS) {
    const value = vars[name];
    if (value === undefined) el.style.removeProperty(name);
    else el.style.setProperty(name, value);
  }
}

const KEY = 'smithonline.settings.v1';

export function loadSettings(): Settings {
  try {
    const text = localStorage.getItem(KEY);
    return text ? parseSettings(JSON.parse(text)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function storeSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private mode or quota: the settings last until the page is closed.
  }
}
