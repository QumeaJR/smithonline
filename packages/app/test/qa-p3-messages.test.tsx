// @vitest-environment jsdom
/**
 * QA round on redesign phase 3: the store's messageExtras and the buttons
 * StatusMessage and Toast draw from them. Expected behaviour from the user
 * guide section 1 (Undo for 8 seconds; an action button while the message
 * stays; on touch a toast for 4 s, 8 s with a button) and section 10 (Scale
 * sweep scales the range by the factor of the frequency change; any other
 * change to the design withdraws the offer). it.fails marks a finding.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusMessage, Toast, TOAST_MS } from '../src/components/ui/Toast';
import { emptyDesign, identify } from '../src/lib/design';
import { UNDO_MESSAGE_MS, useDesignStore } from '../src/store/useDesignStore';

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
  useDesignStore.getState().init(emptyDesign());
  useDesignStore.getState().setMessage(null);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const store = useDesignStore;
const undoButton = (): HTMLElement | null => screen.queryByRole('button', { name: 'Undo' });

describe('messageExtras in the store', () => {
  it('Undo or an action is kept with the text it was set with', () => {
    const run = vi.fn();
    store.getState().setMessage('Removed Shunt C 1', { undo: true });
    expect(store.getState().messageExtras).toMatchObject({
      text: 'Removed Shunt C 1',
      undo: true,
      action: null,
    });
    store.getState().setMessage('Offer', { action: { label: 'Do it', run } });
    expect(store.getState().messageExtras).toMatchObject({ text: 'Offer', undo: false });
    expect(store.getState().messageExtras?.action?.label).toBe('Do it');
  });

  it('a newer plain message, an empty options object or a null message carry no buttons', () => {
    store.getState().setMessage('Removed DP2', { undo: true });
    store.getState().setMessage('Exported design.svg');
    expect(store.getState().messageExtras).toBeNull();
    store.getState().setMessage('Plain', {});
    expect(store.getState().messageExtras).toBeNull();
    store.getState().setMessage(null, { undo: true });
    expect(store.getState().messageExtras).toBeNull();
  });

  it('the same text again counts as a new message (a new serial)', () => {
    store.getState().setMessage('Same', { undo: true });
    const first = store.getState().messageExtras?.serial ?? 0;
    store.getState().setMessage('Same', { undo: true });
    expect(store.getState().messageExtras?.serial).toBe(first + 1);
  });

  it('a recorded design change clears the buttons with the message', () => {
    store.getState().setMessage('Offer', { action: { label: 'Do it', run: () => undefined } });
    store.getState().setName('Changed');
    expect(store.getState().messageExtras).toBeNull();
  });
});

describe('StatusMessage: Undo for 8 s, replaced by a newer message', () => {
  it('Undo shows until 8000 ms and is gone at 8000 ms', () => {
    vi.useFakeTimers();
    render(<StatusMessage fallback="idle" />);
    act(() => store.getState().setMessage('Removed DP2', { undo: true }));
    act(() => vi.advanceTimersByTime(UNDO_MESSAGE_MS - 1));
    expect(undoButton()).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(undoButton()).toBeNull();
    // The text stays; only the button expires.
    expect(screen.getByRole('status').textContent).toBe('Removed DP2');
  });

  it('a newer message with Undo at 5 s restarts the 8 s; it ends 8 s after the newer one', () => {
    vi.useFakeTimers();
    render(<StatusMessage fallback="idle" />);
    act(() => store.getState().setMessage('Removed DP2', { undo: true }));
    act(() => vi.advanceTimersByTime(5000));
    act(() => store.getState().setMessage('Removed DP3', { undo: true }));
    act(() => vi.advanceTimersByTime(3000));
    expect(undoButton()).not.toBeNull();
    act(() => vi.advanceTimersByTime(4999));
    expect(undoButton()).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(undoButton()).toBeNull();
  });

  it('the same text repeated with Undo restarts the timer too', () => {
    vi.useFakeTimers();
    render(<StatusMessage fallback="idle" />);
    act(() => store.getState().setMessage('Same', { undo: true }));
    act(() => vi.advanceTimersByTime(6000));
    act(() => store.getState().setMessage('Same', { undo: true }));
    act(() => vi.advanceTimersByTime(6000));
    expect(undoButton()).not.toBeNull();
    act(() => vi.advanceTimersByTime(2000));
    expect(undoButton()).toBeNull();
  });

  it('a newer plain message removes Undo at once', () => {
    render(<StatusMessage fallback="idle" />);
    act(() => store.getState().setMessage('Removed DP2', { undo: true }));
    act(() => store.getState().setMessage('Saved design.json'));
    expect(undoButton()).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('an action stays after 8 s while its message stays; Undo beside it expires', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    render(<StatusMessage fallback="idle" />);
    act(() => store.getState().setMessage('Both', { undo: true, action: { label: 'Do it', run } }));
    act(() => vi.advanceTimersByTime(UNDO_MESSAGE_MS));
    expect(undoButton()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Do it' }));
    expect(run).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByRole('button', { name: 'Do it' })).toBeTruthy();
  });

  it('a stale extras record whose text is no longer on show draws no button', () => {
    render(<StatusMessage fallback="idle" />);
    act(() => store.getState().setMessage('Removed DP2', { undo: true }));
    // A path that sets the text alone (as undo and redo do) leaves the old record behind.
    act(() => store.setState({ message: 'Something else' }));
    expect(undoButton()).toBeNull();
  });
});

describe('Toast: 4 s plain, 8 s with a button', () => {
  it('a plain message goes after 4 s', () => {
    vi.useFakeTimers();
    render(<Toast />);
    act(() => store.getState().setMessage('Plain'));
    act(() => vi.advanceTimersByTime(TOAST_MS - 1));
    expect(screen.queryByText('Plain')).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('Plain')).toBeNull();
  });

  it('a message with Undo stays 8 s, a newer one restarts the time', () => {
    vi.useFakeTimers();
    render(<Toast />);
    act(() => store.getState().setMessage('First', { undo: true }));
    act(() => vi.advanceTimersByTime(TOAST_MS + 1));
    expect(screen.queryByText('First')).not.toBeNull();
    act(() => store.getState().setMessage('Second', { undo: true }));
    expect(screen.queryByText('First')).toBeNull();
    act(() => vi.advanceTimersByTime(UNDO_MESSAGE_MS - 1));
    expect(screen.queryByText('Second')).not.toBeNull();
    expect(undoButton()).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByText('Second')).toBeNull();
  });

  it('an action-only message stays 8 s', () => {
    vi.useFakeTimers();
    render(<Toast />);
    act(() =>
      store.getState().setMessage('Offer', { action: { label: 'Do it', run: () => undefined } }),
    );
    act(() => vi.advanceTimersByTime(TOAST_MS + 1));
    expect(screen.getByRole('button', { name: 'Do it' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(UNDO_MESSAGE_MS - TOAST_MS - 1));
    expect(screen.queryByText('Offer')).toBeNull();
  });
});

describe('Scale sweep after the design changed again', () => {
  async function offer() {
    const { App } = await import('../src/App');
    store.getState().init({
      ...emptyDesign(),
      frequency: 450e6,
      elements: identify([{ kind: 'C', orientation: 'shunt', value: 4.7e-12 }]),
      sweep: { enabled: true, start: 300e6, stop: 600e6, points: 31 },
    });
    const user = userEvent.setup();
    render(<App />);
    const f = screen.getByRole('textbox', { name: 'Design frequency' });
    const setF = async (text: string): Promise<void> => {
      await user.clear(f);
      await user.type(f, `${text}{Enter}`);
    };
    await setF('900 MHz');
    expect(screen.getByRole('button', { name: 'Scale sweep' })).toBeTruthy();
    return { user, setF };
  }

  it('an edit to another value withdraws the offer', async () => {
    await offer();
    act(() => store.getState().setLoad({ re: 30, im: 5 }));
    expect(store.getState().messageExtras).toBeNull();
    expect(screen.queryByRole('button', { name: 'Scale sweep' })).toBeNull();
  });

  it('a removal replaces it with Undo; the sweep stays where it was', async () => {
    await offer();
    act(() => store.getState().removeElement(0));
    expect(screen.queryByRole('button', { name: 'Scale sweep' })).toBeNull();
    expect(store.getState().messageExtras).toMatchObject({ undo: true, action: null });
    expect(store.getState().design.sweep).toMatchObject({ start: 300e6, stop: 600e6 });
  });

  it('a second frequency change offers its own factor from the sweep as it is', async () => {
    // 450 -> 900 MHz offers x2; ignored; 900 -> 1.8 GHz offers x2 again of 300..600 MHz.
    const { user, setF } = await offer();
    await setF('1.8 GHz');
    expect(store.getState().message).toMatch(
      /f is now 1\.8 GHz; the sweep still runs 300 MHz to 600 MHz\. Scale sweep makes it 600 MHz to 1\.2 GHz/,
    );
    await user.click(screen.getByRole('button', { name: 'Scale sweep' }));
    expect(store.getState().design.sweep.start).toBeCloseTo(600e6, 0);
    expect(store.getState().design.sweep.stop).toBeCloseTo(1200e6, 0);
  });

  it('Undo of the frequency change withdraws the offer', async () => {
    await offer();
    act(() => store.getState().undo());
    expect(store.getState().design.frequency).toBe(450e6);
    expect(screen.queryByRole('button', { name: 'Scale sweep' })).toBeNull();
  });

  it('the sweep turned off withdraws it', async () => {
    await offer();
    act(() => store.getState().setSweep({ enabled: false }));
    expect(screen.queryByRole('button', { name: 'Scale sweep' })).toBeNull();
  });
});
