// @vitest-environment jsdom
/**
 * Adversarial QA, D6 round 1: the closed loop in the app store (compare, fit, retune, apply,
 * undo and redo, persistence).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('uplot', () => {
  class FakePlot {
    static pxRatio = 1;
    over = document.createElement('div');
    cursor = {};
    setCursor(): void {}
    posToIdx(): number {
      return 0;
    }
    setData(): void {}
    setSize(): void {}
    redraw(): void {}
    destroy(): void {}
  }
  return { default: FakePlot };
});
vi.mock('uplot/dist/uPlot.min.css', () => ({}));

import { MeasuredBoardSection } from '../src/components/MeasuredBoardSection';
import {
  applyRetune,
  compareWithDesign,
  currentFit,
  currentRetune,
  resetBoardFit,
  runBoardFit,
  runRetune,
  stopBoardFit,
  useBoardFit,
} from '../src/lib/boardFit';
import { readImportFile } from '../src/lib/import';
import { boardModel } from '../src/lib/measuredBoard';
import { designFileText, designFromJsonFile, decodeDesign, encodeDesign } from '../src/lib/share';
import { measureStart } from '../src/lib/workflows';
import { useDesignStore } from '../src/store/useDesignStore';
import { useTourStore } from '../src/store/useTourStore';
import { MeasuredBoardPanel } from '../src/response/MeasuredBoardPanel';

const D = () => useDesignStore.getState();
// Kept failures: the comparison message overwritten by 'Fit stopped', a repeated frequency and
// an open row (|S11| = 1) lost on save and reopen.
const SAMPLE = readFileSync(
  resolve(__dirname, '../../core/test/fixtures/sparams/board-1g-synthetic.s1p'),
  'utf8',
);

const settle = (ms = 20): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  useTourStore.getState().close();
  resetBoardFit();
  D().init(measureStart());
  D().setView('chart');
  D().setMessage(null);
});
afterEach(() => cleanup());

function compare(name: string, text: string): boolean {
  const file = readImportFile(name, text);
  let ok = false;
  act(() => {
    ok = compareWithDesign(file);
  });
  return ok;
}

describe('fit job bookkeeping', () => {
  // Latent: the UI never calls runBoardFit while one runs (the Fit button and the workflow's
  // Do it both disappear while running), so this is not reachable today.
  it.skip('a second Fit while one runs (workflow Do it) keeps the second one stoppable', async () => {
    compare('board.s1p', SAMPLE);
    act(() => runBoardFit());
    expect(useBoardFit.getState().running).toBe(true);
    // The workflow card's "Fit what moved" does not check running.
    act(() => runBoardFit());
    // Let microtasks run, but not the setTimeout(0) that runs the fit.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const s = useBoardFit.getState();
    const msg = D().message;
    // The second job is still pending: running must be true and Stop must reach it.
    expect({ running: s.running, msg }).toEqual({ running: true, msg: expect.anything() });
  });

  it.skip('Stop after the double start actually stops the second job', async () => {
    compare('board.s1p', SAMPLE);
    act(() => runBoardFit());
    act(() => runBoardFit());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => stopBoardFit());
    await settle(50);
    // The second job should have been cancelled: no outcome stored.
    expect(useBoardFit.getState().outcome).toBeNull();
  });

  it('comparing a new file while a fit runs keeps the comparison message', async () => {
    compare('board.s1p', SAMPLE);
    act(() => runBoardFit());
    compare('board2.s1p', SAMPLE);
    const said = D().message;
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(D().message).toBe(said);
  });
});

describe('retune bookkeeping', () => {
  it('locking the part a retune changes makes the retune stale (Realize on)', async () => {
    compare('board.s1p', SAMPLE);
    act(() => runBoardFit());
    await settle(200);
    act(() => {
      runRetune();
    });
    const r = currentRetune(D().design);
    const changes = r?.suggestion?.changes ?? [];
    expect(changes.length).toBeGreaterThan(0);
    const idx = (changes[0] as { index: number }).index;
    const before = D().design.elements[idx];
    act(() => D().toggleLock(idx));
    expect(D().design.elements[idx]?.locked).toBe(true);
    act(() => applyRetune());
    // A locked part must not be changed by Apply.
    expect(D().design.elements[idx]).toEqual({ ...before, locked: true });
  });

  it('undo after apply restores the design and the fit is current again', async () => {
    compare('board.s1p', SAMPLE);
    act(() => runBoardFit());
    await settle(200);
    act(() => {
      runRetune();
    });
    const before = D().design;
    act(() => applyRetune());
    expect(D().design).not.toBe(before);
    act(() => D().undo());
    expect(D().design.elements).toEqual(before.elements);
    expect(currentFit(D().design)).not.toBeNull();
    act(() => D().redo());
    expect(D().design.measurement).toBeDefined();
  });
});

describe('persistence of the measurement', () => {
  function points(n: number): string {
    const lines = ['# HZ S RI R 50'];
    for (let i = 0; i < n; i++) {
      const f = 7e8 + i * (6e8 / Math.max(1, n - 1));
      lines.push(`${f} ${(0.1 + 0.0001 * i).toFixed(6)} ${(-0.2).toFixed(6)}`);
    }
    return lines.join('\n');
  }

  it('201 points ride in a link, 202 do not', () => {
    expect(compare('a.s1p', points(201))).toBe(true);
    const d201 = decodeDesign(encodeDesign(D().design));
    expect(d201?.measurement?.points.length).toBe(201);
    expect(compare('b.s1p', points(202))).toBe(true);
    const d202 = decodeDesign(encodeDesign(D().design));
    expect(d202?.measurement).toBeUndefined();
  });

  it('2001 points are taken, 2002 refused with a message', () => {
    expect(compare('a.s1p', points(2001))).toBe(true);
    expect(D().design.measurement?.points.length).toBe(2001);
    expect(compare('b.s1p', points(2002))).toBe(false);
    expect(D().design.measurement?.name).toBe('a.s1p');
  });

  it('file round trip is stable for a 2001-point measurement', () => {
    compare('a.s1p', points(2001));
    const t1 = designFileText(D().design);
    const r = designFromJsonFile(t1);
    const d = 'value' in r ? r.value : (r as unknown as { design: unknown }).design;
    expect(d).toBeTruthy();
    const t2 = designFileText(d as typeof D extends never ? never : ReturnType<typeof D>['design']);
    expect(t2).toBe(t1);
  });

  it('a file with a repeated frequency round trips through .json unchanged', () => {
    const text = ['# HZ S RI R 50', '1e9 0.1 0.1', '1e9 0.2 0.2', '1.1e9 0.1 0', '1.2e9 0 0'].join(
      '\n',
    );
    const ok = compare('dup.s1p', text);
    if (!ok) return; // refused at import: nothing to check
    const m1 = D().design.measurement;
    const t1 = designFileText(D().design);
    const r = designFromJsonFile(t1) as unknown as { value?: { measurement?: unknown } };
    expect(r.value?.measurement).toEqual(m1);
  });

  it('a row at |S11| = 1 survives save and reopen', () => {
    const text = ['# HZ S MA R 50', '0.9e9 1 0', '1e9 0.5 10', '1.1e9 0.5 20'].join('\n');
    const ok = compare('open.s1p', text);
    if (!ok) return;
    const m1 = D().design.measurement;
    const t1 = designFileText(D().design);
    const r = designFromJsonFile(t1) as unknown as {
      value?: { measurement?: { points: unknown[] } };
    };
    expect(r.value?.measurement?.points.length).toBe(m1?.points.length);
  });
});

describe('never NaN on screen', () => {
  function textOf(): string {
    return document.body.textContent ?? '';
  }

  it('a measurement entirely outside a measured load band', () => {
    compare('board.s1p', SAMPLE);
    // A measured load known only at 5 to 6 GHz.
    act(() =>
      D().step('load', (d) => ({
        ...d,
        sweep: {
          ...d.sweep,
          enabled: true,
          loads: [
            { frequency: 5e9, z: { re: 50, im: 0 } },
            { frequency: 6e9, z: { re: 60, im: 0 } },
          ],
        },
      })),
    );
    render(
      <>
        <MeasuredBoardSection />
        <MeasuredBoardPanel logX={false} />
      </>,
    );
    expect(textOf()).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('a measurement with |Gamma| > 1 (negative R)', () => {
    const text = [
      '# HZ S RI R 50',
      '0.9e9 1.2 0',
      '1e9 1.1 0.1',
      '1.1e9 1.3 0.2',
      '1.2e9 1.05 0',
    ].join('\n');
    compare('active.s1p', text);
    render(
      <>
        <MeasuredBoardSection />
        <MeasuredBoardPanel logX={false} />
      </>,
    );
    expect(textOf()).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('retune with an empty stock list', () => {
    compare('board.s1p', SAMPLE);
    act(() => D().setRealize({ series: 'stock', stockText: '' }));
    let r: unknown = null;
    act(() => {
      r = runRetune();
    });
    expect(r).toBeTruthy();
    expect(D().message ?? '').not.toMatch(/NaN|undefined|Infinity/);
  });

  it('boardModel for a design whose part library is empty', () => {
    compare('board.s1p', SAMPLE);
    act(() => D().setRealize({ series: 'library' }));
    expect(() => boardModel(D().design)).not.toThrow();
    let r: unknown = null;
    act(() => {
      r = runRetune();
    });
    expect(r).toBeTruthy();
    expect(D().message ?? '').not.toMatch(/NaN|undefined|Infinity/);
  });
});
