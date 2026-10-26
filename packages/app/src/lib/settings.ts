import { E_SERIES, type ESeries } from '@smithonline/core';
import { ARC_COLORS, setPalette } from './colors';

/**
 * Application settings, the counterpart of the original's settings dialog:
 * colours, line widths, label density, the chart at start, defaults for new
 * designs, the next-step suggestions and the schematic direction. Stored in
 * localStorage; colours and widths reach the chart through the CSS variables
 * that index.css already reads. Nothing here changes how a design evaluates:
 * the build (board, package models) is saved with the design (docs/09b), and
 * the board and package table kept in this browser are only the defaults a
 * new design copies (lib/designBuild.ts).
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
export type ChartDensity = 'coarse' | 'normal' | 'fine';

/** The chart grid options a page starts with (Settings, Appearance, Chart at start). */
export interface ChartAtStart {
  readonly zGrid: boolean;
  readonly yGrid: boolean;
  readonly density: ChartDensity;
  readonly labels: boolean;
}

/** The value series a new design starts with in Realize: an E series or the part library. */
export type DefaultSeries = ESeries | 'library';

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
  /** Default Q of inductors and capacitors in a new design's loss model. */
  readonly defaultInductorQ: number;
  readonly defaultCapacitorQ: number;
  /** The Realize series of a new design. */
  readonly defaultSeries: DefaultSeries;
  /** Tolerance of every part of a new design, percent; null takes it from the series. */
  readonly defaultTolerancePercent: number | null;
  /** The VSWR limit of a new design: its usable bandwidth, Tolerance and next steps. */
  readonly defaultVswrLimit: number;
  /** The chart grid options a page starts with. */
  readonly chart: ChartAtStart;
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
  defaultInductorQ: 50,
  defaultCapacitorQ: 500,
  defaultSeries: 'E24',
  defaultTolerancePercent: null,
  defaultVswrLimit: 2,
  chart: { zGrid: true, yGrid: false, density: 'normal', labels: true },
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

function nonNegative(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
}

function chartOf(v: unknown): ChartAtStart {
  const c = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS.chart;
  return {
    zGrid: typeof c.zGrid === 'boolean' ? c.zGrid : d.zGrid,
    yGrid: typeof c.yGrid === 'boolean' ? c.yGrid : d.yGrid,
    density: c.density === 'coarse' || c.density === 'fine' ? c.density : 'normal',
    labels: typeof c.labels === 'boolean' ? c.labels : d.labels,
  };
}

/** The settings that "Reset all" brings back: appearance, schematic and behaviour, not the defaults for new designs. */
export function resetPreferences(s: Settings): Settings {
  const d = DEFAULT_SETTINGS;
  return {
    ...s,
    colors: d.colors,
    palette: d.palette,
    gridWidth: d.gridWidth,
    locusWidth: d.locusWidth,
    labelDensity: d.labelDensity,
    chart: d.chart,
    schematic: d.schematic,
    suggestNextSteps: d.suggestNextSteps,
  };
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
    defaultInductorQ: nonNegative(r.defaultInductorQ, DEFAULT_SETTINGS.defaultInductorQ),
    defaultCapacitorQ: nonNegative(r.defaultCapacitorQ, DEFAULT_SETTINGS.defaultCapacitorQ),
    defaultSeries:
      r.defaultSeries === 'library' || (E_SERIES as readonly unknown[]).includes(r.defaultSeries)
        ? (r.defaultSeries as DefaultSeries)
        : DEFAULT_SETTINGS.defaultSeries,
    defaultTolerancePercent:
      typeof r.defaultTolerancePercent === 'number' &&
      Number.isFinite(r.defaultTolerancePercent) &&
      r.defaultTolerancePercent >= 0 &&
      r.defaultTolerancePercent <= 100
        ? r.defaultTolerancePercent
        : null,
    defaultVswrLimit:
      typeof r.defaultVswrLimit === 'number' &&
      Number.isFinite(r.defaultVswrLimit) &&
      r.defaultVswrLimit > 1
        ? r.defaultVswrLimit
        : DEFAULT_SETTINGS.defaultVswrLimit,
    chart: chartOf(r.chart),
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
