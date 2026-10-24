// @vitest-environment jsdom
/**
 * QA round 2: ValueInput's typed-text flag under focus, rerender and Escape sequences, and
 * the wording of the status message for a refused entry.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ValueInput } from '../src/components/ValueInput';
import { Field } from '../src/components/ui/Field';
import { useDesignStore } from '../src/store/useDesignStore';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => useDesignStore.getState().setMessage(null));

const message = (): string | null => useDesignStore.getState().message;

/** A ValueInput whose value the test can change from outside (a slider, a chart drag). */
function Harness({
  initial,
  onCommit,
  expose,
}: {
  readonly initial: number;
  readonly onCommit: (v: number) => void;
  readonly expose: (set: (v: number) => void) => void;
}) {
  const [value, setValue] = useState(initial);
  expose(setValue);
  return (
    <ValueInput
      value={value}
      unit="H"
      ariaLabel="Inductance"
      onCommit={(v) => {
        onCommit(v);
        setValue(v);
      }}
    />
  );
}

function setupHarness(initial = 16.0349e-9) {
  const onCommit = vi.fn();
  let setOutside: (v: number) => void = () => undefined;
  render(<Harness initial={initial} onCommit={onCommit} expose={(s) => (setOutside = s)} />);
  const input = screen.getByRole('textbox', { name: 'Inductance' }) as HTMLInputElement;
  return { input, onCommit, setOutside: (v: number) => act(() => setOutside(v)) };
}

