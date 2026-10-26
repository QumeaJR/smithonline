// @vitest-environment jsdom
/**
 * Phase D4 QA fixes in the app: the error boundary, the autosave check, the
 * stackup and board fields with their messages, Reset all with its confirmation
 * and undo, Use board stackup keeping Z0, the report notes, the export headers,
 * the "as built" Zin and the legend's tooltip.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  complex,
  DEFAULT_BOARD,
  DEFAULT_PACKAGES,
  DEFAULT_STACKUP,
  evaluateLadder,
  microstripProperties,
  microstripWidthAt,
  STACKUP_PRESETS,
  withBoard,
  type Element,
} from '@smithonline/core';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { Schematic } from '../src/components/Schematic';
import { SettingsDialog } from '../src/components/SettingsDialog';
import { BuildPanel } from '../src/components/BuildPanel';
import { setBoardEnabled, setBoardNumber } from '../src/lib/buildActions';
import { designBuild } from '../src/lib/designBuild';
import { DESIGN_STORAGE_KEY, readSavedDesign } from '../src/lib/autosave';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { asBuiltTitle } from '../src/lib/realize';
import { reportSvg, wrapText } from '../src/lib/report';
import { buildReportParts, ALL_PARTS } from '../src/lib/reportParts';
import { elementsOf } from '../src/lib/share';
import { BOARD_NOTE, designToS2p, designToSpice } from '../src/lib/simexport';
import { useBoard } from '../src/store/useBoard';
import { useDesignStore } from '../src/store/useDesignStore';
import { usePackages } from '../src/store/usePackages';

beforeAll(() => {
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
});
beforeEach(() => {
  localStorage.clear();
  useDesignStore.getState().init(emptyDesign());
  useDesignStore.getState().setMessage(null);
  useBoard.getState().reset();
  usePackages.getState().reset();
});
afterEach(() => cleanup());

const FR4 = DEFAULT_STACKUP;
const RO4003 = STACKUP_PRESETS[2]!.stackup;

async function typeEnter(input: HTMLElement, text: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(input);
  await user.clear(input);
  await user.type(input, `${text}{Enter}`);
}

describe('d4 qa: the error boundary', () => {
  it('a render that throws shows the recovery message, and Start a new design recovers', () => {
    let fail = true;
    function Boom() {
      if (fail) throw new Error('bad stackup name');
      return <p>shell</p>;
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert').textContent).toMatch(
      /This design could not be shown: bad stackup name\./,
    );
    expect(screen.getByRole('button', { name: 'Load the last saved design' })).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Start a new design' }));
    expect(screen.getByText('shell')).toBeTruthy();
    expect(useDesignStore.getState().design.elements).toEqual([]);
    spy.mockRestore();
  });
});

describe('d4 qa: the autosave and the element check', () => {
  const ms = { kind: 'microstrip', width: 3e-3, length: 0.02, stackup: FR4 };
  it('an autosaved stackup name that is not text is dropped; a bad element refuses the save', () => {
    const saved = {
      ...emptyDesign(),
      elements: [{ ...ms, stackup: { ...FR4, name: { evil: 1 } } }],
    };
    localStorage.setItem(DESIGN_STORAGE_KEY, JSON.stringify(saved));
    const d = readSavedDesign();
    const el = d?.elements[0] as { stackup: { name?: unknown } } | undefined;
    expect(el?.stackup.name).toBeUndefined();
    localStorage.setItem(
      DESIGN_STORAGE_KEY,
      JSON.stringify({ ...saved, elements: [{ ...ms, width: 1e-12 }] }),
    );
    expect(readSavedDesign()).toBeNull();
  });

  it('elementsOf keeps a microstrip to its own fields and the display ones', () => {
    const out = elementsOf([{ ...ms, id: 'a', color: '#123456', locked: true, extra: 'x' }]);
    expect(out?.[0]).toEqual({
      id: 'a',
      color: '#123456',
      locked: true,
      kind: 'microstrip',
      width: 3e-3,
      length: 0.02,
      stackup: FR4,
    });
    expect(elementsOf([{ ...ms, stackup: { ...FR4, tanD: 0.4 } }])).toBeNull();
    expect(elementsOf([{ ...ms, stackup: { ...FR4, rho: -1 } }])).toBeNull();
  });
});

/** The board of the design on show (docs/09b: the board is saved with the design). */
const board = () => designBuild(useDesignStore.getState().design).board;

