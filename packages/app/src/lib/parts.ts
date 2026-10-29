/**
 * Library parts as the app shows them: the manufacturers' download pages,
 * the lines of a part's card, and the data a share link leaves out put back
 * from the part library.
 */
import {
  formatEngineering,
  inPartRange,
  isApproximatePart,
  partAt,
  partKey,
  partNominal,
  partRangeProblem,
  partSrf,
  placementNote,
  type Element,
  type LibraryPart,
  type PartElement,
} from '@smithonline/core';
import type { DesignElement } from './design';
import type { AddReport } from '../store/usePartLibrary';

/**
 * Where each manufacturer publishes its S-parameter files. Checked on
 * 2026-10-25: the Murata, Coilcraft, Johanson and KEMET pages answered; TDK's
 * server refuses automated requests, its pages were confirmed through search
 * results only. The app links to them and bundles none of their files.
 */
export const MANUFACTURER_PAGES: readonly {
  readonly name: string;
  /** The product line the page covers: with the name it makes each link's text unique. */
  readonly line: string;
  readonly what: string;
  readonly url: string;
}[] = [
  {
    name: 'Murata',
    line: 'capacitors',
    what: 'MLCC',
    url: 'https://www.murata.com/en-us/tool/data/sparameterdata/sparameter-mlcc',
  },
  {
    name: 'Murata',
    line: 'inductors',
    what: 'chip inductors',
    url: 'https://www.murata.com/en-us/tool/data/sparameterdata/sparameter-inductor',
  },
  {
    name: 'Coilcraft',
    line: 'inductors',
    what: 'SPICE models and S-parameters',
    url: 'https://www.coilcraft.com/en-us/models/spice/',
  },
  {
    name: 'Johanson Technology',
    line: 'capacitors and inductors',
    what: 'designer libraries',
    url: 'https://www.johansontechnology.com/downloads/designer-libraries-s-parameters/',
  },
  {
    name: 'KEMET',
    line: 'capacitors',
    what: 'K-SIM, S2P download',
    url: 'https://ksim3.kemet.com/',
  },
  {
    name: 'TDK',
    line: 'capacitors',
    what: 'MLCC',
    url: 'https://product.tdk.com/en/technicalsupport/tvcl/general/mlcc.html',
  },
  {
    name: 'TDK',
    line: 'inductors',
    what: 'chip inductors',
    url: 'https://product.tdk.com/en/technicalsupport/tvcl/general/ind.html',
  },
];

const eng = (v: number, unit: string, digits = 3): string => formatEngineering(v, { unit, digits });

/** "Murata GRM1555C1H100JA01", or the part number alone without a manufacturer. */
export function partTitle(part: LibraryPart): string {
  return part.manufacturer ? `${part.manufacturer} ${part.partNumber}` : part.partNumber;
}

/** The frequency range of the part's data: "10 MHz to 10 GHz". */
export function partRangeText(part: LibraryPart): string {
  return `${eng(part.range[0], 'Hz')} to ${eng(part.range[1], 'Hz')}`;
}

/** The nominal value: "10 pF", or a dash when the data gives none. */
export function partNominalText(part: LibraryPart): string {
  const v = partNominal(part);
  return v === null ? '-' : eng(v, part.type === 'C' ? 'F' : 'H');
}

/** The self-resonance: "2.58 GHz", or "above 10 GHz" when it is not in the data. */
export function partSrfText(part: LibraryPart): string {
  const srf = partSrf(part);
  return srf === null ? `above ${eng(part.range[1], 'Hz')}` : eng(srf, 'Hz', 4);
}

/** What a library part's card says at the design frequency. */
export interface PartCardInfo {
  /** "C eff 25.3 pF, Q 41 at 2 GHz", or the reason there is none. */
  readonly atF: string;
  /** "SRF 2.582 GHz". */
  readonly srf: string;
  /** Flags: out of range, approximate, a placement that differs from the fixture, data that is not passive. */
  readonly warnings: readonly string[];
  /** True when the part has no value at the design frequency. */
  readonly outOfRange: boolean;
}

/** The words of the fixture and placement selects: "in series", "to ground". */
export function placementWords(where: 'series' | 'shunt'): string {
  return where === 'series' ? 'in series' : 'to ground';
}

/**
 * The card of a library part at f. `mismatch` is why the library's part of the same name was
 * not taken for this one (libraryMismatchOf), when it was not.
 */
