// @vitest-environment jsdom
/**
 * D6 QA round 1 fixes in the app: the .json file keeps the measurement, the checks of a fit
 * reach Build, the Response view and the status line, a retune is refused where the data does
 * not support it, the sample design meets its target as built, the workflow from the user's own
 * design, a two-port Compare in one step of Undo, the ticks and Apply notes, the import dialog's
 * words and the chart's legend and marks.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  useBoardFit,
} from '../src/lib/boardFit';
import { readImportFile } from '../src/lib/import';
import { boardComparison, designModel } from '../src/lib/measuredBoard';
import { retunedWorst } from '@smithonline/core';
import { noteBomExported, useNextStep } from '../src/lib/nextSteps';
import { designFromJsonFile, LONG_LINK, shareMeasurementNote } from '../src/lib/share';
import { buildableStart, measureStart, WORKFLOWS } from '../src/lib/workflows';
import { doItLabel } from '../src/lib/workflowKit';
import { useDesignStore } from '../src/store/useDesignStore';
import { useShell } from '../src/store/useShell';
import { useTourStore } from '../src/store/useTourStore';
import { MeasuredBoardPanel } from '../src/response/MeasuredBoardPanel';

const D = () => useDesignStore.getState();
const FIX = (n: string): string =>
  readFileSync(resolve(__dirname, '../../core/test/fixtures/sparams', n), 'utf8');
const SAMPLE = FIX('board-1g-synthetic.s1p');

const settle = (ms = 30): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

const blobs: Blob[] = [];
beforeEach(() => {
  localStorage.clear();
  blobs.length = 0;
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
  vi.stubGlobal('innerWidth', 1440);
  vi.stubGlobal('innerHeight', 900);
  URL.createObjectURL = (b: Blob | MediaSource) => {
    blobs.push(b as Blob);
    return 'blob:d6';
  };
  URL.revokeObjectURL = () => undefined;
  HTMLAnchorElement.prototype.click = () => undefined;
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

function compare(name: string, text: string): boolean {
  const file = readImportFile(name, text);
  let ok = false;
  act(() => {
    ok = compareWithDesign(file);
  });
  return ok;
}

/** A one-port file of n rows, Gamma slowly moving, Z0 50. */
function rows(n: number): string {
  const lines = ['# HZ S RI R 50'];
  for (let i = 0; i < n; i++) {
    const f = 7e8 + i * (6e8 / Math.max(1, n - 1));
    lines.push(`${f} ${(0.1 + 0.0001 * i).toFixed(6)} ${(-0.2 + 0.00003 * i).toFixed(6)}`);
  }
  return lines.join('\n');
}

/** The sample with the reference plane 5 mm of FR-4 microstrip away from the board. */
function samplePlane5mm(): string {
  const tau = 5e-3 / (299792458 / Math.sqrt(3.3));
  return SAMPLE.split('\n')
    .map((line) => {
      const p = line.trim().split(/\s+/);
      if (line.startsWith('!') || line.startsWith('#') || p.length !== 3) return line;
      const f = Number(p[0]) * 1e9;
      const re = Number(p[1]);
      const im = Number(p[2]);
      const phi = -4 * Math.PI * f * tau;
      const c = Math.cos(phi);
      const s = Math.sin(phi);
      return `${p[0]} ${(re * c - im * s).toFixed(6)} ${(re * s + im * c).toFixed(6)}`;
    })
    .join('\n');
}

describe('the .json file keeps the measurement (blocker)', () => {
  it('File, Save as SmithChart.Online keeps a 2001-point measurement at full precision', async () => {
    expect(compare('big.s1p', rows(2001))).toBe(true);
    const m = D().design.measurement;
    expect(m?.points).toHaveLength(2001);
    const { App } = await import('../src/App');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /^File/ }));
    fireEvent.click(
      screen.getByRole('menuitem', { name: /^Save as SmithChart.Online \(\.json\)/ }),
    );
    const text = await (blobs[blobs.length - 1] as Blob).text();
    const back = designFromJsonFile(text);
    expect('value' in back).toBe(true);
    if (!('value' in back)) return;
    expect(back.value.measurement).toEqual(m);
  });

  it('a 201-point measurement rides in a link, and the link says it is long', () => {
    compare('a.s1p', rows(201));
    expect(shareMeasurementNote(D().design, LONG_LINK + 1)).toMatch(
      /long: some mail and chat tools cut long links, a \.json file is safer/,
    );
    expect(shareMeasurementNote(D().design, 1000)).toBeNull();
  });
});

