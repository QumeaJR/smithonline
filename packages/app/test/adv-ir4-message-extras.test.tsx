// @vitest-environment jsdom
/** Adversarial: the Undo and action buttons of the status message. */
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusMessage } from '../src/components/ui/Toast';
import { designFromXmlsc, emptyDesign, identify } from '../src/lib/design';
import { designToXmlsc } from '../src/lib/files';
import { decodeDesign, encodeDesign } from '../src/lib/share';
import { UNDO_MESSAGE_MS, useDesignStore } from '../src/store/useDesignStore';

const parts = () =>
  identify([
    { kind: 'C', orientation: 'shunt', value: 2e-12 },
    { kind: 'L', orientation: 'series', value: 3e-9 },
    { kind: 'C', orientation: 'shunt', value: 2e-12 },
  ]);

beforeEach(() => {
  useDesignStore.getState().init({ ...emptyDesign(), elements: parts() });
  useDesignStore.getState().setMessage(null);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const undoButton = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('.message-undo');
const actionButton = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('.message-action');

describe('Undo button', () => {
  it('is gone after Ctrl+Z undid its step, and after a redo', () => {
    const { container } = render(<StatusMessage fallback="-" />);
    act(() => useDesignStore.getState().removeElement(0));
    expect(undoButton(container)).not.toBeNull();
    act(() => useDesignStore.getState().undo());
    expect(undoButton(container)).toBeNull();
    act(() => useDesignStore.getState().redo());
    expect(undoButton(container)).toBeNull();
  });

  it('expires after UNDO_MESSAGE_MS; a second message with the same text restarts the timer', () => {
    vi.useFakeTimers();
    const { container } = render(<StatusMessage fallback="-" />);
    act(() => useDesignStore.getState().removeElement(0)); // "Removed C 1: ..."
    act(() => vi.advanceTimersByTime(UNDO_MESSAGE_MS - 100));
    // Same part kind at index 0 again: identical text.
    const t1 = useDesignStore.getState().message;
    act(() => useDesignStore.getState().removeElement(1)); // remove the second C so index 0 is L
    act(() => useDesignStore.getState().undo());
    act(() => useDesignStore.getState().removeElement(1));
    expect(useDesignStore.getState().message).toBeTruthy();
    act(() => vi.advanceTimersByTime(UNDO_MESSAGE_MS - 100));
    expect(undoButton(container)).not.toBeNull();
    act(() => vi.advanceTimersByTime(200));
    expect(undoButton(container)).toBeNull();
    void t1;
  });

  it('one click undoes exactly the step the message belongs to', () => {
    const { container } = render(<StatusMessage fallback="-" />);
    act(() => useDesignStore.getState().setName('A'));
    act(() => useDesignStore.getState().removeElement(0));
    const n = useDesignStore.getState().design.elements.length;
    act(() => fireEvent.click(undoButton(container) as HTMLButtonElement));
    expect(useDesignStore.getState().design.elements.length).toBe(n + 1);
    expect(useDesignStore.getState().design.name).toBe('A');
    expect(undoButton(container)).toBeNull();
  });

  it('a refused removal does not get an Undo that would undo an earlier step', () => {
    // An unsound design can only come in through loadDesign; try the file paths.
    const xml = designToXmlsc({ ...emptyDesign(), elements: parts() }).replace(
      /<Frequency>[^<]*/,
      '<Frequency>0',
    );
    let loaded: ReturnType<typeof designFromXmlsc> | null;
    try {
      loaded = designFromXmlsc(xml, 'zero');
    } catch {
      loaded = null;
    }
    const link = encodeDesign({ ...emptyDesign(), elements: parts() });
    const zeroLink = decodeDesign(link.replace(/"frequency":[0-9.e+]+/, '"frequency":0'));
    console.log('xmlsc f=0 ->', loaded?.frequency, '| link f=0 ->', zeroLink?.frequency);
    const d = loaded && !(loaded.frequency > 0) ? loaded : null;
    if (!d) return; // the readers refuse it: nothing to attack here
    act(() => useDesignStore.getState().setName('before'));
    act(() => useDesignStore.getState().loadDesign(d));
    act(() => useDesignStore.getState().removeElement(0));
    const s = useDesignStore.getState();
    expect(s.message).toMatch(/Refused/);
    expect(s.messageExtras?.text === s.message && s.messageExtras.undo).toBe(false);
  });
});

describe('Scale sweep action', () => {
  const offer = () => {
    const store = useDesignStore.getState();
    store.setSweep({ enabled: true, start: 500e6, stop: 2e9 });
    store.setFrequency(2e9);
    store.setMessage('f is now 2 GHz. Scale sweep', {
      action: {
        label: 'Scale sweep',
        run: () => useDesignStore.getState().setSweep({ start: 1e9, stop: 4e9 }),
      },
    });
  };

  it('is withdrawn by Undo', () => {
    const { container } = render(<StatusMessage fallback="-" />);
    act(offer);
    expect(actionButton(container)).not.toBeNull();
    act(() => useDesignStore.getState().undo());
    expect(actionButton(container)).toBeNull();
  });

  it('is withdrawn when the refused-change message replaces it', () => {
    const { container } = render(<StatusMessage fallback="-" />);
    act(offer);
    act(() => useDesignStore.getState().setZ0(0));
    expect(useDesignStore.getState().message).toMatch(/Refused/);
    expect(actionButton(container)).toBeNull();
  });
});
