/**
 * The build of a design (docs/09b): how its network is made, saved with the
 * design. The board (stackup, vias, traces) and the package models (ESL, Cp,
 * ESR, pads and land sizes) decide the as-built locus, the `.s2p`, the report
 * and the BOM layout notes, so they travel in the `.json` file, the share link
 * and the autosave, and every change to them is an undoable step.
 *
 * A design saved before the build travelled with it has no `build`. It takes
 * this browser's defaults for new designs: the board and package table kept
 * under their old keys (`smithonline.board.v1`, `smithonline.packages.v1`),
 * which is exactly what such a design evaluated against before. Opening one
 * copies those defaults into it, so it then keeps them.
 *
 * Only the package rows and fields that differ from the built-in table are
 * stored (`packages`), which keeps a share link short.
 */
import {
  DEFAULT_BOARD,
  DEFAULT_PACKAGES,
  normalizeBoard,
  normalizePackageTable,
  normalizeStackup,
  packageById,
  stackupLabel,
  type BoardSettings,
  type PackageId,
  type PackageTable,
  type RealizeScope,
  type Stackup,
} from '@smithonline/core';
import { useBoard } from '../store/useBoard';
import { usePackages } from '../store/usePackages';
import { useSettings } from '../store/useSettings';
import { emptyDesign, type Design } from './design';
import { DEFAULT_SETTINGS, type Settings } from './settings';
import { DEFAULT_TOLERANCE } from './tolerance';

/** The numbers of a package row a design may change. */
export type PackageNumber = 'esl' | 'cp' | 'esr' | 'pad' | 'padLength' | 'padWidth';

export const PACKAGE_NUMBERS: readonly PackageNumber[] = [
  'esl',
  'cp',
  'esr',
  'pad',
  'padLength',
  'padWidth',
];

/**
 * The range of each package number a design, a link or a file may hold, inclusive. Wide enough
 * for any real part (a 1 µH ESL, a 1 nF pad, 10 cm lands); a number outside it is refused.
 */
export const PACKAGE_LIMITS: Readonly<Record<PackageNumber, { min: number; max: number }>> = {
  esl: { min: 0, max: 1e-6 },
  cp: { min: 0, max: 1e-9 },
  esr: { min: 0, max: 1000 },
  pad: { min: 0, max: 1e-9 },
  padLength: { min: 0, max: 0.1 },
  padWidth: { min: 0, max: 0.1 },
};

/** A package row as the design stores it: its id and the numbers that differ from the built-in row. */
export type PackageChange = { readonly id: PackageId } & Partial<
  Readonly<Record<PackageNumber, number>>
>;

/** The build a design carries. Each part absent: this browser's default for new designs. */
export interface DesignBuild {
  readonly board?: BoardSettings;
  /** The package rows that differ from the built-in table; empty: the built-in table. */
  readonly packages?: readonly PackageChange[];
}

/** The build a design evaluates with: its own, or this browser's defaults where it has none. */
export interface ResolvedBuild {
  readonly board: BoardSettings;
  readonly table: PackageTable;
}

/* ------------------------------------------------------------ the table */

/** The built-in table with the changes applied. */
export function tableFromChanges(changes: readonly PackageChange[]): PackageTable {
  if (changes.length === 0) return DEFAULT_PACKAGES;
  return normalizePackageTable(
    DEFAULT_PACKAGES.map((row) => {
      const change = changes.find((c) => c.id === row.id);
      return change ? { ...row, ...change } : row;
    }),
  );
}

/** The rows and numbers of a table that differ from the built-in one, in table order. */
export function changesFromTable(table: PackageTable): PackageChange[] {
  const out: PackageChange[] = [];
  for (const row of table) {
    const d = packageById(DEFAULT_PACKAGES, row.id);
    if (!d) continue;
    const change: Record<string, unknown> = {};
    for (const k of PACKAGE_NUMBERS) if (row[k] !== d[k]) change[k] = row[k];
    if (Object.keys(change).length > 0) out.push({ id: row.id, ...change } as PackageChange);
  }
  return out;
}

/** True when the package row differs from the built-in one. */
export function rowChanged(table: PackageTable, id: PackageId): boolean {
  return changesFromTable(table.filter((r) => r.id === id)).length > 0;
}

/* ------------------------------------------------------------- resolving */

const resolved = new WeakMap<
  DesignBuild,
  { readonly defaults: ResolvedBuild; readonly out: ResolvedBuild }
>();

