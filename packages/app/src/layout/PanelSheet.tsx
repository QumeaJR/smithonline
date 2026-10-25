import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Button, IconButton } from '../components/ui/Button';
import { IconChevronLeft, IconChevronRight, IconClose } from '../components/ui/icons';
import { Progress } from '../components/ui/Progress';
import { Segmented } from '../components/ui/Segmented';
import { DETENTS, effectivePane, settlePanel, type SheetHeights } from '../lib/layout';
import { TOOLS, toolInfo, type ToolId } from '../lib/tools';
import { useJobs } from '../store/useJobs';
import { useDesignStore } from '../store/useDesignStore';
import { useShell, type Detent, type Pane } from '../store/useShell';
import { isHost, slotFilled, slotProps, type Slot } from './slots';

export interface PanelSheetProps {
  readonly heights: SheetHeights;
  readonly network: Slot;
  readonly numbers: Slot;
  /** The open tool's panel, or null. */
  readonly tool: Slot;
  readonly toolId: ToolId | null;
  /** A row of the Tools list: opens that tool, or pushes its panel again when it is open. */
  readonly onOpenTool: (id: ToolId) => void;
  readonly onCloseTool: () => void;
  /** A mode's banner (an armed part, datapoint input): the header at peek. */
  readonly banner?: ReactNode | undefined;
  /** The tour's title, step and Next: the header at peek. */
  readonly tourHead?: ReactNode | undefined;
  /** The tour's narration, at the top of the body from the half detent up. */
  readonly tourBody?: ReactNode | undefined;
  /** Zin and VSWR for the live strip at the full detent. */
  readonly live: ReactNode;
}

/**
 * The phone's main sheet (docs/07 section 5): the segmented control
 * Network | Numbers | Tools and three detents, peek (64 px plus the safe
 * area), half (just below the chart hero, in pixels) and full. It never goes
 * below peek. At full a 36 px live strip with Zin and VSWR sits at its top; a
 * tap drops it to half. A mode's banner or the tour takes the header at peek.
 * Tools lists the three tools with their descriptions; each pushes its panel
 * into the sheet with a back chevron that does not stop a running job.
 */
