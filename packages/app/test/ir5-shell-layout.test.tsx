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
    detent: 'half',
    held: null,
  });
  useJobs.setState({ jobs: {} });
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
    expect(effectivePane('tablet', 'numbers', true)).toBe('numbers');
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
  it('opening a tool keeps the chart container as it was and shows Numbers | tool', () => {
    setWidth(1440, 900);
    const { container, rerender } = render(shell());
    const main = container.querySelector('main') as HTMLElement;
    const before = main.className;
    act(() => useShell.getState().toolOpened());
    rerender(shell({ tool: slot('tool'), toolId: 'match' }));
    expect(container.querySelector('main')).toBe(main);
    expect(main.className).toBe(before);
    expect(main.className).not.toContain('with-tool');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Numbers', 'Auto match']);
    expect(placement(container).tool).toBe('pane:tool');
    // The tool's pane shows, Numbers is hidden but mounted.
    const pane = (name: string) => container.querySelector<HTMLElement>(`[data-pane="${name}"]`);
    expect(pane('tool')?.hidden).toBe(false);
    expect(pane('numbers')?.hidden).toBe(true);
    fireEvent.click(screen.getByRole('tab', { name: 'Numbers' }));
    expect(pane('tool')?.hidden).toBe(true);
    expect(pane('numbers')?.hidden).toBe(false);
    fireEvent.click(screen.getByRole('tab', { name: 'Auto match' }));
    expect(pane('tool')?.hidden).toBe(false);
  });

  it('the strip carries a close button named after the tool', () => {
    setWidth(1440, 900);
    const onCloseTool = vi.fn();
    useShell.getState().toolOpened();
    render(shell({ tool: slot('tool'), toolId: 'optimize', onCloseTool }));
    fireEvent.click(screen.getByRole('button', { name: 'Close Optimize band' }));
    expect(onCloseTool).toHaveBeenCalledOnce();
  });

  it('a running job keeps its progress in the strip while Numbers shows', () => {
    setWidth(1440, 900);
    useShell.getState().toolOpened();
    render(shell({ tool: slot('tool'), toolId: 'match' }));
    act(() =>
      useJobs.getState().report('match', { done: 3, total: 40, label: 'Searching ladder 4 of 40' }),
    );
    // On its own segment the panel shows its progress itself.
    expect(screen.queryByRole('progressbar')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Numbers' }));
    const bar = screen.getByRole('progressbar', { name: 'Auto match' });
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
    expect(screen.getByText('Searching ladder 4 of 40')).toBeTruthy();
    expect(
      screen.getByRole('tab', { name: 'Auto match' }).querySelector('.badge-dot'),
    ).not.toBeNull();
  });

  it('tablet: the tool is a third segment of the side column', () => {
    setWidth(768, 1024);
    useShell.getState().toolOpened();
    render(shell({ tool: slot('tool'), toolId: 'montecarlo' }));
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Network',
      'Numbers',
      'Tolerance',
    ]);
    expect(screen.getByRole('tab', { name: 'Tolerance' }).getAttribute('aria-selected')).toBe(
      'true',
    );
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
    expect(within(right).getByRole('tab', { name: 'Auto match' })).toBeTruthy();
  });

  it('desktop: a running job behind Numbers puts a dot on its header button', async () => {
    setWidth(1440, 900);
    const { App } = await import('../src/App');
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Optimize band' }));
    act(() =>
      useJobs.getState().report('optimize', { done: 1, total: 8, label: 'Restart 1 of 8' }),
    );
    const button = () => screen.getByRole('button', { name: /^Optimize band/ });
    expect(button().querySelector('.badge-dot')).toBeNull();
    await user.click(screen.getByRole('tab', { name: 'Numbers' }));
    expect(button().querySelector('.badge-dot')).not.toBeNull();
    // The button brings the tool's segment back instead of closing it.
    await user.click(button());
    expect(screen.getByRole('tab', { name: 'Optimize band' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(button().querySelector('.badge-dot')).toBeNull();
  });
});
