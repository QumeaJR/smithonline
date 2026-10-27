import { IconButton } from '../components/ui/Button';
import { IconClose } from '../components/ui/icons';
import { closeToolTitle, TOOL_ANCHORS, toolInfo, type ToolId } from '../lib/tools';

export interface ToolHeadProps {
  readonly tool: ToolId;
  readonly onClose: () => void;
  /** Where the focus goes after the close: the header button (desktop), or this element. */
  readonly focusAfter?: () => HTMLElement | null;
  /** The title carries the tool's workflow anchor (phone: no header button holds it). */
  readonly anchor?: boolean;
}

/** After a close: the tool's header button takes the focus, else the given element. */
function focusAfterClose(tool: ToolId, fallback?: () => HTMLElement | null): void {
  setTimeout(() => {
    const header = document.querySelector<HTMLElement>(`.desktop-header [data-tool="${tool}"]`);
    (header ?? fallback?.() ?? null)?.focus({ preventScroll: true });
  }, 0);
}

/**
 * The head of an open tool (docs/10 section 5): its title and X, at the top of
 * the right column (desktop), the side column (tablet) or the Tools segment
 * (phone). The tool's own head row under it keeps Show me and the ? link. X
 * closes the tool; a running job goes on in the background (layout/JobRow.tsx).
 */
export function ToolHead({ tool, onClose, focusAfter, anchor = false }: ToolHeadProps) {
  const info = toolInfo(tool);

  return (
    <div className="tool-head-bar">
      <h2 className="tool-head-title" data-tour={anchor ? TOOL_ANCHORS[tool] : undefined}>
        {info.label}
      </h2>
      <IconButton
        size="sm"
        icon={<IconClose size={14} />}
        label={`Close ${info.label}`}
        title={closeToolTitle(tool)}
        onClick={() => {
          onClose();
          focusAfterClose(tool, focusAfter);
        }}
      />
    </div>
  );
}
