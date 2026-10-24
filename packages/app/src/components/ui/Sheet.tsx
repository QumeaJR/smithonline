import {
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { settleSheet, useEscapeLayer, useFocusTrap, useOutsidePress } from '../../lib/overlay';
import { IconButton } from './Button';
import { IconClose } from './icons';

export type SheetDetent = 'half' | 'full';

export interface SheetProps {
  /** The title in the sheet header; also its accessible name unless `label` is given. */
  readonly title: ReactNode;
  /** Accessible name when the title is not plain text. */
  readonly label?: string | undefined;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly className?: string | undefined;
  /** The detent it opens at; the grabber moves it between half and full. */
  readonly detent?: SheetDetent | undefined;
  /** The element to focus on open; default the first focusable one. */
  readonly initialFocus?: () => HTMLElement | null | undefined;
  /** The opener the focus returns to; default the element focused on open. */
  readonly returnTo?: () => HTMLElement | null | undefined;
  /** Presses inside these (the opener) do not count as outside. */
  readonly inside?: readonly RefObject<Element | null>[] | undefined;
  /** Name of the close button, such as "Close the File menu". */
  readonly closeLabel?: string | undefined;
  /**
   * Settle at the low detent while set, so the chart above shows what a tapped
   * row previews; back to the detent it had when cleared. On the phone the low
   * detent reaches up to just below the pinned chart, so the whole ghost shows,
   * its tapped end point included; elsewhere it is about 30 percent of the window.
   */
  readonly low?: boolean | undefined;
}

/**
 * The low detent in pixels: below the phone's pinned chart hero when there is
 * one (its bottom edge is where the sheet may reach), else 30 percent of the
 * window; never under 200 px, the head and one row with its Add button.
 */
function lowDetent(): number {
  if (typeof window === 'undefined') return 220;
  const hero = document.querySelector('.phone-hero')?.getBoundingClientRect();
  const room =
    hero && hero.height > 0 ? window.innerHeight - hero.bottom : window.innerHeight * 0.3;
  return Math.round(Math.max(200, room));
}

/**
 * A bottom sheet for coarse pointers (docs/07-interaction-redesign.md section
 * 4): grabber, header with title and close button, a body that scrolls on its
 * own (`overscroll-behavior: contain`) with the safe area below. Half and full
 * detents; dragging the grabber or header moves it and a flick down closes it,
 * as do Escape, the close button and a tap on the backdrop. Focus moves in,
 * Tab stays inside and the focus returns to the opener.
 */
export function Sheet({
  title,
  label,
  onClose,
  children,
  className,
  detent: initialDetent = 'half',
  initialFocus,
  returnTo,
  inside,
  closeLabel = 'Close',
  low = false,
}: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const layer = useEscapeLayer('overlay', true, onClose, ref);
  useFocusTrap(ref, {
    layer,
    ...(initialFocus ? { initialFocus } : {}),
    ...(returnTo ? { returnTo } : {}),
  });
  useOutsidePress(true, layer, [ref, ...(inside ?? [])], onClose);
  const [detent, setDetent] = useState<SheetDetent>(initialDetent);
  const [dy, setDy] = useState(0);
  // The half detent in pixels, fixed when the sheet opens: dvh moves with Safari's toolbar.
  const [half] = useState(() =>
    typeof window === 'undefined' ? 400 : Math.round(Math.max(280, window.innerHeight * 0.6)),
  );
  // The low detent: the head and one 44 px row with its Add button at least.
  const [lowHeight] = useState(() => lowDetent());
  const drag = useRef<{ y: number; t: number; id: number } | null>(null);

  const onDown = (e: ReactPointerEvent<HTMLElement>): void => {
    // The close button keeps its own press.
    if ((e.target as HTMLElement).closest('button')) return;
    drag.current = { y: e.clientY, t: e.timeStamp, id: e.pointerId };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent<HTMLElement>): void => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setDy(Math.max(-60, e.clientY - d.y));
  };
  const onUp = (e: ReactPointerEvent<HTMLElement>): void => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const next = settleSheet(detent, e.clientY - d.y, e.timeStamp - d.t);
    setDy(0);
    if (next === 'close') onClose();
    else setDetent(next);
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

  const sheet = (
    <div className={`sheet-backdrop${low ? ' low' : ''}`}>
      <div
        ref={ref}
        className={`sheet ${detent}${low ? ' low' : ''}${className ? ` ${className}` : ''}${dy !== 0 ? ' dragging' : ''}`}
        role="dialog"
        aria-modal="true"
        {...(label ? { 'aria-label': label } : { 'aria-labelledby': titleId })}
        style={
          {
            '--sheet-half': `${half}px`,
            '--sheet-low': `${lowHeight}px`,
            ...(dy !== 0 ? { transform: `translateY(${dy}px)` } : {}),
          } as CSSProperties
        }
      >
        <div className="sheet-grab" aria-hidden="true" {...dragProps}>
          <span className="sheet-grabber" />
        </div>
        <div className="sheet-head" {...dragProps}>
          <strong id={titleId}>{title}</strong>
          <IconButton label={closeLabel} icon={<IconClose size={16} />} onClick={onClose} />
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
  return typeof document === 'undefined' ? sheet : createPortal(sheet, document.body);
}
