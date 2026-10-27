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
  if (env.EVENTS) {
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
