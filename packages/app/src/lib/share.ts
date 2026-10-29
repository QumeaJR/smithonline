/**
 * Share links: the design as compact JSON in the URL fragment, base64url
 * encoded so it survives every chat client and spreadsheet.
 */
import {
  E_SERIES,
  isPackageId,
  isPackageNumber,
  libraryPartOf,
  DEFAULT_BOARD,
  normalizeBoard,
  stackupPreset,
  type BoardSettings,
  normalizeStackup,
  stackupProblem,
  PACKAGE_IDS,
  PACKAGE_LIMITS,
  BOARD_LIMITS,
  formatEngineering,
  withoutData,
  REALIZE_SCOPES,
  type Element,
  type Stackup,
  type SweepLoad,
} from '@smithonline/core';
import { elementProblem, isElement, sameStackup } from './elementRule';
import {
  DEFAULT_LOSSES,
  DEFAULT_REALIZE,
  DEFAULT_SWEEP,
  emptyDesign,
  identify,
  type Design,
  type GainCircleSpec,
  type LossSettings,
  type RealizeSettings,
  type TwoPort,
  type TwoPortSource,
} from './design';
import { limitsOf, stressPatch, tolerancePatch } from './build';
import {
  PACKAGE_NUMBERS,
  type DesignBuild,
  type PackageChange,
  type PackageNumber,
} from './designBuild';
import { MAX_DATAPOINTS, MAX_SWEEP_LOADS, MAX_SWEEP_POINTS } from './datapoints';
import { MAX_DESIGN_NAME } from './design';
import {
  boardPoints,
  LINK_BOARD_POINTS,
  MAX_BOARD_POINTS,
  type MeasuredBoard,
} from './measuredBoard';

function realizeOf(value: unknown): RealizeSettings {
  const raw = (value ?? {}) as Record<string, unknown>;
  const series = raw.series;
  return {
    enabled: raw.enabled === true,
    series:
      series === 'stock' ||
      series === 'library' ||
      (E_SERIES as readonly unknown[]).includes(series)
        ? (series as RealizeSettings['series'])
        : DEFAULT_REALIZE.series,
    stockText: typeof raw.stockText === 'string' ? raw.stockText : '',
    scope: (REALIZE_SCOPES as readonly unknown[]).includes(raw.scope)
      ? (raw.scope as RealizeSettings['scope'])
      : DEFAULT_REALIZE.scope,
  };
}

function lossesOf(value: unknown): LossSettings {
  const raw = (value ?? {}) as Record<string, unknown>;
  return {
    enabled: raw.enabled === true,
    inductorQ: num(raw.inductorQ, DEFAULT_LOSSES.inductorQ),
    capacitorQ: num(raw.capacitorQ, DEFAULT_LOSSES.capacitorQ),
  };
}

const GAIN_CIRCLE_TYPES = new Set(['available', 'operating', 'unilateralSource', 'unilateralLoad']);

function cx(value: unknown): { re: number; im: number } | null {
  const v = value as { re?: unknown; im?: unknown } | null;
  if (!v || !Number.isFinite(v.re) || !Number.isFinite(v.im)) return null;
  return { re: v.re as number, im: v.im as number };
}

function twoPortOf(value: unknown): TwoPort | null {
  const raw = value as {
    s?: Record<string, unknown>;
    noise?: Record<string, unknown>;
    source?: unknown;
  } | null;
  if (!raw || !raw.s) return null;
  const s11 = cx(raw.s.s11);
  const s12 = cx(raw.s.s12);
  const s21 = cx(raw.s.s21);
  const s22 = cx(raw.s.s22);
  if (!s11 || !s12 || !s21 || !s22) return null;
  const n = raw.noise;
  const gammaOpt = n ? cx(n.gammaOpt) : null;
  const noise =
    n && gammaOpt && finite(n.nfMinDb) && finite(n.rn)
      ? { nfMinDb: n.nfMinDb, gammaOpt, rn: n.rn }
      : null;
  const source = sourceOf(raw.source);
  return source
    ? { s: { s11, s12, s21, s22 }, noise, source }
    : { s: { s11, s12, s21, s22 }, noise };
}

