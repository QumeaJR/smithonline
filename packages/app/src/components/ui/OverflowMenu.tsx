import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { IconButton } from './Button';
import { IconMore } from './icons';

export interface OverflowItem {
  readonly label: string;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
  /** Danger text, for Delete. */
  readonly destructive?: boolean;
}

export interface OverflowMenuProps {
  /** Accessible name of the opener, such as "More for element 2". */
  readonly label: string;
  readonly items: readonly OverflowItem[];
}

/**
 * One button that opens a small menu of actions: the row of small buttons of
 * a ladder card on a touch screen. Escape, a tap outside or a choice closes
 * it; Up and Down move between the items and the focus returns to the opener.
 */
export function OverflowMenu({ label, items }: OverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLSpanElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    host.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    // Capture: the tool panels and dialogs stop pointerdown from bubbling to the window.
    const onPointer = (e: PointerEvent): void => {
      if (!host.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        opener.current?.focus();
      }
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const list = [
      ...(host.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ??
        []),
    ];
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === 'ArrowDown' ? (at + 1) % list.length : (at - 1 + list.length) % list.length;
    list[next]?.focus();
  };

  return (
    <span className="menu overflow" ref={host} onClick={(e) => e.stopPropagation()}>
      <IconButton
        ref={opener}
        size="sm"
        label={label}
        icon={<IconMore />}
        aria-haspopup="menu"
        aria-expanded={open}
        className={open ? 'on' : undefined}
        onClick={() => setOpen(!open)}
      />
      {open && (
        <div
          className="dropdown overflow-menu"
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
        >
          {items.map((item, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              className={item.destructive ? 'destructive' : undefined}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                opener.current?.focus();
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
