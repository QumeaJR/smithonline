// @vitest-environment jsdom
/**
 * Phase 4: the phone's main sheet. Detents in pixels (peek, half just below
 * the chart hero, full), drags that settle and never close it, the live strip
 * at full that drops it to half, and the modes that hold it at peek: arming a
 * palette part (with the banner and its Default and Cancel), datapoint input,
 * a marker drag, and the tour's header at peek.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PanelSheet } from '../src/layout/PanelSheet';
import { settlePanel, sheetHeights } from '../src/lib/layout';
import { emptyDesign } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';
import { useJobs } from '../src/store/useJobs';
import { useShell } from '../src/store/useShell';
import { useTourStore } from '../src/store/useTourStore';

let coarse = false;
beforeAll(() => {
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

beforeEach(() => {
  coarse = false;
  vi.stubGlobal('innerWidth', 390);
  vi.stubGlobal('innerHeight', 844);
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
  useDesignStore.getState().setMessage(null);
});
afterEach(() => {
  cleanup();
  vi.stubGlobal('innerWidth', 1024);
  vi.stubGlobal('innerHeight', 768);
});

const HEIGHTS = sheetHeights(844, 44 + 390, 44);
const detent = () => useShell.getState().detent;

describe('detents', () => {
  it('peek is 64 px plus the safe area, half reaches the chart hero, full the top bar', () => {
    expect(sheetHeights(844, 434, 44, 34)).toEqual({ peek: 98, half: 410, full: 800 });
    expect(HEIGHTS).toEqual({ peek: 64, half: 410, full: 800 });
    // A hero that leaves little room still gives half HALF_FLOOR (108 px) above peek, never above full.
    expect(sheetHeights(600, 560, 44).half).toBe(172);
    expect(sheetHeights(200, 190, 44).half).toBe(156);
  });

  it('a slow drag settles at the nearest detent, a flick moves one detent, it never closes', () => {
    expect(settlePanel(HEIGHTS, 'half', 300, 2000)).toBe('peek');
    expect(settlePanel(HEIGHTS, 'half', -300, 2000)).toBe('full');
    expect(settlePanel(HEIGHTS, 'half', 40, 2000)).toBe('half');
    expect(settlePanel(HEIGHTS, 'full', 60, 50)).toBe('half');
    expect(settlePanel(HEIGHTS, 'half', -40, 30)).toBe('full');
    expect(settlePanel(HEIGHTS, 'peek', 200, 50)).toBe('peek');
    // A tap that slips a few pixels is not a flick.
    expect(settlePanel(HEIGHTS, 'half', 10, 5)).toBe('half');
  });
});

function sheet(over: Partial<Parameters<typeof PanelSheet>[0]> = {}) {
  return (
    <PanelSheet
      heights={HEIGHTS}
      network={<div>network pane</div>}
      numbers={<div>numbers pane</div>}
      tool={null}
      toolId={null}
      onOpenTool={() => undefined}
      onCloseTool={() => undefined}
      live="Zin 50 + j0 Ω   VSWR 1.000"
      {...over}
    />
  );
}

describe('PanelSheet', () => {
  it('the live strip shows at full only, and a tap on it drops the sheet to half', () => {
    render(sheet());
    expect(screen.queryByText(/^Zin 50/)).toBeNull();
    act(() => useShell.getState().setDetent('full'));
    const strip = screen.getByRole('button', { name: /Zin 50 \+ j0 Ω\s+VSWR 1\.000/ });
    fireEvent.click(strip);
    expect(detent()).toBe('half');
    expect(screen.queryByRole('button', { name: /Zin 50/ })).toBeNull();
  });

  it('the grabber steps the detents and the arrow keys move them', () => {
    render(sheet());
    const grab = screen.getByRole('button', { name: /Panel size: half/ });
    fireEvent.click(grab);
    expect(detent()).toBe('full');
    fireEvent.keyDown(screen.getByRole('button', { name: /Panel size: full/ }), {
      key: 'ArrowDown',
    });
    expect(detent()).toBe('half');
    fireEvent.keyDown(screen.getByRole('button', { name: /Panel size: half/ }), { key: 'Home' });
    expect(detent()).toBe('peek');
    fireEvent.keyDown(screen.getByRole('button', { name: /Panel size: peek/ }), {
      key: 'ArrowDown',
    });
    expect(detent()).toBe('peek');
  });

  it('a banner takes the header at peek; the segments come back above peek', () => {
    useShell.setState({ detent: 'peek' });
    const { rerender } = render(sheet({ banner: <div role="status">Series L armed</div> }));
    expect(screen.getByText('Series L armed')).toBeTruthy();
    expect(screen.queryByRole('tablist', { name: 'Panels' })).toBeNull();
    act(() => useShell.getState().setDetent('half'));
    rerender(sheet({ banner: <div role="status">Series L armed</div> }));
    expect(screen.getByRole('tablist', { name: 'Panels' })).toBeTruthy();
  });

  it('Tools lists the three tools; a pushed panel has a back chevron that keeps the tool', () => {
    const onOpenTool = vi.fn();
    const onCloseTool = vi.fn();
    const { rerender } = render(sheet({ onOpenTool }));
    fireEvent.click(screen.getByRole('tab', { name: 'Tools' }));
    const list = screen.getByRole('list', { name: 'Tools' });
    const rows = within(list).getAllByRole('button');
    expect(rows.map((r) => r.querySelector('strong')?.textContent)).toEqual([
      'Auto match',
      'Optimize band',
      'Tolerance',
    ]);
    expect(rows[1]?.textContent).toContain('lowest worst-case VSWR');
    fireEvent.click(rows[1] as HTMLElement);
    expect(onOpenTool).toHaveBeenCalledWith('optimize');
    act(() => useShell.getState().toolOpened());
    rerender(sheet({ tool: <div>optimizer panel</div>, toolId: 'optimize', onCloseTool }));
    expect(screen.getByText('optimizer panel')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Tools' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to the tools' }));
    // The panel stays mounted (its job runs on) while the list shows.
    expect(screen.getByRole('list', { name: 'Tools' })).toBeTruthy();
    expect(
      screen.getByText('optimizer panel', { selector: 'div' }).closest('[hidden]'),
    ).not.toBeNull();
    expect(onCloseTool).not.toHaveBeenCalled();
    act(() =>
      useJobs.getState().report('optimize', { done: 2, total: 8, label: 'Restart 2 of 8' }),
    );
    expect(screen.getByRole('progressbar', { name: 'Optimize band' })).toBeTruthy();
  });
});

describe('modes hold the sheet at peek in the application', () => {
  it('arming a palette part drops to peek with the banner; Cancel restores the detent', async () => {
    const { App } = await import('../src/App');
    const user = userEvent.setup();
    render(<App />);
    expect(document.querySelector('.app')?.className).toContain('layout-phone');
    expect(detent()).toBe('half');
    await user.click(screen.getByRole('button', { name: 'Series L' }));
    expect(detent()).toBe('peek');
    const banner = screen.getByText(/armed:/).closest('.mode-banner') as HTMLElement;
    expect(banner.textContent).toMatch(/Series L armed: tap, or press and drag, to place it/);
    await user.click(within(banner).getByRole('button', { name: 'Cancel' }));
    expect(detent()).toBe('half');
    expect(screen.queryByText(/armed:/)).toBeNull();
  });

  it('Default in the banner adds the part, names the step and restores the detent', async () => {
    act(() => useShell.getState().setDetent('full'));
    const { App } = await import('../src/App');
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Shunt C' }));
    expect(detent()).toBe('peek');
    await user.click(screen.getByRole('button', { name: 'Default' }));
    expect(useDesignStore.getState().design.elements).toHaveLength(1);
    expect(useDesignStore.getState().message).toMatch(/^Added Shunt C 1: /);
    expect(detent()).toBe('full');
  });

  it('datapoint input shows its banner with Done at peek', async () => {
    const { App } = await import('../src/App');
    const user = userEvent.setup();
    render(<App />);
    act(() => useDesignStore.getState().setDatapointInput(true));
    expect(detent()).toBe('peek');
    expect(screen.getByText('Tap the chart to add DP2')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(useDesignStore.getState().datapointInput).toBe(false);
    expect(detent()).toBe('half');
  });

  it('the tour is the header at peek with its title, step and Next', async () => {
    const { App } = await import('../src/App');
    render(<App />);
    act(() => useTourStore.getState().start('l-network'));
    const tour = useTourStore.getState().tour;
    expect(tour).not.toBeNull();
    act(() => useShell.getState().setDetent('peek'));
    const head = screen.getByRole('group', { name: `Guided tour: ${tour?.title}` });
    expect(within(head).getByText(/step 1 of/)).toBeTruthy();
    expect(within(head).getByRole('button', { name: 'Next' })).toBeTruthy();
    // The narration shows from half up.
    expect(document.querySelector('.tour-sheet')).toBeNull();
    act(() => useShell.getState().setDetent('half'));
    expect(document.querySelector('.tour-sheet')).not.toBeNull();
  });
});
