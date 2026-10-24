// @vitest-environment jsdom
/**
 * Adversarial: the Slider's undo coalescing against out-of-order pointer
 * sequences, keyboard steps during a drag, undo in the middle of a run,
 * unmount mid-drag, two sliders, and the ladder slider on a zero value, a
 * Realize-snapped and a locked element.
 */
import { complex, evaluateLadder } from '@smithonline/core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ladder } from '../src/components/Ladder';
import { KEY_COALESCE_MS, Slider } from '../src/components/ui/Slider';
import { emptyDesign } from '../src/lib/design';
import { PALETTE } from '../src/lib/elements';
import { effectiveElements } from '../src/lib/realize';
import { useDesignStore } from '../src/store/useDesignStore';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
beforeEach(() => {
  useDesignStore.getState().init(emptyDesign());
});

function LoadSlider({ label = 'Load R' }: { readonly label?: string }) {
  const re = useDesignStore((s) => s.design.load.re);
  const { setLoad, commit } = useDesignStore.getState();
  return (
    <Slider
      min={1}
      max={200}
      step={1}
      value={re}
      ariaLabel={label}
      onChange={(v) => setLoad(complex(v, 0), true)}
      onCommit={commit}
    />
  );
}

const state = () => useDesignStore.getState();
const steps = (): number => state().past.length;
const re = (): number => state().design.load.re;
const slider = (name = 'Load R'): HTMLInputElement =>
  screen.getByRole('slider', { name }) as HTMLInputElement;
const change = (input: HTMLInputElement, v: number): void => {
  fireEvent.change(input, { target: { value: String(v) } });
};

describe('adv Slider: pointer sequences', () => {
  it('pointerup without pointerdown is harmless and the next change is a keyboard step', () => {
    vi.useFakeTimers();
    render(<LoadSlider />);
    fireEvent.pointerUp(window);
    fireEvent.pointerUp(slider());
    change(slider(), 60);
    change(slider(), 61);
    act(() => vi.advanceTimersByTime(KEY_COALESCE_MS + 10));
    change(slider(), 62);
    expect(steps()).toBe(2);
    state().undo();
    expect(re()).toBe(61);
    state().undo();
    expect(re()).toBe(50);
  });

  it('a keyboard step during a drag joins the drag as one step', () => {
    vi.useFakeTimers();
    render(<LoadSlider />);
    const s = slider();
    fireEvent.pointerDown(s);
    change(s, 60);
    fireEvent.keyDown(s, { key: 'ArrowRight' });
    change(s, 61);
    fireEvent.pointerUp(window);
    act(() => vi.advanceTimersByTime(KEY_COALESCE_MS + 10));
    expect(steps()).toBe(1);
    expect(re()).toBe(61);
  });

  it('two pointers down, one up: the whole gesture stays one step', () => {
    vi.useFakeTimers();
    render(<LoadSlider />);
    const s = slider();
    fireEvent.pointerDown(s, { pointerId: 1 });
    fireEvent.pointerDown(s, { pointerId: 2 });
    change(s, 60);
    fireEvent.pointerUp(window, { pointerId: 1 });
    change(s, 70);
    change(s, 80);
    fireEvent.pointerUp(window, { pointerId: 2 });
    act(() => vi.advanceTimersByTime(KEY_COALESCE_MS + 10));
    expect(re()).toBe(80);
    expect(steps()).toBe(1);
  });

  it('pointercancel followed by a late pointerup does not open a second step', () => {
    render(<LoadSlider />);
    const s = slider();
    fireEvent.pointerDown(s);
    change(s, 60);
    fireEvent.pointerCancel(window);
    fireEvent.pointerUp(window);
    expect(steps()).toBe(1);
  });

  it('unmount in the middle of a drag closes the step and a late pointerup does not throw', () => {
    const { unmount } = render(<LoadSlider />);
    const s = slider();
    fireEvent.pointerDown(s);
    change(s, 60);
    change(s, 70);
    unmount();
    expect(() => fireEvent.pointerUp(window)).not.toThrow();
    expect(steps()).toBe(1);
    // The next transient change from anywhere is a new step.
    state().setLoad(complex(80, 0), true);
    expect(steps()).toBe(2);
  });

  it('a drag with no move commits nothing and leaves history alone', () => {
    render(<LoadSlider />);
    fireEvent.pointerDown(slider());
    fireEvent.pointerUp(window);
    expect(steps()).toBe(0);
  });

  it('a disabled slider cannot change the design', () => {
    const { setLoad, commit } = state();
    render(
      <Slider
        min={1}
        max={200}
        value={50}
        disabled
        ariaLabel="D"
        onChange={(v) => setLoad(complex(v, 0), true)}
        onCommit={commit}
      />,
    );
    const s = slider('D');
    expect(s.disabled).toBe(true);
  });
});

