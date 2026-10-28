/**
 * The usage counts' schema (docs/10 section 1): every event and field is a
 * closed list. The app's `track` takes only these values (checked when it
 * compiles) and the Worker drops anything else (checked when it runs). This
 * file is the one source of both, so it imports nothing.
 */

/** The body's version. */
export const BATCH_VERSION = 1;
/** The most events a page load sends, and the most one request may carry. */
export const MAX_EVENTS = 60;
/** The largest body of `/api/e`, bytes. */
export const MAX_EVENTS_BYTES = 8 * 1024;

/** The context sent with every batch. */
export const CONTEXT = {
  lay: ['phone', 'tablet', 'desktop', 'wide'],
  ptr: ['fine', 'coarse'],
  thm: ['light', 'dark'],
  pwa: ['app', 'browser'],
} as const;

/** The app version: three numbers, nothing else. */
export const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

export interface EventContext {
  readonly ver: string;
  readonly lay: (typeof CONTEXT.lay)[number];
  readonly ptr: (typeof CONTEXT.ptr)[number];
  readonly thm: (typeof CONTEXT.thm)[number];
  readonly pwa: (typeof CONTEXT.pwa)[number];
}

/** The guided workflows (`lib/workflows.ts`). A test keeps this list equal to the app's. */
export const WORKFLOW_IDS = [
  'measured-antenna',
  'robust',
  'buildable',
  'verify',
  'amplifier',
  'broadband-limits',
  'real-parts',
  'measure-retune',
  'real-frequency',
] as const;

/** The lessons (`lib/tours.ts`). A test keeps this list equal to the app's. */
export const LESSON_IDS = [
  'l-network',
  'single-stub',
  'lna-input',
  'band-optimizer',
  'broadband',
  'realize',
  'packages',
  'pa-output',
  'pi-t',
  'quarter-wave',
] as const;

/** The V4.1 example files (`lib/examples.ts`), without `.xmlsc`. */
export const EXAMPLE_IDS = [
  'Example1',
  'Example2',
  'Example3',
  'Example4',
  'Example5',
  'Example6',
  'Example7',
  'Example8',
  'Example9',
  'Example10',
  'Example11',
  'Example12',
  'Example13-input',
  'Example13-output1',
  'Example13-output2',
  'Example13-output3',
  'Example14-1',
  'Example14-2',
  'Example15',
  'Example16',
  'Example17',
  'Example18',
] as const;

/** The next-step rules (`lib/nextSteps.ts`). A test keeps this list equal to the app's. */
export const NEXT_STEP_IDS = [
  'amplifier',
  'bom',
  'broadband-limits',
  'build-default',
  'buildable',
  'centre',
  'check-band',
  'check-stackup',
  'check-tolerance',
  'compare',
  'load-parts',
  'match-over-band',
  'measure',
  'measure-retune',
  'measured-antenna',
  'more-parts',
  'optimize-band',
  'packages',
  'real-frequency',
  'real-parts',
  'realize',
  'robust',
  'stability',
  'stability-circles',
  'tighter-part',
  'tolerance-over-band',
  'verify',
] as const;

/** Workflow steps, as text. */
export const STEP_IDS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'] as const;

interface FieldSpec {
  readonly a: readonly string[];
  readonly b?: readonly string[];
  readonly c?: readonly string[];
}

/** Every event with the values each field may take (docs/10 section 1.3). */
export const EVENTS = {
  start: { a: ['new', 'autosave', 'link', 'file', 'example'] },
  view: { a: ['chart', 'response', 'splot'] },
  tool: { a: ['match', 'optimize', 'montecarlo', 'build'], b: ['open', 'close'] },
  match_method: { a: ['add', 'tune', 'broadband', 'transformer', 'stubfilter'] },
  rft: { a: ['run', 'apply'], b: ['lowpass', 'highpass', 'bandpass'] },
  job: {
    a: ['broadband', 'optimize', 'montecarlo', 'centre', 'fit', 'retune', 'rft'],
    b: ['done', 'stopped', 'error'],
  },
  workflow: { a: WORKFLOW_IDS, b: ['start', 'complete', 'close'], c: STEP_IDS },
  lesson: { a: LESSON_IDS, b: ['start', 'complete', 'close'] },
  sample: { a: ['antenna', 'amplifier', 'parts', 'board'] },
  example: { a: EXAMPLE_IDS },
  import: {
    a: ['s1p', 's2p', 's3p', 's4p', 'citi', 'eznec', 'csv', 'txt', 'xmlsc', 'json', 'other'],
    b: ['load', 'rows', 'device', 'splot', 'measurement', 'parts'],
    c: ['ok', 'refused'],
  },
  refused: {
    a: ['touchstone', 'citi', 'csv', 'eznec', 'xmlsc', 'json', 'link', 'part'],
    b: [
      'no_frequency',
      'no_sparams',
      'too_large',
      'too_few_rows',
      'bad_option_line',
      'parse',
      'unsupported',
    ],
  },
  export: {
    a: [
      'svg',
      'png',
      'report',
      'print',
      'copy_chart',
      'copy_dp',
      'csv',
      'ckt',
      'spice',
      'ltspice',
      's2p',
      'splot_add',
      'ascii',
      'bom',
      'json',
      'xmlsc',
      'share_link',
      'plot_png',
      'plot_svg',
      'plot_csv',
    ],
  },
  build: {
    a: ['realization', 'losses', 'packages', 'board', 'measured', 'ratings'],
    b: ['open', 'change'],
  },
  realize: { a: ['E6', 'E12', 'E24', 'E48', 'E96', 'stock', 'library'] },
  library: {
    a: ['open', 'load_files', 'load_samples', 'remove', 'use'],
    b: ['1', '2-5', '6-20', '21+'],
  },
  retune: { a: ['import', 'compare', 'fit', 'suggest', 'apply'], b: ['ok', 'refused'] },
  next_step: { a: NEXT_STEP_IDS, b: ['shown', 'taken', 'dismissed'] },
  guide: { a: ['shown', 'step1', 'step2', 'step3', 'matched', 'closed'] },
  help: { a: ['open', 'try_link'] },
  plot: { a: ['zoom', 'enlarge', 'reset'], b: ['response', 'splot', 'measured'] },
  feedback: { a: ['open', 'sent', 'failed'] },
  error: { a: ['boundary', 'worker', 'autosave'] },
} as const satisfies Record<string, FieldSpec>;

