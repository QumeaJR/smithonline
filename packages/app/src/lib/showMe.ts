import type { Design } from './design';
import { hasMeasuredLoad } from './measuredLoad';
import type { MatchMode } from '../store/useShell';
import type { ToolId } from './tools';

/** Where a tool's Show me starts: a workflow, at the first step for that tool. */
export interface ShowMeTarget {
  readonly workflow: string;
  readonly at?: string;
}

/**
 * The workflow a tool head's Show me starts (docs/09 section 2, Tools): Auto
 * match at Broadband on the user's design (from the sample file when the
 * design is still empty), at Transformer for the distributed designers;
 * Optimize band in the broadband workflow; Tolerance in the robust-match
 * workflow. Show me starts with keep, so the workflow works on the design.
 */
export function showMeTarget(tool: ToolId, mode: MatchMode | null, design: Design): ShowMeTarget {
  if (tool === 'montecarlo') return { workflow: 'robust', at: 'open' };
  if (tool === 'optimize') return { workflow: 'broadband-limits', at: 'optimize' };
  if (mode === 'transformer' || mode === 'filter') {
    return { workflow: 'broadband-limits', at: 'transformer' };
  }
  const empty =
    !hasMeasuredLoad(design) &&
    design.elements.length === 0 &&
    design.load.re === design.z0 &&
    design.load.im === 0;
  return empty ? { workflow: 'measured-antenna' } : { workflow: 'measured-antenna', at: 'method' };
}