function sourceOf(value: unknown): TwoPortSource | null {
  const v = value as Record<string, unknown> | null | undefined;
  if (!v || typeof v.fileName !== 'string' || typeof v.frequency !== 'number') return null;
  const covers = numbers(v.covers);
  if (covers.length !== 2 || (covers[0] as number) > (covers[1] as number)) return null;
  if (!Number.isFinite(v.frequency) || (v.frequency as number) <= 0) return null;
  return {
    fileName: v.fileName,
    frequency: v.frequency as number,
    covers: [covers[0] as number, covers[1] as number],
    clamped: v.clamped === true,
    ...(typeof v.fileId === 'string' ? { fileId: v.fileId } : {}),
  };
}

/**
 * The measured board of a link, a file or the autosave (phase D6): its name, its points (the
 * rule Compare takes them by, boardPoints: finite positive frequencies, impedances up to an
 * open, one per frequency, sorted; at most MAX_BOARD_POINTS), the port 2 termination of a
 * two-port file, the VNA class and what the board was built from. Anything unusable leaves the measurement out; the design itself is never
 * refused for it, so a design the app wrote always opens.
 */
export function measurementPatch(value: unknown): { measurement?: MeasuredBoard } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.points)) return {};
  const points = boardPoints(v.points as unknown[]).points.slice(0, MAX_BOARD_POINTS);
  if (points.length < 2) return {};
  const clean = (text: string): string =>
    [...text]
      .map((ch) => (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? ' ' : ch))
      .join('')
      .slice(0, MAX_DESIGN_NAME);
  const name = typeof v.name === 'string' ? clean(v.name) : 'measured board';
  const t = v.termination;
  return {
    measurement: {
      name,
      points,
      ...(positive(t) && t <= 1e6 ? { termination: t } : {}),
      ...(v.vna === 'hobby' || v.vna === 'lab' ? { vna: v.vna } : {}),
      ...(typeof v.source === 'string' && v.source.length > 0 ? { source: clean(v.source) } : {}),
    },
  };
}

/** A link longer than this many characters may be cut by some mail and chat tools. */
export const LONG_LINK = 4000;

/**
 * What a share link says about the measured board: left out when it has too many points, or
 * carried but making the link long (some mail and chat tools cut long links).
 */
export function shareMeasurementNote(
  design: Pick<Design, 'measurement'>,
  linkLength = 0,
): string | null {
  const m = design.measurement;
  if (!m) return null;
  if (m.points.length > LINK_BOARD_POINTS)
    return `The measured board (${m.points.length} points, more than the ${LINK_BOARD_POINTS} a link carries) is left out of the link; save a .json file to send it`;
  if (linkLength > LONG_LINK)
    return `The link carries the measured board (${m.points.length} points) and is long: some mail and chat tools cut long links, a .json file is safer to send`;
  return null;
}

function loadsOf(value: unknown): SweepLoad[] {
  if (!Array.isArray(value)) return [];
  const out: SweepLoad[] = [];
  for (const item of value) {
    if (out.length >= MAX_SWEEP_LOADS) break;
    const l = item as { frequency?: unknown; z?: unknown } | null;
    const z = l ? cx(l.z) : null;
    if (l && z && positive(l.frequency)) out.push({ frequency: l.frequency, z });
  }
  return out;
}

function gainCirclesOf(value: unknown): GainCircleSpec[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (g): g is GainCircleSpec =>
      typeof g === 'object' &&
      g !== null &&
      GAIN_CIRCLE_TYPES.has((g as { type?: string }).type ?? '') &&
      finite((g as { gainDb?: unknown }).gainDb),
  );
}

function numbers(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    : [];
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Six significant figures are plenty for a shared design and keep the link short. */
function round(v: number): number {
  return Number(v.toPrecision(6));
}

function roundDeep<T>(value: T): T {
  if (typeof value === 'number') return round(value) as T;
  if (Array.isArray(value)) return value.map(roundDeep) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = roundDeep(v);
    }
    return out as T;
  }
  return value;
}

export interface EncodeOptions {
  /**
   * Keep the measured data of library parts, at full precision (a .json design file: the
   * user's own copy, so the design reopens complete). A share link leaves it out and carries
   * each part's names and fitted equivalent circuit, which the recipient's own part library
   * replaces with the data when it holds the part.
   */
  readonly partData?: boolean;
  /**
   * Keep the measured board whatever its size (a .json design file). A share link carries it
   * only up to LINK_BOARD_POINTS points (shareMeasurementNote says when it is left out).
   */
  readonly measurement?: boolean;
}

