/**
 * The application's file and view shortcuts (docs/06-user-guide.md section 10): Ctrl+S saves
 * the design as .json, Ctrl+O opens a file, Ctrl+E opens the File menu at its Export section,
 * Ctrl+1, Ctrl+2 and Ctrl+3 switch to the Smith chart, Response and S-Plot. Cmd works for Ctrl
 * on a Mac. Like Delete and Ctrl+N they do nothing while an overlay is open.
 */
import type { View } from '../store/useDesignStore';

export type AppShortcut =
  | { readonly kind: 'save' }
  | { readonly kind: 'open' }
  | { readonly kind: 'export' }
  | { readonly kind: 'view'; readonly view: View };

/** The slice of a keyboard event the shortcuts read; a DOM KeyboardEvent fits. */
export interface ShortcutEvent {
  readonly key: string;
  readonly code?: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

const VIEWS: readonly View[] = ['chart', 'response', 'splot'];

/** The shortcut a key press asks for, or null. Shift and Alt leave the keys to the browser. */
export function appShortcut(e: ShortcutEvent): AppShortcut | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return null;
  const key = e.key.toLowerCase();
  if (key === 's') return { kind: 'save' };
  if (key === 'o') return { kind: 'open' };
  if (key === 'e') return { kind: 'export' };
  // The digit row by its position too, so a keyboard layout with symbols there works.
  const digit = /^Digit([1-3])$/.exec(e.code ?? '')?.[1] ?? (/^[1-3]$/.test(key) ? key : null);
  if (digit) return { kind: 'view', view: VIEWS[Number(digit) - 1] as View };
  return null;
}

/** What the mounted header (desktop or phone) does for the file shortcuts. */
export interface FileShortcuts {
  readonly save: () => void;
  readonly open: () => void;
  /** Open the File menu with the focus on the first entry of its Export section. */
  readonly exportMenu: () => void;
}

/**
 * The header on screen registers its actions here; the keyboard handler of the application
 * calls them synchronously, inside the key press, so the browser lets Open show its picker.
 */
export const fileShortcuts: { current: FileShortcuts | null } = { current: null };

/** The hints the File menu shows beside its entries. */
export const SHORTCUT_HINTS = {
  new: 'Ctrl+N',
  open: 'Ctrl+O',
  save: 'Ctrl+S',
  export: 'Ctrl+E',
  views: ['Ctrl+1', 'Ctrl+2', 'Ctrl+3'],
} as const;
