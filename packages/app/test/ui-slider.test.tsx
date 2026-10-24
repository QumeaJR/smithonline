// @vitest-environment jsdom
/**
 * Slider: every move is a transient change, the run closes as one undo step
 * per drag, and keyboard steps that follow each other within 500 ms make one
 * step. Wired to the store the way the ladder cards wire it.
 */
import { complex } from '@smithonline/core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEY_COALESCE_MS, Slider } from '../src/components/ui/Slider';
import { emptyDesign } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => {
  useDesignStore.getState().init(emptyDesign());
});

/** A slider on the load resistance: transient changes, commit closes the run. */
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

const steps = (): number => useDesignStore.getState().past.length;
const slider = (name = 'Load R'): HTMLInputElement =>
  screen.getByRole('slider', { name }) as HTMLInputElement;

function drag(input: HTMLInputElement, values: readonly number[]): void {
  fireEvent.pointerDown(input);
  for (const v of values) fireEvent.change(input, { target: { value: String(v) } });
  fireEvent.pointerUp(window);
}

describe('Slider', () => {
  it('renders a range input with the knob at the value', () => {
    render(<LoadSlider />);
    expect(slider().type).toBe('range');
    expect(slider().value).toBe('50');
  });

  it('one drag is one undo step, however many moves it makes', () => {
    render(<LoadSlider />);
    drag(slider(), [60, 70, 80, 90]);
    expect(useDesignStore.getState().design.load.re).toBe(90);
    expect(steps()).toBe(1);
    drag(slider(), [100, 110]);
    expect(steps()).toBe(2);
    useDesignStore.getState().undo();
    expect(useDesignStore.getState().design.load.re).toBe(90);
    useDesignStore.getState().undo();
    expect(useDesignStore.getState().design.load.re).toBe(50);
  });

  it('the change event the browser fires after the release adds no second step', () => {
    render(<LoadSlider />);
    const input = slider();
    fireEvent.pointerDown(input);
    fireEvent.change(input, { target: { value: '60' } });
    fireEvent.change(input, { target: { value: '70' } });
    fireEvent.pointerUp(window);
    // The native change after pointerup repeats the released value.
    fireEvent.change(input, { target: { value: '70' } });
    expect(steps()).toBe(1);
    useDesignStore.getState().undo();
    expect(useDesignStore.getState().design.load.re).toBe(50);
  });

  it('a click on the track without a move is one step; a press on the knob without a move none', () => {
    render(<LoadSlider />);
    const input = slider();
    // The value jumps where the track was pressed, then the release repeats it.
    fireEvent.pointerDown(input);
    fireEvent.change(input, { target: { value: '120' } });
    fireEvent.pointerUp(window);
    fireEvent.change(input, { target: { value: '120' } });
    expect(steps()).toBe(1);
    fireEvent.pointerDown(input);
    fireEvent.pointerUp(window);
    expect(steps()).toBe(1);
  });

  it('a drag the browser cancels (a scroll on a touch screen) also closes its step', () => {
    render(<LoadSlider />);
    const input = slider();
    fireEvent.pointerDown(input);
    fireEvent.change(input, { target: { value: '70' } });
    fireEvent.pointerCancel(window);
    drag(input, [80]);
    expect(steps()).toBe(2);
  });

  it('keyboard steps within 500 ms of each other are one undo step', () => {
    vi.useFakeTimers();
    render(<LoadSlider />);
    const input = slider();
    for (const v of [51, 52, 53, 54]) {
      fireEvent.change(input, { target: { value: String(v) } });
      act(() => vi.advanceTimersByTime(KEY_COALESCE_MS - 100));
    }
    expect(steps()).toBe(1);
    act(() => vi.advanceTimersByTime(KEY_COALESCE_MS));
    // After the pause the next key press starts a new step.
    fireEvent.change(input, { target: { value: '55' } });
    expect(steps()).toBe(2);
    useDesignStore.getState().undo();
    expect(useDesignStore.getState().design.load.re).toBe(54);
  });

  it('keyboard steps further apart than 500 ms are separate steps', () => {
    vi.useFakeTimers();
    render(<LoadSlider />);
    const input = slider();
    fireEvent.change(input, { target: { value: '51' } });
    act(() => vi.advanceTimersByTime(KEY_COALESCE_MS + 50));
    fireEvent.change(input, { target: { value: '52' } });
    act(() => vi.advanceTimersByTime(KEY_COALESCE_MS + 50));
    expect(steps()).toBe(2);
  });

  it('leaving the slider closes a keyboard run at once', () => {
    vi.useFakeTimers();
    render(<LoadSlider />);
    const input = slider();
    fireEvent.change(input, { target: { value: '51' } });
    fireEvent.blur(input);
    // Without the blur this change would join the run above.
    fireEvent.change(input, { target: { value: '52' } });
    expect(steps()).toBe(2);
  });

  it('a drag on a second slider never joins the first one’s keyboard run', () => {
    vi.useFakeTimers();
    render(
      <>
        <LoadSlider label="A" />
        <LoadSlider label="B" />
      </>,
    );
    fireEvent.change(slider('A'), { target: { value: '51' } });
    drag(slider('B'), [60, 70]);
    expect(steps()).toBe(2);
  });

  it('a drag right after keyboard steps on the same slider is a step of its own', () => {
    vi.useFakeTimers();
    render(<LoadSlider />);
    const input = slider();
    fireEvent.change(input, { target: { value: '51' } });
    drag(input, [60]);
    expect(steps()).toBe(2);
  });
});
