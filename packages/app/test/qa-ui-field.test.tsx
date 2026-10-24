// @vitest-environment jsdom
/**
 * QA: Field width from digits versus an explicit width, the unit suffix with
 * and without an SI prefix (and with none, zero, negative, huge, infinite
 * values, plain values and a suffix), the keyboard hints of the spec, and the
 * ValueInput boundaries reached through it: min inclusive, blur commit,
 * Escape followed by a blur.
 *
 * Expected strings are hand-derived from splitEngineering: exponent =
 * floor(log10|v| / 3) * 3 clamped to [-18, 12], mantissa to `digits`
 * significant digits.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Field } from '../src/components/ui/Field';

afterEach(cleanup);

function setup(props: Partial<Parameters<typeof Field>[0]> = {}) {
  const onCommit = vi.fn();
  render(
    <Field label="L" value={16.03e-9} unit="H" onCommit={onCommit} ariaLabel="Value" {...props} />,
  );
  const input = screen.getByRole('textbox', { name: 'Value' }) as HTMLInputElement;
  const box = input.closest('.ui-field-box') as HTMLElement;
  const unit = box.querySelector('.ui-field-unit');
  return { onCommit, input, box, unit, user: userEvent.setup() };
}

describe('Field width', () => {
  it('defaults to 4 digits: calc(8ch + 8px)', () => {
    const { input } = setup();
    expect(input.style.width).toBe('calc(8ch + 8px)');
  });

  it('1 digit: calc(5ch + 8px), and the number rounds to one digit', () => {
    // 16.03e-9 H: exponent -9, mantissa 16.03 to 1 digit = 20 -> "20 nH"
    const { input } = setup({ digits: 1 });
    expect(input.style.width).toBe('calc(5ch + 8px)');
    expect(input.value).toBe('20 n');
  });

  it('9 digits (the Monte Carlo seed): calc(13ch + 8px)', () => {
    const { input } = setup({ digits: 9, plain: true, unit: '', value: 123456789 });
    expect(input.style.width).toBe('calc(13ch + 8px)');
    expect(input.value).toBe('123456789');
  });

  it('an explicit width wins over the digits', () => {
    const { input } = setup({ digits: 6, width: '100%' });
    expect(input.style.width).toBe('100%');
  });
});

describe('Field unit suffix', () => {
  it('with a prefix: the prefix stays in the input, the unit follows without a gap', () => {
    const { input, unit } = setup();
    expect(input.value).toBe('16.03 n');
    expect(unit?.textContent).toBe('H');
    expect(unit?.classList.contains('spaced')).toBe(false);
    expect(unit?.getAttribute('aria-hidden')).toBe('true');
  });

  it('a negative value with a prefix: -3.3 pF', () => {
    const { input, unit } = setup({ value: -3.3e-12, unit: 'F' });
    expect(input.value).toBe('-3.3 p');
    expect(unit?.textContent).toBe('F');
    expect(unit?.classList.contains('spaced')).toBe(false);
  });

  it('without a prefix: the unit keeps a space (50 Ω)', () => {
    const { input, unit } = setup({ value: 50, unit: 'Ω' });
    expect(input.value).toBe('50');
    expect(unit?.textContent).toBe('Ω');
    expect(unit?.classList.contains('spaced')).toBe(true);
  });

  it('zero has no prefix: 0 and a spaced unit', () => {
    const { input, unit } = setup({ value: 0 });
    expect(input.value).toBe('0');
    expect(unit?.classList.contains('spaced')).toBe(true);
  });

  it('a huge value clamps at tera: 1e15 Ω shows 1000 T and Ω', () => {
    const { input, unit } = setup({ value: 1e15, unit: 'Ω' });
    expect(input.value).toBe('1000 T');
    expect(unit?.textContent).toBe('Ω');
    expect(unit?.classList.contains('spaced')).toBe(false);
  });

  it('a tiny value clamps at atto: 1e-20 H shows 0.01 a', () => {
    const { input } = setup({ value: 1e-20 });
    expect(input.value).toBe('0.01 a');
  });

  it('Infinity has no prefix: Infinity and a spaced unit', () => {
    const { input, unit } = setup({ value: Infinity, unit: 'Ω' });
    expect(input.value).toBe('Infinity');
    expect(unit?.classList.contains('spaced')).toBe(true);
  });

  it('a plain value with a unit: no prefix, the unit spaced (1500 Hz)', () => {
    const { input, unit } = setup({ value: 1500, unit: 'Hz', plain: true });
    expect(input.value).toBe('1500');
    expect(unit?.textContent).toBe('Hz');
    expect(unit?.classList.contains('spaced')).toBe(true);
  });

  it('a suffix on a plain value is always spaced', () => {
    const { input, unit } = setup({ value: 45, unit: '', plain: true, suffix: '°' });
    expect(input.value).toBe('45');
    expect(unit?.textContent).toBe('°');
    expect(unit?.classList.contains('spaced')).toBe(true);
  });

  it('no unit and no suffix: no unit element', () => {
    const { input, unit } = setup({ value: 1.5, unit: '', plain: true });
    expect(input.value).toBe('1.5');
    expect(unit).toBeNull();
  });
});

describe('Field attributes', () => {
  it('uses the text keyboard with Done, no autocomplete (spec 07 section 4)', () => {
    const { input } = setup();
    expect(input.getAttribute('inputmode')).toBe('text');
    expect(input.getAttribute('enterkeyhint')).toBe('done');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('autocorrect')).toBe('off');
    expect(input.getAttribute('autocapitalize')).toBe('off');
    expect(input.getAttribute('spellcheck')).toBe('false');
  });

  it('no label: no label element, the box still wraps the input', () => {
    render(<Field value={1} plain onCommit={() => undefined} ariaLabel="Bare" />);
    const input = screen.getByRole('textbox', { name: 'Bare' });
    expect(input.closest('label')?.querySelector('.ui-field-label')).toBeNull();
    expect(input.closest('.ui-field-box')).not.toBeNull();
  });

  it('the title sits on the label, the id and the input class on the input', () => {
    const { input } = setup({ title: 'Tip', id: 'ql', inputClassName: 'default-q' });
    expect(input.closest('label')?.title).toBe('Tip');
    expect(input.title).toBe('');
    expect(input.id).toBe('ql');
    expect(input.classList.contains('in-field')).toBe(true);
    expect(input.classList.contains('default-q')).toBe(true);
  });

  it('a click on the unit focuses the input (label wraps it)', async () => {
    const { input, unit, user } = setup();
    await user.click(unit as Element);
    expect(document.activeElement).toBe(input);
  });
});

describe('Field value boundaries', () => {
  it('a value equal to min is accepted', async () => {
    const { input, onCommit, user } = setup({ min: 0 });
    await user.click(input);
    await user.clear(input);
    await user.type(input, '0{Enter}');
    expect(onCommit).toHaveBeenCalledWith(0);
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });

  it('a value just below min is refused', async () => {
    const { input, onCommit, user } = setup({ min: 1, value: 5, unit: 'Hz' });
    await user.click(input);
    await user.clear(input);
    await user.type(input, '0.999{Enter}');
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('leaving the field by Tab commits', async () => {
    const { input, onCommit, user } = setup();
    await user.click(input);
    await user.clear(input);
    await user.type(input, '22n');
    await user.tab();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]?.[0]).toBeCloseTo(22e-9, 18);
  });

  it('after Escape a later focus and Tab commit nothing', async () => {
    const { input, onCommit, user } = setup();
    await user.click(input);
    await user.clear(input);
    await user.type(input, '47n{Escape}');
    // QA round 2: Escape reverts and keeps the focus.
    expect(document.activeElement).toBe(input);
    await user.click(input);
    expect(input.value).toBe('16.03 n');
    await user.tab();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('Escape on an untouched field commits nothing and keeps the focus', async () => {
    const { input, onCommit, user } = setup();
    await user.click(input);
    await user.keyboard('{Escape}');
    expect(onCommit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
  });

  it('empty text is refused', async () => {
    const { input, onCommit, user } = setup();
    await user.click(input);
    await user.clear(input);
    await user.keyboard('{Enter}');
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    // QA round 2: after Enter the refused text stays in the field to be corrected.
    expect(input.value).toBe('');
  });

  it('the invalid flash clears after 800 ms', async () => {
    const { input, user } = setup();
    await user.click(input);
    await user.clear(input);
    await user.type(input, 'x{Enter}');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    await waitFor(() => expect(input.getAttribute('aria-invalid')).toBeNull(), { timeout: 2000 });
    expect(input.classList.contains('invalid')).toBe(false);
  });
});
