/**
 * The usage counts of docs/10 section 1.4: `track(event, a, b, c)` queues an
 * event whose every field is a closed list (schema.ts); the queue is sent in
 * batches to `/api/e` on the same origin. Nothing is sent when the Settings
 * switch is off, the browser sends Global Privacy Control or Do Not Track, or
 * the page is not on the production host. Failure is silent: no retry, no
 * storage, no queue kept across page loads. The app works the same without
 * `/api` (offline, an ad blocker).
 */
import { layoutForWidth } from '../layout';
import {
  BATCH_VERSION,
  MAX_EVENTS,
  MAX_REPEATS,
  ONCE_PER_START,
  VERSION_RE,
  type EventA,
  type EventB,
  type EventC,
  type EventContext,
  type EventName,
  type WireEvent,
} from './schema';

export const EVENTS_PATH = '/api/e';
/** The host the counts come from; previews and localhost send nothing. */
export const PRODUCTION_HOST = 'smithchart.online';
/** While events wait, they go out at least this often, ms. */
export const FLUSH_MS = 60_000;

/** What decides whether counts may be sent; read from the browser unless a test gives it. */
export interface Gate {
  /** The Settings switch Share anonymous usage counts. */
  readonly switchOn: boolean;
  readonly globalPrivacyControl: boolean;
  readonly doNotTrack: boolean;
  readonly host: string;
  /** VITE_ANALYTICS_DEV=1: send from any host (a local check of the Worker). */
  readonly devOverride: boolean;
}

/** Whether the browser asks sites not to track: Global Privacy Control or Do Not Track. */
export function browserOptOut(nav: Navigator | undefined = globalThis.navigator): boolean {
  if (!nav) return false;
  const n = nav as Navigator & { globalPrivacyControl?: boolean; doNotTrack?: string | null };
  const w = globalThis as { doNotTrack?: string | null };
  return n.globalPrivacyControl === true || n.doNotTrack === '1' || w.doNotTrack === '1';
}

export function allowedBy(g: Gate): boolean {
  if (!g.switchOn || g.globalPrivacyControl || g.doNotTrack) return false;
  return g.devOverride || g.host === PRODUCTION_HOST;
}

/** The switch's state, set by the settings store (lib/analytics/index.ts wires it). */
let switchOn = true;
export function setSwitch(on: boolean): void {
  switchOn = on;
  if (!on) queue.length = 0;
}

function devOverride(): boolean {
  try {
    return import.meta.env?.VITE_ANALYTICS_DEV === '1';
  } catch {
    return false;
  }
}

/** The gate as the browser has it now. */
export function currentGate(): Gate {
  const nav = globalThis.navigator as
    (Navigator & { globalPrivacyControl?: boolean; doNotTrack?: string | null }) | undefined;
  return {
    switchOn,
    globalPrivacyControl: nav?.globalPrivacyControl === true,
    doNotTrack:
      nav?.doNotTrack === '1' || (globalThis as { doNotTrack?: string }).doNotTrack === '1',
    host: globalThis.location?.hostname ?? '',
    devOverride: devOverride(),
  };
}

export function analyticsAllowed(): boolean {
  return allowedBy(currentGate());
}

declare const __APP_VERSION__: string | undefined;

/** The app version, from package.json at build time. */
export function appVersion(): string {
  const v = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
  return VERSION_RE.test(v) ? v : '0.0.0';
}

/** The context of every batch: version, layout, pointer, theme, installed or not. */
export function currentContext(): EventContext {
  const w = globalThis.window;
  const mm = (q: string): boolean => {
    try {
      return Boolean(w?.matchMedia?.(q).matches);
    } catch {
      return false;
    }
  };
  const attr = globalThis.document?.documentElement.getAttribute('data-theme');
  const dark = attr === 'dark' || (attr !== 'light' && mm('(prefers-color-scheme: dark)'));
  return {
    ver: appVersion(),
    lay: layoutForWidth(w?.innerWidth ?? 1440),
    ptr: mm('(pointer: coarse)') ? 'coarse' : 'fine',
    thm: dark ? 'dark' : 'light',
    pwa: mm('(display-mode: standalone)') ? 'app' : 'browser',
  };
}

