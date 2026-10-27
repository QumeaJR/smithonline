/**
 * POST /api/feedback (docs/10 section 2.3): a message from the app's Send
 * feedback dialog, checked by Turnstile and stored in D1. Answered 201 with
 * its reference ("FB-7K3Q2M"). The sender's address is used only for the
 * rate limit and is not passed to Turnstile or stored.
 */
import { CONTEXT, VERSION_RE } from '../../app/src/lib/analytics/schema';
import {
  EMAIL_MAX,
  MAX_DESIGN_CHARS,
  MAX_FEEDBACK_BYTES,
  MESSAGE_MAX,
  MESSAGE_MIN,
} from '../../app/src/lib/feedbackLimits';
import type { Env } from './env';
import { guard, overLimit, readBody, reply } from './http';

export { EMAIL_MAX, MAX_DESIGN_CHARS, MAX_FEEDBACK_BYTES, MESSAGE_MAX, MESSAGE_MIN };
export const CATEGORIES = ['bug', 'idea', 'question', 'other'] as const;
export const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Crockford's base32 without I, L, O and U: a reference that reads aloud. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export interface Feedback {
  readonly category: (typeof CATEGORIES)[number];
  readonly message: string;
  readonly email: string | null;
  readonly design: string | null;
  readonly ver: string;
  readonly lay: (typeof CONTEXT.lay)[number];
  readonly turnstile: string;
}

export type Checked = { ok: true; value: Feedback } | { ok: false; field: string };

const FIELDS = new Set(['category', 'message', 'email', 'design', 'ver', 'lay', 'turnstile']);

/** A basic address check: one @, no spaces, a dot in the domain. */
export function plausibleEmail(s: string): boolean {
  return s.length <= EMAIL_MAX && /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/.test(s);
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/**
 * A share-link payload: base64url of a JSON design with a list of elements,
 * at most MAX_DESIGN_CHARS (256 KiB), and no library part data in it (the app's `encodeDesign`
 * leaves it out; a payload that carries it is refused). This is the Worker's
 * own structural check; the app checks the design fully when it opens one.
 */
export function checkDesign(payload: string): boolean {
  if (payload.length === 0 || payload.length > MAX_DESIGN_CHARS) return false;
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) return false;
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fromBase64Url(payload)));
  } catch {
    return false;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
  const elements = (raw as { elements?: unknown }).elements;
  if (!Array.isArray(elements)) return false;
  for (const el of elements) {
    if (typeof el !== 'object' || el === null) return false;
    const part = (el as { kind?: unknown; part?: unknown }).part;
    if (typeof part === 'object' && part !== null) {
      const data = (part as { data?: unknown }).data;
      if (data !== undefined && data !== null) return false;
    }
  }
  return true;
}

/** The fields of a feedback body, or the first field that is wrong. */
export function checkFeedback(body: unknown): Checked {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, field: 'body' };
  }
  const r = body as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!FIELDS.has(k)) return { ok: false, field: k };
  const { category, ver, lay, turnstile } = r;
  if (typeof category !== 'string' || !(CATEGORIES as readonly string[]).includes(category)) {
    return { ok: false, field: 'category' };
  }
  if (typeof r.message !== 'string') return { ok: false, field: 'message' };
  const message = r.message.trim();
  if ([...message].length < MESSAGE_MIN || [...message].length > MESSAGE_MAX) {
    return { ok: false, field: 'message' };
  }
  let email: string | null = null;
  if (r.email !== undefined && r.email !== null && r.email !== '') {
    if (typeof r.email !== 'string' || !plausibleEmail(r.email.trim())) {
      return { ok: false, field: 'email' };
    }
    email = r.email.trim();
  }
  let design: string | null = null;
  if (r.design !== undefined && r.design !== null) {
    if (typeof r.design !== 'string' || !checkDesign(r.design))
      return { ok: false, field: 'design' };
    design = r.design;
  }
  if (typeof ver !== 'string' || !VERSION_RE.test(ver)) return { ok: false, field: 'ver' };
  if (typeof lay !== 'string' || !(CONTEXT.lay as readonly string[]).includes(lay)) {
    return { ok: false, field: 'lay' };
  }
  if (typeof turnstile !== 'string' || turnstile.length === 0 || turnstile.length > 2048) {
    return { ok: false, field: 'turnstile' };
  }
  return {
    ok: true,
    value: {
      category: category as Feedback['category'],
      message,
      email,
      design,
      ver,
      lay: lay as Feedback['lay'],
      turnstile,
    },
  };
}