export function encodeDesign(design: Design, options: EncodeOptions = {}): string {
  const elements = design.elements.map((el) =>
    el.kind === 'part' ? { ...el, part: withoutData(el.part) } : el,
  );
  const { build, measurement, ...rest } = design;
  const rounded: Record<string, unknown> & { elements: Design['elements'] } = roundDeep({
    ...rest,
    elements,
  });
  // An element the rounding would make one the reader refuses (a stackup whose tanδ sits on
  // the edge of physical, a width on the edge of W/h) is written at full precision, as the
  // build is (linkBuild): the reader always takes what the writer wrote.
  rounded.elements = rounded.elements.map((el, i) => {
    const own = elements[i];
    return own && !isElement(el) && isElement(own) ? own : el;
  });
  if (options.partData) {
    rounded.elements = rounded.elements.map((el, i) => {
      const own = design.elements[i];
      return own?.kind === 'part' && own.part.data && el.kind === 'part'
        ? { ...el, part: { ...el.part, data: own.part.data } }
        : el;
    });
  }
  if (build) rounded.build = linkBuild(build);
  if (measurement && (options.measurement || measurement.points.length <= LINK_BOARD_POINTS)) {
    // Files keep the full precision; a link rounds the impedances like the rest and keeps the
    // frequencies whole (six figures would merge the points of a narrow sweep: 1 GHz + 1 kHz).
    rounded.measurement = options.measurement
      ? measurement
      : {
          ...roundDeep(measurement),
          points: measurement.points.map((q) => ({ frequency: q.frequency, z: roundDeep(q.z) })),
        };
  }
  const json = JSON.stringify({ v: 1, ...rounded });
  return toBase64Url(new TextEncoder().encode(json));
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function positive(v: unknown): v is number {
  return finite(v) && v > 0;
}

/**
 * The build as a link or file writes it: six significant figures, the board compact. Where the
 * rounding would make a number one the reader refuses (a value on the edge of its range), the
 * build is written at full precision, so the reader always takes what the writer wrote.
 */
function linkBuild(build: DesignBuild): Record<string, unknown> {
  const write = (b: DesignBuild): Record<string, unknown> => ({
    ...b,
    ...(b.board ? { board: compactBoard(b.board) } : {}),
  });
  const rounded = write(roundDeep(build));
  return buildPatch(rounded) !== null ? rounded : write(build);
}

/** The board numbers a design stores, each compared after normalizing. */
const BOARD_NUMBERS = ['viaDrill', 'viasPerShunt', 'traceLength', 'traceWidth'] as const;

/**
 * The board as a link writes it: the numbers that are the built-in defaults, `enabled: false`
 * and the name of a laminate preset (its numbers name it) are left out, which keeps a link
 * short. The reader puts them back (boardOf).
 */
function compactBoard(board: BoardSettings): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (board.enabled) out.enabled = true;
  const preset = stackupPreset(board.stackup);
  const { name, ...numbers } = board.stackup;
  // A preset's numbers without a name are written with `name: null`, so they read back nameless.
  out.stackup =
    preset && name === preset.stackup.name
      ? numbers
      : preset && name === undefined
        ? { ...numbers, name: null }
        : board.stackup;
  for (const k of BOARD_NUMBERS) if (board[k] !== DEFAULT_BOARD[k]) out[k] = board[k];
  return out;
}

/** A part of a link or file as read: its value, or why it cannot be used, in words. */
type Read<T> = { readonly value: T } | { readonly problem: string };

/** The board numbers in words, for the reason a file is refused. */
const BOARD_WORDS: Readonly<Record<string, string>> = {
  viaDrill: 'the via drill',
  viasPerShunt: 'the vias per shunt part',
  traceLength: 'the trace length',
  traceWidth: 'the trace width',
  h: 'the height h',
  er: 'εr',
  tanD: 'tanδ',
  fRef: 'the frequency of tanδ',
  t: 'the copper thickness t',
  roughness: 'the roughness Rq',
  rho: 'the copper resistivity',
};

/** The range of a board number in words (BOARD_LIMITS), as the stackup's refusals state theirs. */
function boardRange(k: (typeof BOARD_NUMBERS)[number]): string {
  const { min, max } = BOARD_LIMITS[k];
  if (k === 'viasPerShunt') return `${min} to ${max}`;
  const m = (v: number): string => formatEngineering(v, { unit: 'm' });
  return k === 'traceWidth' ? `0, or ${m(min)} to ${m(max)}` : `${m(min)} to ${m(max)}`;
}

