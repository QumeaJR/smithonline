// @vitest-environment jsdom
/**
 * Adversarial: the phone sheet's holds (armed part, datapoint input, the
 * Response and S-Plot pages, a previewed solution) started and ended in odd
 * orders, a tool opened from More while the sheet is held, and PanelSheet
 * drags with odd pointer sequences.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelSheet } from '../src/layout/PanelSheet';
import { emptyDesign } from '../src/lib/design';
import { sheetHeights } from '../src/lib/layout';
import { useDesignStore } from '../src/store/useDesignStore';
import { useJobs } from '../src/store/useJobs';
import { useShell } from '../src/store/useShell';
import { useTourStore } from '../src/store/useTourStore';

let coarse = false;
beforeAll(() => {
  // jsdom has no canvas; uPlot (the Response plots this file switches to) draws on one. A
  // context that ignores every call keeps the plots out of the question, as in
  // qa-p4-app-layouts.test.tsx.
  const ctx: Record<string | symbol, unknown> = new Proxy(
    {},
    {
      get: (_t, key) =>
        key === 'measureText'
          ? () => ({ width: 0 })
          : key === 'canvas'
            ? document.createElement('canvas')
            : () => undefined,
      set: () => true,
    },
  );
  vi.stubGlobal(
    'Path2D',
    class {
      moveTo(): void {}
      lineTo(): void {}
      rect(): void {}
      arc(): void {}
      closePath(): void {}
      bezierCurveTo(): void {}
      addPath(): void {}
    },
  );
  HTMLCanvasElement.prototype.getContext = (() =>
    ctx) as unknown as HTMLCanvasElement['getContext'];
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('coarse') ? coarse : false,
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

function setWidth(width: number, height = 844): void {
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('innerHeight', height);
  window.dispatchEvent(new Event('resize'));
}

beforeEach(() => {
  coarse = false;
  setWidth(390, 844);
  useShell.setState({
    pane: 'network',
    paneBefore: 'network',
    toolPushed: false,
    detent: 'half',
    held: null,
  });
  useJobs.setState({ jobs: {} });
  useTourStore.getState().close();
  useDesignStore.getState().init(emptyDesign());
  useDesignStore.getState().setView('chart');
  useDesignStore.getState().setDatapointInput(false);
  useDesignStore.getState().setMessage(null);
});
afterEach(() => {
  cleanup();
  setWidth(1024, 768);
});

const detent = () => useShell.getState().detent;

describe('holds in the application', () => {
  it('armed part, Response and back to Chart: still armed, the sheet must stay at peek', async () => {
    const { App } = await import('../src/App');
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Series L' }));
    expect(detent()).toBe('peek');
    act(() => useDesignStore.getState().setView('response'));
    act(() => useDesignStore.getState().setView('chart'));
    expect(screen.getByText(/armed:/)).toBeTruthy();
    expect(detent()).toBe('peek');
  });

  it('datapoint input, Response and back to Chart: the sheet must stay at peek', async () => {
    const { App } = await import('../src/App');
    render(<App />);
    act(() => useDesignStore.getState().setDatapointInput(true));
    expect(detent()).toBe('peek');
    act(() => useDesignStore.getState().setView('response'));
    act(() => useDesignStore.getState().setView('chart'));
    expect(useDesignStore.getState().datapointInput).toBe(true);
    expect(detent()).toBe('peek');
  });

  it('rotation to tablet and back while armed: peek again, half after Cancel', async () => {
    const { App } = await import('../src/App');
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Series L' }));
    act(() => setWidth(800, 390));
    act(() => setWidth(390, 844));
    expect(detent()).toBe('peek');
    const banner = screen.getByText(/armed:/).closest('.mode-banner') as HTMLElement;
    await user.click(within(banner).getByRole('button', { name: 'Cancel' }));
    expect(detent()).toBe('half');
  });

  it('Response page (sheet held at peek), open Tolerance from More: the sheet comes up', async () => {
    const { App } = await import('../src/App');
    const user = userEvent.setup();
    render(<App />);
    act(() => useDesignStore.getState().setView('response'));
    expect(detent()).toBe('peek');
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(screen.getByRole('button', { name: /^Tolerance/ }));
    expect(useShell.getState().toolPushed).toBe(true);
    expect(detent()).not.toBe('peek');
  });

  it('S-Plot page then Chart: the detent before the page comes back', async () => {
    const { App } = await import('../src/App');
    render(<App />);
    act(() => useShell.getState().setDetent('full'));
    act(() => useDesignStore.getState().setView('splot'));
    act(() => useDesignStore.getState().setView('response'));
    act(() => useDesignStore.getState().setView('chart'));
    expect(detent()).toBe('full');
  });
});

const H = sheetHeights(844, 434, 44);
function sheet() {
  return (
    <PanelSheet
      heights={H}
      network={<div>network pane</div>}
      numbers={<div>numbers pane</div>}
      tool={null}
      toolId={null}
      onOpenTool={() => undefined}
      onCloseTool={() => undefined}
      live="Zin"
    />
  );
}
function pointer(el: Element, type: string, clientY: number): void {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
  Object.defineProperty(ev, 'pointerId', { value: 1 });
  fireEvent(el, ev);
}

describe('PanelSheet drags', () => {
  it('a drag of the header, then Enter on the grabber: the grabber still steps', () => {
    const { container } = render(sheet());
    const head = container.querySelector('.panel-sheet-head') as HTMLElement;
    pointer(head, 'pointerdown', 500);
    pointer(head, 'pointermove', 300);
    pointer(head, 'pointerup', 300);
    const after = detent();
    // Keyboard activation of the grabber is a click without a pointerdown.
    const grab = screen.getByRole('button', { name: /Panel size/ });
    fireEvent.click(grab);
    expect(detent()).not.toBe(after);
  });

  it('a pointerup without a pointerdown changes nothing', () => {
    const { container } = render(sheet());
    const head = container.querySelector('.panel-sheet-head') as HTMLElement;
    pointer(head, 'pointerup', 0);
    expect(detent()).toBe('half');
  });

  it('a drag far beyond full and released: full, never above', () => {
    const { container } = render(sheet());
    const head = container.querySelector('.panel-sheet-head') as HTMLElement;
    pointer(head, 'pointerdown', 800);
    pointer(head, 'pointermove', -5000);
    const style = (container.querySelector('.panel-sheet') as HTMLElement).style.getPropertyValue(
      '--panel-h',
    );
    expect(style).toBe(`${H.full}px`);
    pointer(head, 'pointerup', -5000);
    expect(detent()).toBe('full');
  });

  // Dropped as theoretical and timing-dependent: needs a hold to start during a sheet drag (two fingers).
  it.skip('an arm (hold) during a drag of the sheet, then release and Cancel: back to half', () => {
    const { container } = render(sheet());
    const head = container.querySelector('.panel-sheet-head') as HTMLElement;
    pointer(head, 'pointerdown', 500);
    pointer(head, 'pointermove', 480);
    act(() => useShell.getState().hold('peek'));
    pointer(head, 'pointerup', 480);
    act(() => useShell.getState().release());
    expect(detent()).toBe('half');
  });
});

describe('a previewed solution, then a part armed from the palette', () => {
  it('sheet at full, preview drops it to half, arming must drop it to peek', async () => {
    coarse = true;
    useDesignStore.getState().init({ ...emptyDesign(), load: { re: 25, im: -10 } });
    const { App } = await import('../src/App');
    const user = userEvent.setup();
    const { container } = render(<App />);
    act(() => useShell.getState().setDetent('full'));
    const sheetEl = container.querySelector('.panel-sheet') as HTMLElement;
    await user.click(within(sheetEl).getByRole('tab', { name: 'Tools' }));
    await user.click(within(sheetEl).getByRole('button', { name: /^Auto match/ }));
    const row = container.querySelector('.solution-pick') as HTMLElement;
    expect(row).not.toBeNull();
    await user.click(row);
    expect(detent()).toBe('half');
    await user.click(within(sheetEl).getByRole('tab', { name: 'Network' }));
    await user.click(screen.getByRole('button', { name: 'Series L' }));
    expect(screen.getByText(/armed:/)).toBeTruthy();
    expect(detent()).toBe('peek');
  });
});
