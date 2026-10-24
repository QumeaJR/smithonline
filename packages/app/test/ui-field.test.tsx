// @vitest-environment jsdom
/**
 * Field: label, value and unit in one box around a ValueInput. Engineering
 * notation on input, Enter commits, Escape reverts, a value below min flashes
 * and is not committed.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Field } from '../src/components/ui/Field';

afterEach(cleanup);

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
    expect(document.activeElement).not.toBe(input);
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
    expect(input.getAttribute('inputmode')).toBe('decimal');
    expect(input.getAttribute('enterkeyhint')).toBe('done');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('autocapitalize')).toBe('off');
  });

  it('its width follows the digits', () => {
    const { input } = setup({ digits: 6 });
    expect(input.style.width).toBe('calc(10ch + 8px)');
  });
});