const boardProblem = (what: string): { problem: string } => ({
  problem: `the board in it is not usable: ${what}`,
});

/**
 * The board of a design's build, or why it is not one the model can use as it stands: like a
 * microstrip's stackup, a number normalizing would change (non-finite, out of range, an
 * unphysical er and tanD) refuses the whole link or file. A long laminate name is cut.
 */
function readBoard(value: unknown, compact: boolean): Read<BoardSettings> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return boardProblem('it is not a set of numbers');
  }
  const raw = value as Record<string, unknown>;
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') {
    return boardProblem('its switch is neither on nor off');
  }
  if (typeof raw.stackup !== 'object' || raw.stackup === null || Array.isArray(raw.stackup)) {
    return boardProblem('it has no stackup');
  }
  const board = normalizeBoard(raw);
  // A number left out is the built-in default (compactBoard); one given must be usable as it is.
  const badNumber = BOARD_NUMBERS.find((k) =>
    raw[k] === undefined ? board[k] !== DEFAULT_BOARD[k] : raw[k] !== board[k],
  );
  if (badNumber) {
    return boardProblem(`${BOARD_WORDS[badNumber]} is outside ${boardRange(badNumber)}`);
  }
  const rawStackup = raw.stackup as Record<string, unknown>;
  // The stackup as written, so the reason names the number at fault and its range.
  const problem = stackupProblem(rawStackup as unknown as Stackup) ?? stackupProblem(board.stackup);
  if (problem) return boardProblem(`${BOARD_WORDS[problem.field]} ${problem.reason}`);
  if (!sameStackup(rawStackup, board.stackup)) {
    const norm = board.stackup as unknown as Record<string, unknown>;
    const field =
      ['h', 'er', 'tanD', 'fRef', 't', 'roughness'].find((k) => rawStackup[k] !== norm[k]) ?? 'rho';
    return boardProblem(`${BOARD_WORDS[field]} is missing or out of range`);
  }
  // In a link or a file, a preset's numbers without a name are that preset (compactBoard left
  // its name out); with `name: null` they are nameless as written. The autosave writes the
  // board as it is, so there a stackup without a name stays nameless.
  const nameless = rawStackup.name === null || !compact;
  const preset =
    board.stackup.name === undefined && !nameless ? stackupPreset(board.stackup) : undefined;
  return {
    value: preset?.stackup.name
      ? { ...board, stackup: { ...board.stackup, name: preset.stackup.name } }
      : board,
  };
}

/** The package numbers in words, for the reason a file is refused. */
const PACKAGE_WORDS: Readonly<Record<PackageNumber, string>> = {
  esl: 'ESL',
  cp: 'Cp',
  esr: 'ESR',
  pad: 'Pads',
  padLength: 'Land l',
  padWidth: 'Land w',
};

/** The unit of each package number, for the range a refusal states. */
const PACKAGE_UNITS: Readonly<Record<PackageNumber, string>> = {
  esl: 'H',
  cp: 'F',
  esr: 'Ω',
  pad: 'F',
  padLength: 'm',
  padWidth: 'm',
};

/** The range of a package number in words ("0 to 1 µH"), as the board's refusals state theirs. */
function packageRange(k: PackageNumber): string {
  const { min, max } = PACKAGE_LIMITS[k];
  const unit = PACKAGE_UNITS[k];
  return `${formatEngineering(min, { unit })} to ${formatEngineering(max, { unit })}`;
}

/**
 * The package rows of a design's build: known ids, each once, and numbers within
 * PACKAGE_LIMITS (core), the rule the Build fields and the defaults for new designs keep; or
 * why not (the link or file is refused). Rows that change nothing are dropped.
 */
function readPackageChanges(value: unknown): Read<PackageChange[]> {
  const problem = (what: string): { problem: string } => ({
    problem: `the package models in it are not usable: ${what}`,
  });
  if (!Array.isArray(value)) return problem('they are not a list');
  if (value.length > PACKAGE_IDS.length) return problem('there are more rows than packages');
  const out: PackageChange[] = [];
  const seen = new Set<string>();
  for (const item of value as unknown[]) {
    if (typeof item !== 'object' || item === null) return problem('a row is empty');
    const row = item as Record<string, unknown>;
    if (!isPackageId(row.id)) return problem('a row names no known package');
    if (seen.has(row.id)) return problem(`${row.id} is listed twice`);
    seen.add(row.id);
    const change: Partial<Record<PackageNumber, number>> = {};
    for (const k of PACKAGE_NUMBERS) {
      const v = row[k];
      if (v === undefined) continue;
      if (!isPackageNumber(k, v)) {
        return problem(`${row.id} ${PACKAGE_WORDS[k]} is outside ${packageRange(k)}`);
      }
      change[k] = v;
    }
    if (Object.keys(change).length > 0) out.push({ id: row.id, ...change });
  }
  return { value: out };
}

