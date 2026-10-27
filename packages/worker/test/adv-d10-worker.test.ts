/**
 * QA docs/10 section 2 (adversarial): hostile requests to the Worker's
 * handlers. Kept: what a client could do to the counts or the feedback
 * store; the rest documents what the Worker survived.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { route } from '../src/index';
import type { Env } from '../src/env';
import { handleFeedback } from '../src/feedback';
import { TestD1 } from './d1';

const ORIGIN = 'https://smithchart.online';
const CTX = { ver: '0.6.0', lay: 'desktop', ptr: 'fine', thm: 'light', pwa: 'browser' };

let points: unknown[];
beforeEach(() => {
  points = [];
});

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.5',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const env = (over: Partial<Env> = {}): Env => ({
  EVENTS: { writeDataPoint: (p) => void points.push(p) },
  ...over,
});

describe('usage counts: what one request may write', () => {
  it('one request cannot write more starts than one page load makes (1), nor 60 copies of one event', async () => {
    // The app sends one start per page load and at most 5 identical events (job and plot: 1);
    // the Worker takes whatever the batch says. 30 such requests a minute from one address
    // (the rate limit) write 1800 data points a minute: the free plan's 100 000 a day are gone
    // in under an hour, and the start count is whatever the sender wants.
    const ev = Array.from({ length: 60 }, () => ['start', 'link']);
    const res = await route(post('/api/e', { v: 1, ctx: CTX, ev }), env());
    expect(res.status).toBe(204);
    expect(points.length).toBeLessThanOrEqual(1);
  });

  it('survives: a dataset that throws loses the count, the answer stays 204', async () => {
    const res = await route(
      post('/api/e', { v: 1, ctx: CTX, ev: [['view', 'chart']] }),
      env({
        EVENTS: {
          writeDataPoint: () => {
            throw new Error('quota');
          },
        },
      }),
    );
    expect(res.status).toBe(204);
  });

  it('survives: prototype names and odd values are dropped one by one', async () => {
    const res = await route(
      post('/api/e', {
        v: 1,
        ctx: CTX,
        ev: [
          ['__proto__', 'x'],
          ['constructor', 'a'],
          ['toString', 'a'],
          ['view', 'chart', null],
          ['view', 1],
          ['workflow', 'robust', 'close', '13'],
          'view',
          ['view', 'chart'],
        ],
      }),
      env(),
    );
    expect(res.status).toBe(204);
    expect(points).toHaveLength(1);
  });

  it('survives: a body that lies about its length, a BOM, a number for v, a 61-event batch', async () => {
    expect(
      (await route(post('/api/e', '{"v":1', { 'Content-Length': '9000' }), env())).status,
    ).toBe(413);
    expect((await route(post('/api/e', { v: '1', ctx: CTX, ev: [] }), env())).status).toBe(400);
    const ev = Array.from({ length: 61 }, () => ['view', 'chart']);
    expect((await route(post('/api/e', { v: 1, ctx: CTX, ev }), env())).status).toBe(400);
  });
});

describe('feedback: failures of what the Worker depends on', () => {
  it('survives: no table yet (migration not run) answers 503 unavailable', async () => {
    const db = new TestD1(); // no migration
    const res = await handleFeedback(
      post('/api/feedback', {
        category: 'bug',
        message: 'hello world here',
        ver: '0.6.0',
        lay: 'desktop',
        turnstile: 't',
      }),
      { DB: db as unknown as D1Database, TURNSTILE_SECRET: 's' },
      { fetch: (async () => new Response('{"success":true}')) as typeof fetch },
    );
    expect(res.status).toBe(503);
  });

  it('survives: a spent or replayed token (siteverify says no) is 400 check and nothing is stored', async () => {
    const db = new TestD1().migrate();
    const res = await handleFeedback(
      post('/api/feedback', {
        category: 'bug',
        message: 'hello world here',
        ver: '0.6.0',
        lay: 'desktop',
        turnstile: 'spent',
      }),
      { DB: db as unknown as D1Database, TURNSTILE_SECRET: 's' },
      {
        fetch: (async () =>
          new Response('{"success":false,"error-codes":["timeout-or-duplicate"]}')) as typeof fetch,
      },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'check' });
    expect(db.rows()).toEqual([]);
  });
});
