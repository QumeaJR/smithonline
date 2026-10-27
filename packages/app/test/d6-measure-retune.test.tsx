// @vitest-environment jsdom
/**
 * D6 in the app: Compare with the design from the import dialog, the overlay in the Response
 * view and on the chart, Fit what moved (in this thread here: jsdom has no Web Worker), the
 * drift table, Suggest retune and Apply as one step of Undo, the next step after a BOM export,
 * and the measurement saved with the design: files keep it, links up to 201 points, every
 * reader checks it and never refuses a design for it.
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
  applyRetune,
  clearMeasurement,
  compareWithDesign,
  currentFit,
  resetBoardFit,
  runBoardFit,
  runRetune,
  useBoardFit,
} from '../src/lib/boardFit';
import { emptyDesign, type Design } from '../src/lib/design';
import { readImportFile } from '../src/lib/import';
import {
  boardComparison,
  boardModel,
  LINK_BOARD_POINTS,
  type MeasuredBoard,
} from '../src/lib/measuredBoard';
import { DEFAULT_BOARD, DEFAULT_PACKAGES } from '@smithonline/core';
import { noteBomExported, useNextStep } from '../src/lib/nextSteps';
import {
  decodeDesign,
  designFileText,
  designFromJsonFile,
  encodeDesign,
  measurementPatch,
  readAutosaveObject,
  shareMeasurementNote,
} from '../src/lib/share';
import { measureStart } from '../src/lib/workflows';
import { useDesignStore } from '../src/store/useDesignStore';
import { useTourStore } from '../src/store/useTourStore';
import { MeasuredBoardPanel } from '../src/response/MeasuredBoardPanel';

const D = () => useDesignStore.getState();
const SAMPLE = readFileSync(
  resolve(__dirname, '../../core/test/fixtures/sparams/board-1g-synthetic.s1p'),
  'utf8',
);
const AMP = readFileSync(
  resolve(__dirname, '../../core/test/fixtures/sparams/amp-synthetic.s2p'),
  'utf8',
);

/** Wait for the in-thread fit (a setTimeout of 0) to finish. */
const settle = (): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });

function stubs(): void {
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
}

beforeEach(() => {
  localStorage.clear();
  stubs();
  useTourStore.getState().close();
  resetBoardFit();
  D().init(measureStart());
  D().setView('chart');
  D().setMessage(null);
});
afterEach(() => cleanup());

function compareSample(): void {
  const file = readImportFile('board-1g-synthetic.s1p', SAMPLE);
  act(() => {
    compareWithDesign(file);
  });
}

describe('the sample belongs to the workflow board', () => {
  it('the board the fit sees is the one scripts/synth-board.mjs measured', () => {
    const m = boardModel(measureStart());
    expect(m.z0).toBe(50);
    expect(m.frequency).toBe(1e9);
    expect(m.load).toEqual({ re: 100, im: -50 });
    expect(m.board).toEqual({ ...DEFAULT_BOARD, enabled: true });
    expect(m.table).toEqual(DEFAULT_PACKAGES);
    const plain = m.base.map((el) => {
      const { id: _id, color: _color, ...rest } = el as typeof el & { id?: string; color?: string };
      void _id;
      void _color;
      return rest;
    });
    expect(plain).toEqual([
      { kind: 'L', orientation: 'shunt', value: 10e-9, package: '0402' },
      { kind: 'C', orientation: 'series', value: 2.7e-12, package: '0402' },
    ]);
  });
});