describe('the sample design meets its target as built', () => {
  it('designed 1.298 inside 1.38, the sample measured 1.550 outside: the drift alone breaks it', () => {
    compare('board-1g-synthetic.s1p', SAMPLE);
    const c = boardComparison(D().design);
    expect(c?.designedWorst?.vswr).toBeLessThan(1.38);
    expect(c?.measuredWorst?.vswr).toBeGreaterThan(1.38);
    render(<MeasuredBoardSection />);
    expect(document.body.textContent).not.toMatch(/misses the target/);
  });

  it('a design that misses its target as built is flagged in Build and the retune says so', async () => {
    const d = {
      ...measureStart(),
      elements: buildableStart().elements.map((el) => ({ ...el, package: '0402' as const })),
    };
    act(() => D().loadDesign(d, 'twelve'));
    compare('board-1g-synthetic.s1p', SAMPLE);
    expect(retunedWorst(designModel(D().design), {}, new Map(), [1.1e9]).vswr).toBeGreaterThan(
      1.38,
    );
    render(<MeasuredBoardSection />);
    expect(document.querySelector('.measured-compare')?.textContent).toMatch(
      /misses the target before any drift/,
    );
    act(() => {
      runRetune();
    });
    expect(D().message).toMatch(/misses the target already/);
  });
});

describe('the checks of a fit reach the user', () => {
  it('the sample: the residual is at the noise floor, the retune is offered', async () => {
    compare('board-1g-synthetic.s1p', SAMPLE);
    render(<MeasuredBoardSection />);
    act(() => runBoardFit());
    await settle();
    expect(document.querySelector('[data-verdict]')?.getAttribute('data-verdict')).toBe('ok');
    act(() => {
      runRetune();
    });
    expect(currentRetune(D().design)?.suggestion?.changes).toHaveLength(1);
  });

  it('a 5 mm reference-plane offset: not explained, named causes, the retune refused', async () => {
    compare('plane.s1p', samplePlane5mm());
    render(
      <>
        <MeasuredBoardSection />
        <MeasuredBoardPanel logX={false} />
      </>,
    );
    act(() => runBoardFit());
    await settle();
    const fit = currentFit(D().design);
    expect(fit?.ok && fit.fit.check.trusted).toBe(false);
    // QA round 2: the silent fit with the plane finds it; the status names it first.
    expect(D().message).toMatch(/reference-plane offset of about \+3\d(\.\d)? ps/);
    const verdict = document.querySelector('[data-verdict]');
    expect(verdict?.getAttribute('data-verdict')).toBe('untrusted');
    expect(verdict?.textContent).toMatch(/Reference plane/);
    expect(
      document.querySelector('[data-tour="response.measured"] .warn-text')?.textContent,
      // Fix round 3: the pads are linear in the model, the fit absorbs more of the plane: a
      // pattern above the noise (4.4 floors) rather than unexplained.
    ).toMatch(/reference-plane offset.*(does not explain this board|leaves a pattern)/);
    act(() => {
      runRetune();
    });
    expect(currentRetune(D().design)?.refused).toMatch(/cannot be acted on/);
    expect(D().message).toMatch(/^Retune refused/);
    expect(screen.queryByRole('button', { name: 'Apply retune' })).toBeNull();
  });

  it('ticking Reference plane fits the offset back to noise', async () => {
    compare('plane.s1p', samplePlane5mm());
    const defaults = ['value:0', 'value:1', 'pad:0', 'pad:1', 'via'];
    act(() => setFitFree('plane', true, defaults));
    act(() => runBoardFit());
    await settle();
    const fit = currentFit(D().design);
    expect(fit?.ok && fit.fit.check.residual).toBe('noise');
  });

  it('a wrong design (450 MHz, other parts): frequency outside, retune refused for the band', async () => {
    act(() =>
      D().step('wrong', (d) => ({
        ...d,
        frequency: 450e6,
        sweep: { ...d.sweep, start: 400e6, stop: 500e6 },
        elements: d.elements.map((el, i) =>
          i === 0 ? { ...el, value: 22e-9 } : { ...el, value: 10e-12 },
        ) as typeof d.elements,
      })),
    );
    compare('board-1g-synthetic.s1p', SAMPLE);
    expect(D().message).toMatch(/design frequency \(450 MHz\) lies outside the measurement/);
    act(() => runBoardFit());
    await settle();
    const fit = currentFit(D().design);
    expect(fit?.ok && fit.fit.check.frequencyOutside).toBe(true);
    act(() => {
      runRetune();
    });
    expect(currentRetune(D().design)?.refused).toBeTruthy();
  });

  it('a target band only partly measured gets no retune: the unmeasured part could get worse', () => {
    act(() => D().setSweep({ start: 1.2e9, stop: 1.4e9 }));
    compare('board-1g-synthetic.s1p', SAMPLE);
    act(() => {
      runRetune();
    });
    const r = currentRetune(D().design);
    expect(r?.suggestion ?? null).toBeNull();
    expect(r?.refused).toMatch(/part of the target band .* lies outside the measurement/);
    expect(r?.refused).toMatch(/measure the board over the whole band/);
    expect(Math.max(...(r?.judged ?? [0]))).toBeLessThanOrEqual(1.3e9);
    expect(r?.bandOutside).toBeGreaterThan(0);
  });
});

