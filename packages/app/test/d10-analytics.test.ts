/**
 * docs/10 section 1: the usage counts. What is sent, exactly; when nothing is
 * sent (the switch, Global Privacy Control, Do Not Track, another host); the
 * limits per page load; and that the schema's lists match the app's own.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONTEXT,
  EVENTS,
  EXAMPLE_IDS,
  LESSON_IDS,
  NEXT_STEP_IDS,
  WORKFLOW_IDS,
  checkEvent,
  parseBatch,
  type WireEvent,
} from '../src/lib/analytics/schema';
import {
  EVENTS_PATH,
  allowedBy,
  batchBody,
  countBucket,
  flush,
  queued,
  resetForTest,
  setSwitch,
  track,
  trackDynamic,
} from '../src/lib/analytics/track';
import { importFormat, readerOf, refusalReason } from '../src/lib/analytics/files';
import { loadBeacon } from '../src/lib/analytics/beacon';
import { WORKFLOWS } from '../src/lib/workflows';
import { TOURS } from '../src/lib/tours';

const CTX = { ver: '0.6.0', lay: 'desktop', ptr: 'fine', thm: 'light', pwa: 'browser' } as const;

function onHost(host: string, nav: Record<string, unknown> = {}): void {
  vi.stubGlobal('location', { hostname: host });
  vi.stubGlobal('navigator', { ...nav });
}

beforeEach(() => {
  resetForTest();
  onHost('smithchart.online');
});
afterEach(() => {
  resetForTest();
  vi.unstubAllGlobals();
});

describe('when counts may be sent', () => {
  const base = {
    switchOn: true,
    globalPrivacyControl: false,
    doNotTrack: false,
    host: 'smithchart.online',
    devOverride: false,
  };
  it('only with the switch on, no GPC, no DNT, on the production host', () => {
    expect(allowedBy(base)).toBe(true);
    expect(allowedBy({ ...base, switchOn: false })).toBe(false);
    expect(allowedBy({ ...base, globalPrivacyControl: true })).toBe(false);
    expect(allowedBy({ ...base, doNotTrack: true })).toBe(false);
    expect(allowedBy({ ...base, host: 'localhost' })).toBe(false);
    expect(allowedBy({ ...base, host: 'smithonline.qumeajr.workers.dev' })).toBe(false);
    expect(allowedBy({ ...base, host: 'localhost', devOverride: true })).toBe(true);
    expect(allowedBy({ ...base, devOverride: true, globalPrivacyControl: true })).toBe(false);
  });

  it('nothing is queued with the switch off, GPC, DNT or on localhost', () => {
    setSwitch(false);
    track('view', 'response');
    setSwitch(true);
    onHost('smithchart.online', { globalPrivacyControl: true });
    track('view', 'response');
    onHost('smithchart.online', { doNotTrack: '1' });
    track('view', 'response');
    onHost('localhost');
    track('view', 'response');
    expect(queued()).toEqual([]);
    onHost('smithchart.online');
    track('view', 'response');
    expect(queued()).toEqual([['view', 'response']]);
  });

  it('switching off drops what waits', () => {
    track('view', 'splot');
    setSwitch(false);
    expect(queued()).toEqual([]);
  });
});

describe('limits per page load', () => {
  it('at most 5 identical events, job and plot once per value, 60 in all', () => {
    for (let i = 0; i < 9; i++) track('view', 'response');
    for (let i = 0; i < 3; i++) track('job', 'broadband', 'done');
    track('job', 'broadband', 'stopped');
    for (let i = 0; i < 3; i++) track('plot', 'zoom', 'response');
    expect(queued()).toEqual([
      ...Array.from({ length: 5 }, () => ['view', 'response']),
      ['job', 'broadband', 'done'],
      ['job', 'broadband', 'stopped'],
      ['plot', 'zoom', 'response'],
    ]);
    const ids = EXAMPLE_IDS;
    for (let k = 0; k < 5; k++) for (const id of ids) track('example', id);
    expect(queued()).toHaveLength(60);
    track('help', 'open');
    expect(queued()).toHaveLength(60);
  });

  it('a value outside the schema is dropped by trackDynamic', () => {
    trackDynamic('workflow', 'not-a-workflow', 'start');
    trackDynamic('workflow', 'buildable', 'close', '13');
    trackDynamic('workflow', 'buildable', 'close', '4');
    trackDynamic('sample', 'antenna');
    expect(queued()).toEqual([
      ['workflow', 'buildable', 'close', '4'],
      ['sample', 'antenna'],
    ]);
  });
});

describe('what is sent', () => {
  it('the body is exactly {"v":1,"ctx":{ver,lay,ptr,thm,pwa},"ev":[...]} and nothing else', () => {
    const ev: WireEvent[] = [
      ['tool', 'match', 'open'],
      ['start', 'link'],
      ['workflow', 'robust', 'close', '3'],
    ];
    const body = batchBody(ev, CTX);
    expect(body).toBe(
      '{"v":1,"ctx":{"ver":"0.6.0","lay":"desktop","ptr":"fine","thm":"light","pwa":"browser"},"ev":[["tool","match","open"],["start","link"],["workflow","robust","close","3"]]}',
    );
    const parsed = parseBatch(JSON.parse(body));
    expect(parsed?.dropped).toBe(0);
    expect(new TextEncoder().encode(body).length).toBeLessThan(8 * 1024);
  });

  it('a full page load of events stays under 8 KB and every value is in the schema', () => {
    const longest = Object.entries(EVENTS).map(([name, spec]) => {
      const s = spec as { a: readonly string[]; b?: readonly string[]; c?: readonly string[] };
      const pick = (l?: readonly string[]): string[] =>
        l ? [[...l].sort((x, y) => y.length - x.length)[0] as string] : [];
      return [name, ...pick(s.a), ...pick(s.b), ...(s.b ? pick(s.c) : [])] as unknown as WireEvent;
    });
    const sixty = Array.from({ length: 60 }, (_, i) => longest[i % longest.length] as WireEvent);
    const body = batchBody(sixty, { ...CTX, lay: 'desktop' });
    expect(new TextEncoder().encode(body).length).toBeLessThan(8 * 1024);
    for (const e of sixty) expect(checkEvent(e)).not.toBeNull();
    // Only closed values: no number other than the version and the step, no free text.
    const strings = JSON.stringify(JSON.parse(body).ev).match(/"[^"]*"/g) ?? [];
    for (const s of strings) expect(s).toMatch(/^"[\w+.-]+"$/);
  });

  it('flushes with a beacon on hide and with fetch (keepalive, no credentials) on the timer, no retry', async () => {
    track('view', 'response');
    const beacon = vi.fn<(url: string, data: Blob) => boolean>(() => true);
    flush('beacon', { beacon });
    expect(beacon).toHaveBeenCalledOnce();
    const [url, blob] = beacon.mock.calls[0] as [string, Blob];
    expect(url).toBe(EVENTS_PATH);
    expect(blob.type).toBe('application/json');
    const sent = JSON.parse(await blob.text()) as {
      v: number;
      ctx: Record<string, string>;
      ev: unknown;
    };
    expect(Object.keys(sent)).toEqual(['v', 'ctx', 'ev']);
    expect(Object.keys(sent.ctx)).toEqual(['ver', 'lay', 'ptr', 'thm', 'pwa']);
    expect(sent.ev).toEqual([['view', 'response']]);
    expect(queued()).toEqual([]);

    track('view', 'chart');
    const fetchFn = vi.fn<(url: string, init: RequestInit) => Promise<unknown>>(async () => {
      throw new Error('offline');
    });
    flush('fetch', { fetch: fetchFn });
    await Promise.resolve();
    expect(fetchFn).toHaveBeenCalledOnce();
    const init = fetchFn.mock.calls[0]?.[1] as RequestInit;
    expect(init).toMatchObject({ method: 'POST', keepalive: true, credentials: 'omit' });
    // The failure is dropped: nothing waits to be sent again.
    expect(queued()).toEqual([]);
    flush('fetch', { fetch: fetchFn });
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('nothing goes out when counts were switched off before the flush', () => {
    track('view', 'chart');
    const beacon = vi.fn(() => true);
    onHost('smithchart.online', { globalPrivacyControl: true });
    flush('beacon', { beacon });
    expect(beacon).not.toHaveBeenCalled();
  });

  it('files are named by their type, refusals by a closed reason', () => {
    expect(importFormat('My antenna, v2.S2P')).toBe('s2p');
    expect(importFormat('a.cti')).toBe('citi');
    expect(importFormat('noext')).toBe('other');
    expect(readerOf('x.s1p')).toBe('touchstone');
    expect(readerOf('x.txt')).toBe('csv');
    expect(refusalReason('The option line # GHz Q MA R 50 is not valid')).toBe('bad_option_line');
    expect(refusalReason('anything else went wrong')).toBe('parse');
    expect(countBucket(1)).toBe('1');
    expect(countBucket(7)).toBe('6-20');
    expect(countBucket(300)).toBe('21+');
  });
});

describe('the Web Analytics beacon', () => {
  function fakeDoc(): Document & { added: { src: string; attr: string | null }[] } {
    const added: { src: string; attr: string | null }[] = [];
    const doc = {
      added,
      querySelector: () => (added.length ? {} : null),
      createElement: () => {
        const el = {
          defer: false,
          src: '',
          attrs: {} as Record<string, string>,
          setAttribute(k: string, v: string) {
            this.attrs[k] = v;
          },
        };
        return el;
      },
      head: {
        appendChild: (el: { src: string; attrs: Record<string, string> }) =>
          added.push({ src: el.src, attr: el.attrs['data-cf-beacon'] ?? null }),
      },
    };
    return doc as unknown as Document & { added: typeof added };
  }

  it('is added once when allowed, with the token as JSON and without SPA tracking', () => {
    const doc = fakeDoc();
    expect(loadBeacon('0123456789abcdef0123456789abcdef', doc, '')).toBe(true);
    expect(loadBeacon('0123456789abcdef0123456789abcdef', doc, '')).toBe(true);
    expect(doc.added).toEqual([
      {
        src: 'https://static.cloudflareinsights.com/beacon.min.js',
        attr: '{"token":"0123456789abcdef0123456789abcdef","spa":false}',
      },
    ]);
  });

  it('is left out of a page load that opens a share link (QA round 1)', () => {
    const doc = fakeDoc();
    expect(loadBeacon('0123456789abcdef0123456789abcdef', doc, '#d=eyJ2IjoxfQ')).toBe(false);
    expect(doc.added).toEqual([]);
  });

  it('is left out with the switch off, GPC, DNT, without a token or with an odd one', () => {
    const doc = fakeDoc();
    setSwitch(false);
    expect(loadBeacon('0123456789abcdef0123456789abcdef', doc)).toBe(false);
    setSwitch(true);
    onHost('smithchart.online', { doNotTrack: '1' });
    expect(loadBeacon('0123456789abcdef0123456789abcdef', doc)).toBe(false);
    onHost('smithchart.online');
    expect(loadBeacon('', doc)).toBe(false);
    expect(loadBeacon('abc"><script>', doc)).toBe(false);
    expect(doc.added).toEqual([]);
  });
});

describe('the schema matches the app', () => {
  it('workflows, lessons, examples and next-step rules', () => {
    expect([...WORKFLOW_IDS].sort()).toEqual(WORKFLOWS.map((w) => w.id).sort());
    expect([...LESSON_IDS].sort()).toEqual(TOURS.map((t) => t.id).sort());
    const files = readFileSync(new URL('../src/lib/examples.ts', import.meta.url), 'utf8');
    const examples = [...files.matchAll(/'(Example[\w-]+)\.xmlsc'/g)]
      .map((m) => m[1] as string)
      .filter((v, i, a) => a.indexOf(v) === i);
    expect([...EXAMPLE_IDS].sort()).toEqual(examples.sort());
    const rules = readFileSync(new URL('../src/lib/nextSteps.ts', import.meta.url), 'utf8');
    const ids = [...new Set([...rules.matchAll(/id: '([a-z0-9-]+)'/g)].map((m) => m[1]))].sort();
    expect([...NEXT_STEP_IDS].sort()).toEqual(ids);
    expect(CONTEXT.lay).toEqual(['phone', 'tablet', 'desktop', 'wide']);
  });
});
