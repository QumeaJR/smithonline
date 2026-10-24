// @vitest-environment jsdom
/**
 * Adversarial: Field / ValueInput with hostile input, no-edit focus and blur,
 * Escape and blur races, Enter during the invalid flash, NaN and Infinity
 * from the store, long strings.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Field } from '../src/components/ui/Field';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(props: Partial<Parameters<typeof Field>[0]> = {}) {
  const onCommit = vi.fn();
  render(
    <Field label="L" value={16.03e-9} unit="H" onCommit={onCommit} ariaLabel="V" {...props} />,
  );
  const input = screen.getByRole('textbox', { name: 'V' }) as HTMLInputElement;
  return { onCommit, input };
}

describe('adv Field: no-edit focus and blur', () => {
  it('focus then blur without typing commits nothing for a value with 5+ significant digits', () => {
    // Auto match produces values like this one; the field shows them rounded to 4 digits.
    // From a string: the literal has more digits than a double holds (no-loss-of-precision).
    const value = Number('15.915494309189535e-9');
    const { onCommit, input } = setup({ value });
    fireEvent.focus(input);
    expect(input.value).toBe('15.92 n');
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('focus then Enter without typing commits nothing (Tab through a card)', () => {
    const { onCommit, input } = setup({ value: Number('15.915494309189535e-9') });
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('a plain value with digits=5 (line length) survives focus and blur unchanged', () => {
    const { onCommit, input } = setup({ value: 0.123456789, plain: true, unit: '', digits: 5 });
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('a value of 50.00001 ohm survives focus and blur unchanged', () => {
    const { onCommit, input } = setup({ value: 50.00001, unit: 'Ω' });
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('adv Field: hostile text', () => {
  const type = async (input: HTMLInputElement, text: string) => {
    const user = userEvent.setup();
    await user.click(input);
    await user.clear(input);
    await user.type(input, text);
  };

  it.each([
    ['empty', ''],
    ['minus only', '-'],
    ['unicode minus', '−5n'],
    ['comma decimal', '1,5'],
    ['NaN', 'NaN'],
    ['Infinity', 'Infinity'],
    ['1e999', '1e999'],
  ])('%s is refused with the flash', async (_, text) => {
    const { onCommit, input } = setup();
    await type(input, `${text}{Enter}`);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.className).toContain('invalid');
    expect(input.value).toBe('16.03 n');
  });

  it('"1e" (an unfinished exponent) is not committed as 1', async () => {
    const { onCommit, input } = setup();
    await type(input, '1e{Enter}');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('the unit typed twice ("22nHH") is refused', async () => {
    const { onCommit, input } = setup();
    await type(input, '22nHH{Enter}');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('a foreign unit ("5 F" into an inductance) is refused', async () => {
    const { onCommit, input } = setup();
    await type(input, '5 F{Enter}');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('"+1", ".5", "1e3", "3n9", "1 nH" are accepted', async () => {
    for (const [text, expected] of [
      ['+1', 1],
      ['.5', 0.5],
      ['1e3', 1000],
      ['3n9', 3.9e-9],
      ['1 nH', 1e-9],
    ] as const) {
      cleanup();
      const { onCommit, input } = setup();
      await type(input, `${text}{Enter}`);
      expect(onCommit, text).toHaveBeenCalledTimes(1);
      expect(onCommit.mock.calls[0]?.[0], text).toBeCloseTo(expected, 15);
    }
  });

  it('a pasted string of 30000 digits does not stall the tab for more than 100 ms', () => {
    const { onCommit, input } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: `${'1'.repeat(30000)}!` } });
    const t0 = performance.now();
    fireEvent.blur(input);
    const ms = performance.now() - t0;
    expect(onCommit).not.toHaveBeenCalled();
    expect(ms, `blur took ${ms.toFixed(0)} ms`).toBeLessThan(100);
  });
});

describe('adv Field: Escape and blur races, the invalid flash', () => {
  it('Escape reverts and the following blur commits nothing', async () => {
    const { onCommit, input } = setup();
    const user = userEvent.setup();
    await user.click(input);
    await user.clear(input);
    await user.type(input, '47n{Escape}');
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe('16.03 n');
    // The revert flag must not leak into the next edit.
    await user.click(input);
    await user.clear(input);
    await user.type(input, '47n{Enter}');
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('Escape without focus (keydown only) leaves the next real commit intact', () => {
    const { onCommit, input } = setup();
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '47n' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(47e-9);
  });

  it('Escape while the blur does not fire synchronously still commits the next Enter', () => {
    // A browser that fires blur after keydown returns: the reverting flag is already false.
    const { onCommit, input } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '47n' } });
    const blur = HTMLElement.prototype.blur;
    HTMLElement.prototype.blur = function () {
      /* deferred by the browser */
    };
    fireEvent.keyDown(input, { key: 'Escape' });
    HTMLElement.prototype.blur = blur;
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '33n' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(33e-9);
  });

  it('Enter during the invalid flash with a valid draft commits it and ends the flash later', () => {
    vi.useFakeTimers();
    const { onCommit, input } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.blur(input);
    expect(input.className).toContain('invalid');
    act(() => vi.advanceTimersByTime(400));
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '47n' } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(47e-9);
    act(() => vi.advanceTimersByTime(900));
    expect(input.className).not.toContain('invalid');
  });

  it('a second invalid entry during the flash restarts the 800 ms flash', () => {
    vi.useFakeTimers();
    const { input } = setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.blur(input);
    act(() => vi.advanceTimersByTime(700));
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'def' } });
    fireEvent.blur(input);
    act(() => vi.advanceTimersByTime(300));
    // 300 ms after the second refusal the flash should still be on.
    expect(input.className).toContain('invalid');
  });

  it('a store value that changes while the field is focused is not overwritten by the stale draft', () => {
    const onCommit = vi.fn();
    const { rerender } = render(
      <Field label="L" value={16e-9} unit="H" onCommit={onCommit} ariaLabel="V" />,
    );
    const input = screen.getByRole('textbox', { name: 'V' }) as HTMLInputElement;
    fireEvent.focus(input);
    rerender(<Field label="L" value={22e-9} unit="H" onCommit={onCommit} ariaLabel="V" />);
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('adv Field: NaN, Infinity and extremes from the store', () => {
  it('NaN shows as text and a no-edit focus/blur does not flash invalid', () => {
    const { onCommit, input } = setup({ value: NaN });
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.className).not.toContain('invalid');
  });

  it('Infinity shows as text and a no-edit focus/blur does not flash invalid', () => {
    const { onCommit, input } = setup({ value: Infinity });
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.className).not.toContain('invalid');
  });

  it('1e-30 shows readable text that parses back', () => {
    const { onCommit, input } = setup({ value: 1e-30 });
    expect(input.value).not.toMatch(/e-?\d+ a/);
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.className).not.toContain('invalid');
  });

  it('1e30 shows readable text', () => {
    const { input } = setup({ value: 1e30 });
    expect(input.value.length).toBeLessThan(12);
  });

  it('-0 shows as 0 and a no-edit focus/blur commits nothing', () => {
    const { onCommit, input } = setup({ value: -0 });
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
