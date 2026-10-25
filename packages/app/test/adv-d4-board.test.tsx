// @vitest-environment jsdom
/**
 * Adversarial, phase D4 (the board in the network) in the app: hostile share links carrying a
 * microstrip stackup, a reference frequency the stackup fields accept, the share rounding of a
 * microstrip and the stackup label. Each test asserts the correct behaviour; a failure is a defect.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cabs,
  complex,
  csub,
  evaluateLadder,
  STACKUP_PRESETS,
  stackupLabel,
  zinWith,
  type Element,
} from '@smithonline/core';

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
import { decodeDesign, encodeDesign } from '../src/lib/share';
import { newMicrostrip } from '../src/lib/elements';
import { useBoard } from '../src/store/useBoard';
import { useDesignStore } from '../src/store/useDesignStore';
import { useShell } from '../src/store/useShell';
import { useHelp } from '../src/store/useHelp';

const FR4 = STACKUP_PRESETS[0]!.stackup;
const D = () => useDesignStore.getState();

function b64(json: unknown): string {
  return Buffer.from(JSON.stringify(json), 'utf8').toString('base64url');
}
function link(stackup: Record<string, unknown>): string {
  return b64({
    v: 1,
    name: 'x',
    z0: 50,
    frequency: 1e9,
    load: { re: 25, im: 10 },
    elements: [{ kind: 'microstrip', width: 3e-3, length: 0.02, stackup }],
  });
}
const ladderOf = (d: Design) => ({
  z0: d.z0,
  frequency: d.frequency,
  load: complex(d.load.re, d.load.im),
  elements: d.elements as unknown as Element[],
});
const finiteZ = (d: Design): boolean => {
  const r = evaluateLadder(ladderOf(d));
  return r.datapoints.every((z) => Number.isFinite(z.re) && Number.isFinite(z.im));
};

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
}

beforeEach(() => {
  stubs();
  localStorage.clear();
  useBoard.getState().reset();
  useShell.setState({
    detent: 'half',
    held: null,
    holds: [],
    guideClosed: true,
    guideShown: false,
  });
  useHelp.getState().closeHelp();
  D().init({ ...emptyDesign(), load: { re: 25, im: 10 } });
  D().setView('chart');
  D().setMessage(null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderApp(): Promise<HTMLElement> {
  const { App } = await import('../src/App');
  return render(<App />).container;
}
/** Every "NaN" a user could see: text, and attribute values (SVG paths, points). */
function nanInDom(c: HTMLElement): string[] {
  const hits: string[] = [];
  const text = c.textContent ?? '';
  const m = /.{0,40}NaN.{0,20}/.exec(text);
  if (m) hits.push(`text: ${m[0]}`);
  c.querySelectorAll('*').forEach((el) => {
    for (const a of Array.from(el.attributes)) {
      if (/NaN/.test(a.value)) hits.push(`${el.tagName}[${a.name}]`);
    }
  });
  return [...new Set(hits)];
}

describe('share link: the stackup a microstrip carries', () => {
  it('a link whose stackup has rho = -1 is refused or repaired, never evaluated as NaN', () => {
    const d = decodeDesign(link({ ...FR4, rho: -1 }));
    expect(d === null || finiteZ(d)).toBe(true);
  });

  it('a link whose stackup has rho = "x" (a string) is refused or repaired', () => {
    const d = decodeDesign(link({ ...FR4, rho: 'x' }));
    expect(d === null || finiteZ(d)).toBe(true);
  });

  it('a link whose stackup name is an object is refused or the name dropped', () => {
    const d = decodeDesign(link({ ...FR4, name: { evil: 1 } }));
    const ms = d?.elements[0] as unknown as { stackup: { name?: unknown } } | undefined;
    expect(
      d === null || ms?.stackup.name === undefined || typeof ms.stackup.name === 'string',
    ).toBe(true);
  });

  it('opening that link does not crash the App', async () => {
    const d = decodeDesign(link({ ...FR4, name: { evil: 1 } }));
    if (d === null) return;
    D().loadDesign(d, 'Opened link');
    await expect(renderApp()).resolves.toBeTruthy();
  });

  it('a link whose stackup name is 1 MB long is refused or the name cut (normalizeStackup caps it at 80)', () => {
    const d = decodeDesign(link({ ...FR4, name: 'A'.repeat(1_000_000) }));
    const ms = d?.elements[0] as unknown as { stackup: { name?: string } } | undefined;
    expect(d === null || (ms?.stackup.name?.length ?? 0) <= 80).toBe(true);
  });

  it('a link carrying a reference frequency of 1 Hz (passes isUsableStackup) is refused or evaluates finite', () => {
    const d = decodeDesign(link({ ...FR4, fRef: 1 }));
    expect(d === null || finiteZ(d)).toBe(true);
  });

  it('share rounding to 6 digits keeps a microstrip network within 1e-4 of the original', () => {
    const ms = { ...newMicrostrip(50, 1.234567e9), length: 0.0123456789 };
    const design: Design = {
      ...emptyDesign(),
      frequency: 1.234567e9,
      load: { re: 13.3333333, im: -27.7777777 },
      elements: identify([ms, { kind: 'C', orientation: 'shunt', value: 3.3333333e-12 }]),
    };
    const back = decodeDesign(encodeDesign(design));
    expect(back).not.toBeNull();
    const zl = complex(13.3333333, -27.7777777);
    for (const f of [0.5e9, 1.234567e9, 3e9]) {
      const ref = { index: 0, parameter: 'length' as const };
      const a = zinWith(ladderOf(design).elements, ref, 0.0123456789, zl, f);
      const bEls = ladderOf(back as Design).elements;
      const b = zinWith(bEls, ref, (bEls[0] as { length: number }).length, zl, f);
      expect(cabs(csub(a, b)) / cabs(a)).toBeLessThan(1e-4);
    }
  });
});

