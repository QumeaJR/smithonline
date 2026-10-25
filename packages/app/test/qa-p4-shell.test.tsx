// @vitest-environment jsdom
/**
 * QA, redesign phase 4: the tool strip when the tool closes with its segment
 * shown or hidden, job badges with no tool open, a job's entry when its panel
 * closes, the sheet hold across a view switch, and slots across the phone and
 * tablet breakpoint (docs/07 section 2.2 and section 7 phase 4: "mounted while
 * hidden so a job keeps running").
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell, type ShellProps } from '../src/layout/Shell';
import { emptyDesign } from '../src/lib/design';
import type { ToolId } from '../src/lib/tools';
import { useDesignStore, type View } from '../src/store/useDesignStore';
import { useJobs, useReportJob } from '../src/store/useJobs';
import { useSheetHold, useShell } from '../src/store/useShell';

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

function setWidth(width: number, height = 844): void {
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('innerHeight', height);
  window.dispatchEvent(new Event('resize'));
}

const log: string[] = [];
function Probe({ name }: { name: string }) {
  useEffect(() => {
    log.push(`mount ${name}`);
    return () => {
      log.push(`unmount ${name}`);
    };
  }, [name]);
  return <div data-probe={name}>{name}</div>;
}

/** A tool panel that reports a running job, as BroadbandMatch and BandOptimizer do. */
function JobTool({ id }: { id: ToolId }) {
  useReportJob(id, { done: 2, total: 8, label: 'Restart 2 of 8' });
  return <Probe name="tool" />;
}

beforeEach(() => {
  log.length = 0;
  useShell.setState({
    pane: 'network',
    paneBefore: 'network',
    toolPushed: false,
    detent: 'half',
    held: null,
  });
  useJobs.setState({ jobs: {} });
  useDesignStore.getState().init(emptyDesign());
});
afterEach(() => {
  cleanup();
  setWidth(1024, 768);
});

function shell(over: Partial<ShellProps> = {}) {
  const props: ShellProps = {
    view: 'chart',
    header: <header>header</header>,
    topBar: <header>topbar</header>,
    chart: <Probe name="chart" />,
    network: <div>network</div>,
    numbers: <div>numbers</div>,
    tool: null,
    toolId: null,
    onOpenTool: () => undefined,
    onCloseTool: () => undefined,
    live: 'Zin',
    status: <footer>status</footer>,
    ...over,
  };
  return <Shell {...props} />;
}

const pane = (name: string) => document.querySelector<HTMLElement>(`[data-pane="${name}"]`);
const tabs = () => screen.queryAllByRole('tab').map((t) => t.textContent);
const selectedTab = () =>
  screen.queryAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')?.textContent;