export function partCardInfo(el: PartElement, f: number, mismatch?: string | null): PartCardInfo {
  const p = el.part;
  const warnings: string[] = [];
  const range = partRangeProblem(p, f);
  if (range) warnings.push(`No value at ${eng(f, 'Hz')}: ${range}.`);
  if (mismatch) {
    warnings.push(
      `Approximate: not the library part of the same name (${mismatch}), so its measured data is not used; the fitted equivalent circuit the design brought stays.`,
    );
  } else if (isApproximatePart(p)) {
    warnings.push(
      'Approximate: the fitted equivalent circuit, because the part file is not in your part library. Load it there to use the measured data.',
    );
  }
  const note = placementNote(p, el.orientation);
  if (note) warnings.push(`Approximation: ${note}.`);
  const at = range ? null : partAt(p, f);
  let atF: string;
  if (!at) atF = `no value at ${eng(f, 'Hz')}`;
  else if (!at.passive) {
    // Re Z < 0: the data gives power back here. No Q, and never "lossless".
    atF = `${at.value === null ? `X ${eng(at.z.im, 'Ω')}` : `${p.type} eff ${eng(at.value, p.type === 'C' ? 'F' : 'H')}`}, ESR ${eng(at.esr, 'Ω')} at ${eng(f, 'Hz')}: not passive`;
    warnings.push(
      `Not passive at ${eng(f, 'Hz')}: the data has a negative resistance (ESR ${eng(at.esr, 'Ω')}), so it gives power back, which no real part does. Most likely measurement noise on a high-Q part; Q has no meaning there.`,
    );
  } else if (at.value === null) {
    atF = `above its resonance at ${eng(f, 'Hz')}: acts as ${p.type === 'C' ? 'an inductor' : 'a capacitor'} (X ${eng(at.z.im, 'Ω')})`;
  } else {
    const q = Number.isFinite(at.q) ? String(Number(at.q.toPrecision(3))) : 'lossless';
    atF = `${p.type} eff ${eng(at.value, p.type === 'C' ? 'F' : 'H')}, Q ${q} at ${eng(f, 'Hz')}`;
  }
  return { atF, srf: `SRF ${partSrfText(p)}`, warnings, outOfRange: range !== null };
}

/**
 * How far the fitted main value (C or L) of the library's part may differ from the one a
 * design brought before the two are taken as different parts under one name: 10 %, wider
 * than a chip part's tolerance and the drift between two releases of a manufacturer's file,
 * far narrower than the step to the next value in the range (10 pF to 12 pF is 20 %).
 */
export const ATTACH_TOLERANCE = 0.1;

const typeWord = (t: 'C' | 'L'): string => (t === 'C' ? 'a capacitor' : 'an inductor');

/** C of a fitted capacitor, L of a fitted inductor. */
function mainValue(part: LibraryPart): number {
  return part.circuit.type === 'C' ? part.circuit.c : part.circuit.l;
}

/**
 * Why the library part `lib` of the same manufacturer and part number is not the part the
 * design brought (`own`), or null when it is: another type, or a fitted value that differs by
 * more than ATTACH_TOLERANCE.
 */
export function libraryMismatch(own: LibraryPart, lib: LibraryPart): string | null {
  if (lib.type !== own.type) {
    return `your library's ${partTitle(lib)} is ${typeWord(lib.type)}, the design's ${typeWord(own.type)}`;
  }
  const a = mainValue(own);
  const b = mainValue(lib);
  if (!(Math.abs(b / a - 1) <= ATTACH_TOLERANCE)) {
    const unit = own.type === 'C' ? 'F' : 'H';
    return `your library's ${partTitle(lib)} fits ${eng(b, unit)}, the design's ${eng(a, unit)}`;
  }
  return null;
}

/** Why the library's part of this part's name is not taken for it, or null (none there, or it matches). */
export function libraryMismatchOf(
  part: LibraryPart,
  library: readonly LibraryPart[],
): string | null {
  if (part.data) return null;
  const key = partKey(part);
  const found = library.find((p) => p.data && partKey(p) === key);
  return found ? libraryMismatch(part, found) : null;
}

/**
 * The elements with every library part that came without its data (a share
 * link) given the data of the library part of the same manufacturer and part
 * number; null when nothing changes. A part that carries data keeps its own:
 * the design's copy wins. A library part of the same name that is another
 * part (libraryMismatch) is not taken: the element keeps its fitted circuit
 * and the card says why (libraryAttachProblems lists them).
 */
