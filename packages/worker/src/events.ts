/**
 * POST /api/e (docs/10 section 2.2): a batch of usage counts. Every value is
 * checked against the app's own schema; unknown events are dropped one by
 * one, a malformed body is 400. Each event becomes one Analytics Engine data
 * point: index the event, blobs [event, a, b, c, ver, lay, ptr, thm, pwa],
 * double 1. Nothing else is written; the address is used only for the rate
 * limit.
 */
import { MAX_EVENTS_BYTES, parseBatch } from '../../app/src/lib/analytics/schema';
import type { Env } from './env';
import { guard, readBody, reply } from './http';

/**
 * A guard on the day's writes, kept in this Worker instance's memory: past it the counts of
 * the day are dropped, so a flood cannot spend the account's Analytics Engine allowance
 * (100 000 data points a day on Workers Free). Each Cloudflare location runs its own
 * instances, so this bounds a flood that one place sends, not the sum of all.
 */
export const DAILY_POINTS_PER_INSTANCE = 20_000;
const budget = { day: '', written: 0 };

/** True while this instance may write `n` more data points today. */
export function spend(n: number, now: Date = new Date()): boolean {
  const day = now.toISOString().slice(0, 10);
  if (budget.day !== day) {
    budget.day = day;
    budget.written = 0;
  }
  if (budget.written + n > DAILY_POINTS_PER_INSTANCE) return false;
  budget.written += n;
  return true;
}

/** For the tests: start a fresh day. */
export function resetBudget(): void {
  budget.day = '';
  budget.written = 0;
}

export async function handleEvents(request: Request, env: Env): Promise<Response> {
  const refused = await guard(request, env, env.EVENTS_LIMIT);
  if (refused) return refused;
  const text = await readBody(request, MAX_EVENTS_BYTES);
  if (text === null) return reply(413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return reply(400);
  }
  const batch = parseBatch(body);
  if (!batch) return reply(400);
  const { ctx } = batch;
  if (env.EVENTS && spend(batch.events.length)) {
    for (const [event, a, b, c] of batch.events) {
      try {
        env.EVENTS.writeDataPoint({
          indexes: [event],
          blobs: [event, a, b, c, ctx.ver, ctx.lay, ctx.ptr, ctx.thm, ctx.pwa],
          doubles: [1],
        });
      } catch {
        // A full or missing dataset loses the count, nothing else.
      }
    }
  }
  return reply(204);
}