describe('Compare with the design', () => {
  it('the import dialog offers it apart from "use as the load", and it keeps the load', () => {
    const file = readImportFile('board-1g-synthetic.s1p', SAMPLE);
    const onClose = vi.fn();
    render(<ImportDialog file={file} onClose={onClose} />);
    const load = D().design.load;
    fireEvent.click(screen.getByRole('button', { name: 'Compare with the design' }));
    const d = D().design;
    expect(d.measurement?.name).toBe('board-1g-synthetic.s1p');
    expect(d.measurement?.points).toHaveLength(121);
    expect(d.measurement?.termination).toBeUndefined();
    expect(d.load).toEqual(load);
    expect(d.sweep.loads).toBeUndefined();
    expect(D().view).toBe('response');
    // The design as built meets the target (1.298 against 1.38); the board drifted out (1.550).
    expect(D().message).toMatch(/\|ΔΓ\| worst 0\.155.*measured 1\.550, designed 1\.298/);
  });

  it('is disabled without a network', () => {
    D().init(emptyDesign());
    const file = readImportFile('board-1g-synthetic.s1p', SAMPLE);
    render(<ImportDialog file={file} onClose={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Compare with the design' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('is one step of Undo, and Stop comparing another', () => {
    compareSample();
    expect(D().design.measurement).toBeDefined();
    act(() => D().undo());
    expect(D().design.measurement).toBeUndefined();
    act(() => D().redo());
    expect(D().design.measurement).toBeDefined();
    act(() => clearMeasurement());
    expect(D().design.measurement).toBeUndefined();
  });

  it('takes a two-port file as measured with port 2 on the reference, and puts the device panel back', () => {
    const before = D().design.twoPort;
    const file = readImportFile('amp-synthetic.s2p', AMP);
    // The import path fills the device panel from a two-port file first.
    act(() => D().importTwoPort((file as unknown as { data: never }).data, file.fileName));
    expect(D().design.twoPort).not.toBe(before);
    act(() => {
      compareWithDesign(file);
    });
    expect(D().design.measurement?.termination).toBe(50);
    expect(D().design.twoPort).toEqual(before);
  });

  it('reads |ΔΓ| per frequency and the worst VSWR, measured against designed', () => {
    compareSample();
    const c = boardComparison(D().design);
    expect(c?.points).toHaveLength(121);
    expect(c?.worstDelta).toBeGreaterThan(0.14);
    expect(c?.measuredWorst?.vswr).toBeCloseTo(1.55, 2);
    expect(c?.designedWorst?.vswr).toBeCloseTo(1.298, 3);
  });
});

describe('the overlay', () => {
  it('the Response view panel shows measured and designed with |ΔΓ|', () => {
    compareSample();
    render(<MeasuredBoardPanel logX={false} />);
    const panel = document.querySelector('[data-tour="response.measured"]') as HTMLElement;
    expect(panel.textContent).toMatch(/measured/);
    expect(panel.textContent).toMatch(/designed/);
    expect(panel.textContent).toMatch(/\|ΔΓ\| worst 0\.1/);
    expect(panel.textContent).toMatch(/target 1\.38/);
  });

  it('the chart draws the measured board and the legend names it', async () => {
    compareSample();
    act(() => D().setView('chart'));
    const { App } = await import('../src/App');
    render(<App />);
    expect(document.querySelector('.measured-board .board-measured')).not.toBeNull();
    expect(document.querySelector('.measured-board .board-designed')).not.toBeNull();
    expect(screen.getAllByText('Measured board').length).toBeGreaterThan(0);
  });
});

describe('fit, drift table, retune', () => {
  it('fits what moved and names what the data cannot tell apart', async () => {
    compareSample();
    render(<MeasuredBoardSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Fit what moved' }));
    expect(useBoardFit.getState().running).toBe(true);
    await settle();
    const out = currentFit(D().design);
    expect(out?.ok).toBe(true);
    if (!out?.ok) return;
    const l = out.fit.parameters.find((p) => p.id === 'value:0');
    expect(l?.status).toBe('fitted');
    expect(Math.abs((l?.drift ?? 0) - 0.08)).toBeLessThan(3 * (l?.sigma ?? 0));
    const table = document.querySelector('[data-tour="build.drift"]') as HTMLElement;
    expect(table.textContent).toMatch(/Shunt L 1 value/);
    // Two figures of its uncertainty (0.040 %): three decimals.
    expect(table.textContent).toMatch(/\+8\.018 %/);
    expect(table.textContent).toMatch(/Series C 2 pads/);
    expect(table.textContent).toMatch(/Vias.*not resolved: acts like Shunt L 1 value/);
  });

  it('Stop ends a running fit and says so', async () => {
    compareSample();
    act(() => runBoardFit());
    expect(useBoardFit.getState().running).toBe(true);
    render(<MeasuredBoardSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await settle();
    expect(useBoardFit.getState().running).toBe(false);
    expect(D().message).toBe('Fit stopped');
  });

  it('refuses more unknowns than the data supports, in words', async () => {
    const few: MeasuredBoard = {
      name: 'three.s1p',
      points: [0.9e9, 1e9, 1.1e9].map((f) => ({ frequency: f, z: { re: 60, im: 10 } })),
    };
    act(() => D().step('three', (d) => ({ ...d, measurement: few })));
    act(() => runBoardFit());
    await settle();
    const out = currentFit(D().design);
    expect(out?.ok).toBe(false);
    if (out && !out.ok) expect(out.reason).toMatch(/more than the data supports/);
  });

  it('a fit goes stale when the design changes', async () => {
    compareSample();
    act(() => runBoardFit());
    await settle();
    expect(currentFit(D().design)).not.toBeNull();
    act(() => D().setFrequency(1.01e9));
    expect(currentFit(D().design)).toBeNull();
  });

  it('suggests an E24 retune inside the target and applies it as one step of Undo', async () => {
    compareSample();
    act(() => runBoardFit());
    await settle();
    let r: ReturnType<typeof runRetune> = null;
    act(() => {
      r = runRetune();
    });
    const s = (r as ReturnType<typeof runRetune>)?.suggestion;
    expect(s?.inside).toBe(true);
    expect(s?.changes).toHaveLength(1);
    expect(s?.changes[0]?.index).toBe(0);
    const before = D().design.elements[0];
    act(() => applyRetune());
    const after = D().design.elements[0] as { value: number; package: string };
    expect(after.value).toBeCloseTo(9.1e-9, 20);
    expect(after.package).toBe('0402');
    // QA round 2: the status after Apply gives what the reworked board should measure.
    expect(D().message).toMatch(
      /^Retuned Shunt L 1 to 9\.1 nH: the reworked board should measure a worst VSWR of about 1\.36/,
    );
    act(() => D().undo());
    expect(D().design.elements[0]).toEqual(before);
  });

  it('the Build section shows the suggestion, the first part to change and Apply', async () => {
    compareSample();
    act(() => runBoardFit());
    await settle();
    act(() => {
      runRetune();
    });
    render(<MeasuredBoardSection />);
    const box = document.querySelector('[data-tour="build.retune.result"]') as HTMLElement;
    if (!box) throw new Error(document.body.textContent ?? '');
    expect(box.textContent).toMatch(/Shunt L 1: 10 nH to 9\.1 nH/);
    expect(box.textContent).toMatch(/inside the target of 1\.38/);
    expect(box.textContent).toMatch(/One change is enough: change Shunt L 1/);
    fireEvent.click(screen.getByRole('button', { name: 'Apply retune' }));
    expect((D().design.elements[0] as { value: number }).value).toBeCloseTo(9.1e-9, 20);
    const notes = screen.getAllByRole('note').map((n) => n.textContent ?? '');
    // After Apply: the measurement is of the board before it, and what the rework should measure.
    expect(notes.some((t) => /The measurement is of the board before it/.test(t))).toBe(true);
    expect(
      notes.some((t) => /should measure a worst VSWR of about 1\.362 at 1\.1 GHz/.test(t)),
    ).toBe(true);
    expect(document.body.textContent).not.toMatch(/fit again to see what moved/);
  });
});

describe('the next step after a BOM export', () => {
  it('offers "When it is built: compare" with Realize on, and starts the D6 workflow', () => {
    D().init(measureStart(), { fresh: true });
    act(() => noteBomExported());
    const s = useNextStep.getState().suggestion;
    expect(s?.label).toBe('When it is built: compare');
    act(() => s?.run());
    expect(useTourStore.getState().tour?.id).toBe('measure-retune');
    useTourStore.getState().close();
  });

  it('is not offered with Realize off', () => {
    D().init(
      { ...measureStart(), realize: { ...measureStart().realize, enabled: false } },
      { fresh: true },
    );
    act(() => noteBomExported());
    expect(useNextStep.getState().suggestion).toBeNull();
  });
});

describe('saved with the design', () => {
  const withMeasurement = (n: number): Design => ({
    ...measureStart(),
    measurement: {
      name: 'board.s1p',
      points: Array.from({ length: n }, (_, i) => ({
        frequency: 0.7e9 + i * 1e6,
        z: { re: 50.123456789 + i, im: -3.987654321 },
      })),
    },
  });

  it('a .json file keeps it at full precision, whatever its size', () => {
    const d = withMeasurement(1500);
    const back = designFromJsonFile(designFileText(d));
    if (!('value' in back)) throw new Error(back.problem);
    expect(back.value.measurement).toEqual(d.measurement);
  });

  it('a share link carries a small one, rounded, and leaves a large one out and says so', () => {
    const small = decodeDesign(encodeDesign(withMeasurement(LINK_BOARD_POINTS)));
    expect(small?.measurement?.points).toHaveLength(LINK_BOARD_POINTS);
    expect(small?.measurement?.points[0]?.z.re).toBeCloseTo(50.1235, 4);
    expect(shareMeasurementNote(withMeasurement(LINK_BOARD_POINTS))).toBeNull();
    const big = decodeDesign(encodeDesign(withMeasurement(LINK_BOARD_POINTS + 1)));
    expect(big).not.toBeNull();
    expect(big?.measurement).toBeUndefined();
    expect(shareMeasurementNote(withMeasurement(LINK_BOARD_POINTS + 1))).toMatch(
      /202 points.*left out of the link; save a \.json file/,
    );
  });

  it('the autosave keeps it and checks it like every reader', () => {
    const d = withMeasurement(20);
    const back = readAutosaveObject(JSON.parse(JSON.stringify(d)));
    if (!('value' in back)) throw new Error(back.problem);
    expect(back.value.measurement).toEqual(d.measurement);
    const hostile = readAutosaveObject({
      ...JSON.parse(JSON.stringify(d)),
      measurement: { name: 5, points: 'x' },
    });
    if (!('value' in hostile)) throw new Error(hostile.problem);
    expect(hostile.value.measurement).toBeUndefined();
  });

  it('hostile measurements are cleaned or left out, never refusing the design', () => {
    const ok = { frequency: 1e9, z: { re: 50, im: 0 } };
    const ok2 = { frequency: 1.1e9, z: { re: 51, im: 1 } };
    for (const junk of [
      null,
      42,
      'board',
      [],
      { points: null },
      { points: {} },
      { points: [ok] },
      { points: [ok, ok] },
      { points: [ok, { frequency: NaN, z: { re: 1, im: 1 } }] },
      { points: [ok, { frequency: -1e9, z: { re: 1, im: 1 } }] },
      { points: [ok, { frequency: 2e9, z: { re: 1e300, im: 1 } }] },
      { points: [ok, { frequency: 2e9, z: 'z' }] },
    ]) {
      expect(measurementPatch(junk)).toEqual({});
    }
    const cleaned = measurementPatch({
      name: `a${String.fromCharCode(0)}b${'x'.repeat(5000)}`,
      points: [ok2, ok, ok, { frequency: Infinity, z: { re: 1, im: 1 } }],
      termination: -5,
    });
    expect(cleaned.measurement?.points.map((p) => p.frequency)).toEqual([1e9, 1.1e9]);
    expect(cleaned.measurement?.name.startsWith('a b')).toBe(true);
    expect((cleaned.measurement?.name.length ?? 0) <= 200).toBe(true);
    expect(cleaned.measurement?.termination).toBeUndefined();
    const many = measurementPatch({
      name: 'many',
      points: Array.from({ length: 5000 }, (_, i) => ({
        frequency: 1e6 * (i + 1),
        z: { re: 50, im: 0 },
      })),
      termination: 75,
    });
    expect(many.measurement?.points).toHaveLength(2001);
    expect(many.measurement?.termination).toBe(75);
    // A link with a broken measurement still opens, without it.
    const text = JSON.stringify({
      ...JSON.parse(new TextDecoder().decode(base64(encodeDesign(measureStart())))),
      measurement: { name: 'x', points: [{ frequency: 'a' }] },
    });
    const link = Buffer.from(text).toString('base64url');
    const d = decodeDesign(link);
    expect(d).not.toBeNull();
    expect(d?.measurement).toBeUndefined();
  });
});

function base64(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, 'base64url'));
}
