// @vitest-environment jsdom
/**
 * QA round 2, 0.6.0 (docs/09b section 6, QA): through the real File menu, the .s2p, the SPICE
 * netlist and the BOM of a design with its own build are the same bytes (apart from the date
 * line) whatever this browser's default board and package table are, and the BOM layout
 * notes name the design's laminate. Expected: equality between the two browsers, and the
 * design's laminate (RO4350B) in the notes, never the browser's (RO4003C).
 */
import { complex, DEFAULT_BOARD, STACKUP_PRESETS, type BoardSettings } from '@smithonline/core';
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

import { emptyDesign, identify, type Design } from '../src/lib/design';
import { useBoard } from '../src/store/useBoard';
import { useDesignStore } from '../src/store/useDesignStore';
import { usePackages } from '../src/store/usePackages';
import { useSettings } from '../src/store/useSettings';
import { useShell } from '../src/store/useShell';

const D = () => useDesignStore.getState();
const RO4350 = STACKUP_PRESETS.find((p) => p.id === 'ro4350b-0.762')!.stackup;
const RO4003 = STACKUP_PRESETS.find((p) => p.id === 'ro4003c-0.508')!.stackup;
const BOARD: BoardSettings = {
  ...DEFAULT_BOARD,
  enabled: true,
  stackup: RO4350,
  viasPerShunt: 2,
  traceLength: 1e-3,
};

function design(): Design {
  const base = emptyDesign();
  return {
    ...base,
    name: 'Parity',
    load: complex(25, -15),
    elements: identify([
      { kind: 'C', orientation: 'shunt', value: 3.3e-12, package: '0402' },
      { kind: 'L', orientation: 'series', value: 6.8e-9, package: '0402' },
    ]),
    sweep: { ...base.sweep, enabled: true, start: 0.5e9, stop: 2e9, points: 21 },
    realize: { ...base.realize, enabled: true },
    build: { board: BOARD, packages: [{ id: '0402', esl: 0.45e-9 }] },
  };
}

const blobs: Blob[] = [];

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
  vi.stubGlobal('innerWidth', 1440);
  vi.stubGlobal('innerHeight', 900);
  URL.createObjectURL = (b: Blob | MediaSource) => {
    blobs.push(b as Blob);
    return 'blob:qa2';
  };
  URL.revokeObjectURL = () => undefined;
  HTMLAnchorElement.prototype.click = () => undefined;
}

/** Choose a File menu entry and return the text of the file it downloads. */
async function exportVia(label: RegExp): Promise<string> {
  const before = blobs.length;
  fireEvent.click(screen.getByRole('button', { name: /^File/ }));
  fireEvent.click(screen.getByRole('menuitem', { name: label }));
  expect(blobs.length).toBe(before + 1);
  const text = await blobs[blobs.length - 1]!.text();
  return text.replace(/^!.*\d{4}-\d{2}-\d{2}.*$/gm, '');
}

async function allExports(): Promise<{ s2p: string; spice: string; bom: string }> {
  return {
    s2p: await exportVia(/^Touchstone S-parameters \(\.s2p\)/),
    spice: await exportVia(/^SPICE netlist \(\.cir\)/),
    bom: await exportVia(/^Bill of materials \(CSV\)/),
  };
}

beforeEach(() => {
  localStorage.clear();
  blobs.length = 0;
  useBoard.getState().reset();
  usePackages.getState().reset();
  useSettings.getState().reset();
  useShell.setState({ guideClosed: true, guideShown: false, settings: null, tool: null });
  D().init(design());
  D().setView('chart');
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the File menu exports of a design with its own build', () => {
  it('are the same in a browser with other defaults', async () => {
    stubs();
    const { App } = await import('../src/App');
    render(<App />);
    const here = await allExports();
    act(() => {
      useBoard.getState().restore({ ...DEFAULT_BOARD, enabled: true, stackup: RO4003 });
      usePackages.getState().setRow('0402', { esl: 0.9e-9, padLength: 0.8e-3 });
    });
    const there = await allExports();
    expect(there).toEqual(here);
    expect(here.s2p).toMatch(/Board stackup: RO4350B/);
    expect(here.bom).toMatch(/^Note;.*RO4350B/m);
    expect(here.bom).not.toMatch(/RO4003C/);
    expect(here.spice.split('\n')[1]).toMatch(/^\* Component package parasitics and the board/);
  });

  it('the check discriminates: a design without a build does follow the defaults (0.5.0 behaviour)', async () => {
    const { build: _b, ...bare } = design();
    void _b;
    // Every way into the store gives a design its own build since QA round 2; the control puts
    // a design without one on show directly.
    useDesignStore.setState({ design: bare, past: [], future: [] });
    stubs();
    const { App } = await import('../src/App');
    render(<App />);
    const here = await allExports();
    act(() => {
      useBoard.getState().restore({ ...DEFAULT_BOARD, enabled: true, stackup: RO4003 });
    });
    const there = await allExports();
    expect(there.s2p).not.toEqual(here.s2p);
    expect(there.bom).toMatch(/RO4003C/);
  });
});
