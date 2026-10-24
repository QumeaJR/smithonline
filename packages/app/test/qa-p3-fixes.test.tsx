// @vitest-environment jsdom
/**
 * The fixes of the phase 3 QA round (redesign phase 3 and the S-Plot network
 * action) that the reviewer tests do not reach: a stable default target,
 * undo labels, the tour message, the coarse-pointer status bar, the S-Plot
 * entry undo, the broadband step count, the overflow sheet title, the ASCII
 * sub-sheet focus, the low sheet detent and the CSS of the status bar, the
 * toast and the S-Plot entry row.
 */
import { broadbandSteps, complex } from '@smithonline/core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useRef, useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Menu } from '../src/components/ui/Menu';
import { OverflowMenu } from '../src/components/ui/OverflowMenu';
import { Popover } from '../src/components/ui/Popover';
import { StatusMessage, Toast } from '../src/components/ui/Toast';
import { emptyDesign, identify, targetOf } from '../src/lib/design';
import { readSPlotFiles } from '../src/lib/splot';
import { useDesignStore } from '../src/store/useDesignStore';
import { RESTORE_ENTRY_MS, useSPlotStore } from '../src/store/useSPlotStore';
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
  useTourStore.getState().close();
  useDesignStore.getState().init(emptyDesign());
  useDesignStore.getState().setMessage(null);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const store = useDesignStore;
const TWO_PORT = '# Hz S RI R 50\n1e9 0.1 0 0.9 0 0.9 0 0.1 0\n2e9 0.2 0 0.8 0 0.8 0 0.2 0\n';

/** Parse a small two-port file and add it to the S-Plot list; returns its id. */
function addTwoPort(name: string): string {
  return useSPlotStore.getState().addFiles(readSPlotFiles(name, TWO_PORT))[0] as string;
}

describe('the default target', () => {
  it('is one object per Z0 across calls, so memoized lists keep their rows', () => {
    const a = targetOf({ target: null, z0: 50 });
    expect(targetOf({ target: null, z0: 50 })).toBe(a);
    expect(a).toEqual(complex(50, 0));
    expect(targetOf({ target: null, z0: 75 })).not.toBe(a);
    const set = complex(20, 5);
    expect(targetOf({ target: set, z0: 50 })).toBe(set);
  });
});

describe('undo labels', () => {
  it('New names its step: "Undo: New design"', () => {
    store.getState().newDesign();
    store.getState().undo();
    expect(store.getState().message).toBe('Undo: New design');
    store.getState().redo();
    expect(store.getState().message).toBe('Redo: New design');
  });

  it('a second palette click adds the part at its default value and says so', async () => {
    const { App } = await import('../src/App');
    const user = userEvent.setup();
    render(<App />);
    const button = screen.getAllByRole('button', { name: 'Series L' })[0] as HTMLElement;
    expect(button.title).toMatch(/: click, then click on the chart/);
    await user.click(button);
    // The armed tooltip keeps the palette label's case.
    expect(button.title).toMatch(/^Click again to add the Series L at its default value/);
    await user.click(button);
    expect(store.getState().design.elements).toHaveLength(1);
    expect(store.getState().message).toMatch(/^Added Series L 1: \S+ nH$/);
    act(() => store.getState().undo());
    expect(store.getState().message).toMatch(/^Undo: Added Series L 1: /);
  });
});

describe('the tour start message', () => {
  it('carries Undo; ending the tour from its panel takes the message away', () => {
    useTourStore.getState().start('l-network');
    const s = store.getState();
    expect(s.message).toMatch(/^Tour: .*Undo brings your previous design back\.$/);
    expect(s.messageExtras?.undo).toBe(true);
    useTourStore.getState().end();
    expect(useTourStore.getState().tour).toBeNull();
    expect(store.getState().message).toBeNull();
  });

  it('a newer message is left alone when the tour ends', () => {
    useTourStore.getState().start('l-network');
    store.getState().setMessage('Something else');
    useTourStore.getState().end();
    expect(store.getState().message).toBe('Something else');
  });
});