describe('adv Slider: history under rapid input', () => {
  it('200 keyboard steps with no pause are one step and undo restores the origin', () => {
    vi.useFakeTimers();
    render(<LoadSlider />);
    const s = slider();
    for (let v = 51; v <= 200; v++) change(s, v);
    for (let v = 199; v >= 150; v--) change(s, v);
    expect(steps()).toBe(1);
    expect(state().future).toHaveLength(0);
    act(() => vi.advanceTimersByTime(KEY_COALESCE_MS + 10));
    expect(steps()).toBe(1);
    state().undo();
    expect(re()).toBe(50);
    state().redo();
    expect(re()).toBe(150);
  });

  it('undo in the middle of a keyboard run: no lost or doubled steps', () => {
    vi.useFakeTimers();
    render(<LoadSlider />);
    const s = slider();
    change(s, 51);
    change(s, 52);
    state().undo();
    expect(re()).toBe(50);
    expect(state().future).toHaveLength(1);
    // Still within 500 ms: another step must start a new entry from 50, not resurrect 52.
    change(s, 53);
    expect(re()).toBe(53);
    expect(steps()).toBe(1);
    expect(state().future).toHaveLength(0);
    act(() => vi.advanceTimersByTime(KEY_COALESCE_MS + 10));
    state().undo();
    expect(re()).toBe(50);
    expect(steps()).toBe(0);
  });

  it('undo in the middle of a drag: the rest of the drag is a fresh step', () => {
    render(<LoadSlider />);
    const s = slider();
    fireEvent.pointerDown(s);
    change(s, 60);
    state().undo();
    expect(re()).toBe(50);
    change(s, 70);
    change(s, 80);
    fireEvent.pointerUp(window);
    expect(steps()).toBe(1);
    state().undo();
    expect(re()).toBe(50);
  });

  it('a non-transient change between keyboard steps separates them correctly', () => {
    vi.useFakeTimers();
    render(<LoadSlider />);
    const s = slider();
    change(s, 51);
    state().setName('x');
    change(s, 52);
    act(() => vi.advanceTimersByTime(KEY_COALESCE_MS + 10));
    expect(steps()).toBe(3);
    state().undo();
    expect(re()).toBe(51);
    expect(state().design.name).toBe('x');
    state().undo();
    expect(state().design.name).not.toBe('x');
    state().undo();
    expect(re()).toBe(50);
  });

  it('two sliders alternating by keyboard within 500 ms: each run is its own step', () => {
    vi.useFakeTimers();
    render(
      <>
        <LoadSlider label="A" />
        <LoadSlider label="B" />
      </>,
    );
    change(slider('A'), 51);
    change(slider('A'), 52);
    change(slider('B'), 60);
    change(slider('A'), 70);
    act(() => vi.advanceTimersByTime(KEY_COALESCE_MS + 10));
    expect(steps()).toBe(3);
    state().undo();
    expect(re()).toBe(60);
    state().undo();
    expect(re()).toBe(52);
    state().undo();
    expect(re()).toBe(50);
  });

  it('no transient design leaks into history during a drag', () => {
    render(<LoadSlider />);
    const s = slider();
    const before = state().design;
    fireEvent.pointerDown(s);
    for (let v = 51; v <= 120; v++) {
      change(s, v);
      expect(steps()).toBe(1);
      expect(state().past[0]).toBe(before);
    }
    fireEvent.pointerUp(window);
    expect(steps()).toBe(1);
  });

  it('a chart drag that starts within 500 ms of a keyboard step does not merge into it', () => {
    // Store-level: the slider keyboard run is still open while another transient source starts.
    vi.useFakeTimers();
    render(<LoadSlider />);
    change(slider(), 51);
    // The pointer going down on the chart takes the focus from the slider, as a browser does;
    // the blur closes the keyboard run. (Corrected in QA round 1: the original sequence had no
    // blur, which no browser produces, and expected the slider to see the chart drag coming.)
    fireEvent.blur(slider());
    // The chart's point drag (SmithChart onDragDatapoint).
    state().setLoad(complex(30, 5), true);
    state().setLoad(complex(31, 5), true);
    act(() => vi.advanceTimersByTime(KEY_COALESCE_MS + 10));
    state().setLoad(complex(32, 5), true);
    state().commit();
    expect(steps()).toBe(2);
    state().undo();
    expect(re()).toBe(51);
  });
});

