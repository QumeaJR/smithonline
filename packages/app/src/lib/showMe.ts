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
 * match at Broadband over a measured load (from the file otherwise), at
 * Transformer for the distributed designers; Optimize band in the broadband
 * workflow; Tolerance in the robust-match workflow.
 */
export function showMeTarget(tool: ToolId, mode: MatchMode | null, design: Design): ShowMeTarget {
  if (tool === 'montecarlo') return { workflow: 'robust', at: 'open' };
  if (tool === 'optimize') return { workflow: 'broadband-limits', at: 'optimize' };
  if (mode === 'transformer' || mode === 'filter') {
    return { workflow: 'broadband-limits', at: 'transformer' };
  }
  return hasMeasuredLoad(design)
    ? { workflow: 'measured-antenna', at: 'method' }
    : { workflow: 'measured-antenna' };
}
