// @vitest-environment jsdom
/**
 * QA docs/10 sections 1 and 3 (adversarial): privacy and offline behaviour.
 * What leaves the page, with which fields; that nothing fails loudly when
 * /api is unreachable; and that the Help text "Feedback and privacy"
 * (docs/06 section 12, shown in the app as Help) says what the code does.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONTEXT, EVENTS, parseBatch } from '../src/lib/analytics/schema';
import {
  currentContext,
  flush,
  queued,
  resetForTest,
  setSwitch,
  track,
  trackDynamic,
} from '../src/lib/analytics/track';
import { countImport, countRefused } from '../src/lib/analytics/files';
import { loadBeacon } from '../src/lib/analytics/beacon';
import { sendFeedback, loadTurnstile } from '../src/lib/feedback';

const TOKEN = '0123456789abcdef0123456789abcdef';
const unhandled: unknown[] = [];
const onUnhandled = (e: unknown): void => void unhandled.push(e);

function onProduction(nav: Record<string, unknown> = {}): void {
  vi.stubGlobal('location', { hostname: 'smithchart.online' });
  for (const [k, v] of Object.entries(nav)) {
    Object.defineProperty(navigator, k, { value: v, configurable: true });
  }
}

beforeEach(() => {
  resetForTest();
  unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
  document.head.innerHTML = '';
  onProduction();
});
afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
  for (const k of ['globalPrivacyControl', 'doNotTrack', 'sendBeacon']) {
    delete (navigator as unknown as Record<string, unknown>)[k];
  }
  resetForTest();
  vi.unstubAllGlobals();
});

describe('what leaves the page', () => {
  it('survives: hostile file names and refusal messages never reach the body', () => {
    const name = '=HYPERLINK("http://x")\u0000 secret-customer-antenna.s2p';
    countImport(name, 'load');
    countRefused('Kunde Müller rev3.s1p', 'rows', 'Line 7: "Kunde Müller 50 Ohm" is not a number');
    trackDynamic('workflow', 'my private design', 'start');
    trackDynamic('next_step', '__proto__', 'shown');
    let body = '';
    flush('fetch', {
      fetch: (_u, init) => {
        body = String(init.body);
        return Promise.resolve();
      },
    });
    expect(body).not.toMatch(/Kunde|Müller|secret|HYPERLINK|private|proto/);
    const parsed = parseBatch(JSON.parse(body));
    expect(parsed?.dropped).toBe(0);
    expect(Object.keys(JSON.parse(body) as object)).toEqual(['v', 'ctx', 'ev']);
    expect(Object.keys(parsed?.ctx ?? {})).toEqual(Object.keys(currentContext()));
  });

  it('survives: GPC or DNT set after events were queued sends nothing', () => {
    track('view', 'response');
    onProduction({ globalPrivacyControl: true });
    const sent: string[] = [];
    flush('beacon', {
      beacon: (_u, b) => {
        sent.push(String(b));
        return true;
      },
    });
    expect(sent).toEqual([]);
    track('view', 'splot');
    expect(queued()).toEqual([]);
  });

  it('survives: the beacon is not loaded with GPC, DNT or the switch off', () => {
    onProduction({ doNotTrack: '1' });
    expect(loadBeacon(TOKEN, document)).toBe(false);
    delete (navigator as unknown as Record<string, unknown>).doNotTrack;
    onProduction({ globalPrivacyControl: true });
    expect(loadBeacon(TOKEN, document)).toBe(false);
    delete (navigator as unknown as Record<string, unknown>).globalPrivacyControl;
    setSwitch(false);
    expect(loadBeacon(TOKEN, document)).toBe(false);
    expect(document.querySelector('script')).toBeNull();
  });

  it('switching the counts off takes the Web Analytics beacon off this page too', () => {
    expect(loadBeacon(TOKEN, document)).toBe(true);
    setSwitch(false);
    // Observed: the beacon stays and reports this page when it is hidden (Cloudflare: "Core Web
    // Vital metrics are reported when the visibilityState is hidden for the first time after the
    // page load event"); the Help text does not say "from the next visit".
    const help = readFileSync(resolve(__dirname, '../../../docs/06-user-guide.md'), 'utf8');
    const section = help.slice(help.indexOf('## 12. Feedback and privacy'));
    const saysNextVisit = /next (visit|page load|time)|after a reload/i.test(section);
    expect(document.querySelector('script[data-cf-beacon]') === null || saysNextVisit).toBe(true);
  });
});

describe('offline: /api unreachable or blocked', () => {
  it('survives: a rejected fetch, a throwing beacon and no fetch at all fail quietly', async () => {
    track('view', 'response');
    flush('fetch', { fetch: () => Promise.reject(new TypeError('Failed to fetch')) });
    track('view', 'splot');
    flush('beacon', {
      beacon: () => {
        throw new TypeError('blocked');
      },
    });
    track('view', 'chart');
    flush('fetch', {});
    await new Promise((r) => setTimeout(r, 10));
    expect(unhandled).toEqual([]);
    expect(queued()).toEqual([]);
  });

  it('survives: feedback offline, behind a static host (404 HTML) or a broken 201 says why', async () => {
    const body = {
      category: 'bug' as const,
      message: 'hello world here',
      ver: '0.6.0',
      lay: 'desktop' as const,
      turnstile: 't',
    };
    expect(
      await sendFeedback(body, (() => Promise.reject(new TypeError('offline'))) as typeof fetch),
    ).toEqual({ ok: false, reason: 'no connection' });
    expect(
      await sendFeedback(
        body,
        (async () => new Response('<!doctype html>', { status: 404 })) as typeof fetch,
      ),
    ).toEqual({ ok: false, reason: 'feedback is not available right now' });
    expect(
      await sendFeedback(
        body,
        (async () => new Response('not json', { status: 201 })) as typeof fetch,
      ),
    ).toEqual({ ok: false, reason: 'feedback is not available right now' });
    expect(unhandled).toEqual([]);
  });

  it('survives: Turnstile blocked rejects, and the next open tries again', async () => {
    const first = loadTurnstile();
    const s = document.head.querySelector('script') as HTMLScriptElement;
    s.onerror?.(new Event('error'));
    await expect(first).rejects.toThrow('Turnstile could not load');
    const second = loadTurnstile();
    expect(second).not.toBe(first);
    second.catch(() => undefined);
  });
});

describe('the Help text "Feedback and privacy" against the code', () => {
  const help = readFileSync(resolve(__dirname, '../../../docs/06-user-guide.md'), 'utf8');
  const section = help.slice(help.indexOf('## 12. Feedback and privacy'));

  it('does not say designs are never uploaded while Send feedback can attach the design', () => {
    const dialog = readFileSync(resolve(__dirname, '../src/components/FeedbackDialog.tsx'), 'utf8');
    expect(dialog).toContain('Attach the open design');
    // Observed: "Your designs and files stay there; they are never uploaded."
    expect(section).not.toMatch(/never uploaded/);
  });

  it('names every field each count carries ("Nothing else is sent")', () => {
    // The context the code sends with every batch.
    expect(Object.keys(CONTEXT)).toContain('pwa');
    expect(Object.keys(EVENTS)).toContain('start');
    // Observed: the text lists version, device kind (phone, tablet, desktop; touch or mouse) and
    // theme, then "Nothing else is sent"; whether the app runs installed (pwa: app or browser) is
    // sent too and not named.
    expect(section).toMatch(/install/i);
  });

  it('mentions Turnstile, the third-party check Send feedback loads', () => {
    const lib = readFileSync(resolve(__dirname, '../src/lib/feedback.ts'), 'utf8');
    expect(lib).toContain('challenges.cloudflare.com/turnstile');
    // Observed: section 12 says nothing about the Turnstile check, its script from
    // challenges.cloudflare.com or what it processes.
    expect(section).toMatch(/Turnstile|robot|check/i);
  });
});
