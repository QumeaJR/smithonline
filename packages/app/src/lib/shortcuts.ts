/**
 * The application's file and view shortcuts (docs/06-user-guide.md section 10): Ctrl+S saves
 * the design as .json, Ctrl+O opens a file, Ctrl+E opens the File menu at its Export section
 * (Cmd works for Ctrl on a Mac); Alt+1, Alt+2 and Alt+3 switch to the Smith chart, Response
 * and S-Plot (Chrome on Windows keeps Ctrl+1 to Ctrl+8 for its tabs). Like Delete and Ctrl+N
 * they do nothing while an overlay is open.
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
const LETTERS: Readonly<Record<string, 'save' | 'open' | 'export'>> = {
  s: 'save',
  o: 'open',
  e: 'export',
};

/**
 * The letter a key press means: the key itself on a Latin layout, the key's place (`KeyS`)
 * where the layout types another script there (Cyrillic, Greek). A key name such as
 * `Process` (an IME composing) is no letter at all.
 */
function letterOf(e: ShortcutEvent): string | null {
  const key = e.key.toLowerCase();
  if (/^[a-z]$/.test(key)) return key;
  if ([...e.key].length !== 1) return null;
  return /^Key([A-Z])$/.exec(e.code ?? '')?.[1]?.toLowerCase() ?? null;
}

/**
 * The shortcut a key press asks for, or null. Shift leaves the keys to the browser; Ctrl+Alt
 * is AltGr on Windows and leaves them to the keyboard layout.
 */
export function appShortcut(e: ShortcutEvent): AppShortcut | null {
  if (e.shiftKey) return null;
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.altKey) {
    if (ctrl) return null;
    // The digit row by its place, so a layout with symbols there (or Option on a Mac) works;
    // the numeric keypad is left to Windows, where Alt with it types a character code.
    const code = e.code ?? '';
    const digit = code
      ? (/^Digit([1-3])$/.exec(code)?.[1] ?? null)
      : /^[1-3]$/.test(e.key)
        ? e.key
        : null;
    return digit ? { kind: 'view', view: VIEWS[Number(digit) - 1] as View } : null;
  }
  if (!ctrl) return null;
  const letter = letterOf(e);
  const kind = letter ? LETTERS[letter] : undefined;
  return kind ? { kind } : null;
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
  views: ['Alt+1', 'Alt+2', 'Alt+3'],
} as const;
