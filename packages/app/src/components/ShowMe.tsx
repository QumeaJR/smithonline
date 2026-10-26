import { showMeTarget } from '../lib/showMe';
import type { ToolId } from '../lib/tools';
import { WORKFLOWS } from '../lib/workflows';
import { useDesignStore } from '../store/useDesignStore';
import type { MatchMode } from '../store/useShell';
import { useTourStore } from '../store/useTourStore';

interface ShowMeProps {
  readonly tool: ToolId;
  readonly mode?: MatchMode | null;
}

/**
 * The quiet Show me beside a tool head's help link (docs/09 section 2):
 * starts the guided workflow for the tool at its first step for that tool,
 * on the design on show where the workflow can use it.
 */
export function ShowMe({ tool, mode = null }: ShowMeProps) {
  const design = useDesignStore((s) => s.design);
  const target = showMeTarget(tool, mode, design);
  const workflow = WORKFLOWS.find((w) => w.id === target.workflow);
  if (!workflow) return null;
  return (
    <button
      type="button"
      className="btn quiet sm show-me"
      title={`Start the guided workflow "${workflow.title}" here`}
      onClick={(e) => {
        e.stopPropagation();
        useTourStore
          .getState()
          .startWorkflow(workflow.id, { keep: true, ...(target.at ? { at: target.at } : {}) });
      }}
    >
      Show me
    </button>
  );
}
