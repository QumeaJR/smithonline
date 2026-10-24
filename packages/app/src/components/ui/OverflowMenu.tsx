import { useRef, useState } from 'react';
import { IconButton } from './Button';
import { IconMore } from './icons';
import { Menu } from './Menu';

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
 * a ladder card on a touch screen. It is a `Menu`: a sheet on a coarse
 * pointer, a popover on a fine one; Escape, a tap outside or a choice closes
 * it and the focus returns to the opener.
 */
export function OverflowMenu({ label, items }: OverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);

  return (
    // A click in the menu stays out of the card behind it (React bubbles through the portal).
    <span className="menu overflow" onClick={(e) => e.stopPropagation()}>
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
        <Menu
          label={label}
          anchor={opener}
          onClose={() => setOpen(false)}
          className="overflow-menu"
          prefer={{ align: 'end' }}
          entries={items.map((item) => ({
            label: item.label,
            onSelect: item.onSelect,
            ...(item.disabled ? { disabled: true } : {}),
            ...(item.destructive ? { destructive: true } : {}),
          }))}
        />
      )}
    </span>
  );
}
