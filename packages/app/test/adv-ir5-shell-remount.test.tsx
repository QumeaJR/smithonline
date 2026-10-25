// @vitest-environment jsdom
/**
 * Adversarial: crossing a breakpoint must keep the tool panel, its job, the
 * dialogs and the chart mounted (docs/07 phase 4: "mounted while hidden so a
 * job keeps running").
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Shell, type ShellProps } from '../src/layout/Shell';
import { emptyDesign, identify } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';
import { useJobs, useReportJob } from '../src/store/useJobs';
import { useShell } from '../src/store/useShell';

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

/** A tool panel whose job is cancelled on unmount, as BandOptimizer does. */
function JobTool() {
  useReportJob('optimize', { done: 3, total: 8, label: 'Restart 3 of 8' });
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
    network: <Probe name="network" />,
    numbers: <Probe name="numbers" />,
    tool: <JobTool />,
    toolId: 'optimize',
    onOpenTool: () => undefined,
    onCloseTool: () => undefined,
    status: <footer>status</footer>,
    children: <Probe name="dialog" />,
    ...over,
  };
  return <Shell {...props} />;
}

describe('crossing breakpoints keeps the slots mounted', () => {
  it('desktop 1100 to tablet 1099 and back: tool, chart, numbers and dialog stay', () => {
    setWidth(1100, 900);
    useShell.getState().toolOpened();
    render(shell());
    log.length = 0;
    act(() => setWidth(1099, 900));
    act(() => setWidth(1100, 900));
    expect(log.filter((l) => !l.endsWith('network'))).toEqual([]);
  });

  it('desktop to tablet: the network panel must not remount (ladder and typed state)', () => {
    setWidth(1100, 900);
    render(shell());
    log.length = 0;
    act(() => setWidth(1099, 900));
    expect(log).toEqual([]);
  });

  it('tablet 700 to phone 699 (a rotated phone): tool and job stay', () => {
    setWidth(700, 390);
    useShell.getState().toolOpened();
    render(shell());
    expect(useJobs.getState().jobs.optimize?.done).toBe(3);
    log.length = 0;
    act(() => setWidth(699, 844));
    expect(log).toEqual([]);
  });

  it('tablet 700 to phone 699: an open dialog stays mounted', () => {
    setWidth(700, 390);
    render(shell({ tool: null, toolId: null }));
    log.length = 0;
    act(() => setWidth(699, 844));
    expect(log.filter((l) => l.endsWith('dialog'))).toEqual([]);
  });
});

describe('in the application', () => {
  beforeEach(() => {
    useDesignStore.getState().init({
      ...emptyDesign(),
      elements: identify([{ kind: 'C', orientation: 'shunt', value: 4.7e-12 }]),
    });
  });

  it('Optimize band open at 1024 px, rotate to 600 px: the same panel node survives', async () => {
    setWidth(1024, 700);
    const { App } = await import('../src/App');
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(screen.getByRole('button', { name: 'Optimize band' }));
    const panel = container.querySelector('[data-pane="tool"] > *') as HTMLElement;
    expect(panel).not.toBeNull();
    act(() => setWidth(600, 1024));
    const after = container.querySelector(
      '.pushed-tool > .tool-panel, .pushed-tool > *:last-child',
    );
    expect(container.contains(panel)).toBe(true);
    expect(after).not.toBeNull();
  });
});

describe('a running Optimize band job across a rotation', () => {
  const workers: { terminated: boolean }[] = [];
  beforeEach(() => {
    workers.length = 0;
    vi.stubGlobal(
      'Worker',
      class {
        terminated = false;
        onmessage: unknown = null;
        onerror: unknown = null;
        constructor() {
          workers.push(this);
        }
        postMessage(): void {}
        terminate(): void {
          this.terminated = true;
        }
      },
    );
    useDesignStore.getState().init({
      ...emptyDesign(),
      load: { re: 20, im: -30 },
      elements: identify([
        { kind: 'C', orientation: 'shunt', value: 4.7e-12 },
        { kind: 'L', orientation: 'series', value: 10e-9 },
      ]),
    });
  });

  it('tablet 1024 px, job running, rotate to 600 px: the worker is not terminated', async () => {
    setWidth(1024, 700);
    const { App } = await import('../src/App');
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Optimize band' }));
    await user.click(screen.getByRole('button', { name: 'Optimize' }));
    expect(workers).toHaveLength(1);
    expect(useJobs.getState().jobs.optimize).toBeDefined();
    act(() => setWidth(600, 1024));
    expect(workers[0]?.terminated).toBe(false);
    expect(useJobs.getState().jobs.optimize).toBeDefined();
  });
});