/** "FB-" and six characters of Crockford's base32. */
export function newReference(random: (n: number) => Uint8Array = randomBytes): string {
  const bytes = random(6);
  let out = 'FB-';
  for (const b of bytes) out += ALPHABET[b % 32];
  return out;
}

function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

export interface FeedbackDeps {
  /** Turnstile's siteverify; the Worker's fetch unless a test gives one. */
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly random?: (n: number) => Uint8Array;
}

/** Ask Turnstile whether the token is good; the address is not passed. */
export async function verifyTurnstile(
  token: string,
  secret: string,
  doFetch: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await doFetch(SITEVERIFY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token }),
    });
    if (!res.ok) return false;
    const out = (await res.json()) as { success?: unknown };
    return out.success === true;
  } catch {
    return false;
  }
}

const UNAVAILABLE = { error: 'unavailable', message: 'Feedback is not available right now' };

export async function handleFeedback(
  request: Request,
  env: Env,
  deps: FeedbackDeps = {},
): Promise<Response> {
  // Method and origin first; the rate limit only after the size and field checks, so a body
  // refused for its size or a field (which costs nothing downstream) does not spend one of the
  // three sends a minute. The limit guards Turnstile's check and the database.
  const refused = await guard(request, env, undefined);
  if (refused) return refused;
  if (!env.DB || !env.TURNSTILE_SECRET) return reply(503, UNAVAILABLE);
  const text = await readBody(request, MAX_FEEDBACK_BYTES);
  if (text === null) return reply(413, { error: 'too_large' });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return reply(400, { error: 'invalid', field: 'body' });
  }
  const checked = checkFeedback(body);
  if (!checked.ok) return reply(400, { error: 'invalid', field: checked.field });
  if (await overLimit(request, env.FEEDBACK_LIMIT)) return reply(429);
  const f = checked.value;
  if (!(await verifyTurnstile(f.turnstile, env.TURNSTILE_SECRET, deps.fetch ?? fetch))) {
    return reply(400, { error: 'check' });
  }
  const created = (deps.now?.() ?? new Date()).toISOString();
  for (let attempt = 0; attempt < 3; attempt++) {
    const ref = newReference(deps.random);
    try {
      await env.DB.prepare(
        'INSERT INTO feedback (id, created_at, category, message, email, design, app_version, layout) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
        .bind(ref, created, f.category, f.message, f.email, f.design, f.ver, f.lay)
        .run();
      return reply(201, { ref });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // A reference that exists already: draw another. A missing table (the migration has not
      // run yet) or any other failure: the app offers the GitHub link instead.
      if (/UNIQUE|PRIMARY KEY/i.test(msg)) continue;
      return reply(503, UNAVAILABLE);
    }
  }
  return reply(503, UNAVAILABLE);
}

/** The cut-off dates of the retention: emails after 90 days, rows after 365. */
export function retentionCutoffs(now: Date): { email: string; row: string } {
  const day = 86_400_000;
  return {
    email: new Date(now.getTime() - 90 * day).toISOString(),
    row: new Date(now.getTime() - 365 * day).toISOString(),
  };
}

/** The daily cron: clear old emails, delete old feedback. */
export async function runRetention(db: D1Database, now: Date = new Date()): Promise<void> {
  const { email, row } = retentionCutoffs(now);
  await db
    .prepare('UPDATE feedback SET email = NULL WHERE email IS NOT NULL AND created_at < ?')
    .bind(email)
    .run();
  await db.prepare('DELETE FROM feedback WHERE created_at < ?').bind(row).run();
}
