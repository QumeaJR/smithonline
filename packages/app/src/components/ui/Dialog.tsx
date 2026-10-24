import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useCloseOnRequest } from '../../lib/dialogs';
import {
  clampOffset,
  dialogPosition,
  rememberDialogPosition,
  useEscapeLayer,
  useFocusTrap,
  viewportSize,
  type Offset,
  type Rect,
} from '../../lib/overlay';
import { useCoarsePointer } from '../../lib/pointer';
import { Button, IconButton } from './Button';
import { IconClose } from './icons';

export interface DialogProps {
  /** The title in the title bar; it names the dialog. */
  readonly title: ReactNode;
  /** A muted line beside the title (under it on a coarse pointer). */
  readonly subtitle?: ReactNode | undefined;
  readonly onClose: () => void;
  /** Name of the close button, such as "Close settings". */
  readonly closeLabel: string;
  /** Classes beside "modal", such as "settings". */
  readonly className?: string | undefined;
  /** The actions row, sticky at the bottom; the last child of the dialog. */
  readonly footer?: ReactNode | undefined;
  readonly children: ReactNode;
  /**
   * Draggable by its title bar on a fine pointer, its position remembered for
   * the session under this key (Dimensions, Winding, Report, Import).
   */
  readonly draggable?: string | undefined;
  /** The element to focus on open; default the first focusable one after the title bar. */
  readonly initialFocus?: () => HTMLElement | null | undefined;
  /** The word on the close button of the full-screen sheet on a coarse pointer. */
  readonly doneLabel?: 'Done' | 'Close' | undefined;
}

/**
 * The one dialog of the application (Settings, Report, Help, Dimensions,
 * Winding, Import): a title bar, a body that scrolls inside the window budget
 * of the backdrop (`--backdrop-pad`), and a sticky actions row. Escape goes to
 * the top dialog only through the overlay stack, the focus is trapped inside
 * and returns to the opener, and the page never scrolls when it opens. On a
 * coarse pointer it is a full-screen sheet with a top bar (title centred,
 * Done); on a fine pointer the result dialogs can be dragged by the title bar.
 */
export function Dialog({
  title,
  subtitle,
  onClose,
  closeLabel,
  className,
  footer,
  children,
  draggable,
  initialFocus,
  doneLabel = 'Done',
}: DialogProps) {
  const coarse = useCoarsePointer();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const layer = useEscapeLayer('overlay', true, onClose, ref);
  useFocusTrap(ref, {
    layer,
    initialFocus:
      initialFocus ??
      (() => {
        const box = ref.current;
        if (!box) return null;
        // On a touch screen a focused field would raise the keyboard over the sheet.
        const done = box.querySelector<HTMLElement>('.topbar-done');
        if (done) return done;
        const head = box.querySelector('.tool-head');
        const items = [
          ...box.querySelectorAll<HTMLElement>(
            'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
          ),
        ];
        return items.find((el) => !head?.contains(el)) ?? items[0] ?? box;
      }),
  });
  useCloseOnRequest(onClose);

  const canDrag = Boolean(draggable) && !coarse;
  const offset = useRef<Offset>({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; from: Offset; id: number } | null>(null);

  /** Where the dialog sits with no offset, from where it sits now. */
  const natural = (): Rect | null => {
    const el = ref.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: r.left - offset.current.x,
      top: r.top - offset.current.y,
      width: r.width,
      height: r.height,
    };
  };
  const apply = (next: Offset): void => {
    offset.current = next;
    const el = ref.current;
    if (el) el.style.transform = next.x || next.y ? `translate(${next.x}px, ${next.y}px)` : '';
  };

  // A dialog moved earlier in the session opens where it was left, still inside the window.
  useLayoutEffect(() => {
    if (!canDrag || !draggable) return;
    const saved = dialogPosition(draggable);
    const rect = natural();
    if (saved && rect) apply(clampOffset(saved, rect, viewportSize()));
    // On open only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canDrag]);

  // A window that shrinks pulls a moved dialog back inside, so its title bar and actions row
  // stay reachable.
  useEffect(() => {
    if (!canDrag) return;
    const onResize = (): void => {
      if (drag.current) return;
      const rect = natural();
      if (rect && (offset.current.x || offset.current.y)) {
        apply(clampOffset(offset.current, rect, viewportSize()));
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [canDrag]);

  const onDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!canDrag || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, input, select, a, textarea')) return;
    drag.current = { x: e.clientX, y: e.clientY, from: offset.current, id: e.pointerId };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    const rect = natural();
    if (!d || d.id !== e.pointerId || !rect) return;
    apply(
      clampOffset(
        { x: d.from.x + e.clientX - d.x, y: d.from.y + e.clientY - d.y },
        rect,
        viewportSize(),
      ),
    );
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (draggable) rememberDialogPosition(draggable, offset.current);
  };

  return (
    <div
      className={`modal-backdrop${coarse ? ' full' : ''}`}
      onPointerDown={(e) => {
        // The dialog's own presses stay inside it (a card behind must not take them).
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        ref={ref}
        className={`modal${className ? ` ${className}` : ''}${coarse ? ' sheet-full' : ''}${canDrag ? ' draggable' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {coarse ? (
          <div className="tool-head dialog-topbar">
            <span className="topbar-side" aria-hidden="true" />
            <strong id={titleId}>{title}</strong>
            <span className="topbar-side end">
              <Button variant="quiet" className="topbar-done" onClick={onClose}>
                {doneLabel}
              </Button>
            </span>
          </div>
        ) : (
          <div
            className="tool-head"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={() => {
              drag.current = null;
            }}
            title={canDrag ? 'Drag the title bar to move the dialog' : undefined}
          >
            <strong id={titleId}>{title}</strong>
            {subtitle !== undefined ? (
              <span className="muted">{subtitle}</span>
            ) : (
              <span className="muted" />
            )}
            <IconButton
              size="sm"
              label={closeLabel}
              icon={<IconClose size={13} />}
              onClick={onClose}
            />
          </div>
        )}
        {coarse && subtitle !== undefined && (
          <div className="dialog-subtitle muted">{subtitle}</div>
        )}
        {children}
        {footer !== undefined && <div className="actions">{footer}</div>}
      </div>
    </div>
  );
}
