/**
 * docs/10 QA round 1 fixes in the Worker: the client's per-load caps hold
 * per batch on the server too (one start, job and plot once per value, any
 * other event at most 5 times), and a daily write budget per instance stops a
 * flood from spending the account's Analytics Engine allowance.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/env';
import { DAILY_POINTS_PER_INSTANCE, resetBudget, spend } from '../src/events';
import { route } from '../src/index';

const ORIGIN = 'https://smithchart.online';
const CTX = { ver: '0.6.0', lay: 'desktop', ptr: 'fine', thm: 'light', pwa: 'browser' };

let points: { blobs: string[] }[];
beforeEach(() => {
  points = [];
  resetBudget();
});

const env = (): Env => ({
  EVENTS: { writeDataPoint: (p) => void points.push(p as { blobs: string[] }) },
});

function batch(ev: string[][]): Request {
  return new Request(`${ORIGIN}/api/e`, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ v: 1, ctx: CTX, ev }),
  });
}

describe('per-batch caps on the server', () => {
  it('one start, job and plot once per value, other events at most 5 times', async () => {
    const ev = [
      ['start', 'new'],
      ['start', 'link'],
      ...Array.from({ length: 7 }, () => ['view', 'response']),
      ['job', 'broadband', 'done'],
      ['job', 'broadband', 'done'],
      ['job', 'broadband', 'stopped'],
      ['plot', 'zoom', 'response'],
      ['plot', 'zoom', 'response'],
    ];
    expect((await route(batch(ev), env())).status).toBe(204);
    const names = points.map((p) => p.blobs.slice(0, 4).join(' ').trim());
    expect(names.filter((n) => n.startsWith('start'))).toEqual(['start new']);
    expect(names.filter((n) => n === 'view response')).toHaveLength(5);
    expect(names.filter((n) => n.startsWith('job'))).toEqual([
      'job broadband done',
      'job broadband stopped',
    ]);
    expect(names.filter((n) => n.startsWith('plot'))).toHaveLength(1);
  });
});

describe('the daily write budget', () => {
  it('stops writing for the rest of the day once spent; the answer stays 204', async () => {
    expect(spend(DAILY_POINTS_PER_INSTANCE - 1)).toBe(true);
    expect((await route(batch([['view', 'chart']]), env())).status).toBe(204);
    expect(points).toHaveLength(1);
    expect((await route(batch([['view', 'splot']]), env())).status).toBe(204);
    expect(points).toHaveLength(1);
    // A new day starts a new budget.
    expect(spend(1, new Date(Date.now() + 86_400_000))).toBe(true);
  });
});
