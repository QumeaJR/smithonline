// @vitest-environment jsdom
// The Worker's ambient Cloudflare types (D1Database and the rest), needed by its sources.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../../worker/src/cloudflare.d.ts" />
/**
 * QA docs/10 (adversarial): the Send feedback dialog posting into the real
 * Worker handler (packages/worker/src/index.ts `route`) with the SQLite
 * stand-in for D1. Whatever the dialog sends after the user ticks "Attach the
 * open design" must be accepted by the Worker, or the dialog must say why.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedbackDialog } from '../src/components/FeedbackDialog';
import { DEFAULT_SWEEP, emptyDesign, identify } from '../src/lib/design';
import { useFeedback } from '../src/lib/feedback';
import { encodeDesign } from '../src/lib/share';
import { ownBuild } from '../src/lib/designBuild';
import { useDesignStore } from '../src/store/useDesignStore';
import { route } from '../../worker/src/index';
import { checkFeedback, MAX_DESIGN_CHARS, SITEVERIFY } from '../../worker/src/feedback';
import { TestD1 } from '../../worker/test/d1';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATION = readFileSync(
  resolve(__dirname, '../../worker/migrations/0001_feedback.sql'),
  'utf8',
);

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

let db: TestD1;
let statuses: number[];

/** The browser's fetch, answered by the Worker itself (and Turnstile's siteverify passing). */
function wireToWorker(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url === SITEVERIFY) return new Response(JSON.stringify({ success: true }));
      const req = new Request(`https://smithchart.online${url}`, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string>),
          Origin: 'https://smithchart.online',
          'CF-Connecting-IP': '198.51.100.9',
        },
      });
      const res = await route(req, {
        DB: db as unknown as NonNullable<Parameters<typeof route>[1]['DB']>,
        TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
      });
      statuses.push(res.status);
      return res;
    }),
  );
}

/** A measured antenna: an s1p's rows kept as the datapoint sweep (more than 64 rows). */
function measuredAntenna(rows: number): void {
  const loads = Array.from({ length: rows }, (_, i) => {
    const f = 400e6 + (i * 200e6) / (rows - 1);
    return { frequency: f, z: { re: 20 + 60 * Math.sin(i / 37), im: -35 + 70 * Math.cos(i / 23) } };
  });
  useDesignStore.getState().init({
    ...emptyDesign(),
    name: 'antenna',
    frequency: 433e6,
    elements: identify([{ kind: 'C', orientation: 'shunt', value: 4.7e-12 }]),
    sweep: {
      ...DEFAULT_SWEEP,
      enabled: true,
      start: 400e6,
      stop: 600e6,
      loads,
      loadsName: 'antenna.s1p',
      mode: 'datapoints',
    },
  } as never);
}

beforeEach(() => {
  db = new TestD1();
  db.db.exec(MIGRATION);
  statuses = [];
  vi.stubGlobal('turnstile', {
    render: (_el: HTMLElement, o: { callback: (t: string) => void }) => {
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
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function sendWithDesign(): Promise<void> {
  render(<FeedbackDialog onClose={() => undefined} />);
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
  fireEvent.change(screen.getByPlaceholderText(/What happened/), {
    target: { value: 'The match over my measured antenna looks wrong.' },
  });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Attach the open design' }));
  // Turnstile loads on Send and answers on the next tick; the post follows its token.
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await new Promise((r) => setTimeout(r, 20));
  });
}

describe('feedback with the open design attached, end to end into the Worker', () => {
  it('a small design is stored (sanity)', async () => {
    wireToWorker();
    measuredAntenna(65);
    await sendWithDesign();
    expect(statuses).toEqual([201]);
    expect(db.rows()).toHaveLength(1);
  });

  it('the payload of a measured antenna with 1001 rows fits the Worker limit', () => {
    measuredAntenna(1001);
    const payload = encodeDesign(ownBuild(useDesignStore.getState().design));
    // Observed: far above 64 KB, so the Worker refuses the field "design".
    expect(payload.length).toBeLessThanOrEqual(MAX_DESIGN_CHARS);
  });

  it('the largest measured antenna whose design the Worker still takes', () => {
    let fits = 0;
    for (const n of [101, 201, 301, 401, 501, 801, 1001, 1601, 2001]) {
      measuredAntenna(n);
      const p = encodeDesign(ownBuild(useDesignStore.getState().design));
      const ok = checkFeedback({
        category: 'bug',
        message: 'ten characters',
        design: p,
        ver: '0.6.0',
        lay: 'desktop',
        turnstile: 't',
      }).ok;
      if (ok) fits = n;
    }
    // Typical VNA sweeps are 201 to 1601 points; every one of them should be attachable.
    expect(fits).toBeGreaterThanOrEqual(2001);
  });

  it('a measured antenna of 1001 rows with the box ticked is sent and stored', async () => {
    wireToWorker();
    measuredAntenna(1001);
    await sendWithDesign();
    // Observed: 400 {"error":"invalid","field":"design"} (or 413), and the dialog says
    // "the message was not accepted", although the message is fine and the app built the payload.
    expect(statuses).toEqual([201]);
  });

  // Corrected in the QA fixes: the Worker now takes designs up to MAX_DESIGN_CHARS (256 KiB; the
  // app keeps at most 2001 measured rows, about 150 KB), so a 1001-row design (about 75 KB) is
  // no longer "too large". The warning guards a design above that cap; the store accepts 4001
  // rows here although a file or share link is cut to 2001, which makes one.
  it('a 1001-row design shows its size and no warning', async () => {
    wireToWorker();
    measuredAntenna(1001);
    render(<FeedbackDialog onClose={() => undefined} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Attach the open design' }));
    const note = screen.getByText(/Adds about \d+ KB/).textContent ?? '';
    const kb = Number(/(\d+) KB/.exec(note)?.[1]);
    expect(kb).toBeLessThanOrEqual(MAX_DESIGN_CHARS / 1024);
    expect(screen.queryByRole('button', { name: 'Send without the design' })).toBeNull();
  });

  it('the dialog warns before Send when the design is too large, and sends without it', async () => {
    wireToWorker();
    measuredAntenna(4001);
    render(<FeedbackDialog onClose={() => undefined} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    fireEvent.change(screen.getByPlaceholderText(/What happened/), {
      target: { value: 'The match over my measured antenna looks wrong.' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Attach the open design' }));
    expect(screen.getByRole('alert').textContent).toMatch(/more than the 256 KB/);
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send without the design' }));
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(statuses).toEqual([201]);
    expect(db.rows()).toHaveLength(1);
    expect((db.rows()[0] as { design: unknown }).design).toBeNull();
  });
});
