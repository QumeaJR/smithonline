import { Segmented } from '../components/ui/Segmented';
import { effectivePane, type LayoutKind } from '../lib/layout';
import type { ToolId } from '../lib/tools';
import { useSeenWhileShown } from '../store/useJobs';
import { useShell, type Pane } from '../store/useShell';
import { JobRow } from './JobRow';
import { slotFilled, slotProps, type Slot } from './slots';
import { ToolHead } from './ToolHead';

export interface SideColumnProps {
  readonly layout: Exclude<LayoutKind, 'phone'>;
  /** Above the head: the tour narration on a tablet. */
  readonly top?: Slot | undefined;
  /** The network panel (tablet only; a desktop has it in the left column). */
  readonly network?: Slot | undefined;
  readonly numbers: Slot;
  /** The tool panels (the open one, and closed ones whose job runs), or null. */
  readonly tool: Slot;
  /** The open tool, or null. */
  readonly toolId: ToolId | null;
  readonly onCloseTool: () => void;
  /** Show a closed busy tool again (the job row's Show). */
  readonly onOpenTool: (id: ToolId) => void;
  /** Hidden but mounted (the S-Plot view): the panes keep their state and jobs. */
  readonly hidden?: boolean | undefined;
}

/**
 * The right column of a desktop (Numbers, or the open tool under its head)
 * and the side column of a tablet (Network | Numbers, or the open tool under
 * its head), docs/10 section 5. A job row on top shows a search that runs on
 * after its tool was closed. The panes stay mounted while hidden, so a job
 * keeps running and a panel keeps its inputs. A slot is React content or the
 * shell's host node (layout/slots.ts), which the pane adopts, so the panel
 * survives a change of layout.
 */
export function SideColumn({
  layout,
  top,
  network,
  numbers,
  tool,
  toolId,
  onCloseTool,
  onOpenTool,
  hidden = false,
}: SideColumnProps) {
  const stored = useShell((s) => s.pane);
  const setPane = useShell((s) => s.setPane);
  const hasTool = toolId !== null;
  const pane = effectivePane(layout, stored, hasTool);
  const tablet = layout === 'tablet';
  // A finished job's check dot goes once its tool is on show.
  useSeenWhileShown(toolId, hasTool && !hidden);
  return (
    <aside
      className={`right side-column ${tablet ? 'side-tablet' : 'side-desktop'}`}
      aria-label="Side panels"
      hidden={hidden}
    >
      {slotFilled(top) && <div className="side-top" {...slotProps(top)} />}
      <JobRow onShow={onOpenTool} />
      {toolId !== null ? (
        <ToolHead tool={toolId} onClose={onCloseTool} />
      ) : (
        tablet && (
          <div className="side-tabs">
            <Segmented
              size="sm"
              className="side-tabs-control"
              ariaLabel="Side column"
              value={pane}
              onChange={(p: Pane) => setPane(p)}
              options={[
                { value: 'network', label: 'Network' },
                { value: 'numbers', label: 'Numbers' },
              ]}
            />
          </div>
        )
      )}
      <div className="side-scroll">
        {tablet && (
          <div
            className="pane pane-network"
            data-pane="network"
            hidden={pane !== 'network'}
            {...slotProps(network)}
          />
        )}
        <div
          className="pane pane-numbers numbers"
          data-pane="numbers"
          hidden={pane !== 'numbers'}
          {...slotProps(numbers)}
        />
        {slotFilled(tool) && (
          <div
            className="pane pane-tool"
            data-pane="tool"
            hidden={pane !== 'tool'}
            {...slotProps(tool)}
          />
        )}
      </div>
    </aside>
  );
}