describe('the stackup fields', () => {
  it('a reference frequency the field accepts (1 Hz, its min) gives a finite microstrip', () => {
    act(() => useBoard.getState().setStackup({ fRef: 1 }));
    const ms = newMicrostrip(50, 1e9);
    const design: Design = { ...emptyDesign(), load: { re: 25, im: 10 }, elements: identify([ms]) };
    expect(finiteZ(design)).toBe(true);
  });

  it('fRef typed as "10" (10 Hz): no NaN reaches the chart or a readout', async () => {
    act(() => useBoard.getState().setStackup({ fRef: 10 }));
    const ms = newMicrostrip(50, 1e9);
    D().loadDesign({ ...emptyDesign(), load: { re: 25, im: 10 }, elements: identify([ms]) }, 'x');
    const c = await renderApp();
    expect(nanInDom(c)).toEqual([]);
  });

  it('tanD 0.5 (the field max) at 40 GHz: no NaN reaches the chart or a readout', async () => {
    act(() => useBoard.getState().setStackup({ tanD: 0.5 }));
    const ms = newMicrostrip(50, 40e9);
    D().loadDesign(
      { ...emptyDesign({ frequency: 40e9 }), load: { re: 25, im: 10 }, elements: identify([ms]) },
      'x',
    );
    const c = await renderApp();
    expect(nanInDom(c)).toEqual([]);
  });
});

describe('stackup label', () => {
  it('a stackup whose numbers are not the preset is not labelled with the preset name', () => {
    // A preset name carried by a design made before the preset numbers changed, or by a link.
    const s = { ...FR4, er: 4.3 };
    expect(stackupLabel(s)).not.toBe('FR-4, 1.6 mm');
  });
});

describe('more hostile and old links', () => {
  it('a link whose microstrip width is 1e-12 m (positive, so accepted) evaluates finite or is refused', () => {
    const raw = {
      v: 1,
      z0: 50,
      frequency: 1e9,
      load: { re: 25, im: 10 },
      elements: [{ kind: 'microstrip', width: 1e-12, length: 0.02, stackup: FR4 }],
    };
    const d = decodeDesign(b64(raw));
    expect(d === null || finiteZ(d)).toBe(true);
  });
  it('a link whose stackup h is 1e-9 m evaluates finite or is refused', () => {
    const d = decodeDesign(link({ ...FR4, h: 1e-9 }));
    expect(d === null || finiteZ(d)).toBe(true);
  });
  it('an old link without a microstrip still opens; a microstrip without a stackup is refused', () => {
    const old = {
      v: 1,
      z0: 50,
      frequency: 1e9,
      load: { re: 25, im: 10 },
      elements: [{ kind: 'L', orientation: 'series', value: 5e-9 }],
    };
    expect(decodeDesign(b64(old))).not.toBeNull();
    const bare = { ...old, elements: [{ kind: 'microstrip', width: 3e-3, length: 0.02 }] };
    expect(decodeDesign(b64(bare))).toBeNull();
  });
});
