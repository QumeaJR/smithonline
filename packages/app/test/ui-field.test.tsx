// @vitest-environment jsdom
/**
 * Field: label, value and unit in one box around a ValueInput. Engineering
 * notation on input, Enter commits, Escape reverts, a value below min flashes
 * and is not committed.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Field } from '../src/components/ui/Field';
import { useDesignStore } from '../src/store/useDesignStore';

afterEach(cleanup);
beforeEach(() => useDesignStore.getState().setMessage(null));

function setup(props: Partial<Parameters<typeof Field>[0]> = {}) {
  const onCommit = vi.fn();
  render(
    <Field
      label="L"
      value={16.03e-9}
      unit="H"
      onCommit={onCommit}
      ariaLabel="Inductance"
      {...props}
    />,
  );
  const input = screen.getByRole('textbox', { name: 'Inductance' }) as HTMLInputElement;
  return { onCommit, input, user: userEvent.setup() };
}

describe('Field', () => {
  it('shows the number with its prefix in the input and the unit beside it in the same box', () => {
    const { input } = setup();
    expect(input.value).toBe('16.03 n');
    const box = input.closest('.ui-field-box');
    expect(box?.querySelector('.ui-field-unit')?.textContent).toBe('H');
    expect(input.closest('label')?.textContent).toContain('L');
  });

  it('a unit without a prefix keeps a space from the number', () => {
    const { input } = setup({ value: 50, unit: 'Ω', ariaLabel: 'Inductance' });
    expect(input.value).toBe('50');
    expect(input.closest('.ui-field-box')?.querySelector('.ui-field-unit.spaced')).not.toBeNull();
  });

  it('accepts engineering notation and commits it on Enter', async () => {
    const { input, onCommit, user } = setup();
    await user.click(input);
    await user.clear(input);
    await user.type(input, '3n9{Enter}');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]?.[0]).toBeCloseTo(3.9e-9, 18);
    // Enter commits in place: the focus stays, so Tab goes on from the field.
    expect(document.activeElement).toBe(input);
  });

  it('accepts the unit typed after the number', async () => {
    const { input, onCommit, user } = setup();
    await user.click(input);
    await user.clear(input);
    await user.type(input, '22nH{Enter}');
    expect(onCommit.mock.calls[0]?.[0]).toBeCloseTo(22e-9, 18);
  });

  it('Escape reverts the typed text and commits nothing', async () => {
    const { input, onCommit, user } = setup();
    await user.click(input);
    await user.clear(input);
    await user.type(input, '47n{Escape}');
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe('16.03 n');
  });

  it('a value below min is refused with the invalid flash', async () => {
    const { input, onCommit, user } = setup({ min: 0 });
    await user.click(input);
    await user.clear(input);
    await user.type(input, '-5n{Enter}');
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.className).toContain('invalid');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.value).toBe('16.03 n');
  });

  it('text that is not a number is refused the same way', async () => {
    const { input, onCommit, user } = setup();
    await user.click(input);
    await user.clear(input);
    await user.type(input, 'abc{Enter}');
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.className).toContain('invalid');
  });

  it('an unchanged value commits nothing', async () => {
    const { input, onCommit, user } = setup();
    await user.click(input);
    await user.keyboard('{Enter}');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('a plain value shows its suffix as text only', () => {
    const { input } = setup({ value: 0.5, unit: '', plain: true, suffix: 'dB/m' });
    expect(input.value).toBe('0.5');
    expect(input.closest('.ui-field-box')?.querySelector('.ui-field-unit')?.textContent).toBe(
      'dB/m',
    );
  });

  it('sets the touch keyboard hints', () => {
    const { input } = setup();
    // text, not decimal: the iOS decimal keypad has no minus sign and no letters (spec 07 section 4)
    expect(input.getAttribute('inputmode')).toBe('text');
    expect(input.getAttribute('enterkeyhint')).toBe('done');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('autocapitalize')).toBe('off');
  });

  it('its width follows the digits', () => {
    const { input } = setup({ digits: 6 });
    expect(input.style.width).toBe('calc(10ch + 8px)');
  });

  it('a refused entry names the field and the reason in the status bar', async () => {
    const message = (): string | null => useDesignStore.getState().message;
    const { input, onCommit, user } = setup({ label: 'f', unit: 'Hz', value: 1e9, min: 1 });
    await user.click(input);
    await user.clear(input);
    await user.type(input, 'abc{Enter}');
    expect(message()).toBe('f: not a number');
    await user.clear(input);
    await user.type(input, '0.5{Enter}');
    expect(message()).toBe('f must be at least 1 Hz');
    await user.clear(input);
    await user.type(input, '5 F{Enter}');
    expect(message()).toBe('f: unit F does not fit (Hz)');
    expect(onCommit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });

  it('accepts the suffix of a plain field and any case of the unit', async () => {
    const plain = setup({ value: 1, unit: '', plain: true, suffix: 'dB' });
    await plain.user.click(plain.input);
    await plain.user.clear(plain.input);
    await plain.user.type(plain.input, '3 dB{Enter}');
    expect(plain.onCommit).toHaveBeenCalledWith(3);
    cleanup();
    const { input, onCommit, user } = setup();
    await user.click(input);
    await user.clear(input);
    await user.type(input, '22nh{Enter}');
    expect(onCommit.mock.calls[0]?.[0]).toBeCloseTo(22e-9, 18);
  });
});
