import { track } from './analytics/track';
import type { Design } from './design';
import { readAutosaveObject } from './share';

/** Where the design is autosaved in the browser. */
export const DESIGN_STORAGE_KEY = 'smithonline.design.v1';

/** The autosave as read: the design, or the plain reason it cannot be opened. */
export type SavedRead = { readonly value: Design } | { readonly problem: string };

/**
 * The autosave read with the reader of links and files (lib/share.ts readAutosaveObject):
 * every element checked, a microstrip's stackup normalized. Null when there is none.
 */
export function readSaved(): SavedRead | null {
  let text: string | null;
  try {
    text = localStorage.getItem(DESIGN_STORAGE_KEY);
  } catch {
    return null;
  }
  return text ? readAutosaveText(text) : null;
}

/** Autosave text read as a design, or the plain reason it cannot be opened. */
export function readAutosaveText(text: string): SavedRead {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { problem: 'it is not JSON (it may be cut short)' };
  }
  try {
    return readAutosaveObject(raw);
  } catch {
    return { problem: 'it cannot be read' };
  }
}

/** The autosaved design, or null when there is none or it cannot be opened (readSaved). */
export function readSavedDesign(): Design | null {
  const read = readSaved();
  return read && 'value' in read ? read.value : null;
}

/**
 * Where an autosave this version could not read is kept, so the next autosave cannot replace
 * it: this key, then `.2` to `.5`.
 */
export const BACKUP_KEY_PREFIX = 'smithonline.design.backup';
/**
 * Where the autosave a share link replaced is kept (main.tsx): the design the user had before
 * the link opened, which Settings, Data in this browser, opens again.
 */
export const REPLACED_KEY_PREFIX = 'smithonline.design.replaced';

/** Backups of each kind, at most. A backup is never overwritten: with all in use, nothing is. */
export const MAX_BACKUPS = 5;

/**
 * What a backup holds: an autosave this version could not open, a design a link or a project
 * replaced, the copy a tab kept of its unsaved design (TAB_COPY_PREFIX), or a deleted project
 * kept for its Undo (DELETED_PREFIX).
 */
export type BackupKind = 'unreadable' | 'replaced' | 'tab' | 'deleted';

export interface Backup {
  readonly key: string;
  readonly kind: BackupKind;
}

type SlotKind = 'unreadable' | 'replaced';

const prefixOf = (kind: SlotKind): string =>
  kind === 'unreadable' ? BACKUP_KEY_PREFIX : REPLACED_KEY_PREFIX;

const backupKey = (kind: SlotKind, i: number): string =>
  i === 1 ? prefixOf(kind) : `${prefixOf(kind)}.${i}`;

/**
 * Where a tab keeps its own copy of a design no project holds while another tab may write the
 * one autosave (docs/11 section 4): this prefix and the tab's id. The tab claims it again on a
 * reload; a closed tab's copy is listed in Settings, Data in this browser.
 */
export const TAB_COPY_PREFIX = 'smithonline.design.tab.';
/** Where a deleted project is kept until its Undo is over or done: this prefix and its id. */
export const DELETED_PREFIX = 'smithonline.design.deleted.';

/** The keys under a prefix, sorted. */
export function keysWith(prefix: string): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) out.push(key);
    }
  } catch {
    // Nothing to list.
  }
  return out.sort();
}

/**
 * The backups in this browser, the unreadable autosaves first, each kind oldest first. With
 * `ownTab`, this tab's own copy is left out (it is the design on show).
 */
export function autosaveBackups(ownTab?: string): Backup[] {
  const out: Backup[] = [];
  try {
    for (const kind of ['unreadable', 'replaced'] as const) {
      for (let i = 1; i <= MAX_BACKUPS; i++) {
        const key = backupKey(kind, i);
        if (localStorage.getItem(key) !== null) out.push({ key, kind });
      }
    }
  } catch {
    // Storage refuses to be read: there is nothing to list.
  }
  for (const key of keysWith(TAB_COPY_PREFIX)) {
    if (key !== `${TAB_COPY_PREFIX}${ownTab ?? ''}`) out.push({ key, kind: 'tab' });
  }
  for (const key of keysWith(DELETED_PREFIX)) out.push({ key, kind: 'deleted' });
  return out;
}

/**
 * Write a design under a key of its own: whole, or the lean copy (part data left out) when
 * storage refuses that. True when it is kept.
 */
export function writeDesignKey(key: string, design: Design, lean: () => Design): boolean {
  for (const make of [() => design, lean]) {
    try {
      const text = JSON.stringify(make());
      localStorage.setItem(key, text);
      if (localStorage.getItem(key) === text) return true;
    } catch {
      // The lean copy next, then nothing more to try.
    }
  }
  return false;
}

/** The design kept under a key, or null. */
export function readDesignKey(key: string): Design | null {
  let text: string | null;
  try {
    text = localStorage.getItem(key);
  } catch {
    return null;
  }
  if (text === null) return null;
  const read = readAutosaveText(text);
  return 'value' in read ? read.value : null;
}

