import { HelpLink } from '../components/HelpLink';
import { ShowMe } from '../components/ShowMe';
import { IconButton } from '../components/ui/Button';
import { IconClose } from '../components/ui/icons';
import { closeToolTitle, TOOL_ANCHORS, toolInfo, type ToolId } from '../lib/tools';
import { useDesignStore } from '../store/useDesignStore';
import { useShell } from '../store/useShell';

/** The guide section each tool's ? opens, and what it is about. */
const TOOL_HELP: Readonly<Record<ToolId, { section: string; topic: string }>> = {
  match: { section: 'matching', topic: 'matching' },
  optimize: { section: 'matching', topic: 'Optimize band' },
  montecarlo: { section: 'analysis-for-building', topic: 'tolerance and yield' },
  build: { section: 'analysis-for-building', topic: 'the build of a design' },
};

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
 * The head of an open tool (docs/10 section 5.1): its title, Show me, the ?
 * link and X, fixed at the top of the right column (desktop), the side column
 * (tablet) or the Tools segment (phone), so they stay in view while the tool
 * scrolls. X closes the tool; a running job goes on in the background
 * (layout/JobRow.tsx).
 */
export function ToolHead({ tool, onClose, focusAfter, anchor = false }: ToolHeadProps) {
  const info = toolInfo(tool);
  const help = TOOL_HELP[tool];
  // Auto match's method; unset, it follows the network as the panel does (Tune with parts).
  const matchMode = useShell((s) => s.matchMode);
  const hasParts = useDesignStore((s) => s.design.elements.length > 0);
  const mode = tool === 'match' ? (matchMode ?? (hasParts ? 'tune' : 'add')) : null;

  return (
    <div className="tool-head-bar">
      <h2 className="tool-head-title" data-tour={anchor ? TOOL_ANCHORS[tool] : undefined}>
        {info.label}
      </h2>
      <span className="tool-head-links">
        <ShowMe tool={tool} mode={mode} />
        <HelpLink section={help.section} topic={help.topic} />
      </span>
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
