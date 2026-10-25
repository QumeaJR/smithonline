import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import {
  anchorElement,
  focusQuietly,
  menuKey,
  MENU_ITEMS,
  type Anchor,
  type OverlayPrefer,
} from '../../lib/overlay';
import { useCoarsePointer } from '../../lib/pointer';
import { IconChevronRight } from './icons';
import { Popover } from './Popover';
import { Sheet } from './Sheet';

/** An action row: a label, optionally an icon, a shortcut hint and a one-line description. */
export interface MenuItem {
  readonly kind?: 'item' | undefined;
  readonly key?: string | undefined;
  readonly label: ReactNode;
  /** The text typeahead matches; default the label when it is plain text. */
  readonly text?: string | undefined;
  readonly description?: ReactNode | undefined;
  readonly hint?: string | undefined;
  readonly icon?: ReactNode | undefined;
  readonly disabled?: boolean | undefined;
  readonly title?: string | undefined;
  readonly destructive?: boolean | undefined;
  /** For a menu of choices: the one in effect (rendered as menuitemradio). */
  readonly checked?: boolean | undefined;
  readonly className?: string | undefined;
  /**
   * The menu stays open when this item is chosen (it moves the menu to another point, as the
   * context menu's chooser row does): the focus goes to the first item of the menu as it is
   * then, not back to the opener.
   */
  readonly stay?: boolean | undefined;
  readonly onSelect: () => void;
}

/** A heading between groups of items. */
export interface MenuSection {
  readonly kind: 'section';
  readonly key?: string | undefined;
  readonly label: ReactNode;
}

/** A line of explanation that is not an action. */
export interface MenuNote {
  readonly kind: 'note';
  readonly key?: string | undefined;
  readonly content: ReactNode;
}

/**
 * One row with a few choices (the ASCII export's delimiters): small buttons
 * in the row on a fine pointer, a second sheet listing them on a coarse one.
 */
export interface MenuChoices {
  readonly kind: 'choices';
  readonly key?: string | undefined;
  readonly label: string;
  readonly description?: ReactNode | undefined;
  readonly choices: readonly {
    readonly label: string;
    readonly title?: string;
    readonly onSelect: () => void;
  }[];
}

export type MenuEntry = MenuItem | MenuSection | MenuNote | MenuChoices;

export interface MenuProps {
  /** Accessible name of the menu, and the sheet title on a coarse pointer. */
  readonly label: string;
  /** A sheet title other than the label. */
  readonly title?: ReactNode | undefined;
  readonly entries: readonly MenuEntry[];
  readonly onClose: () => void;
  readonly anchor: Anchor;
  /** Classes of the popover, such as "file" or "wide". */
  readonly className?: string | undefined;
  readonly prefer?: OverlayPrefer | undefined;
  /** Items are choices with one checked (menuitemradio). */
  readonly radio?: boolean | undefined;
  /** Content above the items (the context menu's title row), inside the menu. */
  readonly header?: ReactNode | undefined;
  /** Name of the sheet's close button; default "Close" and the label. */
  readonly closeLabel?: string | undefined;
  /**
   * The key of a section to open at: the focus goes to its first item and the list scrolls to
   * the section (Ctrl+E opens the File menu at Export).
   */
  readonly focusSection?: string | undefined;
}

/**
 * A menu: File, Examples, the chart context menu, a card's overflow menu. A
 * popover placed by `positionOverlay` on a fine pointer, a sheet with 44 px
 * rows and the descriptions kept on a coarse one. Up, Down, Home, End,
 * Enter, Escape and typeahead on the first letter; a choice closes the menu,
 * returns the focus to the opener and then acts.
 */
/** The nearest ancestor that scrolls (the popover or the sheet's body), or null. */
function scrollBoxOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (p.scrollHeight > p.clientHeight && /(auto|scroll)/.test(getComputedStyle(p).overflowY)) {
      return p;
    }
  }
  return null;
}

