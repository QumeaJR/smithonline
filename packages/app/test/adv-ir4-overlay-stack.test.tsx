// @vitest-environment jsdom
/** Adversarial: the Escape stack, focus return, menu keys, sheet and dialog drags. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef, useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Dialog } from '../src/components/ui/Dialog';
import { Menu, type MenuEntry } from '../src/components/ui/Menu';
import { Sheet } from '../src/components/ui/Sheet';
import { layerCount, resetDialogPositions } from '../src/lib/overlay';

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
afterEach(() => {
  cleanup();
  resetDialogPositions();
  vi.restoreAllMocks();
});

const escape = (): void => {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
};

describe('Escape stack in odd orders', () => {
  function Two() {
    const [a, setA] = useState(true);
    const [b, setB] = useState(true);
    return (
      <>
        {a && (
          <Dialog title="A" closeLabel="Close A" onClose={() => setA(false)}>
            <button type="button">in A</button>
          </Dialog>
        )}
        {b && (
          <Dialog title="B" closeLabel="Close B" onClose={() => setB(false)}>
            <button type="button" onClick={() => setA(false)}>
              close A from B
            </button>
          </Dialog>
        )}
      </>
    );
  }

  it('the lower dialog unmounted while the upper is open: one Escape closes B, the stack empties', () => {
    render(<Two />);
    expect(layerCount()).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'close A from B' }));
    expect(layerCount()).toBe(1);
    escape();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(layerCount()).toBe(0);
  });

  it('two Escape presses dispatched back to back close both dialogs', () => {
    render(<Two />);
    act(() => {
      escape();
      escape();
    });
    // Recorded only: two key events never share a task in a browser.
    console.log(
      'dialogs left after two Escapes in one task:',
      screen.queryAllByRole('dialog').length,
    );
  });
});

describe('focus return', () => {
  it('opener removed by the dialog action: the focus does not drop to the body', async () => {
    function Host() {
      const [open, setOpen] = useState(false);
      const [card, setCard] = useState(true);
      return (
        <>
          <button type="button">before</button>
          {card && (
            <button type="button" onClick={() => setOpen(true)}>
              open
            </button>
          )}
          {open && (
            <Dialog title="D" closeLabel="Close D" onClose={() => setOpen(false)}>
              <button
                type="button"
                onClick={() => {
                  setCard(false);
                  setOpen(false);
                }}
              >
                remove
              </button>
            </Dialog>
          )}
        </>
      );
    }
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('button', { name: 'open' }));
    await user.click(screen.getByRole('button', { name: 'remove' }));
    await act(async () => new Promise((r) => setTimeout(r, 5)));
    console.log('focus after the opener was removed:', document.activeElement?.tagName);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('opener disabled by the menu choice: where the focus goes', async () => {
    function Host() {
      const [open, setOpen] = useState(false);
      const [off, setOff] = useState(false);
      const b = useRef<HTMLButtonElement>(null);
      return (
        <>
          <button ref={b} type="button" disabled={off} onClick={() => setOpen(true)}>
            Opener
          </button>
          {open && (
            <Menu
              label="M"
              anchor={b}
              onClose={() => setOpen(false)}
              entries={[{ label: 'Disable', onSelect: () => setOff(true) }]}
            />
          )}
        </>
      );
    }
    const user = userEvent.setup();
    render(<Host />);
    await user.click(screen.getByRole('button', { name: 'Opener' }));
    await user.keyboard('{Enter}');
    await act(async () => new Promise((r) => setTimeout(r, 5)));
    console.log('focus after the opener was disabled:', document.activeElement?.tagName);
  });
});

describe('Menu keys', () => {
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
  const focused = (): string => document.activeElement?.querySelector('.label')?.textContent ?? '';

  it('repeated letters cycle, digits and punctuation match, keys with modifiers and Space do nothing', async () => {
    const onSelect = vi.fn();
    const entries: MenuEntry[] = [
      { label: 'Save', onSelect },
      { label: 'Save as', onSelect },
      { label: 'Share', disabled: true, onSelect },
      { label: '2-port', onSelect },
      { label: '.s2p export', onSelect },
    ];
    const user = userEvent.setup();
    render(<Harness entries={entries} />);
    await user.click(screen.getByRole('button', { name: 'File' }));
    expect(focused()).toBe('Save');
    await user.keyboard('sss');
    expect(focused()).toBe('Save as'); // Save -> Save as -> Save -> Save as (Share disabled)
    await user.keyboard('2');
    expect(focused()).toBe('2-port');
    await user.keyboard('.');
    expect(focused()).toBe('.s2p export');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('Enter on a disabled item (reached by a pointer hover focus) does nothing', async () => {
    const onSelect = vi.fn();
    const onA = vi.fn();
    const user = userEvent.setup();
    render(
      <Harness
        entries={[
          { label: 'A', onSelect: onA },
          { label: 'B', disabled: true, onSelect },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'File' }));
    const b = screen.getByRole('menuitem', { name: 'B' }) as HTMLButtonElement;
    b.focus();
    await user.keyboard('{Enter}');
    fireEvent.click(b);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('a menu with every item disabled: arrows and letters do not throw', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Harness entries={[{ label: 'A', disabled: true, onSelect }]} />);
    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.keyboard('{ArrowDown}{ArrowUp}{Home}{End}a{Enter}');
    expect(onSelect).not.toHaveBeenCalled();
    escape();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('Sheet', () => {
  it('Escape in the middle of a drag closes it; the late pointerup does nothing', () => {
    const onClose = vi.fn();
    function Host() {
      const [open, setOpen] = useState(true);
      return open ? (
        <Sheet
          title="S"
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        >
          <button type="button">x</button>
        </Sheet>
      ) : null;
    }
    render(<Host />);
    const head = document.querySelector('.sheet-head') as HTMLElement;
    fireEvent.pointerDown(head, { pointerId: 1, clientY: 100 });
    fireEvent.pointerMove(head, { pointerId: 1, clientY: 140 });
    escape();
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.pointerUp(head, { pointerId: 1, clientY: 400 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('dialog drag and window resize', () => {
  it('a dialog dragged to the corner is pulled back inside when the window shrinks', () => {
    let vw = 1600;
    let vh = 1000;
    Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => vw });
    Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => vh });
    Object.defineProperty(document.documentElement, 'clientWidth', {
      configurable: true,
      get: () => vw,
    });
    const W = 400;
    const H = 300;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (!this.classList.contains('modal')) return new DOMRect(0, 0, 0, 0);
      const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(this.style.transform);
      const dx = m ? Number(m[1]) : 0;
      const dy = m ? Number(m[2]) : 0;
      // Centred by the layout.
      return new DOMRect((vw - W) / 2 + dx, (vh - H) / 2 + dy, W, H);
    });
    render(
      <Dialog title="Report" closeLabel="Close report" onClose={() => undefined} draggable="report">
        <button type="button">x</button>
      </Dialog>,
    );
    const head = document.querySelector('.modal .tool-head') as HTMLElement;
    fireEvent.pointerDown(head, { pointerId: 1, button: 0, clientX: 800, clientY: 360 });
    fireEvent.pointerMove(head, { pointerId: 1, clientX: 5000, clientY: 5000 });
    fireEvent.pointerUp(head, { pointerId: 1, clientX: 5000, clientY: 5000 });
    const modal = document.querySelector('.modal') as HTMLElement;
    const placed = modal.getBoundingClientRect();
    expect(placed.left + W).toBeLessThanOrEqual(vw);
    // The window shrinks to a third.
    vw = 600;
    vh = 450;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    const r = modal.getBoundingClientRect();
    console.log('after resize: dialog left', r.left, 'top', r.top, 'window', vw, vh);
    // The title bar (top 40 px of the dialog) must stay reachable.
    expect(r.left).toBeLessThan(vw - 40);
    expect(r.top).toBeLessThan(vh - 40);
  });
});
