// @vitest-environment jsdom
/**
 * Redesign phase 5: the wording keyed on the pointer and the phase 4
 * leftovers in the App. A touch screen reads Tap chart and gestures it has;
 * a tapped solution row clears with the ghost when the preview ends
 * elsewhere; one Escape on a phone ends the preview, the next closes Auto
 * match; the start guide's third step focuses the target R field; the focus
 * survives a change of layout; an example loads as "Example 5"; the Share
 * button says what it does; the yield reads 99.9 % with a failed run.
 */
import { complex, type MatchSolution } from '@smithonline/core';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Datapoints } from '../src/components/Datapoints';
import { SolutionList } from '../src/components/SolutionList';
import { emptyDesign, identify } from '../src/lib/design';
import { lSolutions } from '../src/lib/match';
import { useDesignStore } from '../src/store/useDesignStore';
import { useHelp } from '../src/store/useHelp';
import { useShell } from '../src/store/useShell';
import { useTourStore } from '../src/store/useTourStore';

let coarse = false;
beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});

function setup(width: number, touch: boolean, height = 844): void {
  coarse = touch;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: coarse && query === '(pointer: coarse)',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  }));
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('innerHeight', height);
}

beforeEach(() => {
  localStorage.clear();
  useShell.setState({
    pane: 'network',
    paneBefore: 'network',
    toolPushed: false,
    detent: 'half',
    held: null,
    holds: [],
    guideClosed: true,
  });
  useTourStore.getState().close();
  useHelp.getState().closeHelp();
  useDesignStore.getState().init(emptyDesign());
  useDesignStore.getState().setMessage(null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});

async function renderApp(width: number, touch: boolean): Promise<HTMLElement> {
  setup(width, touch);
  const { App } = await import('../src/App');
  return render(<App />).container;
}

describe('wording per pointer', () => {
  it('the datapoint input switch reads Tap chart on touch and Click chart with a mouse', () => {
    setup(390, true);
    const { unmount } = render(<Datapoints />);
    expect(screen.getByRole('switch', { name: 'Tap chart' })).toBeTruthy();
    unmount();
    setup(1440, false);
    render(<Datapoints />);
    expect(screen.getByRole('switch', { name: 'Click chart' })).toBeTruthy();
  });

  it('the status hint over the chart names touch gestures on a coarse pointer', async () => {
    const container = await renderApp(1440, true);
    const hint = container.querySelector('.status-hover')?.textContent ?? '';
    expect(hint).toMatch(/long press/);
    expect(hint).toMatch(/Pinch zooms/);
    expect(hint).not.toMatch(/hover|right-click|double-click|wheel/i);
  });

  it('the status hint keeps the mouse words with a fine pointer', async () => {
    const container = await renderApp(1440, false);
    expect(container.querySelector('.status-hover')?.textContent).toMatch(/right-click/);
  });

  it('the empty ladder says long press on touch', async () => {
    const container = await renderApp(1440, true);
    expect(container.querySelector('.ladder .hint')?.textContent).toMatch(/long press the chart/);
  });
});

describe('a tapped solution row', () => {
  const sols = lSolutions(complex(20, -10), complex(50, 0), 50, 1e9) as MatchSolution[];

  it('clears with the ghost when the preview ends elsewhere', () => {
    setup(390, true);
    const onPreview = vi.fn();
    const { rerender, container } = render(
      <SolutionList
        solutions={sols}
        empty=""
        onPreview={onPreview}
        onApply={() => undefined}
        previewed={null}
      />,
    );
    fireEvent.click(container.querySelector('.solution-pick') as HTMLElement);
    expect(onPreview).toHaveBeenLastCalledWith(sols[0]);
    rerender(
      <SolutionList
        solutions={sols}
        empty=""
        onPreview={onPreview}
        onApply={() => undefined}
        previewed={sols[0]}
      />,
    );
    expect(container.querySelector('.solution-row.sel')).not.toBeNull();
    // An armed part, Escape or Cancel ended the preview: the row goes with the ghost.
    rerender(
      <SolutionList
        solutions={sols}
        empty=""
        onPreview={onPreview}
        onApply={() => undefined}
        previewed={null}
      />,
    );
    expect(container.querySelector('.solution-row.sel')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Add / })).toBeNull();
  });

  it('is revealed again when the sheet around it settles', () => {
    setup(390, true);
    const reveal = vi.fn();
    const was = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = reveal;
    try {
      const { container } = render(
        <div className="panel-sheet">
          <SolutionList
            solutions={sols}
            empty=""
            onPreview={() => undefined}
            onApply={() => undefined}
          />
        </div>,
      );
      fireEvent.click(container.querySelector('.solution-pick') as HTMLElement);
      const calls = reveal.mock.calls.length;
      expect(calls).toBeGreaterThan(0);
      const sheet = container.querySelector('.panel-sheet') as HTMLElement;
      fireEvent(sheet, new Event('transitionend', { bubbles: true }));
      expect(reveal.mock.calls.length).toBe(calls + 1);
    } finally {
      Element.prototype.scrollIntoView = was;
    }
  });
});

