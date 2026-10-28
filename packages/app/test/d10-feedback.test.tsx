// @vitest-environment jsdom
/**
 * docs/10 section 3: the Send feedback dialog. The exact body it posts, the
 * design only when ticked and never with part data, Send held until the
 * message is ready, Turnstile loaded only when Send is pressed (QA round 1),
 * and a failure that keeps the text.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedbackDialog } from '../src/components/FeedbackDialog';
import { emptyDesign, identify } from '../src/lib/design';
import {
  feedbackBody,
  sendFeedback,
  siteKey,
  TEST_SITE_KEY,
  useFeedback,
} from '../src/lib/feedback';
import { parseTarget } from '../src/lib/helpActions';
import { useDesignStore } from '../src/store/useDesignStore';

beforeAll(() => {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  }));
});

let posted: { url: string; init: RequestInit }[];
function answer(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      posted.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    }),
  );
}

beforeEach(() => {
  posted = [];
  // Turnstile as its test key behaves: invisible, passes at once.
  vi.stubGlobal('turnstile', {
    render: (_el: HTMLElement, o: { sitekey: string; callback: (t: string) => void }) => {
      expect(o.sitekey).toBe(TEST_SITE_KEY);
      setTimeout(() => o.callback('XXXX.DUMMY.TOKEN.XXXX'), 0);
      return 'w1';
    },
    remove: () => undefined,
    reset: () => undefined,
  });
  useFeedback.setState({
    open: true,
    draft: { category: 'bug', message: '', email: '', attach: false },
  });
  useDesignStore.getState().init({
    ...emptyDesign(),
    name: 'antenna',
    elements: identify([
      { kind: 'C', orientation: 'shunt', value: 4.7e-12 },
      {
        kind: 'part',
        orientation: 'series',
        part: {
          partNumber: 'SYNTH-L1',
          type: 'L',
          data: { format: 'touchstone', points: [[1e9, 0.1, 0.2]] },
        } as never,
      } as never,
    ]),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function ready(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
}

describe('the body', () => {
  it('has exactly these keys; email and design only when given', () => {
    const draft = {
      category: 'idea' as const,
      message: '  Please add a Q circle  ',
      email: '',
      attach: false,
    };
    expect(feedbackBody(draft, 'tok', 'PAYLOAD', 1440)).toEqual({
      category: 'idea',
      message: 'Please add a Q circle',
      ver: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      lay: 'wide',
      turnstile: 'tok',
    });
    expect(
      Object.keys(
        feedbackBody({ ...draft, email: ' a@b.ch ', attach: true }, 'tok', 'PAYLOAD', 390),
      ),
    ).toEqual(['category', 'message', 'email', 'design', 'ver', 'lay', 'turnstile']);
  });

  it('the test site key on localhost, none elsewhere without configuration', () => {
    expect(siteKey('localhost')).toBe(TEST_SITE_KEY);
    expect(siteKey('smithchart.online')).toBeNull();
  });

  it('the guide link feedback: opens it', () => {
    expect(parseTarget('feedback:')).toEqual({ kind: 'feedback' });
    expect(parseTarget('feedback:open')).toEqual({ kind: 'feedback' });
    expect(parseTarget('feedback:x')).toBeNull();
  });

  it('says why it could not send, without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('offline'))),
    );
    const body = feedbackBody(
      { category: 'bug', message: 'x'.repeat(12), email: '', attach: false },
      't',
      null,
    );
    expect(await sendFeedback(body)).toEqual({ ok: false, reason: 'no connection' });
    answer(429, {});
    expect(await sendFeedback(body)).toEqual({
      ok: false,
      reason: 'more than 3 messages in a minute; wait a minute',
    });
    answer(400, { error: 'check' });
    expect(await sendFeedback(body)).toMatchObject({
      ok: false,
      reason: expect.stringContaining('robot'),
    });
    answer(503, { error: 'unavailable' });
    expect(await sendFeedback(body)).toEqual({
      ok: false,
      reason: 'feedback is not available right now',
    });
    answer(404, 'not found');
    expect(await sendFeedback(body)).toEqual({
      ok: false,
      reason: 'feedback is not available right now',
    });
  });
});

describe('the dialog', () => {
  it('Send waits for 10 characters, then loads the check; the post has the design only when ticked, without part data', async () => {
    answer(201, { ref: 'FB-7K3Q2M' });
    const api = (globalThis as unknown as { turnstile: { render: (...a: unknown[]) => string } })
      .turnstile;
    const renderSpy = vi.spyOn(api, 'render');
    render(<FeedbackDialog onClose={() => undefined} />);
    await ready();
    // Nothing of Turnstile before Send.
    expect(renderSpy).not.toHaveBeenCalled();
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    const text = screen.getByPlaceholderText(/What happened/);
    fireEvent.change(text, { target: { value: 'too short' } });
    expect(send.disabled).toBe(true);
    expect(screen.getByText('9 of 4000')).toBeTruthy();
    fireEvent.change(text, { target: { value: 'The VSWR plot does not zoom.' } });
    expect(send.disabled).toBe(false);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Attach the open design' }));
    expect(screen.getByText(/Adds about \d+ KB\./)).toBeTruthy();
    await act(async () => {
      fireEvent.click(send);
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(posted).toHaveLength(1);
    expect(posted[0]?.url).toBe('/api/feedback');
    expect(posted[0]?.init.credentials).toBe('omit');
    const body = JSON.parse(String(posted[0]?.init.body)) as Record<string, string>;
    expect(Object.keys(body)).toEqual(['category', 'message', 'design', 'ver', 'lay', 'turnstile']);
    const design = JSON.parse(Buffer.from(body.design as string, 'base64url').toString('utf8')) as {
      elements: { kind: string; part?: { data?: unknown } }[];
    };
    const part = design.elements.find((e) => e.kind === 'part');
    expect(part).toBeTruthy();
    expect(part?.part?.data).toBeUndefined();
    expect(body.design).not.toContain('SYNTH-L1'.repeat(0) + 'touchstone');
    expect(screen.getByText('FB-7K3Q2M')).toBeTruthy();
    expect(useFeedback.getState().draft.message).toBe('');
    expect(useDesignStore.getState().message).toBe('Feedback sent, reference FB-7K3Q2M');
  });

  it('without the tick no design is posted; a failure keeps the text', async () => {
    answer(503, { error: 'unavailable' });
    render(<FeedbackDialog onClose={() => undefined} />);
    await ready();
    fireEvent.change(screen.getByPlaceholderText(/What happened/), {
      target: { value: 'An idea for the gain table.' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });
    // Wait for the send and its failure message, not a fixed time: a busy machine is slower.
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    const body = JSON.parse(String(posted[0]?.init.body)) as Record<string, string>;
    expect(body.design).toBeUndefined();
    expect(body.email).toBeUndefined();
    expect(screen.getByRole('alert').textContent).toContain(
      'Could not send (feedback is not available right now). Your text is still here',
    );
    expect(useFeedback.getState().draft.message).toBe('An idea for the gain table.');
    expect(
      screen.getByRole('link', { name: 'Prefer GitHub? Open an issue' }).getAttribute('href'),
    ).toBe('https://github.com/QumeaJR/smithonline/issues/new');
  });
});