describe('notes in Build', () => {
  it('changing the ticks after a fit says the table is of the earlier choice', async () => {
    compare('board-1g-synthetic.s1p', SAMPLE);
    render(<MeasuredBoardSection />);
    act(() => runBoardFit());
    await settle();
    expect(document.body.textContent).not.toMatch(/parameters to fit changed/);
    act(() => setFitFree('via', false, ['value:0', 'value:1', 'pad:0', 'pad:1', 'via']));
    expect(document.body.textContent).toMatch(/parameters to fit changed since this fit/);
  });

  it('unticked parameters are listed as not fitted (unticked)', async () => {
    compare('board-1g-synthetic.s1p', SAMPLE);
    render(<MeasuredBoardSection />);
    act(() => runBoardFit());
    await settle();
    const table = document.querySelector('[data-tour="build.drift"]')?.textContent ?? '';
    expect(table).toMatch(/Board εr.*not fitted \(unticked\)/);
    expect(table).toMatch(/not significant/);
    expect(document.body.textContent).toMatch(/typical drift ±10 %/);
    expect(document.body.textContent).not.toMatch(/All pads \(all/);
  });
});

describe('Compare', () => {
  it('a two-port Compare is one step of Undo back to the design before the file', () => {
    const before = D().design;
    const file = readImportFile('amp-synthetic.s2p', FIX('amp-synthetic.s2p'));
    act(() => D().importTwoPort((file as unknown as { data: never }).data, file.fileName));
    act(() => {
      compareWithDesign(file);
    });
    expect(D().design.measurement?.termination).toBe(50);
    act(() => D().undo());
    expect(D().design).toBe(before);
  });

  it('a repeated frequency and an open row: Compare keeps what a saved file gives back', () => {
    compare(
      'dup.s1p',
      ['# HZ S MA R 50', '0.9e9 1 0', '1e9 0.5 10', '1e9 0.4 10', '1.1e9 0.5 20'].join('\n'),
    );
    const m = D().design.measurement;
    expect(m?.points).toHaveLength(3);
    expect(D().message).toMatch(/1 row repeats a frequency: the last row at each is kept/);
  });

  it('the import dialog explains Compare and says why one row cannot be compared', () => {
    const file = readImportFile('one.s1p', ['# HZ S RI R 50', '1e9 0.1 0.1'].join('\n'));
    render(<ImportDialog file={file} onClose={() => undefined} />);
    expect(document.body.textContent).toMatch(/the board you built, measured/);
    const b = screen.getByRole('button', { name: 'Compare with the design' });
    expect(b).toHaveProperty('disabled', true);
    expect(b.getAttribute('title')).toMatch(/one usable row; Compare needs two at least/);
  });
});

describe('the workflow from the user own design', () => {
  it('the BOM step keeps the design; its open step offers File, Open and the sample only by name', () => {
    const own = { ...buildableStart(), realize: { ...buildableStart().realize, enabled: true } };
    D().init(own, { fresh: true });
    act(() => noteBomExported());
    act(() => useNextStep.getState().suggestion?.run());
    expect(useTourStore.getState().tour?.id).toBe('measure-retune');
    expect(D().design.elements).toEqual(own.elements);
    const wf = WORKFLOWS.find((w) => w.id === 'measure-retune');
    const open = wf?.steps.find((s) => s.id === 'open');
    if (!open) throw new Error('no open step');
    expect(doItLabel(open, D().design)).toBe('Use the sample board instead (replaces your design)');
    expect(doItLabel(open, measureStart())).toBe('Open the sample measurement');
    useTourStore.getState().close();
  });
});

describe('the chart', () => {
  it('names measured, designed and fitted in the legend and marks start, stop and f', async () => {
    compare('board-1g-synthetic.s1p', SAMPLE);
    act(() => runBoardFit());
    await settle();
    act(() => D().setView('chart'));
    const { App } = await import('../src/App');
    render(<App />);
    const legend = document.querySelector('.chart-legend')?.textContent ?? '';
    expect(legend).toMatch(/Measured board/);
    expect(legend).toMatch(/Designed/);
    expect(legend).toMatch(/Fitted/);
    const marks = [...document.querySelectorAll('.measured-board .board-mark-text')].map(
      (t) => t.textContent,
    );
    expect(marks).toEqual(['start', 'stop', 'f']);
    expect(document.querySelector('.measured-board .board-fitted')).not.toBeNull();
    // QA round 2: |S11| in dB and Zin in ohm, as a readout on hover and tap, not only a title.
    const hit = document.querySelector('.measured-board .board-hit');
    expect(hit?.querySelector('title')?.textContent).toMatch(
      /^Measured 700 MHz: \|S11\| .* dB, VSWR .*, Zin .* Ω$/,
    );
    if (hit) fireEvent.pointerEnter(hit, { pointerType: 'mouse' });
    expect(document.querySelector('.measured-board .board-readout')?.textContent).toMatch(
      /^Measured 700 MHz: \|S11\| /,
    );
  });
});

void useBoardFit;
