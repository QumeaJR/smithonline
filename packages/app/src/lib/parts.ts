/**
 * Library parts as the app shows them: the manufacturers' download pages,
 * the lines of a part's card, and the data a share link leaves out put back
 * from the part library.
 */
import {
  formatEngineering,
  isApproximatePart,
  partAt,
  partKey,
  partNominal,
  partRangeProblem,
  partSrf,
  placementNote,
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
  readonly what: string;
  readonly url: string;
}[] = [
  {
    name: 'Murata',
    what: 'capacitors (MLCC)',
    url: 'https://www.murata.com/en-us/tool/data/sparameterdata/sparameter-mlcc',
  },
  {
    name: 'Murata',
    what: 'inductors',
    url: 'https://www.murata.com/en-us/tool/data/sparameterdata/sparameter-inductor',
  },
  {
    name: 'Coilcraft',
    what: 'inductors (SPICE models and S-parameters)',
    url: 'https://www.coilcraft.com/en-us/models/spice/',
  },
  {
    name: 'Johanson Technology',
    what: 'capacitors and inductors',
    url: 'https://www.johansontechnology.com/downloads/designer-libraries-s-parameters/',
  },
  { name: 'KEMET', what: 'capacitors (K-SIM, S2P download)', url: 'https://ksim3.kemet.com/' },
  {
    name: 'TDK',
    what: 'capacitors (MLCC)',
    url: 'https://product.tdk.com/en/technicalsupport/tvcl/general/mlcc.html',
  },
  {
    name: 'TDK',
    what: 'inductors',
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
  /** Flags: out of range, approximate, a placement that differs from the fixture. */
  readonly warnings: readonly string[];
  /** True when the part has no value at the design frequency. */
  readonly outOfRange: boolean;
}

export function partCardInfo(el: PartElement, f: number): PartCardInfo {
  const p = el.part;
  const warnings: string[] = [];
  const range = partRangeProblem(p, f);
  if (range) warnings.push(`No value at ${eng(f, 'Hz')}: ${range}.`);
  if (isApproximatePart(p)) {
    warnings.push(
      'Approximate: the fitted equivalent circuit, because the part file is not in your part library. Load it there to use the measured data.',
    );
  }
  const note = placementNote(p, el.orientation);
  if (note) warnings.push(`Approximation: ${note}.`);
  const at = range ? null : partAt(p, f);
  let atF: string;
  if (!at) atF = `no value at ${eng(f, 'Hz')}`;
  else if (at.value === null) {
    atF = `above its resonance at ${eng(f, 'Hz')}: acts as ${p.type === 'C' ? 'an inductor' : 'a capacitor'} (X ${eng(at.z.im, 'Ω')})`;
  } else {
    const q = Number.isFinite(at.q) ? String(Number(at.q.toPrecision(3))) : 'lossless';
    atF = `${p.type} eff ${eng(at.value, p.type === 'C' ? 'F' : 'H')}, Q ${q} at ${eng(f, 'Hz')}`;
  }
  return { atF, srf: `SRF ${partSrfText(p)}`, warnings, outOfRange: range !== null };
}

/**
 * The elements with every library part that came without its data (a share
 * link) given the data of the library part of the same manufacturer and part
 * number; null when nothing changes. A part that carries data keeps its own:
 * the design's copy wins.
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
    if (!found?.data) return el;
    changed = true;
    return { ...el, part: found } as DesignElement;
  });
  return changed ? out : null;
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
      `check the fixture of ${report.unsure.join(', ')} (the data fits series and shunt about equally)`,
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
