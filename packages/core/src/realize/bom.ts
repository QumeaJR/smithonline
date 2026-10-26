/**
 * Bill of materials from a realization: one row per lumped part, plus one row
 * per line, stub or transformer so the list is complete. A library part (one
 * the design holds, or one Realize chose from the part library) fills the
 * manufacturer and part number columns; for every other part they are left
 * blank for the user.
 *
 * A library part has two values, in their own columns: its nominal value
 * (the catalogue value read from its data, what is ordered) under Realized,
 * and its effective value at the design frequency (what the network sees,
 * and what the deviation compares) under Effective at f0. An L or C for
 * which the part library holds no candidate says "no library part" in the
 * Series column and keeps its ideal value.
 */
import type { Element } from '../elements.js';
import { partAt, partCatalogueValue, type LibraryPart } from '../parts.js';
import { elementExceeds, type ElementStress, type StressLimits } from '../stress.js';
import { formatEngineering } from '../units.js';
import type { PartKind, Realization } from './snap.js';

export interface BomRow {
  /** 1-based position in the ladder, load side first. */
  readonly position: number;
  readonly element: string;
  /** R, L, C, or the element kind for distributed parts. */
  readonly part: PartKind | 'line' | 'openStub' | 'shortStub' | 'transformer' | 'microstrip';
  readonly ideal: number;
  /** The value to order: the snapped value, or a library part's catalogue value (NaN when its data gives none). */
  readonly realized: number;
  /** A library part's effective value at the design frequency; NaN where it has none (above its resonance, outside its data). */
  readonly effective?: number;
  /** SI unit symbol for ideal and realized; empty for a ratio or wavelengths text. */
  readonly unit: string;
  /** Series name, "stock", "library", "exact", or "no library part" when the library had no candidate. */
  readonly source: string;
  /** Percent, null when the part was not snapped. */
  readonly deviationPercent: number | null;
  /** Resonance shift of an L-C pair, percent; null otherwise. */
  readonly detuningPercent: number | null;
  readonly locked: boolean;
  /** Peak voltage across the part at the design frequency, V; present when stress was given. */
  readonly vPeak?: number;
  /** RMS current through the part, A. */
  readonly iRms?: number;
  /** Which stress limits the part exceeds: "V", "I", "V+I" or empty. */
  readonly overLimit?: string;
  /** Component package of an inductor or capacitor, when one was chosen. */
  readonly pkg?: string;
  /** Track width of a microstrip, m (its length is in ideal and realized). */
  readonly width?: number;
  /** Manufacturer of a library part. */
  readonly manufacturer?: string;
  /** Part number of a library part. */
  readonly partNumber?: string;
}

/** Stress of each ladder element (see ladderStress) with the limits to flag against. */
export interface BomStress {
  readonly elements: readonly (ElementStress | null)[];
  readonly limits?: StressLimits;
}

const PART_UNIT: Readonly<Record<PartKind, string>> = { R: 'Ω', L: 'H', C: 'F' };

function defaultName(el: Element): string {
  switch (el.kind) {
    case 'R':
    case 'L':
    case 'C':
    case 'RLC':
      return `${el.orientation === 'series' ? 'Series' : 'Shunt'} ${el.kind}`;
    case 'transformer':
      return 'Transformer';
    case 'line':
      return 'Line';
    case 'openStub':
      return 'Open stub';
    case 'shortStub':
      return 'Shorted stub';
    case 'microstrip':
      return 'Microstrip';
    case 'part':
      return `${el.orientation === 'series' ? 'Series' : 'Shunt'} ${el.part.type} part`;
  }
}

/** Effective value of a library part at f, NaN where it has none. */
function effectiveAt(part: LibraryPart, f: number): number {
  return partAt(part, f)?.value ?? NaN;
}

export function bomRows(
  realization: Realization,
  nameOf: (el: Element, index: number) => string = defaultName,
  stress?: BomStress,
): BomRow[] {
  const rows: BomRow[] = [];
  const f0 = realization.ladder.frequency;
  for (const re of realization.elements) {
    const name = nameOf(re.ideal, re.index);
    if (re.ideal.kind === 'part') {
      // A library part the design holds: no ideal value of its own (the part is the design, so
      // ideal is what it is at f0), its catalogue value to order, its effective value at f0, and
      // its names.
      const p = re.ideal.part;
      const effective = effectiveAt(p, f0);
      rows.push({
        position: re.index + 1,
        element: name,
        part: p.type,
        ideal: effective,
        realized: partCatalogueValue(p) ?? NaN,
        effective,
        unit: PART_UNIT[p.type],
        source: 'library',
        deviationPercent: null,
        detuningPercent: null,
        locked: re.locked,
        manufacturer: p.manufacturer,
        partNumber: p.partNumber,
        ...stressOf(stress, re.index, p.type),
      });
      continue;
    }
    if (re.parts.length === 0) {
      const el = re.ideal;
      const value =
        el.kind === 'transformer'
          ? el.n
          : el.kind === 'line' ||
              el.kind === 'openStub' ||
              el.kind === 'shortStub' ||
              el.kind === 'microstrip'
            ? el.length
            : 0;
      rows.push({
        position: re.index + 1,
        element: name,
        part: el.kind as BomRow['part'],
        ideal: value,
        realized: value,
        unit: el.kind === 'transformer' ? '' : el.kind === 'microstrip' ? 'm' : 'λ',
        ...(el.kind === 'microstrip' ? { width: el.width } : {}),
        source: 'exact',
        deviationPercent: null,
        detuningPercent: null,
        locked: re.locked,
      });
      continue;
    }
    for (const p of re.parts) {
      const es = stress?.elements[re.index] ?? null;
      const ps = es?.parts.find((q) => q.part === p.part);
      const flag =
        es && ps && stress?.limits ? elementExceeds({ ...es, parts: [ps] }, stress.limits) : null;
      const el = re.ideal;
      const chosen = re.realized.kind === 'part' ? re.realized.part : null;
      const pkg =
        !chosen && (el.kind === 'L' || el.kind === 'C') && el.package ? el.package : undefined;
      rows.push({
        position: re.index + 1,
        element: name,
        part: p.part,
        ideal: p.ideal,
        // A chosen library part: its catalogue value to order; the snapped value is its effective one.
        realized: chosen ? (partCatalogueValue(chosen) ?? NaN) : p.realized,
        ...(chosen ? { effective: p.realized } : {}),
        unit: PART_UNIT[p.part],
        source: re.noLibraryPart ? 'no library part' : p.source,
        deviationPercent: p.source === 'exact' ? null : p.deviation * 100,
        detuningPercent: re.detuning !== undefined ? re.detuning * 100 : null,
        locked: re.locked,
        ...(pkg ? { pkg } : {}),
        ...(chosen ? { manufacturer: chosen.manufacturer, partNumber: chosen.partNumber } : {}),
        ...(ps ? finiteStress(ps) : {}),
        ...(ps && flag
          ? {
              overLimit: [flag.voltage ? 'V' : '', flag.current ? 'I' : '']
                .filter(Boolean)
                .join('+'),
            }
          : {}),
      });
    }
  }
  return rows;
}

