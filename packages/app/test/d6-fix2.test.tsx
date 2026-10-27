// @vitest-environment jsdom
/**
 * D6 QA round 2 fixes in the app: the reference plane as the bench's (named when unticked, never
 * advised when ticked), the floor the residual is held against (the VNA class), the build source
 * kept with the measurement, a retune never worse than the board and its refusal reasons, the
 * wrong-design wording, the workflow that follows its design, and Compare leading in the import
 * dialog within the workflow.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, render, screen } from '@testing-library/react';
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

import { ImportDialog } from '../src/components/ImportDialog';
import { MeasuredBoardSection } from '../src/components/MeasuredBoardSection';
import {
  compareWithDesign,
  currentFit,
  currentRetune,
  resetBoardFit,
  runBoardFit,
  runRetune,
  setFitFree,
  setVnaClass,
} from '../src/lib/boardFit';
import { readImportFile } from '../src/lib/import';
import {
  boardComparison,
  boardKey,
  fitVerdict,
  retuneFor,
  worstVswrText,
} from '../src/lib/measuredBoard';
import { memoryPartStore } from '../src/lib/partStore';
import { designFileText, designFromJsonFile } from '../src/lib/share';
import { measureStart } from '../src/lib/workflows';
import { useDesignStore } from '../src/store/useDesignStore';
import { useShell } from '../src/store/useShell';
import { useTourStore } from '../src/store/useTourStore';
import { syntheticLibraryParts, usePartLibrary } from '../src/store/usePartLibrary';

const D = () => useDesignStore.getState();
const SAMPLE = readFileSync(
  resolve(__dirname, '../../core/test/fixtures/sparams/board-1g-synthetic.s1p'),
  'utf8',
);
const settle = (ms = 30): Promise<void> =>
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
  Element.prototype.scrollIntoView = vi.fn();
  useShell.setState({ guideClosed: true, guideShown: false, settings: null, tool: null });
  useTourStore.getState().close();
  resetBoardFit();
  D().init(measureStart());
  D().setView('chart');
  D().setMessage(null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function compare(name: string, text: string): void {
  act(() => {
    compareWithDesign(readImportFile(name, text));
  });
}

/** The sample with the reference plane 5 mm of FR-4 microstrip (30.3 ps) away from the board. */
const TAU = 5e-3 / (299792458 / Math.sqrt(3.3));
function samplePlane5mm(): string {
  return SAMPLE.split('\n')
    .map((line) => {
      const p = line.trim().split(/\s+/);
      if (line.startsWith('!') || line.startsWith('#') || p.length !== 3) return line;
      const f = Number(p[0]) * 1e9;
      const phi = -4 * Math.PI * f * TAU;
      const re = Number(p[1]);
      const im = Number(p[2]);
      return `${p[0]} ${(re * Math.cos(phi) - im * Math.sin(phi)).toFixed(6)} ${(re * Math.sin(phi) + im * Math.cos(phi)).toFixed(6)}`;
    })
    .join('\n');
}
const DEFAULTS = ['value:0', 'value:1', 'pad:0', 'pad:1', 'via'];

async function fit(): Promise<void> {
  act(() => runBoardFit());
  await settle();
}

describe('the reference plane is the bench', () => {
  it('unticked: the plane is named with its size, the advice is to tick it, the retune refused with that reason', async () => {
    compare('plane.s1p', samplePlane5mm());
    await fit();
    const out = currentFit(D().design);
    if (!out?.ok) throw new Error('no fit');
    const plane = out.fit.check.plane;
    expect(plane?.better).toBe(true);
    expect(Math.abs((plane?.drift ?? 0) - TAU)).toBeLessThan(1.5e-12);
    const v = fitVerdict(D().design, out.fit);
    expect(v.level).toBe('untrusted');
    expect(v.text).toMatch(/reference-plane offset of about \+3\d(\.\d)? ps/);
    expect(v.text).toMatch(/Tick Reference plane and fit again/);
    act(() => {
      runRetune();
    });
    expect(currentRetune(D().design)?.refused).toMatch(/reference-plane offset/);
  });

  it('ticked: fitted to the noise, trusted, never told to tick it, the retune runs', async () => {
    compare('plane.s1p', samplePlane5mm());
    act(() => setFitFree('plane', true, DEFAULTS));
    await fit();
    const out = currentFit(D().design);
    if (!out?.ok) throw new Error('no fit');
    const p = out.fit.parameters.find((q) => q.id === 'plane');
    expect(Math.abs((p?.drift ?? 0) - TAU)).toBeLessThan(1.5e-12);
    const v = fitVerdict(D().design, out.fit);
    expect(v.level).toBe('ok');
    expect(v.text).not.toMatch(/tick Reference plane/i);
    act(() => {
      runRetune();
    });
    const r = currentRetune(D().design);
    expect(r?.refused).toBeUndefined();
    expect(r?.suggestion?.inside).toBe(true);
  });
});

