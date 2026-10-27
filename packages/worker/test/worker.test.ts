/**
 * The Worker of docs/10 section 2: routing, the request checks, the
 * validation of usage counts and feedback, the rate limits, the storage in
 * D1 and the retention, with plain request handlers and a SQLite stand-in
 * for D1 (test/d1.ts).
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { route } from '../src/index';
import type { Env } from '../src/env';
import {
  checkDesign,
  checkFeedback,
  handleFeedback,
  newReference,
  runRetention,
  SITEVERIFY,
} from '../src/feedback';
import { TestD1 } from './d1';

const ORIGIN = 'https://smithchart.online';

interface Point {
  indexes?: unknown[];
  blobs?: unknown[];
  doubles?: number[];
}

/** A rate limit as the binding behaves within one location: `limit` per key, then refused. */
function limiter(limit: number): RateLimit & { keys: string[] } {
  const count = new Map<string, number>();
  const keys: string[] = [];
  return {
    keys,
    limit: async ({ key }) => {
      keys.push(key);
      const n = (count.get(key) ?? 0) + 1;
      count.set(key, n);
      return { success: n <= limit };
    },
  };
}

let points: Point[];
let db: TestD1;
function env(over: Partial<Env> = {}): Env {
  return {
    EVENTS: { writeDataPoint: (p?: Point) => void points.push(p ?? {}) },
    DB: db as unknown as D1Database,
    EVENTS_LIMIT: limiter(30),
    FEEDBACK_LIMIT: limiter(3),
    TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
    ...over,
  };
}

function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = { Origin: ORIGIN },
): Request {
  return new Request(`https://smithchart.online${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const CTX = { ver: '0.7.0', lay: 'desktop', ptr: 'fine', thm: 'light', pwa: 'browser' };

beforeEach(() => {
  points = [];
  db = new TestD1().migrate();
});

describe('routing', () => {
  it('answers only /api/e and /api/feedback; any other path is 404', async () => {
    for (const path of ['/api/unknown', '/api', '/api/e/x', '/', '/index.html', '/assets/a.js']) {
      const res = await route(new Request(`https://smithchart.online${path}`), env());
      expect(res.status, path).toBe(404);
    }
  });

  it('never sends CORS headers', async () => {
    const res = await route(post('/api/e', { v: 1, ctx: CTX, ev: [['view', 'response']] }), env());
    expect(res.status).toBe(204);
    expect([...res.headers.keys()].some((k) => k.startsWith('access-control'))).toBe(false);
  });

  it('wrangler.jsonc runs the Worker first only for /api/* and serves everything else as assets', () => {
    const text = readFileSync(new URL('../../../wrangler.jsonc', import.meta.url), 'utf8');
    // JSONC: drop line comments outside strings, then trailing commas.
    const json = text
      .split('\n')
      .map((l) => l.replace(/^\s*\/\/.*$/, ''))
      .join('\n')
      .replace(/,(\s*[}\]])/g, '$1');
    const c = JSON.parse(json) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(c.main).toBe('./packages/worker/src/index.ts');
    expect(c.assets.run_worker_first).toEqual(['/api/*']);
    expect(c.assets.not_found_handling).toBe('single-page-application');
    expect(c.assets.directory).toBe('./packages/app/dist');
    expect(c.observability).toEqual({ enabled: false });
    expect(c.analytics_engine_datasets).toEqual([
      { binding: 'EVENTS', dataset: 'smithonline_events' },
    ]);
    expect(c.d1_databases[0].binding).toBe('DB');
    expect(c.d1_databases[0].migrations_dir).toBe('./packages/worker/migrations');
    expect(c.ratelimits).toEqual([
      { name: 'EVENTS_LIMIT', namespace_id: '1001', simple: { limit: 30, period: 60 } },
      { name: 'FEEDBACK_LIMIT', namespace_id: '1002', simple: { limit: 3, period: 60 } },
    ]);
    expect(c.triggers.crons).toEqual(['17 3 * * *']);
    // No secret in the configuration.
    expect(text).not.toMatch(/TURNSTILE_SECRET"\s*:/);
  });
});