/** The stress columns of a one-part row, when stress was given. */
function stressOf(
  stress: BomStress | undefined,
  index: number,
  part: PartKind,
): Pick<BomRow, 'vPeak' | 'iRms' | 'overLimit'> {
  const es = stress?.elements[index] ?? null;
  const ps = es?.parts.find((q) => q.part === part);
  if (!es || !ps) return {};
  const flag = stress?.limits ? elementExceeds({ ...es, parts: [ps] }, stress.limits) : null;
  const over = flag
    ? [flag.voltage ? 'V' : '', flag.current ? 'I' : ''].filter(Boolean).join('+')
    : '';
  return { ...finiteStress(ps), ...(over ? { overLimit: over } : {}) };
}

/** The stress values that exist: a part with no value at f0 (outside its data) has none. */
function finiteStress(ps: {
  readonly vPeak: number;
  readonly iRms: number;
}): Pick<BomRow, 'vPeak' | 'iRms'> {
  return {
    ...(Number.isFinite(ps.vPeak) ? { vPeak: ps.vPeak } : {}),
    ...(Number.isFinite(ps.iRms) ? { iRms: ps.iRms } : {}),
  };
}

/** The effective value of a library part at f (for a card or a report), or null above its resonance or outside its data. */
export function libraryPartValueAt(el: Element, f: number): number | null {
  return el.kind === 'part' ? (partAt(el.part, f)?.value ?? null) : null;
}

/**
 * A text field of a CSV row. Text from a part file, a share link or the user
 * that starts with =, +, -, @, a tab or a carriage return would be read as a
 * formula by a spreadsheet; it is written with a leading apostrophe (OWASP,
 * CSV injection), which the spreadsheet shows as plain text. Quotes,
 * semicolons and line breaks are quoted as usual.
 */
export function csvText(text: string): string {
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const csvField = csvText;

/** A number cell: empty where there is no value. */
function csvNumber(v: number | undefined, digits: number): string {
  return v === undefined || !Number.isFinite(v) ? '' : formatEngineering(v, { digits });
}

/**
 * Semicolon separated, like the datapoint export, with a header row. The
 * Package column appears when any part has one, like the stress columns; a
 * Width column when a microstrip is in the list; an Effective at f0 column
 * when a library part is in the list. `notes` (the layout
 * assumptions of the network as built) follow the table after an empty line,
 * one per row under a "Note" key.
 */
export function bomCsv(rows: readonly BomRow[], notes: readonly string[] = []): string {
  const withStress = rows.some((r) => r.vPeak !== undefined);
  const withPackage = rows.some((r) => r.pkg !== undefined);
  const withWidth = rows.some((r) => r.width !== undefined);
  const withEffective = rows.some((r) => r.effective !== undefined);
  const header = [
    'Position',
    'Element',
    'Part',
    'Ideal',
    'Realized',
    ...(withEffective ? ['Effective at f0'] : []),
    'Unit',
    'Series',
    'Deviation[%]',
    'Detuning[%]',
    'Locked',
    ...(withPackage ? ['Package'] : []),
    ...(withWidth ? ['Width[m]'] : []),
    ...(withStress ? ['Peak voltage[V]', 'RMS current[A]', 'Over limit'] : []),
    'Manufacturer',
    'Part number',
  ];
  const lines = rows.map((r) =>
    [
      String(r.position),
      csvField(r.element),
      r.part,
      csvNumber(r.ideal, 5),
      csvNumber(r.realized, 5),
      ...(withEffective ? [csvNumber(r.effective, 5)] : []),
      r.unit,
      r.source,
      r.deviationPercent === null ? '' : r.deviationPercent.toFixed(2),
      r.detuningPercent === null ? '' : r.detuningPercent.toFixed(2),
      r.locked ? 'yes' : '',
      ...(withPackage ? [r.pkg ?? ''] : []),
      ...(withWidth ? [csvNumber(r.width, 5)] : []),
      ...(withStress ? [csvNumber(r.vPeak, 4), csvNumber(r.iRms, 4), r.overLimit ?? ''] : []),
      csvField(r.manufacturer ?? ''),
      csvField(r.partNumber ?? ''),
    ].join(';'),
  );
  const noteRows = notes.length > 0 ? ['', ...notes.map((n) => `Note;${csvField(n)}`)] : [];
  return [header.join(';'), ...lines, ...noteRows].join('\n');
}
