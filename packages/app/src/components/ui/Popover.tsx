import {
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  focusQuietly,
  positionOverlay,
  useEscapeLayer,
  useFocusTrap,
  useOutsidePress,
  viewportSize,
  anchorRect,
  type Anchor,
  type OverlayPrefer,
} from '../../lib/overlay';
import { useCoarsePointer } from '../../lib/pointer';
import { Sheet, type SheetDetent } from './Sheet';

export interface PopoverProps {
  readonly anchor: Anchor;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** The title of the sheet it becomes on a coarse pointer. */
  readonly title: ReactNode;
  /** Accessible name of the popover (and of the sheet when the title is not plain text). */
  readonly label?: string | undefined;
  readonly className?: string | undefined;
  /** Classes of the sheet on a coarse pointer. */
  readonly sheetClassName?: string | undefined;
  readonly role?: 'menu' | 'dialog' | 'listbox' | undefined;
  readonly prefer?: OverlayPrefer | undefined;
  /** The element to focus on open; default the first focusable one. */
  readonly initialFocus?: () => HTMLElement | null | undefined;
  readonly closeLabel?: string | undefined;
  readonly detent?: SheetDetent | undefined;
  readonly onKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void | undefined;
}

/**
 * An anchored overlay. On a fine pointer it is a popover placed by
 * `positionOverlay` (below and left-aligned with its anchor, flipped and
 * clamped inside the window); on a coarse pointer the same content is a
 * bottom sheet. Escape (through the overlay stack), a press outside and Tab
 * close it; the focus returns to the opener and the page never scrolls.
 */
export function Popover(props: PopoverProps) {
  const coarse = useCoarsePointer();
  const {
    anchor,
    onClose,
    children,
    title,
    label,
    sheetClassName,
    initialFocus,
    closeLabel,
    detent,
  } = props;
  const anchorRef = 'current' in anchor ? anchor : null;
  if (coarse) {
    return (
      <Sheet
        title={title}
        {...(label && typeof title !== 'string' ? { label } : {})}
        onClose={onClose}
        {...(sheetClassName ? { className: sheetClassName } : {})}
        {...(initialFocus ? { initialFocus } : {})}
        {...(anchorRef ? { inside: [anchorRef], returnTo: () => anchorRef.current } : {})}
        {...(closeLabel ? { closeLabel } : {})}
        {...(detent ? { detent } : {})}
      >
        {children}
      </Sheet>
    );
  }
  return <FloatingPopover {...props} />;
}

function FloatingPopover({
  anchor,
  onClose,
  children,
  label,
  className,
  role,
  prefer,
  initialFocus,
  onKeyDown,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const layer = useEscapeLayer('overlay', true, onClose, ref);
  const anchorRef = 'current' in anchor ? anchor : null;
  useFocusTrap(ref, {
    layer,
    trapTab: false,
    ...(initialFocus ? { initialFocus } : {}),
    ...(anchorRef ? { returnTo: () => anchorRef.current } : {}),
  });
  useOutsidePress(true, layer, anchorRef ? [ref, anchorRef] : [ref], onClose);

  // Placed in the layout phase, before the first paint, and again when the window changes.
  const anchorNow = useRef(anchor);
  const preferNow = useRef(prefer);
  useLayoutEffect(() => {
    anchorNow.current = anchor;
    preferNow.current = prefer;
  });
  useLayoutEffect(() => {
    const place = (): void => {
      const el = ref.current;
      if (!el) return;
      el.style.maxHeight = '';
      el.style.maxWidth = '';
      const box = el.getBoundingClientRect();
      const size = {
        width: Math.max(box.width, el.scrollWidth),
        height: Math.max(box.height, el.scrollHeight),
      };
      const pos = positionOverlay(
        anchorRect(anchorNow.current),
        size,
        viewportSize(),
        preferNow.current,
      );
      el.style.left = `${pos.left}px`;
      el.style.top = `${pos.top}px`;
      if (pos.maxHeight !== undefined) el.style.maxHeight = `${pos.maxHeight}px`;
      if (pos.maxWidth !== undefined) el.style.maxWidth = `${pos.maxWidth}px`;
      el.dataset.side = pos.side;
      el.dataset.align = pos.align;
      el.dataset.placed = '';
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, []);

  const keys = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (e.key === 'Tab') {
      // Tab leaves the popover: the focus goes back to the opener and moves on from there.
      const opener = anchorRef?.current;
      if (opener) focusQuietly(opener);
      onClose();
    }
  };

  const popover = (
    <div
      ref={ref}
      className={`dropdown popover${className ? ` ${className}` : ''}`}
      {...(role ? { role } : {})}
      {...(label ? { 'aria-label': label } : {})}
      onKeyDown={keys}
    >
      {children}
    </div>
  );
  return typeof document === 'undefined' ? popover : createPortal(popover, document.body);
}