/**
 * The build of a link, a file or the autosave (docs/09b), or why it is not usable (the payload
 * is refused, as a bad microstrip stackup refuses it). `{}` when the payload has none (a design
 * saved before 0.6.0, which takes this browser's defaults).
 */
function readBuild(value: unknown, compact = true): Read<{ build?: DesignBuild }> {
  if (value === undefined || value === null) return { value: {} };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { problem: 'its build is not a set of numbers' };
  }
  const raw = value as Record<string, unknown>;
  const board = raw.board === undefined ? undefined : readBoard(raw.board, compact);
  if (board && 'problem' in board) return board;
  const packages = raw.packages === undefined ? undefined : readPackageChanges(raw.packages);
  if (packages && 'problem' in packages) return packages;
  if (board === undefined && packages === undefined) return { value: {} };
  return {
    value: {
      build: {
        ...(board !== undefined ? { board: board.value } : {}),
        ...(packages !== undefined ? { packages: packages.value } : {}),
      },
    },
  };
}

/**
 * The build of a link, a file or the autosave; null when it is not usable (see readBuild).
 * `compact` is false for the autosave, which writes the board as it is (a stackup without a
 * name is nameless there, not the preset its numbers match).
 */
export function buildPatch(
  value: unknown,
  options: { readonly compact?: boolean } = {},
): { build?: DesignBuild } | null {
  const read = readBuild(value, options.compact ?? true);
  return 'value' in read ? read.value : null;
}

/**
 * The elements of a link, a file or the autosave, every one checked (null when one is not an
 * element): only the fields its kind has, and a microstrip's stackup normalized (a name that is
 * not a string dropped, a long one cut), so nothing else is ever stored or rendered.
 */
export function elementsOf(raw: unknown): Element[] | null {
  if (!Array.isArray(raw) || !raw.every(isElement)) return null;
  return raw.map((el: Element) =>
    el.kind === 'part'
      ? ({
          ...pick(el as unknown as Record<string, unknown>, ['id', 'color', 'note', 'locked']),
          kind: 'part',
          orientation: el.orientation,
          part: libraryPartOf(el.part),
        } as Element)
      : el.kind === 'microstrip'
        ? ({
            ...pick(el as unknown as Record<string, unknown>, ['id', 'color', 'note', 'locked']),
            kind: 'microstrip',
            width: el.width,
            length: el.length,
            stackup: normalizeStackup(el.stackup),
          } as Element)
        : el,
  );
}

/** The listed keys of an object that are present (display fields the design keeps). */
function pick(o: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function sweepOf(sweep: Record<string, unknown>): Design['sweep'] {
  const base = {
    enabled: sweep.enabled === true,
    start: positive(sweep.start) ? sweep.start : DEFAULT_SWEEP.start,
    stop: positive(sweep.stop) ? sweep.stop : DEFAULT_SWEEP.stop,
    points: Math.min(
      MAX_SWEEP_POINTS,
      Math.max(2, Math.round(num(sweep.points, DEFAULT_SWEEP.points))),
    ),
  };
  const loads = loadsOf(sweep.loads);
  if (loads.length === 0) return base;
  return {
    ...base,
    loads,
    ...(typeof sweep.loadsName === 'string'
      ? { loadsName: sweep.loadsName.slice(0, MAX_DESIGN_NAME) }
      : {}),
    ...(sweep.mode === 'frequency' || sweep.mode === 'datapoints' ? { mode: sweep.mode } : {}),
  };
}

/** The other user datapoints and the start's place; both absent for a single load. */
function datapointsOf(raw: Record<string, unknown>): Pick<Design, 'datapoints' | 'startSlot'> {
  const others = loadsOf(raw.datapoints).slice(0, MAX_DATAPOINTS - 1);
  if (others.length === 0) return {};
  const slot = Math.trunc(num(raw.startSlot, 0));
  return { datapoints: others, startSlot: Math.min(Math.max(slot, 0), others.length) };
}

/**
 * Decode a share link payload or the design of a .json file, or say why it is not a design, in
 * words that follow "Could not open x.json: ".
 */
export function readDesign(text: string): Read<Design> {
  const design = decodeDesign(text);
  if (design) return { value: design };
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(fromBase64Url(text)));
  } catch {
    return { problem: 'the design in it is damaged (it cannot be decoded)' };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { problem: 'the design in it is damaged (it cannot be decoded)' };
  }
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.elements)) return { problem: 'the design in it has no network' };
  const bad = (r.elements as unknown[]).findIndex((el) => !isElement(el));
  if (bad >= 0) {
    return { problem: `element ${bad + 1} of its network ${elementProblem(r.elements[bad])}` };
  }
  const build = readBuild(r.build);
  return { problem: 'problem' in build ? build.problem : 'the design in it cannot be read' };
}

