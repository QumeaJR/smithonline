import type { ReactNode } from 'react';
import { effectivePane, type LayoutKind } from '../lib/layout';
import type { ToolId } from '../lib/tools';
import { useShell, type Pane } from '../store/useShell';
import { ToolStrip } from './ToolStrip';

export interface SideColumnProps {
  readonly layout: Exclude<LayoutKind, 'phone'>;
  /** Above the strip: the tour narration on a tablet. */
  readonly top?: ReactNode | undefined;
  /** The network panel (tablet only; a desktop has it in the left column). */
  readonly network?: ReactNode | undefined;
  readonly numbers: ReactNode;
  /** The open tool's panel, or null. */
  readonly tool: ReactNode;
  readonly toolId: ToolId | null;
  readonly onCloseTool: () => void;
  /** Hidden but mounted (the S-Plot view): the panes keep their state and jobs. */
  readonly hidden?: boolean | undefined;
}

/**
 * The right column of a desktop (Numbers, and an open tool behind the strip
 * "Numbers | Auto match") and the side column of a tablet (Network | Numbers,
 * plus the tool's segment). The panes stay mounted while hidden, so a job
 * keeps running and a panel keeps its inputs when another segment shows.
 */
export function SideColumn({
  layout,
  top,
  network,
  numbers,
  tool,
  toolId,
  onCloseTool,
  hidden = false,
}: SideColumnProps) {
  const stored = useShell((s) => s.pane);
  const setPane = useShell((s) => s.setPane);
  const hasTool = toolId !== null && tool !== null;
  const pane = effectivePane(layout, stored, hasTool);
  const tablet = layout === 'tablet';
  const panes: Pane[] = [
    ...(tablet ? (['network'] as const) : []),
    'numbers',
    ...(hasTool ? (['tool'] as const) : []),
  ];
  return (
    <aside
      className={`right side-column ${tablet ? 'side-tablet' : 'side-desktop'}`}
      aria-label="Side panels"
      hidden={hidden}
    >
      {top}
      {(tablet || hasTool) && (
        <ToolStrip
          panes={panes}
          value={pane}
          onChange={setPane}
          tool={hasTool ? toolId : null}
          onCloseTool={onCloseTool}
        />
      )}
      <div className="side-scroll">
        {tablet && (
          <div className="pane pane-network" data-pane="network" hidden={pane !== 'network'}>
            {network}
          </div>
        )}
        <div className="pane pane-numbers numbers" data-pane="numbers" hidden={pane !== 'numbers'}>
          {numbers}
        </div>
        {hasTool && (
          <div className="pane pane-tool" data-pane="tool" hidden={pane !== 'tool'}>
            {tool}
          </div>
        )}
      </div>
    </aside>
  );
}