describe('POST /api/e', () => {
  it('writes one data point per known event with the context, and answers 204', async () => {
    const res = await route(
      post('/api/e', {
        v: 1,
        ctx: CTX,
        ev: [
          ['tool', 'match', 'open'],
          ['workflow', 'buildable', 'close', '4'],
          ['start', 'link'],
        ],
      }),
      env(),
    );
    expect(res.status).toBe(204);
    expect(points).toEqual([
      {
        indexes: ['tool'],
        blobs: ['tool', 'match', 'open', '', '0.7.0', 'desktop', 'fine', 'light', 'browser'],
        doubles: [1],
      },
      {
        indexes: ['workflow'],
        blobs: [
          'workflow',
          'buildable',
          'close',
          '4',
          '0.7.0',
          'desktop',
          'fine',
          'light',
          'browser',
        ],
        doubles: [1],
      },
      {
        indexes: ['start'],
        blobs: ['start', 'link', '', '', '0.7.0', 'desktop', 'fine', 'light', 'browser'],
        doubles: [1],
      },
    ]);
  });

  it('drops unknown events and values one by one', async () => {
    const res = await route(
      post('/api/e', {
        v: 1,
        ctx: CTX,
        ev: [
          ['tool', 'match', 'open'],
          ['tool', 'hammer', 'open'],
          ['nope', 'x'],
          ['tool', 'match', 'open', 'extra'],
          ['export', 'svg', 'x'],
          ['import', 's2p', 'load', 'ok'],
          ['tool'],
          'tool',
          ['view', 'response', 'my design.json'],
          ['error', 1],
        ],
      }),
      env(),
    );
    expect(res.status).toBe(204);
    expect(points.map((p) => p.blobs?.slice(0, 4))).toEqual([
      ['tool', 'match', 'open', ''],
      ['import', 's2p', 'load', 'ok'],
    ]);
  });

  it('a malformed body is 400: bad JSON, version, context, keys or more than 60 events', async () => {
    const bodies: unknown[] = [
      '{nope',
      [],
      { v: 2, ctx: CTX, ev: [] },
      { v: 1, ctx: { ...CTX, ver: '0.7' }, ev: [] },
      { v: 1, ctx: { ...CTX, ver: '<script>' }, ev: [] },
      { v: 1, ctx: { ...CTX, lay: 'watch' }, ev: [] },
      { v: 1, ctx: { ...CTX, country: 'CH' }, ev: [] },
      { v: 1, ctx: CTX, ev: [], id: 'abc' },
      { v: 1, ctx: CTX, ev: Array.from({ length: 61 }, () => ['view', 'chart']) },
    ];
    for (const b of bodies) {
      const res = await route(post('/api/e', b), env());
      expect(res.status, JSON.stringify(b).slice(0, 60)).toBe(400);
    }
    expect(points).toEqual([]);
  });

  it('GET is 405; another origin is 403; same-origin without Origin passes', async () => {
    const get = await route(new Request(`${ORIGIN}/api/e`, { headers: { Origin: ORIGIN } }), env());
    expect(get.status).toBe(405);
    expect(get.headers.get('Allow')).toBe('POST');
    const body = { v: 1, ctx: CTX, ev: [['view', 'chart']] };
    expect(
      (await route(post('/api/e', body, { Origin: 'https://evil.example' }), env())).status,
    ).toBe(403);
    expect((await route(post('/api/e', body, {}), env())).status).toBe(403);
    expect(
      (await route(post('/api/e', body, { 'Sec-Fetch-Site': 'cross-site' }), env())).status,
    ).toBe(403);
    expect(
      (await route(post('/api/e', body, { 'Sec-Fetch-Site': 'same-origin' }), env())).status,
    ).toBe(204);
  });

  it('a 9 KB body is 413, whatever Content-Length says', async () => {
    const big = JSON.stringify({ v: 1, ctx: CTX, ev: [['view', 'chart']], pad: 'x'.repeat(9000) });
    expect((await route(post('/api/e', big), env())).status).toBe(413);
    expect(points).toEqual([]);
  });

  it('the 31st request in a minute from one address is 429; the address is not written', async () => {
    const e = env();
    const body = { v: 1, ctx: CTX, ev: [['view', 'chart']] };
    for (let i = 0; i < 30; i++) expect((await route(post('/api/e', body), e)).status).toBe(204);
    expect((await route(post('/api/e', body), e)).status).toBe(429);
    expect((e.EVENTS_LIMIT as ReturnType<typeof limiter>).keys[0]).toBe('203.0.113.7');
    expect(JSON.stringify(points)).not.toContain('203.0.113.7');
  });

  it('without the dataset the counts are lost quietly', async () => {
    const res = await route(
      post('/api/e', { v: 1, ctx: CTX, ev: [['view', 'chart']] }),
      env({ EVENTS: undefined }),
    );
    expect(res.status).toBe(204);
  });
});