describe('Escape on the phone', () => {
  it('the first ends the preview only, the second closes Auto match', async () => {
    useDesignStore.getState().init({ ...emptyDesign(), load: complex(20, -12) });
    const container = await renderApp(390, true);
    act(() => useShell.getState().setPane('tool'));
    fireEvent.click(screen.getByRole('button', { name: /^Auto match/ }));
    const panel = container.querySelector('.tool-panel') as HTMLElement;
    expect(panel).not.toBeNull();
    // No parts yet: Add parts lists the L-networks.
    const row = container.querySelector('.solution-pick') as HTMLElement;
    fireEvent.click(row);
    expect(container.querySelector('svg.smith-chart .ghost')).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(container.querySelector('svg.smith-chart .ghost')).toBeNull();
    expect(container.querySelector('.tool-panel')).not.toBeNull();
    expect(container.querySelector('.solution-row.sel')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(container.querySelector('.tool-panel')).toBeNull();
  });
});

describe('start guide, step 3', () => {
  it('focuses the target R field of Auto match, not its help link', async () => {
    useShell.setState({ guideClosed: false });
    useDesignStore.getState().init(emptyDesign(), { fresh: true });
    await renderApp(1440, false);
    fireEvent.click(screen.getByRole('button', { name: 'Open Auto match' }));
    await act(() => new Promise((r) => setTimeout(r, 10)));
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Auto match target resistance');
  });
});

describe('focus across a change of layout', () => {
  const resize = (width: number): void => {
    vi.stubGlobal('innerWidth', width);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
  };

  it('stays on the same field when it exists in the phone layout', async () => {
    useDesignStore.getState().init({
      ...emptyDesign(),
      elements: identify([{ kind: 'L', orientation: 'series', value: 10e-9 }]),
    });
    await renderApp(1440, false);
    const field = screen.getByLabelText('Series L 1 inductance');
    field.focus();
    expect(document.activeElement).toBe(field);
    resize(390);
    expect(document.querySelector('.app')?.className).toContain('layout-phone');
    expect(document.activeElement).toBe(field);
  });

  it('moves to the main region when the element is gone', async () => {
    await renderApp(1440, false);
    const fit = screen.getByRole('button', { name: 'Fit' });
    fit.focus();
    resize(390);
    expect(document.activeElement?.tagName).toBe('MAIN');
  });
});

describe('wording leftovers', () => {
  it('an example loads as "Example 5", not as its file name', async () => {
    await renderApp(1440, false);
    fireEvent.click(screen.getByRole('button', { name: 'Examples' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Example 5(?!\d)/ }));
    expect(useDesignStore.getState().message).toBe('Loaded Example 5');
  });

  it('the Share button says what it does', async () => {
    await renderApp(1440, false);
    expect(screen.getByRole('button', { name: 'Share link' }).getAttribute('title')).toBe(
      'Share link: puts the whole design in the address and copies the link',
    );
  });

  it('the Optimize band text points at the Numbers segment, not the right panel', async () => {
    const container = await renderApp(1440, false);
    fireEvent.click(screen.getByRole('button', { name: /Optimize band/ }));
    const panel = container.querySelector('.tool-panel') as HTMLElement;
    expect(within(panel).queryByText(/right panel/)).toBeNull();
    expect(panel.textContent).toMatch(/Numbers segment/);
  });
});
