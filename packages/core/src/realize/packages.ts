/**
 * Component packages and their parasitics.
 *
 * A lumped L or C can name the package it is built in. The package is resolved
 * through a small table of typical parasitics (series inductance of a chip
 * capacitor, parallel capacitance and series resistance of a chip inductor,
 * pad capacitance to ground) into the element's `parasitics`, which the
 * element two-port then evaluates exactly: a capacitor becomes C + ESL (+ the
 * loss resistance from Q) in series, an inductor becomes (L + ESR + loss) in
 * parallel with Cp, and half the pad capacitance sits to ground at each pad.
 * The table values are typical figures, not data of any one part; the user
 * edits them in the application and the source note says where each row
 * comes from.
 */
import type { CapacitorElement, Element, InductorElement } from '../elements.js';

export type PackageId = '0201' | '0402' | '0603' | '0805' | '1206' | 'wirewound';

export const PACKAGE_IDS: readonly PackageId[] = [
  '0201',
  '0402',
  '0603',
  '0805',
  '1206',
  'wirewound',
];

export function isPackageId(value: unknown): value is PackageId {
  return typeof value === 'string' && (PACKAGE_IDS as readonly string[]).includes(value);
}

export interface PackageParasitics {
  readonly id: PackageId;
  readonly label: string;
  /** Series inductance (ESL) of a chip capacitor in this package, H. */
  readonly esl: number;
  /** Parallel capacitance of a chip inductor in this package, F. */
  readonly cp: number;
  /** Series resistance of a chip inductor in this package, ohm. */
  readonly esr: number;
  /** Capacitance of both pads to ground together, F. Used when the board is not in the network. */
  readonly pad: number;
  /**
   * Length of one land (pad) along the part, m. With the board in the
   * network the pad capacitance is computed from the land size and the
   * stackup instead of taken from `pad` (board.ts); 0 keeps `pad`.
   */
  readonly padLength: number;
  /** Width of one land across the part, m. */
  readonly padWidth: number;
  /** Which part kinds the package is offered for. */
  readonly parts: readonly ('L' | 'C')[];
  /** Where the typical values come from. */
  readonly source: string;
}

export type PackageTable = readonly PackageParasitics[];

const CHIP_SOURCE =
  'Typical figures: ESL as quoted for MLCCs of this size in manufacturer application notes ' +
  '(about 0.3 nH for 0201 up to 1.2 nH for 1206); Cp and ESR typical of a chip inductor of a ' +
  'few nH to a few tens of nH; pad capacitance is a parallel plate estimate with fringing on ' +
  '1.6 mm FR-4 over a ground plane. Land sizes are typical reflow lands of this size, close to ' +
  'IPC-7351 nominal density; with the board in the network the pads are computed from them and ' +
  'the stackup. Check the datasheet of the part you use and your own footprint.';

/**
 * Typical parasitics per package. The values are starting points for a
 * design review, not measurements; `normalizePackageTable` keeps the rows and
 * lets the user replace every number.
 */
export const DEFAULT_PACKAGES: PackageTable = [
  {
    id: '0201',
    label: '0201 chip',
    esl: 0.3e-9,
    cp: 0.04e-12,
    esr: 0.6,
    pad: 0.01e-12,
    padLength: 0.3e-3,
    padWidth: 0.3e-3,
    parts: ['L', 'C'],
    source: CHIP_SOURCE,
  },
  {
    id: '0402',
    label: '0402 chip',
    esl: 0.4e-9,
    cp: 0.08e-12,
    esr: 0.3,
    pad: 0.03e-12,
    padLength: 0.5e-3,
    padWidth: 0.6e-3,
    parts: ['L', 'C'],
    source: CHIP_SOURCE,
  },
  {
    id: '0603',
    label: '0603 chip',
    esl: 0.6e-9,
    cp: 0.12e-12,
    esr: 0.2,
    pad: 0.07e-12,
    padLength: 0.8e-3,
    padWidth: 0.95e-3,
    parts: ['L', 'C'],
    source: CHIP_SOURCE,
  },
  {
    id: '0805',
    label: '0805 chip',
    esl: 0.9e-9,
    cp: 0.18e-12,
    esr: 0.15,
    pad: 0.1e-12,
    padLength: 1e-3,
    padWidth: 1.4e-3,
    parts: ['L', 'C'],
    source: CHIP_SOURCE,
  },
  {
    id: '1206',
    label: '1206 chip',
    esl: 1.2e-9,
    cp: 0.25e-12,
    esr: 0.1,
    pad: 0.15e-12,
    padLength: 1.1e-3,
    padWidth: 1.8e-3,
    parts: ['L', 'C'],
    source: CHIP_SOURCE,
  },
  {
    id: 'wirewound',
    label: 'Wire-wound coil',
    esl: 0,
    cp: 1e-12,
    esr: 0.1,
    pad: 0.3e-12,
    padLength: 1e-3,
    padWidth: 1e-3,
    parts: ['L'],
    source:
      'Typical figures for a small air-core or ferrite wire-wound coil with two pads or short ' +
      'leads: winding capacitance about 1 pF, DC resistance about 0.1 ohm, pads as for a ' +
      'large chip part. Not offered for capacitors (ESL does not apply). Measure your coil ' +
      'or take the datasheet SRF when it matters.',
  },
];

