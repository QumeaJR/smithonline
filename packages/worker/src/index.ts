/**
 * The Smith Online Worker (docs/10 section 2). Static assets are served by
 * Cloudflare without running it; `run_worker_first: ["/api/*"]` sends only
 * the API here. It answers `/api/e` (usage counts) and `/api/feedback`;
 * any other path is 404. It never serves the app, so an error here cannot
 * take the app down. The daily cron applies the feedback retention.
 */
import type { Env } from './env';
import { handleEvents } from './events';
import { handleFeedback, runRetention } from './feedback';
import { reply } from './http';

export async function route(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname;
  try {
    if (path === '/api/e') return await handleEvents(request, env);
    if (path === '/api/feedback') return await handleFeedback(request, env);
  } catch {
    return reply(500);
  }
  return reply(404);
}

export default {
  fetch: (request: Request, env: Env): Promise<Response> => route(request, env),
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    if (env.DB) await runRetention(env.DB);
  },
};
