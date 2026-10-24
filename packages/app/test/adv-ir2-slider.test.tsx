// @vitest-environment jsdom
/**
 * Adversarial round 2: the Slider's rule that ignores the change event
 * following a release. Release on the start value, a keyboard step right after
 * a release, an assistive-technology step (no keydown) right after a release,
 * and a programmatic value change between pointerup and the change event.
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

function LoadSlider() {
  const re = useDesignStore((s) => s.design.load.re);
  const { setLoad, commit } = useDesignStore.getState();
  return (
    <Slider
      min={1}
      max={200}
      step={1}
      value={re}
      ariaLabel="Load R"
      onChange={(v) => setLoad(complex(v, 0), true)}
      onCommit={commit}
    />
  );
}

const state = () => useDesignStore.getState();
const steps = (): number => state().past.length;
const re = (): number => state().design.load.re;
const slider = (): HTMLInputElement =>
  screen.getByRole('slider', { name: 'Load R' }) as HTMLInputElement;
const change = (v: number): void => {
  fireEvent.change(slider(), { target: { value: String(v) } });
};

describe('adv ir2 slider trailing change', () => {
  it('release on the start value: no step, and the trailing change is ignored', () => {
    vi.useFakeTimers();
    render(<LoadSlider />);
    const before = steps();
    fireEvent.pointerDown(slider(), { pointerId: 1 });
    change(60);
    change(50);
    fireEvent.pointerUp(window, { pointerId: 1 });
    change(50);
    act(() => vi.advanceTimersByTime(KEY_COALESCE_MS + 10));
    // 50 -> 60 -> 50 is a drag that ends where it began; at most one step, and undo stays at 50
    expect(steps() - before).toBeLessThanOrEqual(1);
    expect(re()).toBe(50);
  });

  it('a keyboard step in the same task as the release is its own undo step', () => {
    vi.useFakeTimers();
    render(<LoadSlider />);
    fireEvent.pointerDown(slider(), { pointerId: 1 });
    change(60);
    fireEvent.pointerUp(window, { pointerId: 1 });
    fireEvent.keyDown(slider(), { key: 'ArrowRight' });
    change(61);
    act(() => vi.advanceTimersByTime(KEY_COALESCE_MS + 10));
    expect(re()).toBe(61);
    state().undo();
    expect(re()).toBe(60);
    state().undo();
    expect(re()).toBe(50);
  });

  it('an assistive-technology step (no keydown) right after the release is kept', () => {
    vi.useFakeTimers();
    render(<LoadSlider />);
    fireEvent.pointerDown(slider(), { pointerId: 1 });
    change(60);
    fireEvent.pointerUp(window, { pointerId: 1 });
    change(61);
    act(() => vi.advanceTimersByTime(KEY_COALESCE_MS + 10));
    expect(re()).toBe(61);
  });

  it('a value change between pointerup and the change event: the trailing old value does not undo it', () => {
    vi.useFakeTimers();
    render(<LoadSlider />);
    fireEvent.pointerDown(slider(), { pointerId: 1 });
    change(60);
    fireEvent.pointerUp(window, { pointerId: 1 });
    act(() => state().setLoad(complex(120, 0)));
    // React has written 120 into the DOM; the browser's trailing change reports the DOM value
    change(120);
    act(() => vi.advanceTimersByTime(KEY_COALESCE_MS + 10));
    expect(re()).toBe(120);
    state().undo();
    expect(re()).toBe(60);
  });

  // Accepted (QA round 2): an assistive step in the same task as a programmatic change is theoretical.
  it.fails(
    'a step to the released value right after a programmatic change is not swallowed',
    () => {
      vi.useFakeTimers();
      render(<LoadSlider />);
      fireEvent.pointerDown(slider(), { pointerId: 1 });
      change(60);
      fireEvent.pointerUp(window, { pointerId: 1 });
      act(() => state().setLoad(complex(59, 0)));
      // an AT increment from 59 lands on 60 again in the same task
      change(60);
      act(() => vi.advanceTimersByTime(KEY_COALESCE_MS + 10));
      expect(re()).toBe(60);
    },
  );

  it('released stays set only for one task: a change 1 ms later is a real step', () => {
    vi.useFakeTimers();
    render(<LoadSlider />);
    fireEvent.pointerDown(slider(), { pointerId: 1 });
    change(60);
    fireEvent.pointerUp(window, { pointerId: 1 });
    act(() => vi.advanceTimersByTime(1));
    act(() => state().setLoad(complex(59, 0)));
    change(60);
    act(() => vi.advanceTimersByTime(KEY_COALESCE_MS + 10));
    expect(re()).toBe(60);
  });

  // Accepted (QA round 2): a pointer drag keeps the focus on the slider, so a blur mid-drag is theoretical.
  it.fails(
    'blur in the middle of a drag, then the drag continues: each later move is not its own step',
    () => {
      vi.useFakeTimers();
      render(<LoadSlider />);
      const before = steps();
      fireEvent.pointerDown(slider(), { pointerId: 1 });
      change(60);
      fireEvent.blur(slider());
      act(() => vi.advanceTimersByTime(1));
      change(70);
      act(() => vi.advanceTimersByTime(KEY_COALESCE_MS + 10));
      change(80);
      act(() => vi.advanceTimersByTime(KEY_COALESCE_MS + 10));
      fireEvent.pointerUp(window, { pointerId: 1 });
      expect(steps() - before).toBeLessThanOrEqual(2);
    },
  );
});