/** How keeping a copy went: its key, or null when it could not be kept. */
export interface KeptCopy {
  readonly text: string;
  /** The backup key, or null when it could not be kept. */
  readonly key: string | null;
  /** True when every slot of its kind is in use (none is ever overwritten). */
  readonly full?: true;
}

/** Keep `text` under a free backup key of its kind; the same text is never kept twice. */
function keepCopy(kind: SlotKind, text: string): KeptCopy {
  try {
    let free: string | null = null;
    for (let i = 1; i <= MAX_BACKUPS; i++) {
      const key = backupKey(kind, i);
      const kept = localStorage.getItem(key);
      if (kept === text) return { text, key };
      if (kept === null && free === null) free = key;
    }
    if (free === null) return { text, key: null, full: true };
    localStorage.setItem(free, text);
    if (localStorage.getItem(free) === text) return { text, key: free };
  } catch {
    // Quota or private mode.
  }
  return { text, key: null };
}

/** An autosave this version could not read: its copy and why it could not be opened. */
export interface UnreadableAutosave extends KeptCopy {
  /** Why this version cannot open it ("element 1 of its network must be ..."). */
  readonly problem: string;
}

/**
 * While true the application does not autosave: the autosave holds a design this version could
 * not read and could not copy under a backup key, so writing would lose it. Saving a copy of it
 * as a file (the start message's button) releases it.
 */
export const autosaveHold = { held: false };

/**
 * When the autosave holds something this version cannot read, it is copied under a backup key
 * before anything can write over it. Null when there is no autosave or it reads. When no slot is
 * free (all five in use: none is overwritten) or storage refuses the copy, autosave is held
 * (autosaveHold) and the key is null.
 */
export function keepUnreadableAutosave(): UnreadableAutosave | null {
  let text: string | null;
  try {
    text = localStorage.getItem(DESIGN_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!text) return null;
  const read = readAutosaveText(text);
  if ('value' in read) return null;
  const kept = keepCopy('unreadable', text);
  if (kept.key === null) autosaveHold.held = true;
  return { ...kept, problem: read.problem };
}

/**
 * Before a share link replaces the autosaved design, the autosave is kept under a backup key of
 * its own, so the earlier work survives the tab being closed. Null when there is no autosave.
 */
export function keepReplacedAutosave(): KeptCopy | null {
  let text: string | null;
  try {
    text = localStorage.getItem(DESIGN_STORAGE_KEY);
  } catch {
    return null;
  }
  return text ? keepCopy('replaced', text) : null;
}

/**
 * Before a project replaces a design whose changes are not all stored (docs/11 section 3), the
 * design itself is kept under a backup key of the 'replaced' kind: the design this tab shows,
 * not the autosave, which another tab may have written since.
 */
export function keepReplacedDesign(text: string): KeptCopy {
  return keepCopy('replaced', text);
}

/** The text kept under a backup key, or null. */
export function readBackup(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Remove a backup (Settings, Data in this browser, Clear). */
export function removeBackup(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // nothing to do
  }
}

/**
 * Whether the autosave holds the design on show (its last write went through), kept for the
 * tab in session storage: a reload then knows whether a link this tab left in the address bar
 * is older than the autosave (skipped) or the only copy of the work (opened).
 */
const CURRENT_KEY = 'smithonline.autosave.current';
let currentKnown: boolean | null = null;

function markCurrent(current: boolean): void {
  if (currentKnown === current) return;
  currentKnown = current;
  try {
    sessionStorage.setItem(CURRENT_KEY, current ? '1' : '0');
  } catch {
    // No session storage: a reload opens a link left in the address bar.
  }
}

/** True when this tab's last autosave went through (see markCurrent); false when unknown. */
export function autosaveIsCurrent(): boolean {
  try {
    return sessionStorage.getItem(CURRENT_KEY) === '1';
  } catch {
    return false;
  }
}

/** Whether the last autosave written is the lean copy (part data left out for room). */
export const autosaveWritten = { lean: false };

/**
 * Autosave the design (App.tsx, on every change): the whole design with its build, or, when
 * storage refuses that (a design with large part files), the lean copy without the part data,
 * which the part library puts back on the next start. True when the autosave now holds the
 * design; false while the autosave is held or storage refuses it (private mode, full).
 */
export function writeAutosave(design: Design, lean: () => Design): boolean {
  autosaveWritten.lean = false;
  if (autosaveHold.held) {
    markCurrent(false);
    return false;
  }
  for (const make of [() => design, lean]) {
    try {
      localStorage.setItem(DESIGN_STORAGE_KEY, JSON.stringify(make()));
      markCurrent(true);
      autosaveWritten.lean = make === lean;
      return true;
    } catch {
      // The lean copy next, then nothing more to try.
    }
  }
  // Storage refused both copies (counted at most five times a page load).
  track('error', 'autosave');
  markCurrent(false);
  return false;
}
