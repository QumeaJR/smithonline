/**
 * The design tools the header opens: Auto match, Optimize band, Tolerance
 * and Build. They open in the right column at every width (docs/07 section
 * 2.2), in the side column's third segment on a tablet and in the sheet's
 * Tools segment on a phone; the chart never resizes and is never covered.
 */
export type ToolId = 'match' | 'optimize' | 'montecarlo' | 'build';
export type Tool = ToolId | null;

export interface ToolInfo {
  readonly id: ToolId;
  /** The name on its header button and in its strip segment. */
  readonly label: string;
  /** The one-line description: the Tools row on a phone, and the header tooltip after the label. */
  readonly description: string;
  /** The header tooltip when it reads better than the label and the description. */
  readonly tip?: string;
}

export const TOOLS: readonly ToolInfo[] = [
  {
    id: 'match',
    label: 'Auto match',
    description:
      'Reach the target: add L, Pi or T parts ranked by Q, yield or VSWR, tune the parts already in the network, search a broadband match, or design a quarter-wave transformer or a stub filter',
  },
  {
    id: 'optimize',
    label: 'Optimize band',
    description: 'Refine the values you have for the lowest worst VSWR over the sweep range',
  },
  {
    id: 'montecarlo',
    label: 'Tolerance',
    description:
      'Tolerance and yield: how many boards pass, which part matters, the worst case and design centring',
    tip: 'Tolerance and yield: how many boards pass, which part matters, worst case, design centring',
  },
  {
    id: 'build',
    label: 'Build',
    description:
      'How this network is built: standard values or real parts, losses, package models and the board. Saved with the design',
    tip: 'How this network is built: standard values or real parts, losses, package models and the board. Saved with the design.',
  },
];

/** The workflow anchors of the tools' buttons and rows (docs/09 section 3). */
export const TOOL_ANCHORS: Readonly<Record<ToolId, string>> = {
  match: 'header.automatch',
  optimize: 'header.optimize',
  montecarlo: 'header.tolerance',
  build: 'header.build',
};

export function toolInfo(id: ToolId): ToolInfo {
  return TOOLS.find((t) => t.id === id) as ToolInfo;
}

/** The header button's tooltip: the tool's own tip, else its name and description. */
export function toolTip(info: ToolInfo): string {
  return info.tip ?? `${info.label}: ${info.description}`;
}
