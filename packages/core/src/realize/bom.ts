/**
 * Bill of materials from a realization: one row per lumped part, plus one row
 * per line, stub or transformer so the list is complete. Manufacturer and part
 * number columns are left blank for the user.
 */
import type { Element } from '../elements.js';
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
  readonly realized: number;
  /** SI unit symbol for ideal and realized; empty for a ratio or wavelengths text. */
  readonly unit: string;
  /** Series name, "stock" or "exact". */
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
  }
}

export function bomRows(
  realization: Realization,
  nameOf: (el: Element, index: number) => string = defaultName,
  stress?: BomStress,
): BomRow[] {
  const rows: BomRow[] = [];
  for (const re of realization.elements) {
    const name = nameOf(re.ideal, re.index);
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
      const pkg = (el.kind === 'L' || el.kind === 'C') && el.package ? el.package : undefined;
      rows.push({
        position: re.index + 1,
        element: name,
        part: p.part,
        ideal: p.ideal,
        realized: p.realized,
        unit: PART_UNIT[p.part],
        source: p.source,
        deviationPercent: p.source === 'exact' ? null : p.deviation * 100,
        detuningPercent: re.detuning !== undefined ? re.detuning * 100 : null,
        locked: re.locked,
        ...(pkg ? { pkg } : {}),
        ...(ps ? { vPeak: ps.vPeak, iRms: ps.iRms } : {}),
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

function csvField(text: string): string {
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Semicolon separated, like the datapoint export, with a header row. The
 * Package column appears when any part has one, like the stress columns; a
 * Width column when a microstrip is in the list. `notes` (the layout
 * assumptions of the network as built) follow the table after an empty line,
 * one per row under a "Note" key.
 */
export function bomCsv(rows: readonly BomRow[], notes: readonly string[] = []): string {
  const withStress = rows.some((r) => r.vPeak !== undefined);
  const withPackage = rows.some((r) => r.pkg !== undefined);
  const withWidth = rows.some((r) => r.width !== undefined);
  const header = [
    'Position',
    'Element',
    'Part',
    'Ideal',
    'Realized',
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
      formatEngineering(r.ideal, { digits: 5 }),
      formatEngineering(r.realized, { digits: 5 }),
      r.unit,
      r.source,
      r.deviationPercent === null ? '' : r.deviationPercent.toFixed(2),
      r.detuningPercent === null ? '' : r.detuningPercent.toFixed(2),
      r.locked ? 'yes' : '',
      ...(withPackage ? [r.pkg ?? ''] : []),
      ...(withWidth
        ? [r.width === undefined ? '' : formatEngineering(r.width, { digits: 5 })]
        : []),
      ...(withStress
        ? [
            r.vPeak === undefined ? '' : formatEngineering(r.vPeak, { digits: 4 }),
            r.iRms === undefined ? '' : formatEngineering(r.iRms, { digits: 4 }),
            r.overLimit ?? '',
          ]
        : []),
      '',
      '',
    ].join(';'),
  );
  const noteRows = notes.length > 0 ? ['', ...notes.map((n) => `Note;${csvField(n)}`)] : [];
  return [header.join(';'), ...lines, ...noteRows].join('\n');
}
