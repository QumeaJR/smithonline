/**
 * The tabs of the app in this browser know of each other (docs/11 section 4): each tab says
 * hello when it starts and bye when it closes, and tells the others when it changes the
 * project list. A BroadcastChannel carries the notes; where there is none, a localStorage key
 * does (its `storage` event reaches the other tabs).
 *
 * A tab that closes without a bye (a crash) stays "present" for the others: that only makes
 * them more careful (they keep their own copy of unsaved work and say so).
 */

/** What a tab tells the others. */
export type TabNote =
  | { readonly type: 'hello' }
  | { readonly type: 'here' }
  | { readonly type: 'bye' }
  /** The project list changed (a write, a delete, a new project). */
  | { readonly type: 'projects' };

interface Wire {
  readonly from: string;
  readonly note: TabNote;
}

const CHANNEL = 'smithonline.tabs';
/** The fallback: a note written here reaches the other tabs as a storage event. */
const PING_KEY = 'smithonline.tabs.ping';
/** This tab's id, kept for the tab across reloads. */
export const TAB_ID_KEY = 'smithonline.tab';

const makeId = (): string => {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return `t-${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
};

function readId(): string {
  try {
    const kept = sessionStorage.getItem(TAB_ID_KEY);
    if (kept && /^[A-Za-z0-9-]{1,40}$/.test(kept)) return kept;
    const id = makeId();
    sessionStorage.setItem(TAB_ID_KEY, id);
    return id;
  } catch {
    return makeId();
  }
}

let id = readId();
/** The other tabs that said hello or here and no bye. */
const others = new Set<string>();
const listeners = new Set<(note: TabNote, from: string) => void>();
let channel: BroadcastChannel | null = null;
let started = false;

/** This tab's id. */
export function tabId(): string {
  return id;
}

/** True when another tab of the app is (or may be) open in this browser. */
export function otherTabsOpen(): boolean {
  return others.size > 0;
}

function receive(wire: Wire): void {
  if (!wire || typeof wire.from !== 'string' || !wire.note) return;
  const { from, note } = wire;
  if (from === id) {
    // A duplicated tab took this tab's id with its session storage: the newer one (which said
    // hello) takes a new id; this one answers as before.
    if (note.type === 'here') {
      id = makeId();
      try {
        sessionStorage.setItem(TAB_ID_KEY, id);
      } catch {
        // This page keeps the new id.
      }
      post({ type: 'hello' });
      return;
    }
    if (note.type === 'hello') post({ type: 'here' });
    return;
  }
  if (note.type === 'bye') others.delete(from);
  else others.add(from);
  if (note.type === 'hello') post({ type: 'here' });
  for (const fn of listeners) fn(note, from);
}

function post(note: TabNote): void {
  const wire: Wire = { from: id, note };
  if (channel) {
    try {
      channel.postMessage(wire);
    } catch {
      // The channel is closed: the other tabs do not hear this one.
    }
    return;
  }
  try {
    localStorage.setItem(PING_KEY, JSON.stringify({ ...wire, n: Math.random() }));
  } catch {
    // No storage: the other tabs do not hear this one.
  }
}

/** Start listening and say hello (once per page). */
export function startTabs(): void {
  if (started) return;
  started = true;
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = (e: MessageEvent<Wire>) => receive(e.data);
      // Node (the tests) would wait for an open channel before it ends.
      (channel as unknown as { unref?: () => void }).unref?.();
    } catch {
      channel = null;
    }
  }
  if (!channel && typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key !== PING_KEY || !e.newValue) return;
      try {
        receive(JSON.parse(e.newValue) as Wire);
      } catch {
        // Not a note.
      }
    });
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => post({ type: 'bye' }));
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) post({ type: 'hello' });
    });
  }
  post({ type: 'hello' });
}

/** Tell the other tabs. */
export function tellTabs(note: TabNote): void {
  if (started) post(note);
}

/** Hear the other tabs' notes; returns the way to stop. */
export function onTabNote(fn: (note: TabNote, from: string) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
