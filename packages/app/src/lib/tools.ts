/**
 * The design tools the header opens: Auto match, Optimize band and
 * Tolerance. They open in the right column at every width (docs/07 section
 * 2.2), in the side column's third segment on a tablet and in the sheet's
 * Tools segment on a phone; the chart never resizes and is never covered.
 */
export type ToolId = 'match' | 'optimize' | 'montecarlo';
export type Tool = ToolId | null;

export interface ToolInfo {
  readonly id: ToolId;
  /** The name on its header button and in its strip segment. */
  readonly label: string;
  /** The one-line description: the header tooltip and the Tools row on a phone. */
  readonly description: string;
}

export const TOOLS: readonly ToolInfo[] = [
  {
    id: 'match',
    label: 'Auto match',
    description:
      'Reach the target: add L, Pi or T parts ranked by Q, tune the parts already in the network, search a broadband match, or design a quarter-wave transformer or a stub filter',
  },
  {
    id: 'optimize',
    label: 'Optimize band',
    description: 'Improve the element values for the lowest worst-case VSWR over the sweep range',
  },
  {
    id: 'montecarlo',
    label: 'Tolerance',
    description:
      'Random part values within their tolerances: the cloud of input impedances, the VSWR histogram and the yield',
  },
];

export function toolInfo(id: ToolId): ToolInfo {
  return TOOLS.find((t) => t.id === id) as ToolInfo;
}