/** The build a design's own build and the defaults give; the same object for the same inputs. */
export function resolveBuild(
  build: DesignBuild | undefined,
  defaults: ResolvedBuild,
): ResolvedBuild {
  if (!build || (build.board === undefined && build.packages === undefined)) return defaults;
  const hit = resolved.get(build);
  if (hit && hit.defaults === defaults) return hit.out;
  const out: ResolvedBuild = {
    board: build.board ?? defaults.board,
    table: build.packages ? tableFromChanges(build.packages) : defaults.table,
  };
  resolved.set(build, { defaults, out });
  return out;
}

let defaultsMemo: ResolvedBuild | null = null;

/** This browser's defaults for new designs: the board and package table kept in the browser. */
export function browserBuildDefaults(): ResolvedBuild {
  const board = useBoard.getState().board;
  const table = usePackages.getState().table;
  if (!defaultsMemo || defaultsMemo.board !== board || defaultsMemo.table !== table) {
    defaultsMemo = { board, table };
  }
  return defaultsMemo;
}

/** The build a design evaluates with (the absent-field rule of docs/09b section 2.3). */
export function designBuild(
  design: Pick<Design, 'build'>,
  defaults: ResolvedBuild = browserBuildDefaults(),
): ResolvedBuild {
  return resolveBuild(design.build, defaults);
}

/** True when two builds give the same network. */
export function sameBuild(a: ResolvedBuild, b: ResolvedBuild): boolean {
  if (a === b) return true;
  return (
    JSON.stringify(a.board) === JSON.stringify(b.board) &&
    JSON.stringify(changesFromTable(a.table)) === JSON.stringify(changesFromTable(b.table))
  );
}

/** The build as a design stores it. */
export function storedBuild(b: ResolvedBuild): DesignBuild {
  return { board: b.board, packages: changesFromTable(b.table) };
}

/** True when the design carries all of its build (nothing left to the browser's defaults). */
export function hasOwnBuild(design: Pick<Design, 'build'>): boolean {
  return design.build?.board !== undefined && design.build.packages !== undefined;
}

/**
 * The design with its build written into it: what it evaluates with now. A design that has
 * its own build already is returned as it is.
 */
export function ownBuild<T extends Pick<Design, 'build'>>(
  design: T,
  defaults: ResolvedBuild = browserBuildDefaults(),
): T {
  if (hasOwnBuild(design)) return design;
  return { ...design, build: storedBuild(designBuild(design, defaults)) };
}

/* ------------------------------------------------- the design on show */

let designSource: () => Pick<Design, 'build'> = () => ({});

/** The design store hands itself over, so modules below it can read the build on show. */
export function registerDesignSource(source: () => Pick<Design, 'build'>): void {
  designSource = source;
}

/** The build of the design on show. */
export function currentBuild(): ResolvedBuild {
  return designBuild(designSource());
}

/* ----------------------------------------------------------- in words */

/** The scope of Realize in words. */
export const SCOPE_LABELS: Readonly<Record<RealizeScope, string>> = {
  all: 'All parts',
  L: 'Inductors only',
  C: 'Capacitors only',
  R: 'Resistors only',
  pairs: 'L-C pairs, keep resonance',
};

/** The board in one line: "RO4350B, 0.762 mm, 1 via per shunt part, traces 1 mm". */
export function boardSummary(board: BoardSettings): string {
  const vias = `${board.viasPerShunt} ${board.viasPerShunt === 1 ? 'via' : 'vias'} per shunt part`;
  const mm = String(Math.round(board.traceLength * 1e5) / 100);
  return `${boardName(board)}, ${vias}, traces ${mm} mm`;
}

/* --------------------------------------------------------- old designs */

/** The board in a few words for messages: "FR-4, 1.6 mm", or the stackup's own name. */
export function boardName(board: BoardSettings): string {
  return stackupLabel(board.stackup);
}

/**
 * An opened design (a `.json` file, a share link, the autosave): one saved before the build
 * travelled with designs takes this browser's defaults and keeps them from now on. The notice
 * says so when the default board is on, the case where the network as built depends on it.
 */
export function openedDesign(
  design: Design,
  defaults: ResolvedBuild = browserBuildDefaults(),
): { readonly design: Design; readonly notice: string | null } {
  if (hasOwnBuild(design)) return { design, notice: null };
  const notice =
    design.build?.board === undefined && defaults.board.enabled
      ? `Saved before the board travelled with designs: using this browser's default board (${boardName(defaults.board)}). Check it in Build.`
      : null;
  return { design: ownBuild(design, defaults), notice };
}

/**
 * The notice of a design opened at the start (a link or the autosave from before 0.6.0): the
 * application says it once it is on screen, so the phone's toast shows it too (App.tsx).
 */
export const startNotice: { text: string | null } = { text: null };

/* ------------------------------------------------------------ editing */

type BoardPatch = Partial<Omit<BoardSettings, 'stackup'>>;

