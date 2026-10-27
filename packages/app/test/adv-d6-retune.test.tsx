// @vitest-environment jsdom
/**
 * Adversarial QA, D6 round 1: retune and apply against Realize, the part library, data ranges,
 * other reference impedances and multi-port files.
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
  useBoardFit,
} from '../src/lib/boardFit';
import { readImportFile } from '../src/lib/import';
import { boardModel, boardReflections, boardComparison, boardBand } from '../src/lib/measuredBoard';
import { suggestRetune } from '@smithonline/core';
import { memoryPartStore } from '../src/lib/partStore';
import { measureStart } from '../src/lib/workflows';
import { useDesignStore } from '../src/store/useDesignStore';
import { syntheticLibraryParts, usePartLibrary } from '../src/store/usePartLibrary';
import { useTourStore } from '../src/store/useTourStore';
import { MeasuredBoardPanel } from '../src/response/MeasuredBoardPanel';
import type { Element } from '@smithonline/core';

const D = () => useDesignStore.getState();
const FIX = (n: string) =>
  readFileSync(resolve(__dirname, '../../core/test/fixtures/sparams', n), 'utf8');
const SAMPLE = FIX('board-1g-synthetic.s1p');

const settle = (ms = 200): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

beforeEach(async () => {
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
  usePartLibrary.setState({ parts: [], open: false });
  await usePartLibrary.getState().init(memoryPartStore());
  useTourStore.getState().close();
  resetBoardFit();
  D().init(measureStart());
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

const strip = (el: Element | undefined): unknown => {
  if (!el) return el;
  if (el.kind === 'part') return { kind: 'part', pn: el.part.partNumber, o: el.orientation };
  if (el.kind === 'L' || el.kind === 'C' || el.kind === 'R')
    return { kind: el.kind, value: Number(el.value.toPrecision(6)), o: el.orientation };
  return el.kind;
};

async function fitRetuneApply(): Promise<{ idx: number[]; tos: unknown[] }> {
  act(() => runBoardFit());
  await settle();
  act(() => {
    runRetune();
  });
  const r = currentRetune(D().design);
  const changes = r?.suggestion?.changes ?? [];
  act(() => applyRetune());
  console.log(
    'APPLIED',
    JSON.stringify(changes.map((c) => [c.index, strip(c.from), strip(c.to)])),
    D().message,
  );
  return { idx: changes.map((c) => c.index), tos: changes.map((c) => strip(c.to)) };
}

describe('Apply puts in what the retune suggested (the network as built after Apply)', () => {
  for (const series of ['E6', 'E12', 'E24', 'E96'] as const) {
    it(`Realize on, ${series}`, async () => {
      act(() => D().setRealize({ enabled: true, series }));
      compare('board.s1p', SAMPLE);
      const { idx, tos } = await fitRetuneApply();
      if (idx.length === 0) return;
      const built = boardModel(D().design).base;
      expect(idx.map((i) => strip(built[i]))).toEqual(tos);
    });
  }

  it('Realize on, part library', async () => {
    await act(async () => {
      await usePartLibrary.getState().addParts(syntheticLibraryParts());
    });
    act(() => D().setRealize({ enabled: true, series: 'library' }));
    compare('board.s1p', SAMPLE);
    const { idx, tos } = await fitRetuneApply();
    if (idx.length === 0) return;
    const built = boardModel(D().design).base;
    expect(idx.map((i) => strip(built[i]))).toEqual(tos);
  });

  it('Realize off: retune snaps to the series and Apply writes it', async () => {
    act(() => D().setRealize({ enabled: false, series: 'E12' }));
    compare('board.s1p', SAMPLE);
    const { idx, tos } = await fitRetuneApply();
    if (idx.length === 0) return;
    const built = boardModel(D().design).base;
    expect(idx.map((i) => strip(built[i]))).toEqual(tos);
  });
});

describe('measurements the design cannot hold', () => {
  it('part library, measured above every part’s data (10.5 to 12 GHz)', async () => {
    await act(async () => {
      await usePartLibrary.getState().addParts(syntheticLibraryParts());
    });
    act(() => D().setRealize({ enabled: true, series: 'library' }));
    const lines = ['# GHZ S RI R 50'];
    for (let i = 0; i < 11; i++) lines.push(`${10.5 + i * 0.15} 0.3 -0.2`);
    compare('high.s1p', lines.join('\n'));
    render(
      <>
        <MeasuredBoardSection />
        <MeasuredBoardPanel logX={false} />
      </>,
    );
    act(() => runBoardFit());
    await settle();
    act(() => {
      runRetune();
    });
    const msg = D().message ?? '';
    const text = document.body.textContent ?? '';
    expect(text + msg).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('a one-port measured at Z0 75 is referred to the design Z0', () => {
    // Gamma 0 at 75 ohm: the board is 75 ohm, Gamma 0.2 towards 50 ohm.
    compare('z75.s1p', ['# GHZ S RI R 75', '0.9 0 0', '1.0 0 0', '1.1 0 0'].join('\n'));
    const g = boardReflections(D().design);
    expect(g[0]?.gamma.re).toBeCloseTo(0.2, 9);
  });

  it('a two-port at Z0 75 is terminated in 75 ohm', () => {
    const rows = ['# GHZ S RI R 75'];
    for (const f of [0.9, 1.0, 1.1]) rows.push(`${f} 0 0 1 0 1 0 0 0`);
    compare('thru75.s2p', rows.join('\n'));
    expect(D().design.measurement?.termination).toBe(75);
    const g = boardReflections(D().design);
    expect(g[0]?.gamma.re).toBeCloseTo(0.2, 9);
  });

  // Fix round: a four-port file is refused with its reason (only port 2 would have been
  // terminated, and the section called it a two-port); the design still renders.
  it('a four-port file is refused in words and the design still renders', () => {
    const ok = compare('coupler.s4p', FIX('coupler-synthetic.s4p'));
    render(<MeasuredBoardSection />);
    const text = document.body.textContent ?? '';
    expect(ok).toBe(false);
    expect(D().message).toMatch(/has 4 ports/);
    expect(D().design.measurement).toBeUndefined();
    // The section claims "two-port"; a four-port file is not one.
    expect(text).not.toMatch(/two-port: S11 with port 2 on/);
  });

  it('a design with only a line: fit refuses in words, no NaN', async () => {
    act(() =>
      D().step('line', (d) => ({
        ...d,
        realize: { ...d.realize, enabled: false },
        elements: [{ kind: 'line', z0: 50, length: 0.1, id: 'x' } as never],
      })),
    );
    compare('board.s1p', SAMPLE);
    render(<MeasuredBoardSection />);
    act(() => runBoardFit());
    await settle();
    act(() => {
      runRetune();
    });
    const text = (document.body.textContent ?? '') + (D().message ?? '');
    expect(text).not.toMatch(/NaN|undefined|Infinity/);
    expect(currentFit(D().design)?.ok).toBe(false);
  });

  it('design frequency far outside the measured band', async () => {
    act(() => D().setFrequency(5e9));
    compare('board.s1p', SAMPLE);
    render(
      <>
        <MeasuredBoardSection />
        <MeasuredBoardPanel logX={false} />
      </>,
    );
    act(() => runBoardFit());
    await settle();
    act(() => {
      runRetune();
    });
    const text = (document.body.textContent ?? '') + (D().message ?? '');
    expect(text).not.toMatch(/NaN|undefined|Infinity/);
    expect(boardComparison(D().design)?.points.length).toBe(121);
    expect(useBoardFit.getState().running).toBe(false);
  });
});

describe('library retune applied for many starting values', () => {
  const starts: [number, number][] = [
    [22e-9, 1e-12],
    [2.2e-9, 22e-12],
    [4.7e-9, 10e-12],
    [22e-9, 22e-12],
    [3e-9, 1.5e-12],
  ];
  for (const [l, c] of starts) {
    it(`L ${l} C ${c}`, async () => {
      await act(async () => {
        await usePartLibrary.getState().addParts(syntheticLibraryParts());
      });
      act(() =>
        D().step('vals', (d) => ({
          ...d,
          realize: { ...d.realize, enabled: true, series: 'library' },
          elements: d.elements.map((el, i) =>
            i === 0 ? ({ ...el, value: l } as typeof el) : ({ ...el, value: c } as typeof el),
          ),
        })),
      );
      compare('board.s1p', SAMPLE);
      act(() => {
        runRetune();
      });
      const r = currentRetune(D().design);
      const changes = r?.suggestion?.changes ?? [];
      act(() => applyRetune());
      const tos = changes.map((ch) => strip(ch.to));
      console.log(
        'LIB',
        l,
        c,
        JSON.stringify(changes.map((ch) => [ch.index, strip(ch.from), strip(ch.to)])),
      );
      const built = boardModel(D().design).base;
      expect(changes.map((ch) => strip(built[ch.index]))).toEqual(tos);
    });
  }
});

describe('the comparison follows the part library', () => {
  it('removing the part Realize chose changes the designed curve', async () => {
    await act(async () => {
      await usePartLibrary.getState().addParts(syntheticLibraryParts());
    });
    act(() => D().setRealize({ enabled: true, series: 'library' }));
    compare('board.s1p', SAMPLE);
    const before = boardComparison(D().design);
    const modelBefore = JSON.stringify(boardModel(D().design).base.map(strip));
    // Remove the 10 nH the shunt L was realized with.
    const key = usePartLibrary.getState().parts.find((p) => p.part.partNumber === 'SYNTH-L0402-10N')
      ?.key as string;
    await act(async () => {
      await usePartLibrary.getState().remove(key);
    });
    const modelAfter = JSON.stringify(boardModel(D().design).base.map(strip));
    expect(modelAfter).not.toBe(modelBefore);
    const after = boardComparison(D().design);
    expect(after?.points[0]?.designed).not.toEqual(before?.points[0]?.designed);
  });
});

describe('Realize off with the part library chosen', () => {
  it('Apply puts in the library part the retune evaluated', async () => {
    await act(async () => {
      await usePartLibrary.getState().addParts(syntheticLibraryParts());
    });
    act(() =>
      D().step('vals', (d) => ({
        ...d,
        realize: { ...d.realize, enabled: false, series: 'library' },
        elements: d.elements.map((el, i) =>
          i === 0 ? ({ ...el, value: 22e-9 } as typeof el) : ({ ...el, value: 1e-12 } as typeof el),
        ),
      })),
    );
    compare('board.s1p', SAMPLE);
    act(() => {
      runRetune();
    });
    const r = currentRetune(D().design);
    const changes = r?.suggestion?.changes ?? [];
    expect(changes.length).toBeGreaterThan(0);
    const msg = D().message;
    act(() => applyRetune());
    const built = boardModel(D().design).base;
    console.log(
      'OFFLIB',
      msg,
      '|',
      D().message,
      JSON.stringify(changes.map((c) => [strip(c.from), strip(c.to), strip(built[c.index])])),
    );
    const band = boardBand(D().design);
    const now = suggestRetune(
      boardModel(D().design),
      {},
      { band, limit: 1.38, candidates: () => [] },
    ).before;
    console.log(
      'OFFLIB vswr promised',
      r?.suggestion?.worst.vswr,
      'after apply',
      now.vswr,
      'at',
      now.frequency,
    );
    // What was evaluated (and promised as the expected VSWR) is what the design now holds.
    expect(changes.map((c) => strip(built[c.index]))).toEqual(changes.map((c) => strip(c.to)));
  });
});