export type EventName = keyof typeof EVENTS;
type Spec<E extends EventName> = (typeof EVENTS)[E];
export type EventA<E extends EventName> = Spec<E>['a'][number];
export type EventB<E extends EventName> =
  Spec<E> extends { readonly b: readonly (infer T)[] } ? T : never;
export type EventC<E extends EventName> =
  Spec<E> extends { readonly c: readonly (infer T)[] } ? T : never;

/** One event on the wire: the name and up to three values, absent ones left off. */
export type WireEvent = readonly [string, ...string[]];

/** Events that count once per value per page load; the others up to five times each. */
export const ONCE_PER_START: readonly EventName[] = ['job', 'plot'];
export const MAX_REPEATS = 5;

const has = (list: readonly string[] | undefined, v: unknown): boolean =>
  typeof v === 'string' && list !== undefined && list.includes(v);

/**
 * An event as the Worker stores it: [event, a, b, c] with '' for an absent
 * field, or null when the event or any value is not in the schema.
 */
export function checkEvent(raw: unknown): [string, string, string, string] | null {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 4) return null;
  const [name, a, b, c] = raw as unknown[];
  if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(EVENTS, name)) {
    return null;
  }
  const spec: FieldSpec = EVENTS[name as EventName];
  if (!has(spec.a, a)) return null;
  if (b !== undefined && !has(spec.b, b)) return null;
  if (c !== undefined && !has(spec.c, c)) return null;
  if (c !== undefined && b === undefined) return null;
  return [name, a as string, (b as string | undefined) ?? '', (c as string | undefined) ?? ''];
}

/** The context of a batch, or null when a field is missing or not in the schema. */
export function checkContext(raw: unknown): EventContext | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).length !== 5) return null;
  if (typeof r.ver !== 'string' || !VERSION_RE.test(r.ver)) return null;
  if (!has(CONTEXT.lay, r.lay) || !has(CONTEXT.ptr, r.ptr)) return null;
  if (!has(CONTEXT.thm, r.thm) || !has(CONTEXT.pwa, r.pwa)) return null;
  return r as unknown as EventContext;
}

export interface Batch {
  readonly ctx: EventContext;
  /** The events in the schema, as stored: [event, a, b, c]. */
  readonly events: readonly [string, string, string, string][];
  /** How many events were dropped as unknown. */
  readonly dropped: number;
}

/**
 * A request body of `/api/e`: `{"v":1,"ctx":{...},"ev":[[...],...]}`. A
 * malformed body (wrong version, keys or context, more than 60 events) is
 * null; unknown events are dropped one by one. The client's own caps hold
 * here too, per batch: one `start`, `job` and `plot` once per value, any
 * other event at most 5 times; the rest is dropped.
 */
export function parseBatch(body: unknown): Batch | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const r = body as Record<string, unknown>;
  if (Object.keys(r).length !== 3 || r.v !== BATCH_VERSION || !Array.isArray(r.ev)) return null;
  if (r.ev.length > MAX_EVENTS) return null;
  const ctx = checkContext(r.ctx);
  if (!ctx) return null;
  const events: [string, string, string, string][] = [];
  const seen = new Map<string, number>();
  let starts = 0;
  let dropped = 0;
  for (const e of r.ev) {
    const ok = checkEvent(e);
    if (!ok) {
      dropped++;
      continue;
    }
    const [name] = ok;
    const key = ok.join('|');
    const n = seen.get(key) ?? 0;
    const max = (ONCE_PER_START as readonly string[]).includes(name) ? 1 : MAX_REPEATS;
    if (n >= max || (name === 'start' && starts >= 1)) {
      dropped++;
      continue;
    }
    seen.set(key, n + 1);
    if (name === 'start') starts++;
    events.push(ok);
  }
  return { ctx, events, dropped };
}