export function attachLibraryData(
  elements: readonly DesignElement[],
  library: readonly LibraryPart[],
): DesignElement[] | null {
  if (library.length === 0) return null;
  const byKey = new Map(library.map((p) => [partKey(p), p]));
  let changed = false;
  const out = elements.map((el) => {
    if (el.kind !== 'part' || el.part.data) return el;
    const found = byKey.get(partKey(el.part));
    if (!found?.data || libraryMismatch(el.part, found) !== null) return el;
    changed = true;
    return { ...el, part: found } as DesignElement;
  });
  return changed ? out : null;
}

/** A part that came without its data whose library namesake is another part. */
export interface AttachProblem {
  readonly index: number;
  readonly part: LibraryPart;
  readonly reason: string;
}

/** The library parts of the design that attachLibraryData refuses to fill, with the reason. */
export function libraryAttachProblems(
  elements: readonly DesignElement[],
  library: readonly LibraryPart[],
): AttachProblem[] {
  if (library.length === 0) return [];
  return elements.flatMap((el, index) => {
    if (el.kind !== 'part') return [];
    const reason = libraryMismatchOf(el.part, library);
    return reason ? [{ index, part: el.part, reason }] : [];
  });
}

/** One status line for refused attaches: "Kept the fitted circuit of element 2 (Acme X1): ...". */
export function attachProblemsText(problems: readonly AttachProblem[]): string | null {
  const first = problems[0];
  if (!first) return null;
  const more = problems.length > 1 ? ` (and ${problems.length - 1} more)` : '';
  return `Kept the fitted circuit of element ${first.index + 1} (${partTitle(first.part)})${more}: ${first.reason}, so the library's data is not used for it`;
}

/**
 * What opening a share link did with its library parts, for the status line: how many
 * arrived as fitted circuits (approximate), how many took the measured data from this
 * browser's part library, how many stay approximate, and, with Realize from the part
 * library, how many L and C found no part here. Null when the link holds no library part
 * and Realize does not use the library.
 */
export function linkPartsNote(
  elements: readonly DesignElement[],
  library: readonly LibraryPart[],
  realize: { readonly fromLibrary: boolean; readonly missing: number },
): string | null {
  const own = elements.filter(
    (el): el is DesignElement & { kind: 'part' } => el.kind === 'part' && !el.part.data,
  );
  const sentences: string[] = [];
  if (own.length > 0) {
    const byKey = new Map(library.filter((p) => p.data).map((p) => [partKey(p), p]));
    let taken = 0;
    let refused = 0;
    for (const el of own) {
      const found = byKey.get(partKey(el.part));
      if (!found) continue;
      if (libraryMismatch(el.part, found) === null) taken++;
      else refused++;
    }
    const left = own.length - taken;
    const n = (k: number, one: string, many: string): string => `${k} ${k === 1 ? one : many}`;
    let text = `The link holds ${n(own.length, 'library part', 'library parts')} as fitted circuits`;
    if (taken > 0)
      text += `; ${taken === own.length ? 'all' : taken} took the measured data from your part library`;
    if (refused > 0)
      text += `; ${refused} kept the fitted circuit because your library's part of that name is another part`;
    if (left > 0) {
      text += `; ${n(left, 'stays', 'stay')} approximate until its .s2p file is in your part library`;
    }
    sentences.push(`${text}.`);
  }
  if (realize.fromLibrary && realize.missing > 0) {
    sentences.push(
      `Realize uses your part library: ${realize.missing} ${realize.missing === 1 ? 'L or C has' : 'L and C have'} no part there and ${realize.missing === 1 ? 'stays' : 'stay'} ideal.`,
    );
  }
  return sentences.length > 0 ? sentences.join(' ') : null;
}

/**
 * Why the network has no value at f, for the status line: the first library part whose data
 * does not reach f, named with its data range. Null when every part has a value there.
 */
export function partRangeNote(elements: readonly Element[], f: number): string | null {
  const bad = elements.flatMap((el, i) =>
    el.kind === 'part' && !inPartRange(el.part.range, f) ? [{ i, part: el.part }] : [],
  );
  if (bad.length === 0) return null;
  // Each part by its number first, every one of them spelled out.
  const parts = bad.map(
    ({ i, part }, k) =>
      `${partWho(i, part)} ${k === 0 ? 'has data from' : 'from'} ${partRangeText(part)}`,
  );
  const list =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
  return `No value at ${eng(f, 'Hz', 4)}: ${list}; nothing is extrapolated past the data`;
}

