// @vitest-environment jsdom
/**
 * Phase 4 of the interaction redesign: the responsive shell places the same
 * slots per width (phone below 700 px, tablet 700 to 1099, desktop 1100 to
 * 1439, wide 1440 and up), and the tool column opens a tool in the right
 * column without touching the chart.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell, type ShellProps } from '../src/layout/Shell';
import { effectivePane, layoutForWidth } from '../src/lib/layout';
import { emptyDesign, identify } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';
import { useJobs } from '../src/store/useJobs';
import { useShell } from '../src/store/useShell';

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

/** Resize the window: the shell reads innerWidth and listens to resize. */
function setWidth(width: number, height = 844): void {
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('innerHeight', height);
  window.dispatchEvent(new Event('resize'));
}

beforeEach(() => {
  coarse = false;
  useShell.setState({
    pane: 'network',
    paneBefore: 'network',
    toolPushed: false,
    background: [],
    detent: 'half',
    held: null,
  });
  useJobs.setState({ jobs: {}, finished: {}, stops: {} });
  useDesignStore.getState().init(emptyDesign());
  useDesignStore.getState().setMessage(null);
});
afterEach(() => {
  cleanup();
  setWidth(1024, 768);
});

const slot = (name: string) => <div data-slot={name}>{name}</div>;

function shell(over: Partial<ShellProps> = {}) {
  const props: ShellProps = {
    view: 'chart',
    header: <header data-slot="header">header</header>,
    topBar: <header data-slot="topbar">topbar</header>,
    chart: slot('chart'),
    network: slot('network'),
    numbers: slot('numbers'),
    tool: null,
    toolId: null,
    onOpenTool: () => undefined,
    onCloseTool: () => undefined,
    tour: slot('tour'),
    live: 'Zin 50 + j0 Ω',
    status: <footer data-slot="status">status</footer>,
    ...over,
  };
  return <Shell {...props} />;
}

/** Where each slot ended up: the nearest landmark or pane around it. */
function placement(container: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const el of container.querySelectorAll<HTMLElement>('[data-slot]')) {
    const host = el.parentElement?.closest<HTMLElement>('[data-pane], main, aside, .app');
    const where = host?.dataset.pane
      ? `pane:${host.dataset.pane}`
      : host?.tagName === 'MAIN'
        ? 'main'
        : host?.tagName === 'ASIDE'
          ? `aside.${host.className.split(' ')[0]}`
          : 'app';
    out[el.dataset.slot as string] = where;
  }
  return out;
}

describe('breakpoints', () => {
  it('phone below 700, tablet 700 to 1099, desktop 1100 to 1439, wide 1440 and up', () => {
    expect(layoutForWidth(390)).toBe('phone');
    expect(layoutForWidth(699)).toBe('phone');
    expect(layoutForWidth(700)).toBe('tablet');
    expect(layoutForWidth(768)).toBe('tablet');
    expect(layoutForWidth(1099)).toBe('tablet');
    expect(layoutForWidth(1100)).toBe('desktop');
    expect(layoutForWidth(1439)).toBe('desktop');
    expect(layoutForWidth(1440)).toBe('wide');
    expect(layoutForWidth(Number.NaN)).toBe('desktop');
  });

  it('a column shows the panes it has', () => {
    expect(effectivePane('desktop', 'network', false)).toBe('numbers');
    expect(effectivePane('wide', 'tool', false)).toBe('numbers');
    expect(effectivePane('wide', 'tool', true)).toBe('tool');
    expect(effectivePane('tablet', 'tool', false)).toBe('network');
    expect(effectivePane('tablet', 'numbers', true)).toBe('tool');
    expect(effectivePane('tablet', 'numbers', false)).toBe('numbers');
    expect(effectivePane('phone', 'tool', false)).toBe('tool');
  });
});

