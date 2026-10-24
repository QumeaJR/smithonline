import { IconButton } from '../components/ui/Button';
import { IconClose } from '../components/ui/icons';
import { Progress } from '../components/ui/Progress';
import { Segmented } from '../components/ui/Segmented';
import { toolInfo, type ToolId } from '../lib/tools';
import { useJobs } from '../store/useJobs';
import type { Pane } from '../store/useShell';

export interface ToolStripProps {
  /** The segments in order: Numbers and the tool on a desktop, Network first on a tablet. */
  readonly panes: readonly Pane[];
  readonly value: Pane;
  readonly onChange: (pane: Pane) => void;
  /** The open tool, or null (a tablet still has Network | Numbers). */
  readonly tool: ToolId | null;
  readonly onCloseTool: () => void;
}

const PANE_LABELS: Readonly<Record<Exclude<Pane, 'tool'>, string>> = {
  network: 'Network',
  numbers: 'Numbers',
};

/**
 * The segmented strip at the top of the right column (desktop) or the side
 * column (tablet): "Numbers | Auto match" with the tool's close button. A job
 * that runs while its segment is not on show keeps its progress bar here.
 */
export function ToolStrip({ panes, value, onChange, tool, onCloseTool }: ToolStripProps) {
  const job = useJobs((s) => (tool ? s.jobs[tool] : undefined));
  const info = tool ? toolInfo(tool) : null;
  return (
    <div className="tool-strip">
      <div className="tool-strip-row">
        <Segmented
          size="sm"
          className="tool-strip-tabs"
          ariaLabel={info ? `Numbers or ${info.label}` : 'Side column'}
          value={value}
          onChange={onChange}
          options={panes.map((p) => ({
            value: p,
            label:
              p === 'tool' && info ? (
                <>
                  {info.label}
                  {job && value !== 'tool' && <span className="badge-dot" aria-hidden="true" />}
                </>
              ) : (
                PANE_LABELS[p as Exclude<Pane, 'tool'>]
              ),
            ...(p === 'tool' && info ? { title: info.description } : {}),
          }))}
        />
        {info && (
          <IconButton
            size="sm"
            icon={<IconClose size={14} />}
            label={`Close ${info.label}`}
            title={`Close ${info.label}; a running job stops`}
            onClick={onCloseTool}
          />
        )}
      </div>
      {job && value !== 'tool' && info && (
        <Progress
          className="strip-progress"
          ariaLabel={info.label}
          done={job.done}
          total={job.total}
          label={job.label}
        />
      )}
    </div>
  );
}
