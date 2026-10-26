import { emptyDesign, identify, type Design } from './design';
import { tolerancePatch } from './build';
import { buildPatch, elementsOf } from './share';

/** Where the design is autosaved in the browser. */
export const DESIGN_STORAGE_KEY = 'smithonline.design.v1';

/**
 * The autosaved design, or null when there is none or it cannot be read. Its
 * elements go through the same check as a share link or a file (every field in
 * range, a microstrip's stackup normalized), so a design saved before a check
 * existed cannot bring a bad value back.
 */
export function readSavedDesign(): Design | null {
  try {
    const saved = localStorage.getItem(DESIGN_STORAGE_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved) as Design;
    if (!parsed || !parsed.load) return null;
    const elements = elementsOf(parsed.elements);
    if (!elements) return null;
    // The build is checked as a link's is; one saved before 0.6.0 has none (lib/designBuild.ts).
    const build = buildPatch((parsed as { build?: unknown }).build);
    if (!build) return null;
    const { build: _raw, tolerance: _tolerance, ...rest } = parsed;
    void _raw;
    void _tolerance;
    // Fields added since the design was saved take their defaults; the tolerance settings are
    // checked as a link's are (a VSWR limit of 1 saved before 0.6.0 opens as 2).
    return {
      ...emptyDesign(),
      ...rest,
      elements: identify(elements),
      ...tolerancePatch((parsed as { tolerance?: unknown }).tolerance),
      ...build,
    };
  } catch {
    return null;
  }
}

/** Where an autosave this version could not read is kept, so the next autosave cannot replace it. */
export const BACKUP_KEY_PREFIX = 'smithonline.design.backup';

/** The backup keys in use, oldest first. */
export function autosaveBackups(): string[] {
  const keys: string[] = [];
  try {
    for (let i = 1; i <= MAX_BACKUPS; i++) {
      const key = backupKey(i);
      if (localStorage.getItem(key) !== null) keys.push(key);
    }
  } catch {
    // Storage refuses to be read: there is nothing to list.
  }
  return keys;
}

/** More backups than anyone needs; a further unreadable autosave replaces the newest. */
const MAX_BACKUPS = 5;

const backupKey = (i: number): string =>
  i === 1 ? BACKUP_KEY_PREFIX : `${BACKUP_KEY_PREFIX}.${i}`;

/** An autosave this version could not read: its text and the backup key it is kept under. */
export interface UnreadableAutosave {
  readonly text: string;
  /** The backup key, or null when storage refused the copy (autosave is then held). */
  readonly key: string | null;
}

/**
 * While true the application does not autosave: the autosave holds a design this version could
 * not read and could not copy under a backup key, so writing would lose it. Saving a copy of it
 * as a file (the start message's button) releases it.
 */
export const autosaveHold = { held: false };

/**
 * When the autosave holds something this version cannot read (readSavedDesign gives null), it is
 * copied under a backup key before anything can write over it. Null when there is no autosave
 * or it reads. The same text is never kept twice; when storage refuses the copy, autosave is
 * held (autosaveHold) and the key is null.
 */
export function keepUnreadableAutosave(): UnreadableAutosave | null {
  let text: string | null;
  try {
    text = localStorage.getItem(DESIGN_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!text || readSavedDesign()) return null;
  try {
    let free: string | null = null;
    for (let i = 1; i <= MAX_BACKUPS; i++) {
      const key = backupKey(i);
      const kept = localStorage.getItem(key);
      if (kept === text) return { text, key };
      if (kept === null && free === null) free = key;
    }
    const key = free ?? backupKey(MAX_BACKUPS);
    localStorage.setItem(key, text);
    if (localStorage.getItem(key) === text) return { text, key };
  } catch {
    // Quota or private mode: held below.
  }
  autosaveHold.held = true;
  return { text, key: null };
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
