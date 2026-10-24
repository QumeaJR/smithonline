// @vitest-environment jsdom
/**
 * QA round 2: the Slider's trailing change detection. React drops a change event whose value
 * equals the value it last wrote, so the detection only runs when the controlled value the
 * caller writes back differs slightly from what the slider sent (the ladder's continuous
 * slider computes its position back from the element value). The harness writes back the
 * sent value plus 1e-12, the way that recomputation drifts, and the trailing change carries
 * the value the browser snaps the knob to.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEY_COALESCE_MS, Slider } from '../src/components/ui/Slider';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const DRIFT = 1e-12;

function Drifting({
  initial,
  onChange,
  onCommit,
}: {
  readonly initial: number;
  readonly onChange: (v: number) => void;
  readonly onCommit: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Slider
      min={-1}
      max={1}
      step={0.001}
      value={value}
      ariaLabel="Tune"
      onChange={(v) => {
        onChange(v);
        setValue(v + DRIFT);
      }}
      onCommit={onCommit}
    />
  );
}

function setup(initial = 0) {
  vi.useFakeTimers();
  const onChange = vi.fn();
  const onCommit = vi.fn();
  render(<Drifting initial={initial} onChange={onChange} onCommit={onCommit} />);
  const input = screen.getByRole('slider', { name: 'Tune' }) as HTMLInputElement;
  const change = (v: number): void => {
    fireEvent.change(input, { target: { value: String(v) } });
  };
  return { input, onChange, onCommit, change };
}

describe('Slider trailing change', () => {
  it('the harness reaches the detection: the written-back value differs from the sent one', () => {
    const { input, change, onChange } = setup();
    change(0.06);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(Number(input.value)).toBeCloseTo(0.06 + DRIFT, 15);
    expect(input.value).not.toBe('0.06');
  });

  it('a drag, then the trailing change with the released value: one change run, one commit', () => {
    const { input, change, onChange, onCommit } = setup();
    fireEvent.pointerDown(input);
    change(0.03);
    change(0.06);
    fireEvent.pointerUp(window);
    change(0.06);
    act(() => vi.advanceTimersByTime(KEY_COALESCE_MS + 10));
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([0.03, 0.06]);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('released where it started (0 -> 0.06 -> 0): the trailing 0 is still ignored', () => {
    const { input, change, onChange, onCommit } = setup(0);
    fireEvent.pointerDown(input);
    change(0.06);
    change(0);
    fireEvent.pointerUp(window);
    change(0);
    act(() => vi.advanceTimersByTime(KEY_COALESCE_MS + 10));
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([0.06, 0]);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('a trailing value within 1e-9 of the span (2e-9 here) counts as the repeat', () => {
    const { input, change, onChange, onCommit } = setup();
    fireEvent.pointerDown(input);
    change(0.06);
    fireEvent.pointerUp(window);
    change(0.06 + 1.5e-9);
    act(() => vi.advanceTimersByTime(KEY_COALESCE_MS + 10));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('a different value right after the release is a step of its own, closed after 500 ms', () => {
    const { input, change, onChange, onCommit } = setup();
    fireEvent.pointerDown(input);
    change(0.06);
    fireEvent.pointerUp(window);
    expect(onCommit).toHaveBeenCalledTimes(1);
    change(0.5);
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([0.06, 0.5]);
    act(() => vi.advanceTimersByTime(KEY_COALESCE_MS - 1));
    expect(onCommit).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(1));
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it('the repeat window ends with the task: a late repeat opens a keyboard run', () => {
    const { input, change, onChange, onCommit } = setup();
    fireEvent.pointerDown(input);
    change(0.06);
    fireEvent.pointerUp(window);
    act(() => vi.advanceTimersByTime(0));
    change(0.06);
    expect(onChange).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(KEY_COALESCE_MS));
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it('a key press after the release ends the repeat window at once', () => {
    const { input, change, onChange } = setup();
    fireEvent.pointerDown(input);
    change(0.06);
    fireEvent.pointerUp(window);
    fireEvent.keyDown(input, { key: 'ArrowRight' });
    change(0.06);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('a release of a pointer that never pressed the slider does not end the drag', () => {
    const { input, change, onCommit } = setup();
    fireEvent.pointerDown(input, { pointerId: 1 });
    change(0.06);
    fireEvent.pointerUp(window, { pointerId: 7 });
    expect(onCommit).not.toHaveBeenCalled();
    change(0.07);
    act(() => vi.advanceTimersByTime(KEY_COALESCE_MS + 10));
    // still a drag: no keyboard timer closed it
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('min equal to max: the span floor of 1 keeps the comparison finite', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(
      <Slider min={5} max={5} value={5} ariaLabel="Flat" onChange={onChange} onCommit={onCommit} />,
    );
    const input = screen.getByRole('slider', { name: 'Flat' }) as HTMLInputElement;
    fireEvent.pointerDown(input);
    fireEvent.pointerUp(window);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });
});