const queue: WireEvent[] = [];
/** Events taken this page load (at most MAX_EVENTS), and how often each one was. */
let taken = 0;
const repeats = new Map<string, number>();

/**
 * Count one use of a feature. Typed: only the schema's events and values
 * compile. A no-op when counts are off; quiet when the page load's 60 are used
 * up or the same event came 5 times (`job` and `plot`: once).
 */
export function track<E extends EventName>(
  event: E,
  a: EventA<E>,
  b?: EventB<E>,
  c?: EventC<E>,
): void {
  if (!analyticsAllowed()) return;
  if (taken >= MAX_EVENTS) return;
  const ev: string[] = [event, a];
  if (b !== undefined) ev.push(b as string);
  if (b !== undefined && c !== undefined) ev.push(c as string);
  const key = ev.join('\u0000');
  const max = ONCE_PER_START.includes(event) ? 1 : MAX_REPEATS;
  const seen = repeats.get(key) ?? 0;
  if (seen >= max) return;
  repeats.set(key, seen + 1);
  taken++;
  queue.push(ev as unknown as WireEvent);
  ensureTimer();
}

/** The request body for the queued events: `{"v":1,"ctx":{...},"ev":[...]}`. */
export function batchBody(
  events: readonly WireEvent[],
  ctx: EventContext = currentContext(),
): string {
  return JSON.stringify({ v: BATCH_VERSION, ctx, ev: events });
}

export interface Sender {
  beacon?: (url: string, data: Blob) => boolean;
  fetch?: (url: string, init: RequestInit) => Promise<unknown>;
}

function defaultSender(): Sender {
  const nav = globalThis.navigator;
  return {
    ...(typeof nav?.sendBeacon === 'function'
      ? { beacon: (url: string, data: Blob) => nav.sendBeacon(url, data) }
      : {}),
    ...(typeof globalThis.fetch === 'function'
      ? { fetch: (url: string, init: RequestInit) => globalThis.fetch(url, init) }
      : {}),
  };
}

/**
 * Send what is queued and empty the queue. `beacon` when the page hides (the
 * browser sends it after the page is gone), `fetch` with keepalive on the
 * timer. Any failure is dropped: no retry.
 */
export function flush(how: 'beacon' | 'fetch', sender: Sender = defaultSender()): void {
  if (queue.length === 0) return;
  const events = queue.splice(0);
  if (!analyticsAllowed()) return;
  const body = batchBody(events);
  try {
    if (how === 'beacon' && sender.beacon) {
      sender.beacon(EVENTS_PATH, new Blob([body], { type: 'application/json' }));
      return;
    }
    sender
      .fetch?.(EVENTS_PATH, {
        method: 'POST',
        body,
        keepalive: true,
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
      })
      ?.catch(() => undefined);
  } catch {
    // Offline, blocked, or the beacon queue is full: the counts are lost, nothing else.
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
function ensureTimer(): void {
  if (timer !== null || typeof setInterval !== 'function') return;
  timer = setInterval(() => {
    if (queue.length === 0) return;
    flush('fetch');
  }, FLUSH_MS);
}

let listening = false;
/** Send on hide and page hide; call once at start. */
export function listenForHide(): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  const hide = (): void => flush('beacon');
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hide();
  });
  window.addEventListener('pagehide', hide);
}

/** Tests: the queue as it stands, and a fresh page load. */
export function queued(): readonly WireEvent[] {
  return queue;
}
export function resetForTest(): void {
  queue.length = 0;
  taken = 0;
  repeats.clear();
  switchOn = true;
  if (timer !== null) clearInterval(timer);
  timer = null;
}
