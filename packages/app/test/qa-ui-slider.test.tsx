// @vitest-environment jsdom
/**
 * QA: Slider undo coalescing at the 500 ms boundary (499 and 501 ms), blur and
 * unmount closing a pending keyboard run exactly once, a second slider's
 * keyboard step closing the first run, and the tick count limits.
 */
import { complex } from '@smithonline/core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
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

function Harness({
  onCommit,
  label = 'S',
  ticks,
}: {
  readonly onCommit?: () => void;
  readonly label?: string;
  readonly ticks?: number;
}) {
  const [v, setV] = useState(50);
  return (
    <Slider
      min={0}
      max={100}
      step={1}
      value={v}
      ariaLabel={label}
      onChange={setV}
      {...(onCommit !== undefined ? { onCommit } : {})}
      {...(ticks !== undefined ? { ticks } : {})}
    />
  );
}

const slider = (name = 'S'): HTMLInputElement =>
  screen.getByRole('slider', { name }) as HTMLInputElement;
const step = (input: HTMLInputElement, v: number): void => {
  fireEvent.change(input, { target: { value: String(v) } });
};
const tick = (ms: number): void => {
  act(() => vi.advanceTimersByTime(ms));
};

describe('Slider keyboard coalescing boundary', () => {
  it('a second key step 499 ms after the first joins its run: one commit', () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    step(slider(), 51);
    tick(KEY_COALESCE_MS - 1);
    expect(onCommit).toHaveBeenCalledTimes(0);
    step(slider(), 52);
    // The timer restarts with the second step: nothing fires at 500 ms after the first.
    tick(KEY_COALESCE_MS - 1);
    expect(onCommit).toHaveBeenCalledTimes(0);
    tick(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
    tick(10_000);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(slider().value).toBe('52');
  });

  it('a second key step 501 ms after the first starts a new run: two commits', () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    step(slider(), 51);
    tick(KEY_COALESCE_MS + 1);
    expect(onCommit).toHaveBeenCalledTimes(1);
    step(slider(), 52);
    expect(onCommit).toHaveBeenCalledTimes(1);
    tick(KEY_COALESCE_MS);
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it('exactly 500 ms of silence closes the run', () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    step(slider(), 51);
    tick(KEY_COALESCE_MS);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('with the store: steps 499 ms apart are one undo step, 501 ms apart are two', () => {
    vi.useFakeTimers();
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
    render(<LoadSlider />);
    const input = slider('Load R');
    step(input, 51);
    tick(KEY_COALESCE_MS - 1);
    step(input, 52);
    tick(KEY_COALESCE_MS);
    expect(useDesignStore.getState().past.length).toBe(1);
    step(input, 53);
    tick(KEY_COALESCE_MS + 1);
    step(input, 54);
    tick(KEY_COALESCE_MS);
    expect(useDesignStore.getState().past.length).toBe(3);
    useDesignStore.getState().undo();
    expect(useDesignStore.getState().design.load.re).toBe(53);
    useDesignStore.getState().undo();
    expect(useDesignStore.getState().design.load.re).toBe(52);
    useDesignStore.getState().undo();
    expect(useDesignStore.getState().design.load.re).toBe(50);
  });

  it('blur at 499 ms closes the run at once and the timer does not commit again', () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    step(slider(), 51);
    tick(KEY_COALESCE_MS - 1);
    fireEvent.blur(slider());
    expect(onCommit).toHaveBeenCalledTimes(1);
    tick(10_000);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('blur without a pending run commits nothing', () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    fireEvent.blur(slider());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('unmounting with a pending keyboard run commits once and clears the timer', () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    const view = render(<Harness onCommit={onCommit} />);
    step(slider(), 51);
    view.unmount();
    expect(onCommit).toHaveBeenCalledTimes(1);
    tick(10_000);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('a key step on a second slider closes the pending run of the first', () => {
    vi.useFakeTimers();
    const a = vi.fn();
    const b = vi.fn();
    render(
      <>
        <Harness label="A" onCommit={a} />
        <Harness label="B" onCommit={b} />
      </>,
    );
    step(slider('A'), 51);
    tick(100);
    step(slider('B'), 60);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(0);
    tick(KEY_COALESCE_MS);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('a drag that never moves still closes once on release', () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    fireEvent.pointerDown(slider());
    fireEvent.pointerUp(window);
    expect(onCommit).toHaveBeenCalledTimes(1);
    // A second release with no drag is ignored.
    fireEvent.pointerUp(window);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('changes during a drag never start the keyboard timer', () => {
    vi.useFakeTimers();
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    fireEvent.pointerDown(slider());
    step(slider(), 60);
    tick(10_000);
    expect(onCommit).toHaveBeenCalledTimes(0);
    fireEvent.pointerUp(window);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('works without onCommit', () => {
    vi.useFakeTimers();
    render(<Harness />);
    step(slider(), 51);
    expect(() => tick(KEY_COALESCE_MS)).not.toThrow();
    fireEvent.pointerDown(slider());
    expect(() => fireEvent.pointerUp(window)).not.toThrow();
  });
});

describe('Slider ticks', () => {
  const host = (): HTMLElement => slider().closest('.slider') as HTMLElement;
  const ticksVar = (): string => host().style.getPropertyValue('--ticks');

  it('no ticks prop: no ticked class and no --ticks variable', () => {
    render(<Harness />);
    expect(host().classList.contains('ticked')).toBe(false);
    expect(ticksVar()).toBe('');
  });

  it('2 ticks is the lower limit: --ticks is 1 (gaps between ticks)', () => {
    render(<Harness ticks={2} />);
    expect(host().classList.contains('ticked')).toBe(true);
    expect(ticksVar()).toBe('1');
  });

  it('1 tick draws nothing', () => {
    render(<Harness ticks={1} />);
    expect(host().classList.contains('ticked')).toBe(false);
  });

  it('60 ticks is the upper limit: --ticks is 59', () => {
    render(<Harness ticks={60} />);
    expect(ticksVar()).toBe('59');
  });

  it('61 ticks draws nothing', () => {
    render(<Harness ticks={61} />);
    expect(host().classList.contains('ticked')).toBe(false);
    expect(ticksVar()).toBe('');
  });
});
