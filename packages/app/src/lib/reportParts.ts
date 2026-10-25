import type { Element, LadderResult, Realization } from '@smithonline/core';
import { startIndex, userDatapoints } from './datapoints';
import type { Design } from './design';
import { fmtComplex, fmtFrequency } from './format';
import {
  circleTable,
  datapointTable,
  svgPiece,
  type ReportParts,
  type ReportSelection,
} from './report';

const SELECTION_KEY = 'smithonline.report.selection';

export const ALL_PARTS: ReportSelection = {
  chart: true,
  schematic: true,
  datapoints: true,
  circles: true,
};

/** The selection last used in the Report dialog; File > Print prints exactly this. */
export function readReportSelection(): ReportSelection {
  try {
    const raw = JSON.parse(localStorage.getItem(SELECTION_KEY) ?? 'null') as Partial<
      Record<keyof ReportSelection, unknown>
    > | null;
    if (!raw) return ALL_PARTS;
    return {
      chart: raw.chart !== false,
      schematic: raw.schematic !== false,
      datapoints: raw.datapoints !== false,
      circles: raw.circles !== false,
    };
  } catch {
    return ALL_PARTS;
  }
}

export function storeReportSelection(sel: ReportSelection): void {
  try {
    localStorage.setItem(SELECTION_KEY, JSON.stringify(sel));
  } catch {
    // Private mode: the selection lasts until the page is closed.
  }
}

/** The pieces of a report from the live design and the two SVGs on screen. */
/** "2: 0402, 3: 0603" for the parts that name a package; empty without any. */
export function packagesNote(elements: readonly Element[]): string {
  const named = elements.flatMap((el, i) =>
    (el.kind === 'L' || el.kind === 'C') && el.package ? [`${i + 1}: ${el.package}`] : [],
  );
  return named.length > 0 ? `Packages ${named.join(', ')}` : '';
}

export function buildReportParts(args: {
  readonly design: Design;
  readonly result: LadderResult;
  readonly realization: Realization | null;
  /** The network as built with its component packages and the board, when either applies. */
  readonly packaged?: LadderResult | null;
  /** What the network as built adds: "packages", "the board" or both. */
  readonly builtWhat?: string | null;
  /** The layout assumptions of the network as built (stackup, pads, vias, traces). */
  readonly layout?: readonly string[];
  readonly chart: SVGSVGElement | null;
  readonly schematic: SVGSVGElement | null;
  readonly sel: ReportSelection;
}): ReportParts {
  const { design, result, realization, packaged, chart, schematic, sel } = args;
  const what = args.builtWhat ?? 'packages';
  const date = new Date().toISOString().slice(0, 10);
  const dp = { count: userDatapoints(design).length, slot: startIndex(design) };
  const tables = realization
    ? [
        datapointTable(result, 'Datapoints, ideal values', dp),
        datapointTable(realization.result, `Datapoints, ${realization.sourceLabel} values`, dp),
      ]
    : [
        datapointTable(
          result,
          realization || packaged ? 'Datapoints, ideal values' : 'Datapoints',
          dp,
        ),
      ];
  if (packaged) {
    const table = datapointTable(packaged, `Datapoints, as built with ${what}`, dp);
    // The packages on the table's note line; each layout assumption on a line of its own, as
    // the BOM lists them.
    const pkgs = packagesNote(design.elements);
    const layout = args.layout ?? [];
    tables.push({
      ...table,
      ...(pkgs ? { note: `${table.note}. ${pkgs}` } : {}),
      ...(layout.length > 0 ? { notes: layout } : {}),
    });
  }
  return {
    title: design.name || 'Smith Online design',
    subtitle: `${fmtFrequency(design.frequency)}, Z0 = ${design.z0} Ω, load ${fmtComplex(design.load)} Ω, Zin ${fmtComplex(result.zin)} Ω. Smith Online, ${date}.`,
    chart: sel.chart && chart ? svgPiece(chart) : null,
    schematic: sel.schematic && schematic ? svgPiece(schematic) : null,
    datapoints: tables,
    circles: circleTable(design),
  };
}