describe('status bar on a coarse pointer', () => {
  it('shows the fallback and no buttons while the toast carries the message', () => {
    coarse = true;
    vi.useFakeTimers();
    const { container } = render(
      <>
        <footer className="statusbar">
          <StatusMessage fallback="brand line" />
        </footer>
        <Toast />
      </>,
    );
    act(() => store.getState().setMessage('Removed C 1', { undo: true }));
    const bar = container.querySelector('.statusbar') as HTMLElement;
    expect(bar.textContent).toBe('brand line');
    expect(bar.querySelector('button')).toBeNull();
    expect(container.querySelector('.toast')?.textContent).toMatch(/Removed C 1/);
    expect(container.querySelector('.toast .message-undo')).not.toBeNull();
    // The toast goes after 8 s: the bar shows the last message, still without buttons.
    act(() => vi.advanceTimersByTime(8001));
    expect(container.querySelector('.toast')).toBeNull();
    expect(bar.textContent).toBe('Removed C 1');
    expect(bar.querySelector('button')).toBeNull();
  });
});

describe('S-Plot entry removal', () => {
  it('restores the removed entry where it was within 8 s, not after', () => {
    vi.useFakeTimers();
    const splot = useSPlotStore.getState;
    const before = splot().files.length;
    const a = addTwoPort('restore-a.s2p');
    const b = addTwoPort('restore-b.s2p');
    splot().setActive(a);
    const index = splot().files.findIndex((f) => f.id === a);
    expect(splot().removeFile(a)?.id).toBe(a);
    expect(splot().files.some((f) => f.id === a)).toBe(false);
    expect(splot().restoreRemoved(a)).toBe(true);
    expect(splot().files.findIndex((f) => f.id === a)).toBe(index);
    expect(splot().activeId).toBe(a);
    // Only once, and only within the 8 s.
    expect(splot().restoreRemoved(a)).toBe(false);
    splot().removeFile(b);
    act(() => vi.advanceTimersByTime(RESTORE_ENTRY_MS + 1));
    expect(splot().restoreRemoved(b)).toBe(false);
    expect(splot().files).toHaveLength(before + 1);
    splot().removeFile(a);
  });

  it('from the panel: asks nothing; the message offers Undo, which brings it back', async () => {
    const { FilePanel } = await import('../src/splot/FilePanel');
    const id = addTwoPort('keep.s2p');
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    render(
      <>
        <FilePanel />
        <StatusMessage fallback="-" />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove keep.s2p' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(useSPlotStore.getState().files.some((f) => f.id === id)).toBe(false);
    expect(store.getState().message).toBe('Removed keep.s2p');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(useSPlotStore.getState().files.some((f) => f.id === id)).toBe(true);
    expect(store.getState().message).toBe('Restored keep.s2p');
    useSPlotStore.getState().removeFile(id);
  });
});

describe('broadband progress', () => {
  it('counts the refinement pass from the start: 60 topologies report 76 steps', () => {
    expect(broadbandSteps(60)).toBe(76);
    expect(broadbandSteps(48)).toBe(48);
    expect(broadbandSteps(10)).toBe(10);
  });
});

describe('sheets on a coarse pointer', () => {
  it('the card overflow sheet is titled with the part, the menu keeps its name', async () => {
    coarse = true;
    const user = userEvent.setup();
    render(
      <OverflowMenu
        label="More for element 1"
        title="Shunt L 1, 16.03 nH"
        items={[{ label: 'Delete', onSelect: () => undefined }]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'More for element 1' }));
    expect(screen.getByRole('dialog', { name: 'Shunt L 1, 16.03 nH' })).toBeTruthy();
    expect(screen.getByRole('menu', { name: 'More for element 1' })).toBeTruthy();
  });

  it('Escape in the ASCII sub-sheet gives the focus back to the ASCII row', async () => {
    coarse = true;
    function Host() {
      const [open, setOpen] = useState(false);
      const b = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={b} type="button" onClick={() => setOpen(true)}>
            File
          </button>
          {open && (
            <Menu
              label="File"
              anchor={b}
              onClose={() => setOpen(false)}
              entries={[
                {
                  kind: 'choices',
                  label: 'ASCII',
                  choices: [{ label: 'Datapoints', onSelect: () => undefined }],
                },
              ]}
            />
          )}
        </>
      );
    }
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('button', { name: 'File' }));
    const row = screen.getByRole('menuitem', { name: 'ASCII' });
    expect(row.querySelector('svg.sub-mark')).not.toBeNull();
    expect(row.textContent).not.toContain('›');
    await user.click(row);
    expect(screen.getByRole('dialog', { name: 'ASCII' })).toBeTruthy();
    await user.keyboard('{Escape}');
    await act(async () => new Promise((r) => setTimeout(r, 5)));
    expect(screen.queryByRole('dialog', { name: 'ASCII' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'ASCII' }));
  });

  it('a popover sheet settles at the low detent while low is set', () => {
    coarse = true;
    function Host({ low }: { low: boolean }) {
      return (
        <Popover
          anchor={{ x: 0, y: 0 }}
          onClose={() => undefined}
          title="Match suggestions"
          low={low}
        >
          <button type="button">row</button>
        </Popover>
      );
    }
    const { rerender } = render(<Host low={false} />);
    const sheet = document.querySelector('.sheet') as HTMLElement;
    expect(sheet.classList.contains('low')).toBe(false);
    rerender(<Host low />);
    expect(sheet.classList.contains('low')).toBe(true);
    expect(sheet.style.getPropertyValue('--sheet-low')).toMatch(/^\d+px$/);
    rerender(<Host low={false} />);
    expect(sheet.classList.contains('low')).toBe(false);
  });
});

