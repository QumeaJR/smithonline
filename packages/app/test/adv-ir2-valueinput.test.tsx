// @vitest-environment jsdom
/**
 * Adversarial round 2: ValueInput's dirty flag (Escape then a new value, text
 * that equals the display, paste, IME composition) and the callers of the
 * shared parser through Field: metre, millisiemens, dB/m, farad and hertz.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Field } from '../src/components/ui/Field';
import { emptyDesign } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => {
  useDesignStore.getState().init(emptyDesign());
});

function setup(props: Partial<Parameters<typeof Field>[0]> = {}) {
  const onCommit = vi.fn();
  const utils = render(
    <Field label="L" value={16.03e-9} unit="H" onCommit={onCommit} ariaLabel="V" {...props} />,
  );
  const input = screen.getByRole('textbox', { name: 'V' }) as HTMLInputElement;
  return { onCommit, input, ...utils };
}

const typeIn = async (input: HTMLInputElement, text: string) => {
  const user = userEvent.setup();
  await user.click(input);
  await user.clear(input);
  await user.type(input, text);
};

describe('adv ir2 dirty flag', () => {
  it('type, Escape, then a rerender with a new value: the new value shows, nothing commits', () => {
    const { onCommit, input, rerender } = setup({ value: 16e-9 });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '99n' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);
    rerender(<Field label="L" value={22e-9} unit="H" onCommit={onCommit} ariaLabel="V" />);
    expect(input.value).toBe('22 n');
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('a key then Backspace (text back to the display) does not commit the rounded value', async () => {
    const value = Number('15.915494309189535e-9');
    const { onCommit, input } = setup({ value });
    const user = userEvent.setup();
    await user.click(input);
    // caret to the end, one stray key and its correction
    await user.keyboard('{End}5{Backspace}');
    expect(input.value).toBe('15.92 n');
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('paste of a value with unit commits it', async () => {
    const { onCommit, input } = setup();
    const user = userEvent.setup();
    await user.click(input);
    await user.paste('4.7 nH');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(4.7e-9);
  });

  it('Enter that confirms an IME composition does not commit the composing text', () => {
    const { onCommit, input } = setup();
    fireEvent.focus(input);
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '4.7n' } });
    // Chrome on macOS and Firefox send the confirming Enter with isComposing true
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true, keyCode: 229 });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
  });
});

describe('adv ir2 parser callers through Field', () => {
  it('substrate height: "1.6e-3 m" in a metre field commits 1.6 mm', async () => {
    // Starts from 1 mm: typing the stored value itself commits nothing (no undo step).
    const { onCommit, input } = setup({ value: 1e-3, unit: 'm', min: 1e-9 });
    await typeIn(input, '1.6e-3 m{Enter}');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]?.[0]).toBeCloseTo(1.6e-3, 12);
  });

  it('substrate height: "0.0016 m" in a metre field commits 1.6 mm', async () => {
    const { onCommit, input } = setup({ value: 1e-3, unit: 'm', min: 1e-9 });
    await typeIn(input, '0.0016 m{Enter}');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]?.[0]).toBeCloseTo(1.6e-3, 12);
  });

  it('load G in mS: typing the shown suffix "20 mS" is accepted as 20', async () => {
    const { onCommit, input } = setup({ value: 10, unit: '', plain: true, suffix: 'mS' });
    await typeIn(input, '20 mS{Enter}');
    expect(onCommit).toHaveBeenCalledWith(20);
  });

  it('line attenuation: typing the shown suffix "0.5 dB/m" is accepted', async () => {
    const { onCommit, input } = setup({ value: 0, unit: '', plain: true, suffix: 'dB/m', min: 0 });
    await typeIn(input, '0.5 dB/m{Enter}');
    expect(onCommit).toHaveBeenCalledWith(0.5);
  });

  it('farad field: "1e-12 f" does not commit 1e-27 F', async () => {
    const { onCommit, input } = setup({ value: 1e-12, unit: 'F', min: 0 });
    await typeIn(input, '2e-12 f{Enter}');
    const v = onCommit.mock.calls[0]?.[0];
    expect(v === undefined || Math.abs(v - 2e-12) < 1e-24, `committed ${v}`).toBe(true);
  });

  it('frequency field: "2400 mhz" does not set the design frequency to 2.4 Hz', async () => {
    const { onCommit, input } = setup({ value: 1e9, unit: 'Hz', min: 1 });
    await typeIn(input, '2400 mhz{Enter}');
    const v = onCommit.mock.calls[0]?.[0];
    expect(v === undefined || v === 2.4e9, `committed ${v}`).toBe(true);
  });

  it('ohm field: U+2126 OHM SIGN is accepted like Ω', async () => {
    const { onCommit, input } = setup({ value: 50, unit: 'Ω' });
    await typeIn(input, '75 Ω{Enter}');
    expect(onCommit).toHaveBeenCalledWith(75);
  });

  it('a pasted 70 character legitimate value is accepted (no length cap on a valid number)', async () => {
    const { onCommit, input } = setup({ value: 1, unit: '', plain: true, digits: 5 });
    const user = userEvent.setup();
    await user.click(input);
    await user.paste(`0.${'1'.repeat(68)}`);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledTimes(1);
    act(() => undefined);
  });
});

describe('adv ir2 messages', () => {
  it('"20 mS" in the mS field is not refused (no status message)', async () => {
    const { input } = setup({ value: 10, unit: '', plain: true, suffix: 'mS', label: 'G' });
    await typeIn(input, '20 mS{Enter}');
    expect(useDesignStore.getState().message ?? '').toBe('');
  });
  it('Backspace case: anything committed is the unrounded store value, not 15.92n', async () => {
    const value = Number('15.915494309189535e-9');
    const { onCommit, input } = setup({ value });
    const user = userEvent.setup();
    await user.click(input);
    await user.keyboard('{End}5{Backspace}');
    fireEvent.blur(input);
    // Nothing committed at all is the expected outcome (see the Backspace case above).
    expect(onCommit.mock.calls[0]?.[0] ?? value).toBe(value);
  });
});