/** A library part in a message: its number first, then where it sits and who makes it. */
function partWho(index: number, part: LibraryPart): string {
  return `${part.partNumber} (element ${index + 1}${part.manufacturer ? `, ${part.manufacturer}` : ''})`;
}

/**
 * The part of a sweep from lo to hi that has no value because a library part's data stops
 * short of it, for the status line and the Response view; null when the data covers it all.
 */
export function sweepRangeNote(
  elements: readonly Element[],
  lo: number,
  hi: number,
): string | null {
  let from = lo;
  let to = hi;
  let first: { i: number; part: LibraryPart } | null = null;
  for (const [i, el] of elements.entries()) {
    if (el.kind !== 'part') continue;
    const [a, b] = el.part.range;
    if (inPartRange(el.part.range, lo) && inPartRange(el.part.range, hi)) continue;
    first ??= { i, part: el.part };
    from = Math.max(from, a);
    to = Math.min(to, b);
  }
  if (!first) return null;
  const gaps: string[] = [];
  if (from > lo) gaps.push(`below ${eng(from, 'Hz')}`);
  if (to < hi) gaps.push(`above ${eng(to, 'Hz')}`);
  const where = gaps.length > 0 ? gaps.join(' and ') : 'anywhere';
  return `The sweep has no value ${where}: ${partWho(first.i, first.part)} has data from ${partRangeText(first.part)}; the chart and the plots leave that region out`;
}

/** True when the design holds a library part. */
export function hasLibraryParts(elements: readonly { readonly kind: string }[]): boolean {
  return elements.some((el) => el.kind === 'part');
}

/** One line about what a load did: "Added 3 parts; 1 file could not be read: x.s2p (reason)". */
export function addReportText(report: AddReport): string {
  const parts: string[] = [];
  const n = (k: number, one: string, many: string): string => `${k} ${k === 1 ? one : many}`;
  if (report.added.length > 0) parts.push(`Added ${n(report.added.length, 'part', 'parts')}`);
  if (report.replaced.length > 0) {
    parts.push(`replaced ${n(report.replaced.length, 'part', 'parts')} of the same name`);
  }
  if (report.unsure.length > 0) {
    parts.push(
      `check Measured for ${report.unsure.join(', ')} (the data fits "in series" and "to ground" about equally)`,
    );
  }
  if (report.failed.length > 0) {
    const shown = report.failed
      .slice(0, 3)
      .map((f) => `${f.fileName} (${f.reason})`)
      .join(', ');
    const more = report.failed.length > 3 ? ` and ${report.failed.length - 3} more` : '';
    parts.push(`${n(report.failed.length, 'file', 'files')} could not be read: ${shown}${more}`);
  }
  if (parts.length === 0) return 'No part files were read';
  const text = parts.join('; ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * What the sender of a share link is told when the design uses library parts or Realize from
 * the part library: a link carries each part as its fitted circuit only, so the recipient sees
 * an approximation, and Realize chooses from the recipient's own library. Null otherwise.
 */
export function shareLinkPartsWarning(
  elements: readonly { readonly kind: string }[],
  realizeFromLibrary: boolean,
): string | null {
  const parts = elements.filter((el) => el.kind === 'part').length;
  if (parts === 0 && !realizeFromLibrary) return null;
  const what =
    parts > 0
      ? `The link carries its ${parts === 1 ? 'library part' : `${parts} library parts`} as fitted circuits (approximate), not the measured data`
      : 'The link carries no part library';
  return `${what}; Realize from the part library uses the recipient's own library. For the full data, Save as SmithChart.Online (.json) and send the file.`;
}

/**
 * The library parts of a network for the report: "Library parts: 1 Murata GRM1555C1H100 (measured
 * data), 3 Acme X1 (fitted circuit, approximate)". Null without library parts.
 */
export function libraryPartsLine(
  elements: readonly Element[],
  label = 'Library parts',
  include: (index: number) => boolean = () => true,
): string | null {
  const items = elements.flatMap((el, i) =>
    el.kind === 'part' && include(i)
      ? [
          `${i + 1} ${partTitle(el.part)} (${isApproximatePart(el.part) ? 'fitted circuit, approximate' : placementNote(el.part, el.orientation) ? 'measured data, placed other than measured, approximate' : 'measured data'})`,
        ]
      : [],
  );
  return items.length > 0 ? `${label}: ${items.join(', ')}` : null;
}