describe('fields', () => {
  it('the sweep start, stop and points fields have accessible names', async () => {
    store.getState().init({
      ...emptyDesign(),
      sweep: { enabled: true, start: 300e6, stop: 600e6, points: 31 },
      elements: identify([{ kind: 'C', orientation: 'shunt', value: 4.7e-12 }]),
    });
    const { App } = await import('../src/App');
    render(<App />);
    for (const name of ['Sweep start', 'Sweep stop', 'Sweep points']) {
      expect(screen.getByRole('textbox', { name })).toBeTruthy();
    }
  });
});

describe('CSS of the status bar, the toast, the S-Plot entry row and popovers', () => {
  const css = readFileSync(resolve(__dirname, '../src/index.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  /** The declarations of the first top-level rule whose selector is exactly `selector`. */
  const rule = (selector: string): string => {
    const at = css.indexOf(`\n${selector} {`);
    expect(at, selector).toBeGreaterThanOrEqual(0);
    return css.slice(at, css.indexOf('}', at));
  };

  it('the message shrinks with an ellipsis beside its buttons; the readout keeps 160 px', () => {
    const m = rule('.statusbar .status-message');
    expect(m).toMatch(/flex: 1 1 auto/);
    expect(m).toMatch(/min-width: 0/);
    expect(m).toMatch(/max-width: 75%/);
    expect(m).toMatch(/text-overflow: ellipsis/);
    expect(rule('.statusbar.live .status-hover')).toMatch(/min-width: 160px/);
    expect(rule('.message-actions')).toMatch(/flex: none/);
  });

  it('status bar buttons are --control-h-sm high, toast buttons 44 px', () => {
    expect(rule('.statusbar .message-actions .btn')).toMatch(/height: var\(--control-h-sm\)/);
    expect(rule('.toast .btn')).toMatch(/height: 44px/);
  });

  it('the S-Plot entry row wraps and its name truncates', () => {
    const head = rule('.file-head');
    expect(head).toMatch(/flex-wrap: wrap/);
    expect(head).toMatch(/min-width: 0/);
    const name = rule('.file-head .file-name');
    expect(name).toMatch(/min-width: 0/);
    expect(name).toMatch(/text-overflow: ellipsis/);
  });

  it('desktop popovers use the raised surface, as the sheets do', () => {
    expect(rule('.dropdown.popover')).toMatch(/background: var\(--raised\)/);
  });
});