/** The board with a patch applied, every number checked as the board store checks it. */
export function patchBoard(board: BoardSettings, patch: BoardPatch): BoardSettings {
  return { ...normalizeBoard({ ...board, ...patch }), stackup: board.stackup };
}

/**
 * The board with numbers of its stackup changed. The laminate's name goes when a number
 * changes (it is no longer that laminate); a number the model cannot use keeps the current one.
 */
export function patchStackup(board: BoardSettings, patch: Partial<Stackup>): BoardSettings {
  const current = board.stackup as unknown as Record<string, unknown>;
  const changed = Object.entries(patch).some(([k, v]) => k !== 'name' && current[k] !== v);
  const { name: _name, ...rest } = board.stackup;
  void _name;
  const next = changed ? { ...rest, ...patch } : { ...board.stackup, ...patch };
  return { ...board, stackup: normalizeStackup(next, board.stackup) };
}

/** A package row with numbers changed; a number outside PACKAGE_LIMITS keeps the current one. */
export function patchPackage(
  table: PackageTable,
  id: PackageId,
  patch: Partial<Record<PackageNumber, number>>,
): PackageTable {
  const ok = Object.fromEntries(
    Object.entries(patch).filter(([k, v]) => {
      const lim = PACKAGE_LIMITS[k as PackageNumber];
      return lim !== undefined && Number.isFinite(v) && v >= lim.min && v <= lim.max;
    }),
  );
  return normalizePackageTable(table.map((row) => (row.id === id ? { ...row, ...ok } : row)));
}

/** The table with one row back at its built-in numbers. */
export function resetPackage(table: PackageTable, id: PackageId): PackageTable {
  return table.map((row) => (row.id === id ? (packageById(DEFAULT_PACKAGES, id) ?? row) : row));
}

/* ------------------------------------------------------- new designs */

/** The build of a new design when nothing has been set in this browser. */
export const BUILT_IN_BUILD: ResolvedBuild = { board: DEFAULT_BOARD, table: DEFAULT_PACKAGES };

/**
 * A new design from this browser's defaults (Settings, New designs): f and Z0, the build, the
 * default Q of the loss model, the Realize series, the default tolerance and the VSWR limit.
 */
export function newDesignFromDefaults(
  settings: Settings = useSettings.getState().settings,
  defaults: ResolvedBuild = browserBuildDefaults(),
): Design {
  const base = emptyDesign({ frequency: settings.defaultFrequency, z0: settings.defaultZ0 });
  const tolerance =
    settings.defaultTolerancePercent !== null ||
    settings.defaultVswrLimit !== DEFAULT_TOLERANCE.vswrLimit
      ? {
          tolerance: {
            ...DEFAULT_TOLERANCE,
            percent: settings.defaultTolerancePercent,
            vswrLimit: settings.defaultVswrLimit,
          },
        }
      : {};
  return {
    ...base,
    realize: { ...base.realize, series: settings.defaultSeries },
    losses: {
      ...base.losses,
      inductorQ: settings.defaultInductorQ,
      capacitorQ: settings.defaultCapacitorQ,
    },
    ...tolerance,
    build: storedBuild(defaults),
  };
}

/**
 * The defaults for new designs in one line, for Settings: "FR-4, 1.6 mm, board off, default
 * packages, Q 50 and 500, E24".
 */
export function defaultsSummary(settings: Settings, defaults: ResolvedBuild): string {
  const changed = changesFromTable(defaults.table).length;
  return [
    boardName(defaults.board),
    defaults.board.enabled ? 'board on' : 'board off',
    changed === 0
      ? 'default packages'
      : `${changed} ${changed === 1 ? 'package' : 'packages'} changed`,
    `Q ${settings.defaultInductorQ} and ${settings.defaultCapacitorQ}`,
    settings.defaultSeries === 'library' ? 'part library' : settings.defaultSeries,
  ].join(', ');
}

/** Keep the design's build, default Q and series as the defaults for new designs. */
export function keepAsDefaults(design: Design): void {
  const b = designBuild(design);
  useBoard.getState().restore(b.board);
  usePackages.getState().restore(b.table);
  const { series } = design.realize;
  useSettings.getState().update({
    defaultInductorQ: design.losses.inductorQ,
    defaultCapacitorQ: design.losses.capacitorQ,
    ...(series !== 'stock' ? { defaultSeries: series } : {}),
  });
}

/** The defaults for new designs back to the built-in ones (Settings, New designs, Reset). */
export function resetDefaults(): void {
  useBoard.getState().reset();
  usePackages.getState().reset();
  const d = DEFAULT_SETTINGS;
  useSettings.getState().update({
    defaultInductorQ: d.defaultInductorQ,
    defaultCapacitorQ: d.defaultCapacitorQ,
    defaultSeries: d.defaultSeries,
  });
}
