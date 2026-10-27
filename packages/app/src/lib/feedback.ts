/**
 * Send feedback (docs/10 section 3): the dialog's state, kept for the session
 * when the dialog closes; what is posted to `/api/feedback`; and Turnstile,
 * whose script loads only when the dialog opens. The design goes along only
 * when the user ticks the box, as a share link without library part data.
 */
import { create } from 'zustand';
import { track } from './analytics/track';
import { appVersion } from './analytics/track';
import { layoutForWidth } from './layout';
import { useHelp, type HelpReturn } from '../store/useHelp';

export const FEEDBACK_PATH = '/api/feedback';
export const GITHUB_ISSUES = 'https://github.com/QumeaJR/smithonline/issues';
export const GITHUB_NEW_ISSUE = `${GITHUB_ISSUES}/new`;
import { EMAIL_MAX, MAX_DESIGN_CHARS, MESSAGE_MAX, MESSAGE_MIN } from './feedbackLimits';

export { EMAIL_MAX, MAX_DESIGN_CHARS, MESSAGE_MAX, MESSAGE_MIN };

/** True when a design payload is small enough for the Worker to take with the message. */
export function designFits(payload: string | null): boolean {
  return payload !== null && payload.length <= MAX_DESIGN_CHARS;
}

export type FeedbackCategory = 'bug' | 'idea' | 'question' | 'other';

export interface FeedbackDraft {
  readonly category: FeedbackCategory;
  readonly message: string;
  readonly email: string;
  readonly attach: boolean;
}

const EMPTY: FeedbackDraft = { category: 'bug', message: '', email: '', attach: false };

/** Help, when Feedback was opened from it: the section to return to, and where Help returns. */
export interface FeedbackReturn {
  readonly section: string | null;
  readonly helpReturn: HelpReturn;
}

interface FeedbackState {
  readonly open: boolean;
  readonly draft: FeedbackDraft;
  /** Help, when Feedback came from it; closing Feedback opens it again. */
  readonly returnTo: FeedbackReturn | null;
  openFeedback: (from?: FeedbackReturn) => void;
  closeFeedback: () => void;
  setDraft: (patch: Partial<FeedbackDraft>) => void;
  /** After a send: the draft is done with. */
  clearDraft: () => void;
}

export const useFeedback = create<FeedbackState>()((set, get) => ({
  open: false,
  draft: EMPTY,
  returnTo: null,
  openFeedback: (from) => {
    if (get().open) return;
    track('feedback', 'open');
    set({ open: true, returnTo: from ?? null });
  },
  closeFeedback: () => {
    const { returnTo } = get();
    set({ open: false, returnTo: null });
    if (returnTo) useHelp.getState().openHelp(returnTo.section ?? undefined, returnTo.helpReturn);
  },
  setDraft: (patch) => set({ draft: { ...get().draft, ...patch } }),
  clearDraft: () => set({ draft: EMPTY }),
}));

/** The body of `/api/feedback`: these keys and no other. */
export interface FeedbackBody {
  readonly category: FeedbackCategory;
  readonly message: string;
  readonly email?: string;
  readonly design?: string;
  readonly ver: string;
  readonly lay: 'phone' | 'tablet' | 'desktop' | 'wide';
  readonly turnstile: string;
}

/** The request body for a draft: the trimmed message, the email and design only when given. */
export function feedbackBody(
  draft: FeedbackDraft,
  turnstile: string,
  design: string | null,
  width: number = typeof window === 'undefined' ? 1440 : window.innerWidth,
): FeedbackBody {
  const email = draft.email.trim();
  return {
    category: draft.category,
    message: draft.message.trim(),
    ...(email ? { email } : {}),
    ...(draft.attach && design ? { design } : {}),
    ver: appVersion(),
    lay: layoutForWidth(width),
    turnstile,
  };
}

/** A message long enough to send (10 characters after trimming) and not too long. */
export function messageReady(message: string): boolean {
  const n = [...message.trim()].length;
  return n >= MESSAGE_MIN && n <= MESSAGE_MAX;
}

