// @vitest-environment jsdom
/**
 * docs/10 QA round 1 fixes outside the plots: dialogs return to where they
 * came from, a refused feedback names its real cause, a design is checked
 * against the Worker's cap before Send, and the counts stop for the page once
 * `/api` answers 404 (a host without the Worker).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { designFits, failureReason, MAX_DESIGN_CHARS, useFeedback } from '../src/lib/feedback';
import { flush, resetForTest, track } from '../src/lib/analytics/track';
import { useHelp } from '../src/store/useHelp';
import { useShell } from '../src/store/useShell';

beforeEach(() => {
  useHelp.setState({ open: false, section: null, returnTo: null });
  useFeedback.setState({ open: false, returnTo: null });
  useShell.getState().closeSettings();
});

describe('dialogs return to where they came from', () => {
  it('Help opened by "What is sent" in Settings returns to Settings on close', () => {
    useHelp.getState().openHelp('feedback-and-privacy', 'settings');
    useHelp.getState().closeHelp();
    expect(useShell.getState().settings).toEqual({ section: 'behaviour' });
  });

  it('Help closed for an action (a Try link, Send feedback) does not reopen Settings', () => {
    useHelp.getState().openHelp('feedback-and-privacy', 'settings');
    useHelp.getState().closeHelp(false);
    expect(useShell.getState().settings).toBeNull();
  });

  it('Feedback opened from Help returns to Help at its section, and Help then to Settings', () => {
    useFeedback
      .getState()
      .openFeedback({ section: 'feedback-and-privacy', helpReturn: 'settings' });
    useFeedback.getState().closeFeedback();
    expect(useHelp.getState()).toMatchObject({
      open: true,
      section: 'feedback-and-privacy',
      returnTo: 'settings',
    });
    useHelp.getState().closeHelp();
    expect(useShell.getState().settings).toEqual({ section: 'behaviour' });
  });

  it('Feedback opened elsewhere closes to nothing', () => {
    useFeedback.getState().openFeedback();
    useFeedback.getState().closeFeedback();
    expect(useHelp.getState().open).toBe(false);
  });
});

describe('feedback: the size and the real cause of a refusal', () => {
  it('a design fits up to the cap', () => {
    expect(designFits('A'.repeat(MAX_DESIGN_CHARS))).toBe(true);
    expect(designFits('A'.repeat(MAX_DESIGN_CHARS + 1))).toBe(false);
    expect(designFits(null)).toBe(false);
  });

  it('names the field or the size that was refused', () => {
    expect(failureReason(413, 'too_large', '', true)).toMatch(/design is too large/);
    expect(failureReason(413, '', '', false)).toBe('the message is too long');
    expect(failureReason(400, 'invalid', 'design', true)).toMatch(/design was not accepted/);
    expect(failureReason(400, 'invalid', 'email', false)).toMatch(/email address/);
    expect(failureReason(400, 'invalid', 'message', false)).toMatch(/10 to 4000 characters/);
    expect(failureReason(400, 'check', '', false)).toMatch(/robot/);
  });
});

describe('counts on a host without the Worker', () => {
  beforeEach(() => {
    resetForTest();
    vi.stubGlobal('location', { hostname: 'smithchart.online' });
  });
  afterEach(() => {
    resetForTest();
    vi.unstubAllGlobals();
  });

  it('a 404 from /api/e stops sending for the page; the first send is a fetch, never a beacon', async () => {
    const fetch = vi.fn(async () => ({ status: 404 }));
    const beacon = vi.fn(() => true);
    track('view', 'response');
    flush('beacon', { fetch, beacon });
    expect(beacon).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 0));
    track('view', 'splot');
    flush('fetch', { fetch, beacon });
    flush('beacon', { fetch, beacon });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(beacon).not.toHaveBeenCalled();
  });

  it('once /api/e answered, the page hide uses the beacon', async () => {
    const fetch = vi.fn(async () => ({ status: 204 }));
    const beacon = vi.fn(() => true);
    track('view', 'response');
    flush('fetch', { fetch, beacon });
    await new Promise((r) => setTimeout(r, 0));
    track('view', 'splot');
    flush('beacon', { fetch, beacon });
    expect(beacon).toHaveBeenCalledTimes(1);
  });
});