/** A design as the app's share link carries it: base64url of its JSON. */
function payload(design: unknown): string {
  return Buffer.from(JSON.stringify(design), 'utf8').toString('base64url');
}
const DESIGN = payload({
  name: 'antenna',
  elements: [{ kind: 'C', orientation: 'shunt', value: 1e-12 }],
});

const FEEDBACK = {
  category: 'bug',
  message: '  The VSWR plot does not zoom on my tablet.  ',
  email: 'me@example.com',
  ver: '0.7.0',
  lay: 'tablet',
  turnstile: 'XXXX.DUMMY.TOKEN.XXXX',
};

function turnstile(success: boolean): typeof fetch & { calls: { url: string; body: unknown }[] } {
  const calls: { url: string; body: unknown }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(
      JSON.stringify({ success, 'error-codes': success ? [] : ['invalid-input-response'] }),
      {
        status: 200,
      },
    );
  }) as unknown as typeof fetch & { calls: typeof calls };
  f.calls = calls;
  return f;
}

describe('POST /api/feedback', () => {
  it('a valid message is stored and its reference returned (201)', async () => {
    const t = turnstile(true);
    const res = await handleFeedback(
      post('/api/feedback', { ...FEEDBACK, design: DESIGN }),
      env(),
      {
        fetch: t,
        now: () => new Date('2026-10-27T10:00:00.000Z'),
        random: () => new Uint8Array([7, 20, 3, 24, 2, 19]),
      },
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ref: 'FB-7M3R2K' });
    expect(db.rows()).toEqual([
      {
        id: 'FB-7M3R2K',
        created_at: '2026-10-27T10:00:00.000Z',
        category: 'bug',
        message: 'The VSWR plot does not zoom on my tablet.',
        email: 'me@example.com',
        design: DESIGN,
        app_version: '0.7.0',
        layout: 'tablet',
        status: 'new',
      },
    ]);
    // Turnstile gets the secret and the token, not the address.
    expect(t.calls).toEqual([
      {
        url: SITEVERIFY,
        body: { secret: '1x0000000000000000000000000000000AA', response: 'XXXX.DUMMY.TOKEN.XXXX' },
      },
    ]);
  });

  it('a failed Turnstile check is 400 {"error":"check"} and nothing is stored', async () => {
    const res = await handleFeedback(post('/api/feedback', FEEDBACK), env(), {
      fetch: turnstile(false),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'check' });
    expect(db.rows()).toEqual([]);
  });

  it('refuses a design with library part data, and a payload that is not a design', async () => {
    const withData = payload({
      elements: [
        { kind: 'part', orientation: 'series', part: { name: 'GRM', data: [[1e9, 1, 0]] } },
      ],
    });
    const withoutData = payload({
      elements: [{ kind: 'part', orientation: 'series', part: { name: 'GRM' } }],
    });
    expect(checkDesign(withData)).toBe(false);
    expect(checkDesign(withoutData)).toBe(true);
    expect(checkDesign('not base64!')).toBe(false);
    expect(checkDesign(payload([1, 2]))).toBe(false);
    expect(checkDesign(payload({ name: 'x' }))).toBe(false);
    expect(checkDesign('A'.repeat(64 * 1024 + 1))).toBe(false);
    const res = await handleFeedback(
      post('/api/feedback', { ...FEEDBACK, design: withData }),
      env(),
      {
        fetch: turnstile(true),
      },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid', field: 'design' });
    expect(db.rows()).toEqual([]);
  });

  it('checks every field', () => {
    const bad: [Record<string, unknown>, string][] = [
      [{ ...FEEDBACK, category: 'rant' }, 'category'],
      [{ ...FEEDBACK, message: '   short   ' }, 'message'],
      [{ ...FEEDBACK, message: 'x'.repeat(4001) }, 'message'],
      [{ ...FEEDBACK, message: 12 }, 'message'],
      [{ ...FEEDBACK, email: 'not an address' }, 'email'],
      [{ ...FEEDBACK, email: `${'a'.repeat(250)}@b.ch` }, 'email'],
      [{ ...FEEDBACK, ver: 'latest' }, 'ver'],
      [{ ...FEEDBACK, lay: 'watch' }, 'lay'],
      [{ ...FEEDBACK, turnstile: '' }, 'turnstile'],
      [{ ...FEEDBACK, ip: '1.2.3.4' }, 'ip'],
    ];
    for (const [body, field] of bad) expect(checkFeedback(body)).toEqual({ ok: false, field });
    expect(checkFeedback({ ...FEEDBACK, email: '' })).toMatchObject({
      ok: true,
      value: { email: null },
    });
    expect(checkFeedback({ ...FEEDBACK, message: 'x'.repeat(4000) }).ok).toBe(true);
  });

  it('another origin 403, GET 405, an 81 KB body 413, the 4th in a minute 429', async () => {
    const e = env();
    const deps = { fetch: turnstile(true) };
    expect(
      (
        await handleFeedback(
          post('/api/feedback', FEEDBACK, { Origin: 'https://x.example' }),
          e,
          deps,
        )
      ).status,
    ).toBe(403);
    expect((await handleFeedback(new Request(`${ORIGIN}/api/feedback`), e, deps)).status).toBe(405);
    const big = JSON.stringify({ ...FEEDBACK, design: 'A'.repeat(81 * 1024) });
    expect((await handleFeedback(post('/api/feedback', big), env(), deps)).status).toBe(413);
    for (let i = 0; i < 3; i++)
      expect((await handleFeedback(post('/api/feedback', FEEDBACK), e, deps)).status).toBe(201);
    expect((await handleFeedback(post('/api/feedback', FEEDBACK), e, deps)).status).toBe(429);
  });

  it('503 "Feedback is not available right now" before the migration ran or without a secret', async () => {
    const empty = new TestD1();
    const res = await handleFeedback(
      post('/api/feedback', FEEDBACK),
      env({ DB: empty as unknown as D1Database }),
      {
        fetch: turnstile(true),
      },
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: 'unavailable',
      message: 'Feedback is not available right now',
    });
    const noSecret = await handleFeedback(
      post('/api/feedback', FEEDBACK),
      env({ TURNSTILE_SECRET: undefined }),
    );
    expect(noSecret.status).toBe(503);
  });

  it('a reference that exists already is drawn again', async () => {
    const draws = [new Uint8Array(6), new Uint8Array(6), new Uint8Array([1, 2, 3, 4, 5, 6])];
    const random = vi.fn(() => draws.shift() as Uint8Array);
    const e = env();
    const deps = { fetch: turnstile(true), random };
    expect(await (await handleFeedback(post('/api/feedback', FEEDBACK), e, deps)).json()).toEqual({
      ref: 'FB-000000',
    });
    expect(await (await handleFeedback(post('/api/feedback', FEEDBACK), e, deps)).json()).toEqual({
      ref: 'FB-123456',
    });
  });

  it('references are FB- and six characters without I, L, O or U', () => {
    for (let i = 0; i < 200; i++) expect(newReference()).toMatch(/^FB-[0-9A-HJKMNP-TV-Z]{6}$/);
  });
});

describe('retention (the daily cron)', () => {
  it('clears emails older than 90 days and deletes rows older than 365 days', async () => {
    const insert = (id: string, created: string): void => {
      db.db
        .prepare(
          "INSERT INTO feedback (id, created_at, category, message, email, app_version, layout) VALUES (?, ?, 'idea', 'message text', 'a@b.ch', '0.7.0', 'phone')",
        )
        .run(id, created);
    };
    insert('FB-AAAAAA', '2026-10-20T00:00:00.000Z'); // 7 days
    insert('FB-BBBBBB', '2026-07-01T00:00:00.000Z'); // 118 days
    insert('FB-CCCCCC', '2025-10-01T00:00:00.000Z'); // 391 days
    await runRetention(db as unknown as D1Database, new Date('2026-10-27T00:00:00.000Z'));
    expect(db.rows().map((r) => [r.id, r.email])).toEqual([
      ['FB-BBBBBB', null],
      ['FB-AAAAAA', 'a@b.ch'],
    ]);
  });
});
