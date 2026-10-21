/**
 * Bill of materials from a realization: one row per lumped part, plus one row
 * per line, stub or transformer so the list is complete. Manufacturer and part
 * number columns are left blank for the user.
 */
import type { Element } from '../elements.js';
import { formatEngineering } from '../units.js';
import type { PartKind, Realization } from './snap.js';

export interface BomRow {
  /** 1-based position in the ladder, load side first. */
  readonly position: number;
  readonly element: string;
  /** R, L, C, or the element kind for distributed parts. */
  readonly part: PartKind | 'line' | 'openStub' | 'shortStub' | 'transformer';
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
  }
}

export function bomRows(
  realization: Realization,
  nameOf: (el: Element, index: number) => string = defaultName,
): BomRow[] {
  const rows: BomRow[] = [];
  for (const re of realization.elements) {
    const name = nameOf(re.ideal, re.index);
    if (re.parts.length === 0) {
      const el = re.ideal;
      const value =
        el.kind === 'transformer'
          ? el.n
          : el.kind === 'line' || el.kind === 'openStub' || el.kind === 'shortStub'
            ? el.length
            : 0;
      rows.push({
        position: re.index + 1,
        element: name,
        part: el.kind as BomRow['part'],
        ideal: value,
        realized: value,
        unit: el.kind === 'transformer' ? '' : 'λ',
        source: 'exact',
        deviationPercent: null,
        detuningPercent: null,
        locked: re.locked,
      });
      continue;
    }
    for (const p of re.parts) {
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
      });
    }
  }
  return rows;
}

function csvField(text: string): string {
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Semicolon separated, like the datapoint export, with a header row. */
export function bomCsv(rows: readonly BomRow[]): string {
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
      '',
      '',
    ].join(';'),
  );
  return [header.join(';'), ...lines].join('\n');
}