/**
 * The design of a .json design file (File, Save .json writes `{ app, version, design }`), or the
 * plain reason it is not one: an empty file, no JSON, no design in it, or the part that is not
 * usable.
 */
export function designFromJsonFile(text: string): Read<Design> {
  if (text.trim() === '') return { problem: 'the file is empty' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { problem: 'the file is not JSON (it may be cut short)' };
  }
  const design = (raw as { design?: unknown } | null)?.design;
  if (typeof design === 'string') return readDesign(design);
  // A copy of the autosave saved as a file by 0.6.0 before this fix (the design as JSON).
  if (looksLikeAutosave(raw)) return readAutosaveObject(raw);
  // An Export all file of the local projects (docs/11): Projects imports it.
  if ((raw as { kind?: unknown } | null)?.kind === 'projects') {
    return { problem: 'it is a list of projects (Export all); import it in File, Projects' };
  }
  return { problem: 'not a Smith Online design file' };
}

/** True when a JSON value has the shape of the autosave: a design with a load and a network. */
function looksLikeAutosave(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
  const r = raw as Record<string, unknown>;
  return typeof r.load === 'object' && r.load !== null && Array.isArray(r.elements);
}

/**
 * A design as the autosave writes it (the whole design as JSON, its build as it is), or why it
 * cannot be opened: the reader of the autosave, and of a copy of it saved as a file. Its
 * elements go through the same rule as a link's or a file's (lib/elementRule.ts), so a design
 * saved before a check existed cannot bring a bad value back.
 */
export function readAutosaveObject(raw: unknown): Read<Design> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { problem: 'it holds no design' };
  }
  const parsed = raw as Design & Record<string, unknown>;
  if (!parsed.load) return { problem: 'it has no load' };
  if (!Array.isArray(parsed.elements)) return { problem: 'it has no network' };
  const bad = (parsed.elements as unknown[]).findIndex((el) => !isElement(el));
  if (bad >= 0) {
    return {
      problem: `element ${bad + 1} of its network ${elementProblem(parsed.elements[bad])}`,
    };
  }
  const elements = elementsOf(parsed.elements);
  if (!elements) return { problem: 'its network cannot be read' };
  // The build is checked as a link's is; one saved before 0.6.0 has none (lib/designBuild.ts).
  const build = readBuild(parsed.build, false);
  if ('problem' in build) return build;
  const { build: _raw, tolerance: _tolerance, measurement: _measurement, ...rest } = parsed;
  void _raw;
  void _tolerance;
  void _measurement;
  // Fields added since the design was saved take their defaults; the tolerance settings are
  // checked as a link's are (a VSWR limit of 1 saved before 0.6.0 opens as 2).
  return {
    value: {
      ...emptyDesign(),
      ...rest,
      elements: identify(elements),
      ...tolerancePatch(parsed.tolerance),
      ...build.value,
      ...measurementPatch(parsed.measurement),
    },
  };
}

/**
 * A design file (`{ app, version, design }`) of a design: what File, Save .json and every other
 * .json writer write. It keeps the library parts' measured data and the measured board at full
 * precision whatever its size: the user's own copy, so the design reopens complete.
 */
export function designFileObject(design: Design): {
  readonly app: 'Smith Online';
  readonly version: 1;
  readonly design: string;
} {
  return {
    app: 'Smith Online',
    version: 1,
    design: encodeDesign(design, { partData: true, measurement: true }),
  };
}