export function PanelSheet({
  heights,
  network,
  numbers,
  tool,
  toolId,
  onOpenTool,
  onCloseTool,
  banner,
  tourHead,
  tourBody,
  live,
}: PanelSheetProps) {
  const detent = useShell((s) => s.detent);
  const stored = useShell((s) => s.pane);
  const pushed = useShell((s) => s.toolPushed);
  const { setDetent, setPane, popTool } = useShell.getState();
  const jobs = useJobs((s) => s.jobs);
  const loads = useDesignStore((s) => s.loads);
  const hasTool = toolId !== null && slotFilled(tool);
  const pane = effectivePane('phone', stored, hasTool);
  const showPanel = hasTool && pushed;
  const [dy, setDy] = useState(0);
  const drag = useRef<{ y: number; t: number; id: number; moved: boolean } | null>(null);
  /** A drag of the grabber ended: its click that follows does not step the detent. */
  const dragged = useRef(false);
  const body = useRef<HTMLDivElement>(null);
  // A design loaded (an example, a file, a link): the sheet starts again at its top.
  useEffect(() => {
    if (body.current) body.current.scrollTop = 0;
  }, [loads]);

  const onDown = (e: ReactPointerEvent<HTMLElement>): void => {
    // Buttons, segments and fields keep their own press; the grabber is the exception.
    const t = e.target as HTMLElement;
    if (t.closest('button, input, select, textarea, a') && !t.closest('.sheet-grab')) return;
    drag.current = { y: e.clientY, t: e.timeStamp, id: e.pointerId, moved: false };
    dragged.current = false;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent<HTMLElement>): void => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const delta = e.clientY - d.y;
    if (Math.abs(delta) > 4) d.moved = true;
    // Within the detents: never below peek, never above full.
    const height = Math.min(heights.full, Math.max(heights.peek, heights[detent] - delta));
    setDy(heights[detent] - height);
  };
  const onUp = (e: ReactPointerEvent<HTMLElement>): void => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setDy(0);
    if (!d.moved) return;
    // Only the grabber gets the click that ends its own drag; the flag lasts until that click
    // has passed, so a later press or Enter on the grabber steps again.
    if ((e.currentTarget as HTMLElement).classList.contains('sheet-grab')) {
      dragged.current = true;
      setTimeout(() => {
        dragged.current = false;
      }, 0);
    }
    setDetent(settlePanel(heights, detent, e.clientY - d.y, e.timeStamp - d.t));
  };
  const dragProps = {
    onPointerDown: onDown,
    onPointerMove: onMove,
    onPointerUp: onUp,
    onPointerCancel: () => {
      drag.current = null;
      setDy(0);
    },
  };
  /** The grabber as a button: a press steps peek, half, full, half; the arrow keys move it. */
  const step = (): void =>
    setDetent(detent === 'peek' ? 'half' : detent === 'half' ? 'full' : 'half');
  const onGrabKey = (e: ReactKeyboardEvent<HTMLButtonElement>): void => {
    const at = DETENTS.indexOf(detent);
    const next =
      e.key === 'ArrowUp'
        ? at + 1
        : e.key === 'ArrowDown'
          ? at - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? DETENTS.length - 1
              : null;
    if (next === null) return;
    e.preventDefault();
    setDetent(DETENTS[Math.min(DETENTS.length - 1, Math.max(0, next))] as Detent);
  };

  const lead = banner ?? tourHead ?? null;
  const toolJob = toolId ? jobs[toolId] : undefined;
  // A job keeps its progress in the header while its panel is not on show.
  const jobInHead =
    toolJob !== undefined &&
    toolId !== null &&
    !(pane === 'tool' && showPanel && detent !== 'peek');
  const height = heights[detent] - dy;

  return (
    <section
      className={`panel-sheet detent-${detent}${dy !== 0 ? ' dragging' : ''}`}
      aria-label="Panels"
      data-detent={detent}
      style={{ '--panel-h': `${height}px` } as CSSProperties}
    >
      <button
        type="button"
        className="sheet-grab"
        aria-label={`Panel size: ${detent}. Press to change, or drag`}
        onClick={() => {
          if (dragged.current) {
            dragged.current = false;
            return;
          }
          step();
        }}
        onKeyDown={onGrabKey}
        {...dragProps}
      >
        <span className="sheet-grabber" aria-hidden="true" />
      </button>
      {detent === 'full' && (
        <button
          type="button"
          className="live-strip mono"
          onClick={() => setDetent('half')}
          title="Back to half, with the chart in view"
        >
          {live}
        </button>
      )}
      <div className="panel-sheet-head" {...dragProps}>
        {lead && <div className="sheet-lead">{lead}</div>}
        {(!lead || detent !== 'peek') && (
          <Segmented
            className="panel-tabs"
            ariaLabel="Panels"
            value={pane}
            onChange={(p: Pane) => {
              setPane(p);
              if (detent === 'peek') setDetent('half');
            }}
            options={[
              { value: 'network', label: 'Network' },
              { value: 'numbers', label: 'Numbers' },
              {
                value: 'tool',
                label: (
                  <>
                    Tools
                    {toolJob && pane !== 'tool' && (
                      <span className="badge-dot" aria-hidden="true" />
                    )}
                  </>
                ),
              },
            ]}
          />
        )}
        {jobInHead && toolJob && toolId && (
          <Progress
            className="strip-progress"
            ariaLabel={toolInfo(toolId).label}
            done={toolJob.done}
            total={toolJob.total}
            label={`${toolInfo(toolId).label}: ${toolJob.label}`}
          />
        )}
      </div>
      <div className="panel-sheet-body" ref={body}>
        {detent !== 'peek' && tourBody}
        <div
          className="pane pane-network"
          data-pane="network"
          hidden={pane !== 'network'}
          {...slotProps(network)}
        />
        <div
          className="pane pane-numbers numbers"
          data-pane="numbers"
          hidden={pane !== 'numbers'}
          {...slotProps(numbers)}
        />
        <div className="pane pane-tools" data-pane="tool" hidden={pane !== 'tool'}>
          <ul className="tools-list" aria-label="Tools" hidden={showPanel}>
            {TOOLS.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  className={`tools-row${toolId === t.id ? ' open' : ''}`}
                  onClick={() => onOpenTool(t.id)}
                >
                  <span className="tools-row-text">
                    <strong>
                      {t.label}
                      {jobs[t.id] && <span className="badge-dot" aria-label="running" />}
                    </strong>
                    <span className="desc">{t.description}</span>
                  </span>
                  <IconChevronRight size={16} />
                </button>
              </li>
            ))}
          </ul>
          {hasTool && toolId && (
            <div
              className="pushed-tool"
              hidden={!showPanel}
              ref={isHost(tool) ? tool.adopt : undefined}
            >
              <div className="pushed-head">
                <Button
                  variant="quiet"
                  className="back"
                  onClick={popTool}
                  aria-label="Back to the tools"
                  title="Back to the tools; a running job keeps running"
                >
                  <IconChevronLeft size={16} /> Tools
                </Button>
                <strong>{toolInfo(toolId).label}</strong>
                <IconButton
                  size="sm"
                  icon={<IconClose size={14} />}
                  label={`Close ${toolInfo(toolId).label}`}
                  title={`Close ${toolInfo(toolId).label}; a running job stops`}
                  onClick={() => {
                    onCloseTool();
                    // The panel goes from under the focus: the segment now on show takes it.
                    setTimeout(() => {
                      document
                        .querySelector<HTMLElement>('.panel-tabs [aria-selected="true"]')
                        ?.focus({ preventScroll: true });
                    }, 0);
                  }}
                />
              </div>
              {isHost(tool) ? null : tool}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