export function Menu({
  label,
  title,
  entries,
  onClose,
  anchor,
  className,
  prefer,
  radio = false,
  header,
  closeLabel,
  focusSection,
}: MenuProps) {
  const coarse = useCoarsePointer();
  const list = useRef<HTMLDivElement>(null);
  const [sub, setSub] = useState<MenuChoices | null>(null);
  // The row that opened the sub-sheet: Escape or its close button gives the focus back to it.
  const subOpener = useRef<HTMLElement | null>(null);

  const choose = (run: () => void): void => {
    focusQuietly(anchorElement(anchor));
    setSub(null);
    onClose();
    run();
  };
  /** An item that keeps the menu open: it acts, and the focus goes to the new first item. */
  const [refocus, setRefocus] = useState(0);
  const stayWith = (run: () => void): void => {
    run();
    setRefocus((n) => n + 1);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'F1') {
      // The help opens over the application; the menu goes.
      onClose();
      return;
    }
    if (menuKey(e.currentTarget, e)) e.preventDefault();
  };

  const role = radio ? 'menuitemradio' : 'menuitem';
  const items = entries.map((entry, i) => {
    const key = entry.key ?? String(i);
    if (entry.kind === 'section') {
      return (
        <div
          key={key}
          className="dropdown-note section"
          role="presentation"
          {...(entry.key !== undefined ? { 'data-section': entry.key } : {})}
        >
          {entry.label}
        </div>
      );
    }
    if (entry.kind === 'note') {
      return (
        <div key={key} className="dropdown-note" role="presentation">
          {entry.content}
        </div>
      );
    }
    if (entry.kind === 'choices') {
      if (coarse) {
        return (
          <button
            key={key}
            type="button"
            role="menuitem"
            className="menu-item has-sub"
            aria-haspopup="dialog"
            data-text={entry.label}
            onClick={(e) => {
              subOpener.current = e.currentTarget;
              setSub(entry);
            }}
          >
            <span className="item">
              <span className="label">{entry.label}</span>
              <IconChevronRight size={16} className="sub-mark" />
            </span>
            {entry.description && <span className="desc">{entry.description}</span>}
          </button>
        );
      }
      return (
        <div key={key} className="dropdown-row" role="group" aria-label={entry.label}>
          <span className="item">{entry.label}</span>
          <span className="choices">
            {entry.choices.map((c) => (
              <button
                key={c.label}
                type="button"
                role="menuitem"
                className="btn sm"
                title={c.title}
                onClick={() => choose(c.onSelect)}
              >
                {c.label}
              </button>
            ))}
          </span>
        </div>
      );
    }
    return (
      <button
        key={key}
        type="button"
        role={role}
        className={`menu-item${entry.destructive ? ' destructive' : ''}${entry.className ? ` ${entry.className}` : ''}`}
        disabled={entry.disabled}
        title={entry.title}
        {...(radio ? { 'aria-checked': Boolean(entry.checked) } : {})}
        {...(entry.text !== undefined ? { 'data-text': entry.text } : {})}
        onClick={() => (entry.stay ? stayWith(entry.onSelect) : choose(entry.onSelect))}
      >
        <span className="item">
          {entry.icon}
          <span className="label">{entry.label}</span>
          {entry.hint && <kbd>{entry.hint}</kbd>}
        </span>
        {entry.description && <span className="desc">{entry.description}</span>}
      </button>
    );
  });

  /** The first item after the section to open at, with the list scrolled to the section. */
  const sectionItem = (): HTMLElement | null => {
    const section = Array.from(
      list.current?.querySelectorAll<HTMLElement>('[data-section]') ?? [],
    ).find((el) => el.dataset.section === focusSection);
    if (!section) return null;
    for (let el = section.nextElementSibling; el; el = el.nextElementSibling) {
      if (el instanceof HTMLElement && el.matches(MENU_ITEMS)) {
        // The list's own scroll box moves, never the page: the section heads the visible list.
        const box = scrollBoxOf(section);
        if (box) {
          box.scrollTop += section.getBoundingClientRect().top - box.getBoundingClientRect().top;
        }
        return el;
      }
    }
    return null;
  };
  const firstItem = (): HTMLElement | null =>
    (focusSection ? sectionItem() : null) ??
    list.current?.querySelector<HTMLElement>(
      radio ? '[aria-checked="true"]:not(:disabled)' : MENU_ITEMS,
    ) ??
    list.current?.querySelector<HTMLElement>(MENU_ITEMS) ??
    null;
  // After an item that keeps the menu open, the focus goes to the first item of the menu as
  // it is now (the chooser row moved the menu to another point).
  useLayoutEffect(() => {
    if (refocus > 0) focusQuietly(firstItem());
    // firstItem reads the list as it is now.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refocus]);

  return (
    <>
      <Popover
        anchor={anchor}
        onClose={onClose}
        title={title ?? label}
        label={label}
        className={className}
        sheetClassName={`menu-sheet${className ? ` ${className}` : ''}`}
        initialFocus={firstItem}
        closeLabel={closeLabel ?? `Close ${label}`}
        {...(prefer ? { prefer } : {})}
      >
        <div
          ref={list}
          role="menu"
          aria-label={label}
          className={coarse ? 'sheet-menu' : 'menu-list'}
          onKeyDown={onKeyDown}
        >
          {header}
          {items}
        </div>
      </Popover>
      {sub && (
        <Sheet
          title={sub.label}
          onClose={() => setSub(null)}
          className="menu-sheet"
          closeLabel={`Close ${sub.label}`}
          returnTo={() => subOpener.current}
        >
          <div role="menu" aria-label={sub.label} className="sheet-menu" onKeyDown={onKeyDown}>
            {sub.choices.map((c) => (
              <button
                key={c.label}
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => choose(c.onSelect)}
              >
                <span className="item">
                  <span className="label">{c.label}</span>
                </span>
                {c.title && <span className="desc">{c.title}</span>}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}