describe('the tool strip when the tool closes', () => {
  it('desktop, closed on its own segment: the strip goes and Numbers shows', () => {
    setWidth(1440, 900);
    useShell.getState().toolOpened();
    const { rerender } = render(shell({ tool: <div>panel</div>, toolId: 'match' }));
    expect(selectedTab()).toBe('Auto match');
    act(() => useShell.getState().toolClosed());
    rerender(shell());
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(pane('tool')).toBeNull();
    expect(pane('numbers')?.hidden).toBe(false);
  });

  it('desktop, closed while Numbers shows: Numbers stays', () => {
    setWidth(1440, 900);
    useShell.getState().toolOpened();
    const { rerender } = render(shell({ tool: <div>panel</div>, toolId: 'optimize' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Numbers' }));
    act(() => useShell.getState().toolClosed());
    rerender(shell());
    expect(useShell.getState().pane).toBe('numbers');
    expect(pane('numbers')?.hidden).toBe(false);
  });

  it('tablet, opened from Numbers and closed on its segment: back to Numbers, two segments', () => {
    setWidth(768, 1024);
    useShell.setState({ pane: 'numbers' });
    useShell.getState().toolOpened();
    const { rerender } = render(shell({ tool: <div>panel</div>, toolId: 'montecarlo' }));
    expect(tabs()).toEqual(['Network', 'Numbers', 'Tolerance']);
    act(() => useShell.getState().toolClosed());
    rerender(shell());
    expect(tabs()).toEqual(['Network', 'Numbers']);
    expect(selectedTab()).toBe('Numbers');
  });

  it('tablet, closed while Network shows: Network stays', () => {
    setWidth(768, 1024);
    useShell.getState().toolOpened();
    const { rerender } = render(shell({ tool: <div>panel</div>, toolId: 'montecarlo' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Network' }));
    act(() => useShell.getState().toolClosed());
    rerender(shell());
    expect(selectedTab()).toBe('Network');
    expect(pane('network')?.hidden).toBe(false);
  });

  it('phone, closed while pushed: the pane before it shows and nothing is pushed', () => {
    setWidth(390, 844);
    useShell.setState({ pane: 'numbers' });
    useShell.getState().toolOpened();
    const { rerender } = render(shell({ tool: <div>panel</div>, toolId: 'match' }));
    expect(screen.getByRole('button', { name: 'Back to the tools' })).toBeTruthy();
    act(() => useShell.getState().toolClosed());
    rerender(shell());
    expect(useShell.getState().toolPushed).toBe(false);
    expect(selectedTab()).toBe('Numbers');
    expect(screen.queryByRole('button', { name: 'Back to the tools' })).toBeNull();
  });

  it("a job's entry goes when its panel closes: no progress, no badge", () => {
    setWidth(1440, 900);
    useShell.getState().toolOpened();
    const { rerender } = render(shell({ tool: <JobTool id="optimize" />, toolId: 'optimize' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Numbers' }));
    expect(screen.getByRole('progressbar', { name: 'Optimize band' })).toBeTruthy();
    act(() => useShell.getState().toolClosed());
    rerender(shell());
    expect(useJobs.getState().jobs).toEqual({});
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(document.querySelector('.badge-dot')).toBeNull();
  });
});

describe('job badges with no tool open', () => {
  const stray = () =>
    act(() => useJobs.getState().report('match', { done: 1, total: 4, label: 'Searching' }));

  it('desktop: no strip and no progress bar', () => {
    setWidth(1440, 900);
    render(shell());
    stray();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('tablet: Network | Numbers without a dot or a bar', () => {
    setWidth(768, 1024);
    render(shell());
    stray();
    expect(tabs()).toEqual(['Network', 'Numbers']);
    expect(document.querySelector('.tool-strip .badge-dot')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('phone: no bar in the sheet header and no dot on the Tools segment', () => {
    setWidth(390, 844);
    render(shell());
    stray();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Tools' }).querySelector('.badge-dot')).toBeNull();
  });
});

describe('the sheet hold of a mode across a view switch (phone)', () => {
  function Mode({ active }: { active: boolean }) {
    useSheetHold(true, active, 'peek');
    return null;
  }
  function Harness({ view, active }: { view: View; active: boolean }) {
    return (
      <>
        <Mode active={active} />
        {shell({ view })}
      </>
    );
  }

  it('an armed part keeps the sheet at peek after Response and back to the chart', () => {
    setWidth(390, 844);
    const { rerender } = render(<Harness view="chart" active={false} />);
    expect(useShell.getState().detent).toBe('half');
    rerender(<Harness view="chart" active />);
    expect(useShell.getState().detent).toBe('peek');
    rerender(<Harness view="response" active />);
    rerender(<Harness view="chart" active />);
    // Still armed: section 5, the sheet stays at peek until place, cancel or release.
    expect(useShell.getState().detent).toBe('peek');
    rerender(<Harness view="chart" active={false} />);
    expect(useShell.getState().detent).toBe('half');
  });
});

describe('slots across the phone and tablet breakpoint (a phone rotated, a tablet split)', () => {
  it('tablet 700 to phone 699: the tool panel and the chart stay mounted', () => {
    setWidth(700, 390);
    useShell.getState().toolOpened();
    render(shell({ tool: <JobTool id="optimize" />, toolId: 'optimize' }));
    log.length = 0;
    act(() => setWidth(699, 844));
    expect(document.querySelector('.panel-sheet')).not.toBeNull();
    expect(log).toEqual([]);
  });

  it('phone 430 to tablet 932 (iPhone Pro Max to landscape): the tool panel stays mounted', () => {
    setWidth(430, 932);
    useShell.getState().toolOpened();
    render(shell({ tool: <JobTool id="match" />, toolId: 'match' }));
    log.length = 0;
    act(() => setWidth(932, 430));
    expect(document.querySelector('.app')?.className).toContain('layout-tablet');
    expect(log.filter((l) => l.endsWith('tool'))).toEqual([]);
  });
  it('desktop 1100 to tablet 1099: the network panel stays mounted', () => {
    setWidth(1100, 900);
    render(shell({ network: <Probe name="network" /> }));
    log.length = 0;
    act(() => setWidth(1099, 900));
    expect(log.filter((l) => l.endsWith('network'))).toEqual([]);
  });
});