describe('the floor the residual is held against', () => {
  it('names the lab VNA accuracy floor and the scatter below it', async () => {
    compare('board.s1p', SAMPLE);
    await fit();
    const out = currentFit(D().design);
    if (!out?.ok) throw new Error('no fit');
    expect(fitVerdict(D().design, out.fit).text).toMatch(
      /lab VNA accuracy floor 0\.002 \(the scatter between points, 0\.001\d*, is below it\)/,
    );
  });

  it('a NanoVNA file is held to the hobby floor; the class is a step of Undo, kept in the .json file', () => {
    compare('nanovna-board.s1p', SAMPLE);
    expect(D().design.measurement?.vna).toBe('hobby');
    const before = boardKey(D().design);
    act(() => setVnaClass('lab'));
    expect(D().design.measurement?.vna).toBe('lab');
    expect(boardKey(D().design)).not.toBe(before);
    act(() => setVnaClass('hobby'));
    const back = designFromJsonFile(designFileText(D().design));
    expect('value' in back && back.value.measurement?.vna).toBe('hobby');
  });
});

describe('the board the measurement was taken on', () => {
  it('records the build source; after a change of source the verdict says so instead of blaming the plane', async () => {
    compare('board.s1p', SAMPLE);
    const then = D().design.measurement?.source;
    expect(then).toBeTruthy();
    act(() =>
      D().step('E96', (d) => ({ ...d, realize: { ...d.realize, enabled: true, series: 'E96' } })),
    );
    await fit();
    const out = currentFit(D().design);
    if (!out?.ok) throw new Error('no fit');
    const v = fitVerdict(D().design, out.fit);
    if (then !== 'E96 values') {
      expect(v.level).toBe('untrusted');
      expect(v.text).toMatch(
        new RegExp(`taken on a board built from ${then}; the design now uses E96 values`),
      );
      expect(v.text).not.toMatch(/tick Reference plane/i);
    }
  });
});

describe('a wrong design', () => {
  it('one band frequency reads "at 450 MHz"; the retune refusal names the frequency and the span', async () => {
    act(() =>
      D().step('wrong', (d) => ({
        ...d,
        frequency: 450e6,
        sweep: { ...d.sweep, enabled: false },
        elements: d.elements.map((el, i) =>
          i === 0 ? { ...el, value: 22e-9 } : { ...el, value: 10e-12 },
        ) as typeof d.elements,
      })),
    );
    compare('board.s1p', SAMPLE);
    const c = boardComparison(D().design);
    if (!c) throw new Error('no comparison');
    const text = worstVswrText(D().design, c) ?? '';
    expect(text).not.toMatch(/from 450 MHz to 450 MHz/);
    expect(text).not.toMatch(/measured not measured/);
    await fit();
    const r = retuneFor(D().design, {});
    expect(r.refused).toMatch(/450 MHz/);
    expect(r.refused).toMatch(/700 MHz to 1\.3 GHz/);
  });
});

describe('a retune is never worse than the board as it is', () => {
  it('from the part library, at every start: no suggestion worse than before, no Apply then', async () => {
    usePartLibrary.setState({ parts: [], open: false });
    await usePartLibrary.getState().init(memoryPartStore());
    await usePartLibrary.getState().addParts(syntheticLibraryParts());
    const drifts = [{ 'value:0': -0.12, 'value:1': 0.1, via: 0.4 }, { 'value:0': 0.08 }];
    for (const [l, c] of [
      [10e-9, 2.7e-12],
      [15e-9, 1.8e-12],
      [6.8e-9, 3.3e-12],
    ] as const) {
      D().init(measureStart());
      act(() =>
        D().step('lib', (d) => ({
          ...d,
          realize: { ...d.realize, enabled: true, series: 'library' },
          elements: d.elements.map((el, i) => ({
            ...el,
            value: i === 0 ? l : c,
          })) as typeof d.elements,
        })),
      );
      compare('board.s1p', SAMPLE);
      for (const d of drifts) {
        const r = retuneFor(D().design, d);
        const s = r.suggestion;
        if (s && s.changes.length > 0) expect(s.worst.vswr).toBeLessThan(r.before.vswr);
        if (!s && !r.refused) expect(r.noImprovement).toBe(true);
      }
    }
  });
});

describe('the workflow follows its design', () => {
  it('a step about a fit moves back when another design comes on show, with a note', async () => {
    compare('board.s1p', SAMPLE);
    await fit();
    act(() => useTourStore.getState().startWorkflow('measure-retune', { keep: true, at: 'drift' }));
    expect(useTourStore.getState().step).toBe(4);
    act(() => D().loadDesign(measureStart(), 'Opened another design'));
    await settle();
    expect(useTourStore.getState().tour?.id).toBe('measure-retune');
    expect(useTourStore.getState().step).toBe(0);
    expect(D().message).toMatch(
      /Workflow back at "Open the measured board": the design on show has no measured board/,
    );
  });
});

describe('the import dialog within the measure and retune workflow', () => {
  it('Compare with the design is the primary button', () => {
    act(() => useTourStore.getState().startWorkflow('measure-retune', { keep: true }));
    render(<ImportDialog file={readImportFile('board.s1p', SAMPLE)} onClose={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Compare with the design' }).className).toMatch(
      /primary/,
    );
    expect(
      screen.getByRole('button', { name: /^Use all \d+ rows as the load$/ }).className,
    ).not.toMatch(/primary/);
  });
});

describe('the Build section', () => {
  it('offers the VNA class and keeps a drift with its unit', async () => {
    compare('board.s1p', SAMPLE);
    render(<MeasuredBoardSection />);
    await fit();
    expect(screen.getByRole('combobox', { name: /VNA class/ })).toBeTruthy();
    const cells = [...document.querySelectorAll('.measured-drift .nowrap')].map(
      (e) => e.textContent,
    );
    expect(cells.some((t) => /^\+8\.\d+ %$/.test(t ?? ''))).toBe(true);
  });
});
