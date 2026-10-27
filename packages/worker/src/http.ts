/**
 * What `/api/e` and `/api/feedback` share (docs/10 sections 2.2 and 2.3):
 * POST only, the app's own origin only, a size limit read without trusting
 * Content-Length, and no CORS headers, so other sites cannot read a response.
 */
import type { Env } from './env';

/** The site the app is served from; `ALLOWED_ORIGIN` in the configuration overrides it. */
export const DEFAULT_ORIGIN = 'https://smithchart.online';

export function allowedOrigin(env: Env): string {
  return env.ALLOWED_ORIGIN?.trim() || DEFAULT_ORIGIN;
}

/** A plain response with security headers and no CORS header. */
export function reply(status: number, body?: unknown): Response {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (body === undefined) return new Response(null, { status, headers });
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers });
}

/**
 * The request comes from the app's own pages: its Origin is the site, or (a
 * beacon may leave Origin out) the browser marks it same-origin.
 */
export function sameOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get('Origin');
  if (origin !== null) return origin === allowedOrigin(env);
  return request.headers.get('Sec-Fetch-Site') === 'same-origin';
}

/** The body as text, or null when it is longer than `max` bytes (read in chunks, never all). */
export async function readBody(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get('Content-Length') ?? '');
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/**
 * The common checks: 405 for another method, 403 for another origin, 429
 * over the rate limit (keyed by the client's address in memory only, never
 * stored or logged). Null when the request may go on.
 */
export async function guard(
  request: Request,
  env: Env,
  limiter: RateLimit | undefined,
): Promise<Response | null> {
  if (request.method !== 'POST') {
    const r = reply(405);
    r.headers.set('Allow', 'POST');
    return r;
  }
  if (!sameOrigin(request, env)) return reply(403);
  if (limiter) {
    const key = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    try {
      const { success } = await limiter.limit({ key });
      if (!success) return reply(429);
    } catch {
      // A limiter that fails lets the request through: the limit protects, it does not gate.
    }
  }
  return null;
}
