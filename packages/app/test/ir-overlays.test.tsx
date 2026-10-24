// @vitest-environment jsdom
/**
 * Phase 3 of the interaction redesign: the overlay stack (dialogs, menus,
 * sheets, an armed part, the tour), menu keyboard and typeahead, sheets on a
 * coarse pointer, the dialog drag clamped to the window, tap to preview in a
 * solution list, the message action that replaced window.confirm, Undo in the
 * status bar, and the progress bar.
 */
import { complex, type MatchSolution } from '@smithonline/core';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HelpDialog } from '../src/components/HelpDialog';
import { SettingsDialog } from '../src/components/SettingsDialog';
import { SolutionList } from '../src/components/SolutionList';
import { TourPanel } from '../src/components/TourPanel';
import { Dialog } from '../src/components/ui/Dialog';
import { Menu, type MenuEntry } from '../src/components/ui/Menu';
import { Progress } from '../src/components/ui/Progress';
import { StatusMessage } from '../src/components/ui/Toast';
import { emptyDesign, identify } from '../src/lib/design';
import { layerCount, resetDialogPositions } from '../src/lib/overlay';
import { useDesignStore } from '../src/store/useDesignStore';
import { useHelp } from '../src/store/useHelp';
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
  useDesignStore.getState().init(emptyDesign());
  useDesignStore.getState().setMessage(null);
});