function LiveLadder() {
  const design = useDesignStore((s) => s.design);
  const result = evaluateLadder({
    z0: design.z0,
    frequency: design.frequency,
    load: design.load,
    elements: effectiveElements(design),
  });
  return <Ladder result={result} realization={null} />;
}

const make = (id: string) => {
  const entry = PALETTE.find((p) => p.id === id);
  if (!entry) throw new Error(id);
  return entry.make(50, 1e9);
};

function stubPointer(coarse: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: coarse && query === '(pointer: coarse)',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

describe('adv ladder slider', () => {
  it('an element whose value is 0 still gets a usable slider (no NaN value)', () => {
    stubPointer(false);
    state().addElements([make('seriesR')]);
    const el = state().design.elements[0]!;
    state().updateElement(0, { ...el, value: 0 } as typeof el);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<LiveLadder />);
    const s = screen.getByRole('slider', { name: /Tune/ }) as HTMLInputElement;
    expect(errors.mock.calls.map((c) => String(c[0])).join('\n')).not.toMatch(/NaN/);
    fireEvent.pointerDown(s);
    change(s, 0.5);
    fireEvent.pointerUp(window);
    const after = state().design.elements[0]!;
    expect('value' in after ? after.value : NaN).toBeGreaterThan(0);
  });

  it('Realize on: one keyboard step on the snapped slider is one undo step with a series value', () => {
    vi.useFakeTimers();
    stubPointer(false);
    state().addElements([make('seriesL')]);
    state().setRealize({ enabled: true });
    const before = steps();
    render(<LiveLadder />);
    const s = screen.getByRole('slider', { name: /Step/ }) as HTMLInputElement;
    const at = Number(s.value);
    change(s, at + 1);
    act(() => vi.advanceTimersByTime(KEY_COALESCE_MS + 10));
    expect(steps()).toBe(before + 1);
    const el = state().design.elements[0]!;
    expect(el.kind).toBe('L');
    expect(s.getAttribute('aria-valuetext')).toMatch(/H$/);
    state().undo();
    expect(steps()).toBe(before);
  });

  it('Realize on, locked element: the continuous slider is shown and a drag is one step', () => {
    stubPointer(false);
    state().addElements([make('seriesL')]);
    state().setRealize({ enabled: true });
    state().toggleLock(0);
    const before = steps();
    render(<LiveLadder />);
    expect(screen.queryByRole('slider', { name: /Step/ })).toBeNull();
    const s = screen.getByRole('slider', { name: /Tune/ }) as HTMLInputElement;
    fireEvent.pointerDown(s);
    change(s, 0.3);
    change(s, 0.6);
    fireEvent.pointerUp(window);
    expect(steps()).toBe(before + 1);
    const el = state().design.elements[0]!;
    expect(el.locked).toBe(true);
  });

  it('Realize toggled on during a drag does not throw and keeps the step count sane', () => {
    stubPointer(false);
    state().addElements([make('seriesL')]);
    render(<LiveLadder />);
    const s = screen.getByRole('slider', { name: /Tune/ }) as HTMLInputElement;
    const before = steps();
    fireEvent.pointerDown(s);
    change(s, 0.3);
    act(() => state().setRealize({ enabled: true }));
    // The continuous slider was replaced by the snapped one; the pointer is still down.
    expect(() => fireEvent.pointerUp(window)).not.toThrow();
    // drag step + realize toggle
    expect(steps()).toBe(before + 2);
  });
});