/** A basic address check, as the Worker does; empty is fine (the field is optional). */
export function emailOk(email: string): boolean {
  const e = email.trim();
  return (
    e === '' ||
    (e.length <= EMAIL_MAX && /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/.test(e))
  );
}

export type SendResult =
  { readonly ok: true; readonly ref: string } | { readonly ok: false; readonly reason: string };

/** Post the feedback; never throws. The reason is said in the dialog in plain words. */
export async function sendFeedback(
  body: FeedbackBody,
  doFetch: typeof fetch = globalThis.fetch,
): Promise<SendResult> {
  let res: Response;
  try {
    res = await doFetch(FEEDBACK_PATH, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    track('feedback', 'failed');
    return { ok: false, reason: 'no connection' };
  }
  if (res.status === 201) {
    try {
      const out = (await res.json()) as { ref?: unknown };
      if (typeof out.ref === 'string' && /^FB-[0-9A-Z]{6}$/.test(out.ref)) {
        track('feedback', 'sent');
        return { ok: true, ref: out.ref };
      }
    } catch {
      // fall through to the failure below
    }
  }
  track('feedback', 'failed');
  let error = '';
  let field = '';
  try {
    const out = (await res.clone().json()) as { error?: unknown; field?: unknown };
    error = String(out.error ?? '');
    field = String(out.field ?? '');
  } catch {
    // not JSON (a static host answering 404 or 405)
  }
  return { ok: false, reason: failureReason(res.status, error, field, body.design !== undefined) };
}

/** The real cause of a refused send, in the dialog's words. */
export function failureReason(
  status: number,
  error: string,
  field: string,
  withDesign: boolean,
): string {
  if (status === 429) return 'more than 3 messages in a minute; wait a minute';
  if (status === 413) {
    return withDesign
      ? 'the attached design is too large; send without it'
      : 'the message is too long';
  }
  if (status === 400) {
    if (error === 'check') return 'the check that you are not a robot failed';
    if (field === 'design') return 'the attached design was not accepted; send without it';
    if (field === 'message') return `the message needs ${MESSAGE_MIN} to ${MESSAGE_MAX} characters`;
    if (field === 'email') return 'the email address was not accepted';
    return 'the message was not accepted';
  }
  return 'feedback is not available right now';
}

/* ---------------------------------------------------------------- Turnstile */

/** Cloudflare's documented test site key: invisible, always passes (local development, tests). */
export const TEST_SITE_KEY = '1x00000000000000000000BB';
export const TURNSTILE_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export interface TurnstileApi {
  render: (
    el: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      'error-callback'?: () => void;
      'expired-callback'?: () => void;
      appearance?: 'always' | 'execute' | 'interaction-only';
      size?: 'normal' | 'flexible' | 'compact';
      theme?: 'auto' | 'light' | 'dark';
    },
  ) => string;
  remove: (id: string) => void;
}

/**
 * The site key: the build's VITE_TURNSTILE_SITEKEY; on localhost without one,
 * the test key. Null where none is set: the dialog then offers GitHub only.
 */
export function siteKey(host: string = globalThis.location?.hostname ?? ''): string | null {
  const key = buildSiteKey();
  if (/^[\w-]{10,100}$/.test(key)) return key;
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' ? TEST_SITE_KEY : null;
}

function buildSiteKey(): string {
  try {
    return String(import.meta.env?.VITE_TURNSTILE_SITEKEY ?? '');
  } catch {
    return '';
  }
}

let loading: Promise<TurnstileApi> | null = null;

/** Load Turnstile's script once, when the dialog first opens. */
export function loadTurnstile(): Promise<TurnstileApi> {
  const w = globalThis as { turnstile?: TurnstileApi };
  if (w.turnstile) return Promise.resolve(w.turnstile);
  if (loading) return loading;
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TURNSTILE_SRC;
    s.async = true;
    s.onload = () => (w.turnstile ? resolve(w.turnstile) : reject(new Error('no Turnstile')));
    s.onerror = () => {
      loading = null;
      reject(new Error('Turnstile could not load'));
    };
    document.head.appendChild(s);
  });
  return loading;
}