describe('ValueInput under focus and rerender', () => {
  it('focused and untouched: an outside change shows at once and the blur commits nothing', () => {
    const { input, onCommit, setOutside } = setupHarness();
    act(() => input.focus());
    expect(input.value).toBe('16.03 nH');
    setOutside(22e-9);
    expect(input.value).toBe('22 nH');
    act(() => input.blur());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('focused and typed: an outside change does not replace the typed text, the blur commits it', () => {
    const { input, onCommit, setOutside } = setupHarness();
    act(() => input.focus());
    fireEvent.change(input, { target: { value: '47n' } });
    setOutside(22e-9);
    expect(input.value).toBe('47n');
    act(() => input.blur());
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]?.[0]).toBeCloseTo(47e-9, 20);
  });

  it('typed, outside change, Escape: shows the outside value and commits nothing', () => {
    const { input, onCommit, setOutside } = setupHarness();
    act(() => input.focus());
    fireEvent.change(input, { target: { value: '47n' } });
    setOutside(22e-9);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('22 nH');
    expect(onCommit).not.toHaveBeenCalled();
    // QA round 2: the first Escape reverts and keeps the focus in the field.
    expect(document.activeElement).toBe(input);
    act(() => input.blur());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('Enter commits, then a second Enter without typing commits nothing', () => {
    const { input, onCommit } = setupHarness();
    act(() => input.focus());
    fireEvent.change(input, { target: { value: '47n' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter' });
    act(() => input.blur());
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('47 nH');
  });

  it('a refused entry keeps the typed text after Enter; the blur reverts and commits nothing', () => {
    const { input, onCommit } = setupHarness();
    act(() => input.focus());
    fireEvent.change(input, { target: { value: 'abc' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // QA round 2: the refused text stays to be corrected, still flashed.
    expect(input.value).toBe('abc');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    act(() => input.blur());
    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe('16.03 nH');
  });

  it('typed text equal to the stored value commits nothing (no history step for a no-op)', () => {
    const { input, onCommit } = setupHarness(22e-9);
    act(() => input.focus());
    fireEvent.change(input, { target: { value: '22n' } });
    act(() => input.blur());
    expect(onCommit).not.toHaveBeenCalled();
  });

  // Fixed in QA round 2: text equal to the shown text commits nothing.
  it('text typed back to exactly the shown text does not round the stored value', () => {
    const { input, onCommit } = setupHarness(16.0349e-9);
    act(() => input.focus());
    fireEvent.change(input, { target: { value: '16.03 nH5' } });
    fireEvent.change(input, { target: { value: '16.03 nH' } });
    act(() => input.blur());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('the flash ends 800 ms after the last refusal', () => {
    vi.useFakeTimers();
    const { input } = setupHarness();
    act(() => input.focus());
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    act(() => vi.advanceTimersByTime(799));
    expect(input.className).toContain('invalid');
    act(() => vi.advanceTimersByTime(1));
    expect(input.className).not.toContain('invalid');
  });
});

describe('ValueInput refusal wording', () => {
  function plain(props: Partial<Parameters<typeof ValueInput>[0]> = {}) {
    const onCommit = vi.fn();
    render(<ValueInput value={1} onCommit={onCommit} {...props} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    return { input, onCommit };
  }
  const enter = (input: HTMLInputElement, text: string): void => {
    act(() => input.focus());
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: 'Enter' });
  };

  it('the name wins over the aria label', () => {
    const { input } = plain({ name: 'Z0', ariaLabel: 'Line impedance', unit: 'Ω' });
    enter(input, 'x');
    expect(message()).toBe('Z0: "x" is not a number');
  });

  it('without a name the aria label names the field', () => {
    const { input } = plain({ ariaLabel: 'Line impedance', unit: 'Ω' });
    enter(input, 'x');
    expect(message()).toBe('Line impedance: "x" is not a number');
  });

  it('a field without a unit says it takes a plain number', () => {
    const { input, onCommit } = plain({ name: 'n' });
    enter(input, '5 H');
    expect(message()).toBe('n: "5 H" has the wrong unit (a plain number)');
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('"1E" is an unfinished exponent, not a unit', () => {
    const { input } = plain({ name: 'n' });
    enter(input, '1E');
    expect(message()).toBe('n: "1E" is not a number');
  });

  it('the minimum is quoted in the field unit with its prefix', () => {
    const { input } = plain({ name: 'h', unit: 'm', min: 1e-9, value: 1.6e-3 });
    enter(input, '0');
    // 1e-9 m formats as "1 nm"
    expect(message()).toBe('h: "0" is below the minimum 1 nm');
  });

  it('an ohm field accepts "ohms" and "Ohm"', () => {
    const { input, onCommit } = plain({ unit: 'Ω', value: 50 });
    enter(input, '75 ohms');
    enter(input, '100 Ohm');
    expect(onCommit.mock.calls.map((c) => c[0])).toEqual([75, 100]);
  });

  // The cap was raised from 64 to 256 characters in QA round 2.
  it('a 257 character paste is refused as not a number and keeps the value', () => {
    const { input, onCommit } = plain({ name: 'n' });
    enter(input, `1.${'0'.repeat(255)}`);
    expect(message()).toBe(`n: "1.${'0'.repeat(21)}…" is not a number`);
    expect(onCommit).not.toHaveBeenCalled();
  });

  // Fixed in QA round 2: the name comes from the text of a markup label.
  it('a Field with a markup label and no aria label still names the field', async () => {
    const onCommit = vi.fn();
    render(<Field label={<>&#949;r</>} value={4.3} plain min={1} onCommit={onCommit} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    const user = userEvent.setup();
    await user.click(input);
    await user.clear(input);
    await user.type(input, '0.5{Enter}');
    expect(onCommit).not.toHaveBeenCalled();
    expect(message()).not.toMatch(/^Value\b/);
  });
});

describe('ValueInput in a metre field (Dimensions h, t, diameter; Winding wire)', () => {
  function metre() {
    const onCommit = vi.fn();
    render(
      <Field label="h" value={1.6e-3} unit="m" min={1e-9} onCommit={onCommit} ariaLabel="h" />,
    );
    const input = screen.getByRole('textbox', { name: 'h' }) as HTMLInputElement;
    const enter = (text: string): void => {
      act(() => input.focus());
      fireEvent.change(input, { target: { value: text } });
      fireEvent.keyDown(input, { key: 'Enter' });
    };
    return { input, onCommit, enter };
  }

  // QA round 2: "1.6 m" beside the unit m would read back as 1.6 metres under the rule that
  // the field's own unit wins over a prefix; the metre stays inside the input.
  it('shows 1.6 mm as "1.6 mm" in the input, and "2.2 mm" reads 2.2e-3', () => {
    const { input, onCommit, enter } = metre();
    expect(input.value).toBe('1.6 mm');
    enter('2.2 mm');
    expect(onCommit.mock.calls[0]?.[0]).toBeCloseTo(2.2e-3, 15);
  });

  it('exponent notation without a unit is metres: "2e-3" is 2 mm', () => {
    const { onCommit, enter } = metre();
    enter('2e-3');
    expect(onCommit.mock.calls[0]?.[0]).toBeCloseTo(2e-3, 15);
  });

  // Fixed in QA round 2: the field's own unit wins over the milli prefix.
  it('"2e-3 m" in a metre field is 2 mm, not 2 µm', () => {
    const { onCommit, enter } = metre();
    enter('2e-3 m');
    expect(onCommit.mock.calls[0]?.[0]).toBeCloseTo(2e-3, 15);
  });
});