/** The text of a design file (designFileObject). */
export function designFileText(design: Design): string {
  return JSON.stringify(designFileObject(design));
}

/**
 * A design file of text this version could not open as a design (an autosave kept as a backup):
 * the text goes in as it is, so File, Open reads it with the reader of links and files, and says
 * why it cannot be opened, or opens it in a later version that can.
 */
export function designFileOfText(text: string): string {
  return JSON.stringify({
    app: 'Smith Online',
    version: 1,
    design: toBase64Url(new TextEncoder().encode(text)),
  });
}

/** Decode a share link payload. Returns null when it is not a design. */
export function decodeDesign(text: string): Design | null {
  try {
    const json = new TextDecoder().decode(fromBase64Url(text));
    const raw = JSON.parse(json) as Record<string, unknown>;
    const elements = elementsOf(raw.elements);
    if (!elements) return null;
    const build = buildPatch(raw.build);
    if (!build) return null;
    const load = raw.load as { re?: unknown; im?: unknown } | undefined;
    const sweep = (raw.sweep ?? {}) as Record<string, unknown>;
    return {
      name: typeof raw.name === 'string' ? raw.name.slice(0, MAX_DESIGN_NAME) : 'Shared design',
      z0: positive(raw.z0) ? raw.z0 : 50,
      frequency: positive(raw.frequency) ? raw.frequency : 1e9,
      load: { re: num(load?.re, 50), im: num(load?.im, 0) },
      ...datapointsOf(raw),
      target: cx(raw.target),
      elements: identify(elements),
      vswrCircles: numbers(raw.vswrCircles),
      qContours: numbers(raw.qContours),
      sweep: sweepOf(sweep),
      twoPort: twoPortOf(raw.twoPort),
      showStability: raw.showStability === true,
      gainCircles: gainCirclesOf(raw.gainCircles),
      noiseCircles: numbers(raw.noiseCircles),
      realize: realizeOf(raw.realize),
      losses: lossesOf(raw.losses),
      ...(limitsOf(raw.limits).length > 0 ? { limits: limitsOf(raw.limits) } : {}),
      ...stressPatch(raw.stress),
      ...tolerancePatch(raw.tolerance),
      ...build,
      ...measurementPatch(raw.measurement),
    };
  } catch {
    return null;
  }
}

/**
 * Set when the app opens a share link. `pending`: once the part library is read, the status
 * line says what became of the link's library parts (App, lib/parts.ts linkPartsNote).
 * `dropWhenSaved`: the link leaves the address bar once the autosave holds its design (App's
 * autosave), so a reload before that, or while the autosave cannot write, opens it again.
 */
export const linkOpening = { pending: false, dropWhenSaved: false };

/** The design currently encoded in the page URL, if any. */
export function designFromLocation(hash: string): Design | null {
  const m = /^#d=([A-Za-z0-9_-]+)$/.exec(hash);
  return m?.[1] ? decodeDesign(m[1]) : null;
}

export function shareUrl(design: Design, base: string): string {
  return `${base}#d=${encodeDesign(design)}`;
}

/** The session key of the link this tab put in the address bar itself (Share without a clipboard). */
const WRITTEN_LINK_KEY = 'smithonline.link.written';

/**
 * A link this tab has in the address bar: Share put it there (the clipboard refused it), or it
 * was opened and is not autosaved yet. Remembered for this tab, so a reload opens the autosave
 * when that holds the design or newer, rather than the link again (main.tsx).
 */
export function rememberWrittenLink(hash: string): void {
  try {
    sessionStorage.setItem(WRITTEN_LINK_KEY, hash);
  } catch {
    // No session storage: a reload opens the link, as before.
  }
}

/** True when the address bar holds the link this tab wrote there itself. */
export function wroteThisLink(hash: string): boolean {
  try {
    return hash.startsWith('#d=') && sessionStorage.getItem(WRITTEN_LINK_KEY) === hash;
  } catch {
    return false;
  }
}

/**
 * The share link leaves the address bar once it is read, so a reload opens the autosave (the
 * work done since) and not the same link again.
 */
export function dropLinkFromAddressBar(): void {
  try {
    if (location.hash.startsWith('#d=')) {
      history.replaceState(null, '', location.pathname + location.search);
    }
  } catch {
    // No history API: the link stays.
  }
}
