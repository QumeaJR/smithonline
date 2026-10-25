// @vitest-environment jsdom
/**
 * Final QA before 0.2.0: the fixes of the last review round that the reviewer tests do not
 * reach. The maskable icon's own artwork, the store's transient run owners, an inverted sweep
 * swapped on commit, the Broadband bar counting what its words count, the S-Plot drop summary
 * and size limit, the phone sheet's job line at peek and the check dot of a finished job, the
 * page error banner, a value typed over a default, the stale cloud's anchor.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { complex } from '@smithonline/core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ValueInput } from '../src/components/ValueInput';
import { ErrorBanner } from '../src/layout/ErrorBanner';
import { PanelSheet } from '../src/layout/PanelSheet';
import { broadbandProgressBar, broadbandProgressText } from '../src/lib/broadband';
import { emptyDesign } from '../src/lib/design';
import { sheetHeights } from '../src/lib/layout';
import { MAX_TABLE_BYTES, openSPlotFiles } from '../src/lib/splotActions';
import { cloudAnchor } from '../src/lib/tolerance';
import { useDesignStore } from '../src/store/useDesignStore';
import { useJobs } from '../src/store/useJobs';
import { useShell } from '../src/store/useShell';
import { useSPlotStore } from '../src/store/useSPlotStore';
import { useTourStore } from '../src/store/useTourStore';

const D = () => useDesignStore.getState();
const pub = join(__dirname, '..', 'public');

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
  useTourStore.getState().close();
  D().init(emptyDesign());
  D().setMessage(null);
  useJobs.setState({ jobs: {}, finished: {} });
});
afterEach(() => cleanup());

/** RGBA pixels of an 8 bit RGBA PNG written with filter 0 rows (scripts/icons.mjs). */
function pixels(name: string): { size: number; at: (i: number, j: number) => number[] } {
  const buf = readFileSync(join(pub, name));
  const size = buf.readUInt32BE(16);
  const idat: Buffer[] = [];
  for (let p = 8; p < buf.length;) {
    const len = buf.readUInt32BE(p);
    if (buf.subarray(p + 4, p + 8).toString('ascii') === 'IDAT') {
      idat.push(buf.subarray(p + 8, p + 8 + len));
    }
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  return {
    size,
    at: (i, j) => {
      const k = j * (size * 4 + 1) + 1 + i * 4;
      return [...raw.subarray(k, k + 4)];
    },
  };
}

describe('the maskable icon', () => {
  const manifest = JSON.parse(readFileSync(join(pub, 'manifest.webmanifest'), 'utf8')) as {
    icons: { src: string; purpose: string }[];
  };

  it('has artwork of its own, not the any icon again', () => {
    const maskable = manifest.icons.find((i) => i.purpose === 'maskable');
    const any = manifest.icons.filter((i) => i.purpose === 'any').map((i) => i.src);
    expect(maskable?.src).toBe('icon-maskable-512.png');
    expect(any).not.toContain(maskable?.src);
  });

  it('keeps the disc with a margin inside the safe zone: canvas beyond 0.34 of the side', () => {
    const { size, at } = pixels('icon-maskable-512.png');
    const canvas = [0xf2, 0xf3, 0xf5, 255].join();
    const c = size / 2;
    let rim = 0;
    for (let j = 0; j < size; j += 2) {
      for (let i = 0; i < size; i += 2) {
        const d = Math.hypot(i + 0.5 - c, j + 0.5 - c);
        if (d > 0.34 * size && at(i, j).join() !== canvas) {
          throw new Error(`pixel ${i},${j} at ${d.toFixed(1)} px is not canvas`);
        }
        if (d < 0.32 * size && d > 0.3 * size && at(i, j).join() !== canvas) rim += 1;
      }
    }
    // The rim is drawn (accent pixels just inside 0.32 of the side).
    expect(rim).toBeGreaterThan(50);
  });
});

describe('transient runs and their owners', () => {
  it('a run ends when its owner goes away: the next transient change is a step of its own', () => {
    const chart = {};
    D().setLoad(complex(30, 0), chart);
    D().setLoad(complex(35, 0), chart);
    expect(D().past).toHaveLength(1);
    D().endRun(chart);
    D().setLoad(complex(40, 0), true);
    expect(D().past).toHaveLength(2);
  });

  it('endRun of another owner leaves the open run alone; a new owner starts a new step', () => {
    const a = {};
    const b = {};
    D().setLoad(complex(30, 0), a);
    D().endRun(b);
    D().setLoad(complex(31, 0), a);
    expect(D().past).toHaveLength(1);
    D().setLoad(complex(32, 0), b);
    expect(D().past).toHaveLength(2);
  });
});

describe('an inverted sweep, one rule everywhere', () => {
  it('a start typed above the stop is swapped on commit and says so', () => {
    D().setSweep({ start: 250e6, stop: 2e9 });
    D().setSweep({ stop: 1e9 });
    D().setSweep({ start: 3e9 });
    expect(D().design.sweep.start).toBe(1e9);
    expect(D().design.sweep.stop).toBe(3e9);
    expect(D().message).toBe('Swapped the sweep to 1 GHz to 3 GHz');
    D().undo();
    expect(D().message).toBe('Undo: Swapped the sweep to 1 GHz to 3 GHz');
  });

  it('a stop typed below the start is swapped the same way', () => {
    D().setSweep({ start: 1e9, stop: 2e9 });
    D().setSweep({ stop: 250e6 });
    expect(D().design.sweep).toMatchObject({ start: 250e6, stop: 1e9 });
    expect(D().message).toBe('Swapped the sweep to 250 MHz to 1 GHz');
  });
});

describe('the Broadband bar counts what its words count', () => {
  it('ladders over the first pass, refinements over the second', () => {
    expect(broadbandProgressText({ done: 11, total: 76 }, 60)).toBe('Searching ladder 12 of 60');
    expect(broadbandProgressBar({ done: 11, total: 76 }, 60)).toEqual({ done: 11, total: 60 });
    expect(broadbandProgressText({ done: 62, total: 76 }, 60)).toBe('Refining the best, 3 of 16');
    expect(broadbandProgressBar({ done: 62, total: 76 }, 60)).toEqual({ done: 2, total: 16 });
    expect(broadbandProgressBar({ done: Number.NaN, total: 10 }, 10)).toEqual({
      done: 0,
      total: 10,
    });
  });
});

describe('S-Plot drops', () => {
  const fixture = (name: string): string =>
    readFileSync(join(__dirname, '..', '..', 'core', 'test', 'fixtures', 'sparams', name), 'utf8');
  beforeEach(() => useSPlotStore.setState({ files: [], activeId: null }));

  it('several good files say how many were added, in one line', async () => {
    const text = fixture('dipole-synthetic.s1p');
    await openSPlotFiles([new File([text], 'a.s1p'), new File([text], 'b.s1p')]);
    expect(D().message).toBe('Added 2 files');
    expect(D().messageError).toBe(false);
  });

  it('two bad files are both named', async () => {
    await openSPlotFiles([new File(['x'], 'one.s2p'), new File(['y'], 'two.s2p')]);
    expect(D().message).toMatch(/^one\.s2p could not be read: .*; two\.s2p could not be read: /);
    expect(D().messageError).toBe(true);
  });

  it('a text file above 20 MB is refused before it is read', async () => {
    const big = new File(['x'], 'log.txt');
    Object.defineProperty(big, 'size', { value: MAX_TABLE_BYTES + 1 });
    const text = vi.fn(() => Promise.resolve('x'));
    Object.defineProperty(big, 'text', { value: text });
    await openSPlotFiles([big]);
    expect(text).not.toHaveBeenCalled();
    expect(D().message).toBe(
      'log.txt is 20.0 MB; a VNA table or EZNEC file above 20.0 MB is not read',
    );
    expect(D().messageError).toBe(true);
  });
});

describe('the phone sheet with a job behind another segment', () => {
  const HEIGHTS = sheetHeights(844, 44 + 390, 44);
  const sheet = () => (
    <PanelSheet
      heights={HEIGHTS}
      network={<div>network pane</div>}
      numbers={<div>numbers pane</div>}
      tool={<div>broadband panel</div>}
      toolId="match"
      onOpenTool={() => useShell.getState().pushTool()}
      onCloseTool={() => undefined}
      live="Zin"
    />
  );
  beforeEach(() => {
    useShell.setState({ pane: 'network', toolPushed: true, detent: 'peek', held: null });
  });

  it('at peek the job line takes the segment row and the bar runs along the top edge', () => {
    render(sheet());
    act(() =>
      useJobs
        .getState()
        .report('match', { done: 11, total: 60, label: 'Searching ladder 12 of 60' }),
    );
    expect(screen.queryByRole('tablist', { name: 'Panels' })).toBeNull();
    const line = screen.getByRole('button', { name: /^Auto match: Searching ladder 12 of 60/ });
    const bar = screen.getByRole('progressbar', { name: 'Auto match' });
    expect(bar.getAttribute('aria-valuenow')).toBe('11');
    expect(bar.getAttribute('aria-valuemax')).toBe('60');
    expect(bar.classList.contains('sheet-job-bar')).toBe(true);
    fireEvent.click(line);
    expect(useShell.getState().detent).toBe('half');
    expect(useShell.getState().pane).toBe('tool');
  });

  it('at half the segments come back with the job line under them', () => {
    useShell.setState({ detent: 'half' });
    render(sheet());
    act(() => useJobs.getState().report('match', { done: 1, total: 4, label: 'Step 2 of 4' }));
    expect(screen.getByRole('tablist', { name: 'Panels' })).toBeTruthy();
    expect(screen.getByText('Auto match: Step 2 of 4')).toBeTruthy();
  });

  it('a job that finished leaves a check dot on Tools until its panel shows', () => {
    useShell.setState({ detent: 'half' });
    render(sheet());
    act(() => useJobs.getState().finish('match', 'Broadband search done'));
    expect(screen.getAllByLabelText('result ready').length).toBeGreaterThan(0);
    act(() => useShell.getState().setPane('tool'));
    expect(useJobs.getState().finished.match).toBeUndefined();
    expect(screen.queryByLabelText('result ready')).toBeNull();
  });
});

describe('the page error banner', () => {
  it('stays until dismissed, and stays dismissed in another view', () => {
    const { unmount } = render(<ErrorBanner place="page" />);
    act(() => D().setMessage('Could not open x.s2p: no data', { error: true }));
    expect(screen.getByRole('alert').textContent).toContain('Could not open x.s2p');
    expect(screen.getByRole('alert').classList.contains('page-error')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss the error' }));
    expect(screen.queryByRole('alert')).toBeNull();
    unmount();
    render(<ErrorBanner place="chart" />);
    expect(screen.queryByRole('alert')).toBeNull();
    act(() => D().setMessage('Saved a.json'));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('a value typed over a default', () => {
  it('commits with commitUnchanged although it reads as the value shown', () => {
    const onCommit = vi.fn();
    render(<ValueInput value={50} unit="Ω" commitUnchanged onCommit={onCommit} ariaLabel="R" />);
    const input = screen.getByRole('textbox', { name: 'R' });
    fireEvent.change(input, { target: { value: '50' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(50);
  });

  it('a tab through the field still commits nothing', () => {
    const onCommit = vi.fn();
    render(<ValueInput value={50} unit="Ω" commitUnchanged onCommit={onCommit} ariaLabel="R" />);
    const input = screen.getByRole('textbox', { name: 'R' });
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('the stale cloud', () => {
  it('is anchored at its top, across at the median', () => {
    // Loads of 25, 50 and 100 ohm at Z0 50: Gamma -1/3, 0, 1/3 on the real axis.
    const flat = cloudAnchor([25, 50, 100], [0, 0, 0], 50);
    expect(flat?.x).toBeCloseTo(0, 12);
    expect(flat?.y).toBeCloseTo(0, 12);
    const a = cloudAnchor([50, 50], [50, -50], 50);
    expect(a?.y).toBeLessThan(0);
    expect(cloudAnchor([], [], 50)).toBeNull();
  });
});