export function packageById(table: PackageTable, id: string): PackageParasitics | undefined {
  return table.find((p) => p.id === id);
}

/** The packages offered for a part kind, in table order. */
export function packagesFor(table: PackageTable, part: 'L' | 'C'): PackageParasitics[] {
  return table.filter((p) => p.parts.includes(part));
}

type PackagedElement = InductorElement | CapacitorElement;

/**
 * The element with the parasitics of a package filled in: its "parasitic
 * equivalent", the ladder of C + ESL or L || Cp with pads that the two-port of
 * the element evaluates. Zero table values are left out so an ideal row gives
 * the element back without parasitics.
 */
export function packageEquivalent<T extends PackagedElement>(el: T, pkg: PackageParasitics): T {
  const parasitics =
    el.kind === 'C'
      ? { ...(pkg.esl > 0 ? { esl: pkg.esl } : {}), ...(pkg.pad > 0 ? { pad: pkg.pad } : {}) }
      : {
          ...(pkg.cp > 0 ? { cp: pkg.cp } : {}),
          ...(pkg.esr > 0 ? { esr: pkg.esr } : {}),
          ...(pkg.pad > 0 ? { pad: pkg.pad } : {}),
        };
  if (Object.keys(parasitics).length === 0) {
    const { parasitics: _dropped, ...rest } = el;
    void _dropped;
    return rest as T;
  }
  return { ...el, parasitics };
}

/** True when any inductor or capacitor names a package. */
export function hasPackages(elements: readonly Element[]): boolean {
  return elements.some((el) => (el.kind === 'L' || el.kind === 'C') && el.package !== undefined);
}

/**
 * Every element with its package resolved through the table. Elements without
 * a package, and those whose package the table does not know, are returned as
 * the same object, so a ladder without packages stays untouched.
 */
export function withPackages<T extends Element>(elements: readonly T[], table: PackageTable): T[] {
  return elements.map((el) => {
    if (el.kind !== 'L' && el.kind !== 'C') return el;
    if (el.package === undefined) return el;
    const pkg = packageById(table, el.package);
    return pkg ? packageEquivalent(el as T & PackagedElement, pkg) : el;
  });
}

/**
 * The self-resonant frequency of a part in a package, Hz: 1 / (2 pi sqrt(L C))
 * with the capacitor's ESL or the inductor's Cp. Null when the package adds
 * no resonance (no ESL or Cp) or the value is not positive.
 */
export function packageSelfResonance(el: PackagedElement, pkg: PackageParasitics): number | null {
  const lc = el.kind === 'C' ? pkg.esl * el.value : el.value * pkg.cp;
  if (!(lc > 0) || !Number.isFinite(lc)) return null;
  return 1 / (2 * Math.PI * Math.sqrt(lc));
}

/**
 * A table from stored or typed data: the default rows in their order, with
 * every number taken from the matching stored row when it is finite and not
 * negative. Labels, part kinds and source notes always come from the defaults,
 * so the note stays true to where the default numbers came from; a row whose
 * numbers were changed is marked by `isDefaultRow` returning false.
 */
export function normalizePackageTable(raw: unknown): PackageTable {
  const rows = Array.isArray(raw) ? (raw as unknown[]) : [];
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
  return DEFAULT_PACKAGES.map((d) => {
    const r = rows.find(
      (x) => typeof x === 'object' && x !== null && (x as { id?: unknown }).id === d.id,
    ) as
      Partial<Record<'esl' | 'cp' | 'esr' | 'pad' | 'padLength' | 'padWidth', unknown>> | undefined;
    if (!r) return d;
    return {
      ...d,
      esl: num(r.esl, d.esl),
      cp: num(r.cp, d.cp),
      esr: num(r.esr, d.esr),
      pad: num(r.pad, d.pad),
      padLength: num(r.padLength, d.padLength),
      padWidth: num(r.padWidth, d.padWidth),
    };
  });
}

/** True when the row still holds the default numbers. */
export function isDefaultRow(row: PackageParasitics): boolean {
  const d = packageById(DEFAULT_PACKAGES, row.id);
  return (
    d !== undefined &&
    d.esl === row.esl &&
    d.cp === row.cp &&
    d.esr === row.esr &&
    d.pad === row.pad &&
    d.padLength === row.padLength &&
    d.padWidth === row.padWidth
  );
}