afterEach(() => {
  cleanup();
  act(() => {
    useHelp.getState().closeHelp();
    useTourStore.getState().close();
  });
  coarse = false;
  resetDialogPositions();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const escape = (): void => {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
};

describe('the overlay stack', () => {
  function SettingsWithHelp({ onClose }: { onClose?: () => void }) {
    const [open, setOpen] = useState(false);
    const help = useHelp((s) => s.open);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open settings
        </button>
        {open && (
          <SettingsDialog
            onClose={() => {
              onClose?.();
              setOpen(false);
            }}
          />
        )}
        {help && <HelpDialog onClose={() => useHelp.getState().closeHelp()} />}
      </>
    );
  }

  it('Help over Settings closes in order and the focus returns to each opener', async () => {
    const user = userEvent.setup();
    render(<SettingsWithHelp />);
    const opener = screen.getByRole('button', { name: 'Open settings' });
    await user.click(opener);
    const settings = screen.getByRole('dialog', { name: 'Settings' });
    // The focus moved into the dialog, to its first control after the title bar.
    const first = settings.querySelector('input[type="color"]');
    expect(document.activeElement).toBe(first);
    act(() => useHelp.getState().openHelp());
    expect(screen.getByRole('dialog', { name: 'Help' })).toBeTruthy();
    escape();
    expect(screen.queryByRole('dialog', { name: 'Help' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    expect(document.activeElement).toBe(first);
    escape();
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(layerCount()).toBe(0);
  });

  it('a Try link in Help closes Help and the dialog under it', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<SettingsWithHelp onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Open settings' }));
    act(() => useHelp.getState().openHelp());
    const help = screen.getByRole('dialog', { name: 'Help' });
    const tryLink = help.querySelector<HTMLAnchorElement>('a.try');
    expect(tryLink).not.toBeNull();
    fireEvent.click(tryLink!);
    expect(useHelp.getState().open).toBe(false);
    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Escape closes the tour when nothing else is open', () => {
    render(<TourPanel />);
    act(() => useTourStore.getState().start('l-network'));
    expect(screen.getByRole('region', { name: /Guided tour/ })).toBeTruthy();
    escape();
    expect(useTourStore.getState().tour).toBeNull();
  });

  it('a dialog over the tour takes the Escape first', () => {
    const onClose = vi.fn();
    render(
      <>
        <TourPanel />
        <Dialog title="Over" closeLabel="Close over" onClose={onClose}>
          <button type="button">Inside</button>
        </Dialog>
      </>,
    );
    act(() => useTourStore.getState().start('l-network'));
    escape();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useTourStore.getState().tour).not.toBeNull();
  });

  it('in the app an armed part is cancelled before the tour closes', async () => {
    const { App } = await import('../src/App');
    const user = userEvent.setup();
    render(<App />);
    act(() => useTourStore.getState().start('l-network'));
    const palette = screen.getByRole('toolbar', { name: 'Add element' });
    const seriesL = within(palette).getByRole('button', { name: /Series L/ });
    await user.click(seriesL);
    expect(seriesL.getAttribute('aria-pressed')).toBe('true');
    escape();
    expect(seriesL.getAttribute('aria-pressed')).toBe('false');
    expect(useTourStore.getState().tour).not.toBeNull();
    escape();
    expect(useTourStore.getState().tour).toBeNull();
  });
});

describe('Menu', () => {
  function Harness({ entries }: { entries: readonly MenuEntry[] }) {
    const [open, setOpen] = useState(false);
    const button = useRef<HTMLButtonElement>(null);
    return (
      <>
        <button ref={button} type="button" onClick={() => setOpen(!open)}>
          File
        </button>
        {open && (
          <Menu label="File" anchor={button} entries={entries} onClose={() => setOpen(false)} />
        )}
      </>
    );
  }
  const make = (onSelect = vi.fn()): MenuEntry[] => [
    { kind: 'section', label: 'Design' },
    { label: 'New', hint: 'Ctrl+N', description: 'Empty network', onSelect },
    { label: 'Open', onSelect },
    { label: 'Save', disabled: true, onSelect },
    { kind: 'note', content: 'Exports below' },
    { label: 'Export', onSelect },
    { label: 'Netlist', onSelect },
  ];
  const focused = (): string => document.activeElement?.querySelector('.label')?.textContent ?? '';

  it('opens as a placed popover on the first item; Up, Down, Home and End skip disabled items', async () => {
    const user = userEvent.setup();
    render(<Harness entries={make()} />);
    await user.click(screen.getByRole('button', { name: 'File' }));
    const menu = screen.getByRole('menu', { name: 'File' });
    expect(menu.closest('.popover')?.hasAttribute('data-placed')).toBe(true);
    expect(focused()).toBe('New');
    await user.keyboard('{ArrowDown}');
    expect(focused()).toBe('Open');
    await user.keyboard('{ArrowDown}');
    expect(focused()).toBe('Export');
    await user.keyboard('{End}');
    expect(focused()).toBe('Netlist');
    await user.keyboard('{ArrowDown}');
    expect(focused()).toBe('New');
    await user.keyboard('{ArrowUp}');
    expect(focused()).toBe('Netlist');
    await user.keyboard('{Home}');
    expect(focused()).toBe('New');
  });

  it('typeahead moves to the next item starting with the letter, and wraps', async () => {
    const user = userEvent.setup();
    render(<Harness entries={make()} />);
    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.keyboard('n');
    expect(focused()).toBe('Netlist');
    await user.keyboard('n');
    expect(focused()).toBe('New');
    await user.keyboard('E');
    expect(focused()).toBe('Export');
    // No item starts with x: the focus stays.
    await user.keyboard('x');
    expect(focused()).toBe('Export');
  });

  it('Enter acts once, closes the menu and returns the focus to the button; Escape too', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Harness entries={make(onSelect)} />);
    const button = screen.getByRole('button', { name: 'File' });
    await user.click(button);
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
    await user.click(button);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('on a coarse pointer it is a sheet with a grabber, title, rows with descriptions; Escape closes', async () => {
    coarse = true;
    const user = userEvent.setup();
    render(<Harness entries={make()} />);
    await user.click(screen.getByRole('button', { name: 'File' }));
    const sheet = screen.getByRole('dialog', { name: 'File' });
    expect(sheet.classList.contains('sheet')).toBe(true);
    expect(sheet.querySelector('.sheet-grabber')).not.toBeNull();
    expect(within(sheet).getByRole('menu', { name: 'File' })).toBeTruthy();
    expect(within(sheet).getByText('Empty network')).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Close File' })).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('on a coarse pointer a row of choices opens a sub-sheet; a choice closes both and acts', async () => {
    coarse = true;
    const pick = vi.fn();
    const user = userEvent.setup();
    render(
      <Harness
        entries={[
          {
            kind: 'choices',
            label: 'Datapoints (ASCII)',
            description: 'Choose the delimiter',
            choices: [
              { label: 'comma', onSelect: () => pick('comma') },
              { label: 'spaces', onSelect: () => pick('spaces') },
            ],
          },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: /Datapoints \(ASCII\)/ }));
    const sub = screen.getByRole('dialog', { name: 'Datapoints (ASCII)' });
    // Escape closes the sub-sheet only.
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Datapoints (ASCII)' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'File' })).toBeTruthy();
    expect(sub.isConnected).toBe(false);
    await user.click(screen.getByRole('menuitem', { name: /Datapoints \(ASCII\)/ }));
    await user.click(screen.getByRole('menuitem', { name: 'spaces' }));
    expect(pick).toHaveBeenCalledWith('spaces');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Dialog drag', () => {
  beforeEach(() => {
    // jsdom has no layout: the dialog sits at 500, 96 (400 x 300) plus its drag offset.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(this.style.transform);
      const x = m ? Number(m[1]) : 0;
      const y = m ? Number(m[2]) : 0;
      return {
        left: 500 + x,
        top: 96 + y,
        width: 400,
        height: 300,
        right: 900 + x,
        bottom: 396 + y,
        x: 500 + x,
        y: 96 + y,
        toJSON: () => ({}),
      } as DOMRect;
    });
  });

  const drag = (head: Element, to: { x: number; y: number }): void => {
    fireEvent.pointerDown(head, { clientX: 600, clientY: 110, button: 0, pointerId: 1 });
    fireEvent.pointerMove(head, { clientX: to.x, clientY: to.y, pointerId: 1 });
    fireEvent.pointerUp(head, { clientX: to.x, clientY: to.y, pointerId: 1 });
  };

  it('moves by its title bar, clamped to the window, and reopens where it was left', () => {
    const { unmount } = render(
      <Dialog title="Dimensions" closeLabel="Close" draggable="test" onClose={() => undefined}>
        <p>body</p>
      </Dialog>,
    );
    const modal = screen.getByRole('dialog', { name: 'Dimensions' });
    expect(modal.classList.contains('draggable')).toBe(true);
    const head = modal.querySelector('.tool-head')!;
    drag(head, { x: 650, y: 150 });
    expect(modal.style.transform).toBe('translate(50px, 40px)');
    // Far past the bottom right corner of the 1024 x 768 window: 8 px inside it.
    drag(head, { x: 9000, y: 9000 });
    expect(modal.style.transform).toBe(`translate(${1024 - 8 - 900}px, ${768 - 8 - 396}px)`);
    unmount();
    render(
      <Dialog title="Again" closeLabel="Close" draggable="test" onClose={() => undefined}>
        <p>body</p>
      </Dialog>,
    );
    expect(screen.getByRole('dialog', { name: 'Again' }).style.transform).toBe(
      `translate(${1024 - 8 - 900}px, ${768 - 8 - 396}px)`,
    );
  });

  it('a press on the close button does not start a drag; Settings is not draggable', () => {
    render(<SettingsDialog onClose={() => undefined} />);
    const modal = screen.getByRole('dialog', { name: 'Settings' });
    expect(modal.classList.contains('draggable')).toBe(false);
    drag(modal.querySelector('.tool-head')!, { x: 900, y: 500 });
    expect(modal.style.transform).toBe('');
  });

  it('on a coarse pointer a dialog is a full-screen sheet with a centred title and Done', () => {
    coarse = true;
    const onClose = vi.fn();
    render(
      <Dialog title="Report" closeLabel="Close report" draggable="r" onClose={onClose}>
        <p>body</p>
      </Dialog>,
    );
    const modal = screen.getByRole('dialog', { name: 'Report' });
    expect(modal.classList.contains('sheet-full')).toBe(true);
    expect(modal.classList.contains('draggable')).toBe(false);
    const done = within(modal).getByRole('button', { name: 'Done' });
    expect(document.activeElement).toBe(done);
    fireEvent.click(done);
    expect(onClose).toHaveBeenCalled();
  });
});

describe('SolutionList', () => {
  const sol = (value: number, q: number): MatchSolution => ({
    elements: [{ kind: 'L', orientation: 'series', value }],
    q,
    result: complex(50, 0),
    description: `L ${value}`,
  });
  const solutions = [sol(10e-9, 1.2), sol(22e-9, 2.5)];

  it('coarse pointer: a tap previews and selects, Add appears on that row and adds it', async () => {
    coarse = true;
    const onPreview = vi.fn();
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(
      <SolutionList solutions={solutions} empty="none" onPreview={onPreview} onApply={onApply} />,
    );
    const rows = screen.getAllByRole('listitem');
    expect(screen.queryByRole('button', { name: /^Add/ })).toBeNull();
    const first = within(rows[0]!).getAllByRole('button')[0]!;
    await user.click(first);
    expect(onPreview).toHaveBeenLastCalledWith(solutions[0]);
    expect(first.getAttribute('aria-pressed')).toBe('true');
    expect(onApply).not.toHaveBeenCalled();
    const add = within(rows[0]!).getByRole('button', { name: /^Add/ });
    await user.click(add);
    expect(onApply).toHaveBeenCalledWith(solutions[0]);
  });

  it('coarse pointer: a second tap on the selected row adds it; a tap on another moves the selection', async () => {
    coarse = true;
    const onPreview = vi.fn();
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(
      <SolutionList solutions={solutions} empty="none" onPreview={onPreview} onApply={onApply} />,
    );
    const pick = (i: number): HTMLElement =>
      within(screen.getAllByRole('listitem')[i]!).getAllByRole('button')[0]!;
    await user.click(pick(0));
    await user.click(pick(1));
    expect(onPreview).toHaveBeenLastCalledWith(solutions[1]);
    expect(pick(0).getAttribute('aria-pressed')).toBe('false');
    expect(onApply).not.toHaveBeenCalled();
    await user.click(pick(1));
    expect(onApply).toHaveBeenCalledWith(solutions[1]);
  });

  it('fine pointer: hover previews, a click applies', async () => {
    const onPreview = vi.fn();
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(
      <SolutionList solutions={solutions} empty="none" onPreview={onPreview} onApply={onApply} />,
    );
    const items = screen.getAllByRole('menuitem');
    await user.hover(items[1]!);
    expect(onPreview).toHaveBeenLastCalledWith(solutions[1]);
    await user.click(items[1]!);
    expect(onApply).toHaveBeenCalledWith(solutions[1]);
  });
});

describe('status messages', () => {
  it('a frequency change with the sweep on offers Scale sweep instead of window.confirm', async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    const { App } = await import('../src/App');
    useDesignStore.getState().init({
      ...emptyDesign(),
      frequency: 450e6,
      sweep: { enabled: true, start: 300e6, stop: 600e6, points: 31 },
    });
    const user = userEvent.setup();
    render(<App />);
    const f = screen.getByRole('textbox', { name: 'Design frequency' });
    await user.clear(f);
    await user.type(f, '900 MHz{Enter}');
    expect(useDesignStore.getState().design.frequency).toBe(900e6);
    expect(confirm).not.toHaveBeenCalled();
    expect(useDesignStore.getState().message).toMatch(/Scale sweep makes it 600 MHz to 1\.2 GHz/);
    await user.click(screen.getByRole('button', { name: 'Scale sweep' }));
    const { start, stop } = useDesignStore.getState().design.sweep;
    expect(start).toBeCloseTo(600e6, 0);
    expect(stop).toBeCloseTo(1200e6, 0);
    expect(useDesignStore.getState().message).toMatch(/^Sweep scaled with f/);
    expect(screen.queryByRole('button', { name: 'Scale sweep' })).toBeNull();
  });

  it('a removal shows Undo for 8 s; Undo brings the part back', () => {
    vi.useFakeTimers();
    useDesignStore.getState().init({
      ...emptyDesign(),
      elements: identify([{ kind: 'C', orientation: 'shunt', value: 4.7e-12 }]),
    });
    render(<StatusMessage fallback="idle" />);
    act(() => useDesignStore.getState().removeElement(0));
    expect(screen.getByRole('status').textContent).toMatch(/^Removed Shunt C 1: 4\.7 pF/);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(useDesignStore.getState().design.elements).toHaveLength(1);
    expect(useDesignStore.getState().message).toMatch(/^Undo: Removed Shunt C 1/);
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    act(() => useDesignStore.getState().removeElement(0));
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(8000));
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/^Removed/);
  });

  it('New and a plain message: Undo with New, nothing with setMessage(text)', () => {
    render(<StatusMessage fallback="idle" />);
    act(() => useDesignStore.getState().newDesign());
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
    act(() => useDesignStore.getState().setMessage('Exported design.svg'));
    expect(screen.getByRole('status').textContent).toBe('Exported design.svg');
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('Progress', () => {
  it('total 0: an indeterminate bar with its label', () => {
    render(<Progress done={0} total={0} ariaLabel="Optimizer" label="Starting" />);
    const bar = screen.getByRole('progressbar', { name: 'Optimizer' });
    expect(bar.classList.contains('indeterminate')).toBe(true);
    expect(bar.hasAttribute('aria-valuenow')).toBe(false);
    expect(screen.getByText('Starting')).toBeTruthy();
  });

  it('a known total: a determinate bar filled to done of total', () => {
    render(<Progress done={3} total={10} ariaLabel="Search" label="3 of 10" />);
    const bar = screen.getByRole('progressbar', { name: 'Search' });
    expect(bar.classList.contains('indeterminate')).toBe(false);
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
    expect(bar.getAttribute('aria-valuemax')).toBe('10');
    expect(bar.querySelector<HTMLElement>('.progress-fill')!.style.width).toBe('30%');
  });
});