describe('d4 qa: Build > Board fields, and Settings Reset all leaves the build', () => {
  it('a reference frequency of 10 Hz is refused next to the field, by its visible label', async () => {
    render(<BuildPanel />);
    const f = screen.getByRole('textbox', { name: 'Reference frequency of the permittivity' });
    await typeEnter(f, '10');
    const alert = screen.getAllByRole('alert').find((a) => a.textContent?.startsWith('at f:'));
    expect(alert?.textContent).toMatch(/at f: "10" is not between 1 kHz and 1 THz/);
    expect(f.getAttribute('aria-invalid')).toBe('true');
    expect(board().stackup.fRef).toBe(FR4.fRef);
  });

  it('tanδ 0.3 on FR-4 is refused with the physical reason', async () => {
    render(<BuildPanel />);
    await typeEnter(screen.getByRole('textbox', { name: 'Loss tangent' }), '0.3');
    const alert = screen.getAllByRole('alert').find((a) => a.textContent?.startsWith('tanδ:'));
    expect(alert?.textContent).toMatch(/below 1 \(below vacuum\) by 110 GHz/);
    expect(board().stackup.tanD).toBe(FR4.tanD);
  });

  it('Vias per shunt part refuses 2.5 instead of rounding it', async () => {
    render(<BuildPanel />);
    await typeEnter(screen.getByRole('textbox', { name: 'Vias per shunt part' }), '2.5');
    const alert = screen.getAllByRole('alert').find((a) => a.textContent?.startsWith('Vias'));
    expect(alert?.textContent).toMatch(/is not a whole number of vias/);
    expect(board().viasPerShunt).toBe(1);
  });

  it('states the limits with a help link, and the trace fields read "0 mm"', () => {
    render(<BuildPanel />);
    expect(document.querySelector('.board-limits')?.textContent).toMatch(
      /no EM simulation, no coupling or discontinuities.*vias without mutual inductance/,
    );
    expect(screen.getByRole('button', { name: 'Help on the board in the network' })).toBeTruthy();
    const trace = screen.getByRole('textbox', { name: 'Trace length between parts' });
    expect((trace as HTMLInputElement).value).toBe('0 mm');
  });

  it('Settings Reset all asks first and leaves the build and its defaults alone', () => {
    act(() => useBoard.getState().setBoard({ enabled: true, traceLength: 2e-3 }));
    act(() => setBoardNumber('traceLength', 3e-3));
    render(<SettingsDialog onClose={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset all…' }));
    expect(screen.getByText(/Reset appearance, schematic and behaviour/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset all' }));
    expect(useBoard.getState().board.traceLength).toBe(2e-3);
    expect(board().traceLength).toBe(3e-3);
    fireEvent.click(screen.getByRole('button', { name: 'Undo reset' }));
    expect(board().traceLength).toBe(3e-3);
  });

  it('with the board on, the pads of a package with lands are computed, not typed', () => {
    act(() => setBoardEnabled(true));
    render(<BuildPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Show all packages' }));
    expect(screen.queryByRole('textbox', { name: /^0402.* Pads$/ })).toBeNull();
    const computed = document.querySelector('.build-package .computed') as HTMLElement;
    expect(computed.getAttribute('title')).toMatch(/Computed from the land size and the stackup/);
    act(() => setBoardEnabled(false));
    expect(screen.getByRole('textbox', { name: /^0402.* Pads$/ })).toBeTruthy();
  });
});

describe('d4 qa: the report notes, export headers and the as-built labels', () => {
  const design = (): Design => ({
    ...emptyDesign(),
    elements: identify([
      { kind: 'C', orientation: 'shunt', value: 3e-12 },
      { kind: 'L', orientation: 'series', value: 5e-9 },
    ]),
  });
  const board = { ...DEFAULT_BOARD, enabled: true, traceLength: 2e-3 };

  it('the report SVG puts every layout assumption on lines of its own, wrapped', () => {
    const d = design();
    const result = evaluateLadder({
      ...d,
      load: complex(d.load.re, d.load.im),
      elements: d.elements,
    });
    const long = `Stackup: ${'x '.repeat(300)}end`;
    const parts = buildReportParts({
      design: d,
      result,
      realization: null,
      packaged: result,
      builtWhat: 'the board',
      layout: [long, 'Vias: 1 per shunt part'],
      chart: null,
      schematic: null,
      sel: ALL_PARTS,
    });
    const svg = reportSvg(parts, ALL_PARTS);
    const texts = [...svg.matchAll(/<text [^>]*>([^<]*)<\/text>/g)].map((m) => m[1] ?? '');
    expect(texts.some((t) => t === 'Vias: 1 per shunt part')).toBe(true);
    expect(texts.every((t) => t.length <= 130)).toBe(true);
    expect(wrapText('a b c d', 3)).toEqual(['a b', 'c d']);
  });

  it('SPICE says the board is left out even without packages; the .s2p says what it holds', () => {
    const d = design();
    expect(designToSpice(d, null, board)).toContain(`* ${BOARD_NOTE}`);
    expect(designToSpice(d, null, DEFAULT_BOARD)).not.toContain('board');
    const s2p = designToS2p(d, null, DEFAULT_PACKAGES, board);
    expect(s2p).toMatch(/! Contains: ideal values; no package parasitics; the board/);
    expect(s2p).toMatch(/! Board stackup: FR-4, 1.6 mm: h 1.6 mm/);
  });

  it('the Zin terminal says "as built" when the packages or the board are in it', () => {
    const d = design();
    const ladder = { ...d, load: complex(25, 10), elements: d.elements as unknown as Element[] };
    const result = evaluateLadder(ladder);
    useDesignStore.getState().init(d);
    const { container } = render(
      <Schematic result={result} built={{ result, label: 'board', asBuilt: true }} />,
    );
    expect(container.textContent).toMatch(/VSWR [\d.]+, as built/);
    expect(container.querySelector('[data-cell="zin"] title')?.textContent).toMatch(
      /with the board;/,
    );
  });

  it('the legend tooltip names only what is in the built network', () => {
    const els = design().elements as unknown as Element[];
    const noTrace = { ...board, traceLength: 0 };
    const built = withBoard(els, DEFAULT_PACKAGES, noTrace, { z0: 50, frequency: 1e9 });
    const t = asBuiltTitle(els, built, DEFAULT_PACKAGES, noTrace);
    expect(t).toMatch(/the board adds a via under the shunt part/);
    expect(t).not.toMatch(/trace/);
  });
});

describe('d4 qa: Use board stackup keeps Z0 and the electrical length', () => {
  it('the default solves the width again and rescales the length; Keep size states the Z0', async () => {
    const w = microstripWidthAt(FR4, 50, 1e9)!;
    const d: Design = {
      ...emptyDesign(),
      load: { re: 25, im: 10 },
      elements: identify([{ kind: 'microstrip', width: w, length: 0.02, stackup: FR4 }]),
    };
    act(() => useBoard.getState().applyPreset('ro4003c-0.508'));
    useDesignStore.getState().loadDesign(d, 'x');
    const { App } = await import('../src/App');
    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: "Use the design's stackup" })[0]!);
    const el = useDesignStore.getState().design.elements[0] as unknown as {
      width: number;
      length: number;
    };
    const z = microstripProperties(RO4003, el.width, 1e9).z0.re;
    expect(z).toBeCloseTo(microstripProperties(FR4, w, 1e9).z0.re, 6);
    const before = microstripProperties(FR4, w, 1e9);
    const after = microstripProperties(RO4003, el.width, 1e9);
    expect(after.beta * el.length).toBeCloseTo(before.beta * 0.02, 9);
    expect(useDesignStore.getState().message).toMatch(/Z0 \d+\.\d Ω and electrical length kept/);
    // Undo, then keep the size: the message names the Z0 it now has (about 24 ohm).
    act(() => useDesignStore.getState().undo());
    fireEvent.click(screen.getAllByRole('button', { name: 'Keep size' })[0]!);
    expect(useDesignStore.getState().message).toMatch(/size kept: Z0 24\.0 Ω \(was 50\.\d Ω\)/);
  });
});