describe('Shell slot placement', () => {
  it('390 px: top bar, the pinned chart and the main sheet with Network | Numbers | Tools', () => {
    setWidth(390);
    const { container } = render(shell());
    const app = container.querySelector('.app') as HTMLElement;
    expect(app.className).toContain('layout-phone');
    expect(placement(container)).toEqual({
      topbar: 'app',
      chart: 'main',
      network: 'pane:network',
      numbers: 'pane:numbers',
    });
    // No header, status bar or tour narration panel on a phone.
    expect(container.querySelector('[data-slot="header"]')).toBeNull();
    expect(container.querySelector('[data-slot="status"]')).toBeNull();
    expect(container.querySelector('main')?.className).toContain('phone-hero');
    const sheet = screen.getByRole('region', { name: 'Panels' });
    expect(within(sheet).getByRole('tab', { name: 'Tools' })).toBeTruthy();
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('768 px: two columns, the chart and one side column Network | Numbers', () => {
    setWidth(768, 1024);
    const { container } = render(shell());
    expect(container.querySelector('.app')?.className).toContain('layout-tablet');
    expect(placement(container)).toEqual({
      header: 'app',
      chart: 'main',
      tour: 'aside.right',
      network: 'pane:network',
      numbers: 'pane:numbers',
      status: 'app',
    });
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['Network', 'Numbers']);
    expect(container.querySelector('aside.left')).toBeNull();
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('1440 px: three columns, network left, chart, numbers right', () => {
    setWidth(1440, 900);
    const { container } = render(shell());
    expect(container.querySelector('.app')?.className).toContain('layout-wide');
    expect(placement(container)).toEqual({
      header: 'app',
      tour: 'aside.left',
      network: 'aside.left',
      chart: 'main',
      numbers: 'pane:numbers',
      status: 'app',
    });
    // No strip while no tool is open.
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('crossing a breakpoint moves the slots', () => {
    setWidth(1440, 900);
    const { container } = render(shell());
    expect(container.querySelector('aside.left')).not.toBeNull();
    act(() => setWidth(390));
    expect(container.querySelector('aside.left')).toBeNull();
    expect(container.querySelector('.panel-sheet')).not.toBeNull();
  });
});

describe('tool column', () => {
  it('opening a tool keeps the chart container as it was and shows the tool under its head', () => {
    setWidth(1440, 900);
    const { container, rerender } = render(shell());
    const main = container.querySelector('main') as HTMLElement;
    const before = main.className;
    act(() => useShell.getState().toolOpened());
    rerender(shell({ tool: slot('tool'), toolId: 'match' }));
    expect(container.querySelector('main')).toBe(main);
    expect(main.className).toBe(before);
    expect(main.className).not.toContain('with-tool');
    // No strip: the head names the tool and closes it (docs/10 section 5).
    expect(screen.queryAllByRole('tab')).toEqual([]);
    expect(screen.getByRole('heading', { name: 'Auto match' })).toBeTruthy();
    expect(placement(container).tool).toBe('pane:tool');
    // The tool's pane shows, Numbers is hidden but mounted.
    const pane = (name: string) => container.querySelector<HTMLElement>(`[data-pane="${name}"]`);
    expect(pane('tool')?.hidden).toBe(false);
    expect(pane('numbers')?.hidden).toBe(true);
  });

  it('the head carries a close button named after the tool', () => {
    setWidth(1440, 900);
    const onCloseTool = vi.fn();
    useShell.getState().toolOpened();
    render(shell({ tool: slot('tool'), toolId: 'optimize', onCloseTool }));
    const close = screen.getByRole('button', { name: 'Close Optimize band' });
    expect(close.getAttribute('title')).toBe(
      'Close Optimize band; a running search keeps running (Stop ends it)',
    );
    fireEvent.click(close);
    expect(onCloseTool).toHaveBeenCalledOnce();
  });

  it('a tool closed while its job runs shows the job row with Show and Stop', () => {
    setWidth(1440, 900);
    const onOpenTool = vi.fn();
    const stop = vi.fn();
    useShell.setState({ background: ['match'] });
    render(shell({ tool: slot('tool'), toolId: null, onOpenTool }));
    act(() =>
      useJobs
        .getState()
        .report('match', { done: 3, total: 40, label: 'Searching ladder 4 of 40' }, stop),
    );
    const bar = screen.getByRole('progressbar', { name: 'Auto match' });
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
    expect(screen.getByText('Auto match: Searching ladder 4 of 40')).toBeTruthy();
    // Numbers shows; the panel stays mounted but hidden.
    expect(document.querySelector<HTMLElement>('[data-pane="numbers"]')?.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('[data-pane="tool"]')?.hidden).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(stop).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(onOpenTool).toHaveBeenCalledWith('match');
    useShell.setState({ background: [] });
  });

  it('a finished background job leaves its result line for 8 s', () => {
    vi.useFakeTimers();
    try {
      setWidth(1440, 900);
      useShell.setState({ background: ['match'] });
      render(shell({ tool: slot('tool'), toolId: null }));
      act(() => useJobs.getState().finish('match', 'Broadband search done: best VSWR 1.31'));
      expect(screen.getByText('Broadband search done: best VSWR 1.31')).toBeTruthy();
      act(() => vi.advanceTimersByTime(8100));
      expect(screen.queryByText('Broadband search done: best VSWR 1.31')).toBeNull();
    } finally {
      vi.useRealTimers();
      useShell.setState({ background: [] });
      useJobs.setState({ finished: {} });
    }
  });

  it('tablet: the tool head replaces Network | Numbers while a tool is open', () => {
    setWidth(768, 1024);
    useShell.getState().toolOpened();
    const { rerender } = render(shell({ tool: slot('tool'), toolId: 'montecarlo' }));
    expect(screen.queryAllByRole('tab')).toEqual([]);
    expect(screen.getByRole('heading', { name: 'Tolerance' })).toBeTruthy();
    act(() => useShell.getState().toolClosed());
    rerender(shell());
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Network', 'Numbers']);
  });
});

describe('tool column in the application', () => {
  beforeEach(() => {
    useDesignStore.getState().init({
      ...emptyDesign(),
      elements: identify([{ kind: 'C', orientation: 'shunt', value: 4.7e-12 }]),
    });
  });

  it('desktop: Auto match opens in the right column and the chart area keeps its classes', async () => {
    setWidth(1440, 900);
    const { App } = await import('../src/App');
    const user = userEvent.setup();
    const { container } = render(<App />);
    const main = container.querySelector('main') as HTMLElement;
    const before = main.className;
    await user.click(screen.getByRole('button', { name: 'Auto match' }));
    expect(main.className).toBe(before);
    const right = container.querySelector('aside.right') as HTMLElement;
    expect(right.querySelector('.tool-panel')).not.toBeNull();
    expect(main.querySelector('.tool-panel')).toBeNull();
    expect(within(right).getByRole('heading', { name: 'Auto match' })).toBeTruthy();
  });

  it('desktop: a job survives X, puts a dot on its header button, and the button shows it again', async () => {
    setWidth(1440, 900);
    const { App } = await import('../src/App');
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(screen.getByRole('button', { name: 'Optimize band' }));
    act(() =>
      useJobs.getState().report('optimize', { done: 1, total: 8, label: 'Restart 1 of 8' }),
    );
    const button = () => screen.getByRole('button', { name: /^Optimize band/ });
    expect(button().querySelector('.badge-dot')).toBeNull();
    const panel = container.querySelector('[data-tool-panel="optimize"]');
    expect(panel).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Close Optimize band' }));
    // The panel stays mounted (hidden), the job row and the dot say the job runs.
    expect(container.querySelector('[data-tool-panel="optimize"]')).toBe(panel);
    expect(useShell.getState().tool).toBeNull();
    expect(useShell.getState().background).toEqual(['optimize']);
    expect(button().querySelector('.badge-dot')).not.toBeNull();
    expect(screen.getByRole('progressbar', { name: 'Optimize band' })).toBeTruthy();
    // The button of a closed busy tool shows it again.
    await user.click(button());
    expect(useShell.getState().tool).toBe('optimize');
    expect(useShell.getState().background).toEqual([]);
    expect(container.querySelector('[data-tool-panel="optimize"]')).toBe(panel);
    expect(button().querySelector('.badge-dot')).toBeNull();
    // Pressing the open tool's button closes it; without a job its panel goes.
    act(() => useJobs.getState().report('optimize', null));
    await user.click(button());
    expect(useShell.getState().tool).toBeNull();
    expect(container.querySelector('[data-tool-panel="optimize"]')).toBeNull();
  });
});
