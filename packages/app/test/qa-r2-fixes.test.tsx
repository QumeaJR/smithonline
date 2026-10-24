// @vitest-environment jsdom
/**
 * QA round 2 fixes on the interaction redesign: Escape inside a dialog, the refusal message
 * cleared by the next accepted entry, NumberList refusals and names, the name of a Field with
 * a markup label, the metre kept inside its input, and the datapoint add row labels.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Datapoints } from '../src/components/Datapoints';
import { NumberList } from '../src/components/NumberList';
import { SettingsDialog } from '../src/components/SettingsDialog';
import { Field } from '../src/components/ui/Field';
import { emptyDesign } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';

afterEach(cleanup);
beforeEach(() => {
  useDesignStore.getState().init(emptyDesign());
  useDesignStore.getState().setMessage(null);
});

const message = (): string | null => useDesignStore.getState().message;
const enter = (input: HTMLElement, text: string): void => {
  act(() => input.focus());
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
};

describe('Escape in a field inside Settings', () => {
  it('the first Escape reverts and keeps the focus, the second closes the dialog', () => {
    const onClose = vi.fn();
    render(<SettingsDialog onClose={onClose} />);
    const input = screen.getAllByRole('textbox')[0]!;
    const before = (input as HTMLInputElement).value;
    act(() => input.focus());
    fireEvent.change(input, { target: { value: '123' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe(before);
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('the refusal message', () => {
  it('is cleared by the next accepted entry of any field', () => {
    render(
      <>
        <Field label="f" value={1e9} unit="Hz" min={1} onCommit={() => undefined} />
        <Field label="Z0" value={50} unit="Ω" onCommit={() => undefined} />
      </>,
    );
    const [f, z0] = screen.getAllByRole('textbox');
    enter(f!, 'abc');
    expect(message()).toBe('f: "abc" is not a number');
    enter(z0!, '75');
    expect(message()).toBeNull();
  });

  it('another message (an undo step) is left alone', () => {
    render(<Field label="Z0" value={50} unit="Ω" onCommit={() => undefined} />);
    const input = screen.getByRole('textbox');
    enter(input, 'x');
    useDesignStore.getState().setMessage('Undo: something');
    enter(input, '75');
    expect(message()).toBe('Undo: something');
  });

  it('a decimal comma is named with the corrected text', () => {
    render(<Field label="f" value={1e9} unit="Hz" onCommit={() => undefined} />);
    enter(screen.getByRole('textbox'), '2,4 GHz');
    expect(message()).toBe('f: "2,4 GHz" is not a number (use a decimal point: 2.4 GHz)');
  });

  it('"2400 mhz" is refused as ambiguous', () => {
    const onCommit = vi.fn();
    render(<Field label="f" value={1e9} unit="Hz" onCommit={onCommit} />);
    enter(screen.getByRole('textbox'), '2400 mhz');
    expect(onCommit).not.toHaveBeenCalled();
    expect(message()).toBe('f: "2400 mhz" is ambiguous (mHz or MHz)');
  });

  it('IME: an Enter with keyCode 229 commits nothing', () => {
    const onCommit = vi.fn();
    render(<Field label="L" value={1e-9} unit="H" onCommit={onCommit} />);
    const input = screen.getByRole('textbox');
    act(() => input.focus());
    fireEvent.change(input, { target: { value: '4.7n' } });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('NumberList', () => {
  function setup() {
    const onChange = vi.fn();
    render(
      <NumberList
        label="VSWR circles"
        itemName="VSWR circle"
        values={[2]}
        min={1}
        swatch="red"
        placeholder="1.5"
        onChange={onChange}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Add VSWR circles' });
    return { onChange, input };
  }

  it('names its Add and Remove buttons', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Add VSWR circle' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove VSWR circle 2' })).toBeTruthy();
  });

  it('refuses as a ValueInput does and keeps the text', () => {
    const { onChange, input } = setup();
    enter(input, '1,5');
    expect(message()).toBe('VSWR circles: "1,5" is not a number (use a decimal point: 1.5)');
    expect((input as HTMLInputElement).value).toBe('1,5');
    enter(input, '3m');
    expect(message()).toBe('VSWR circles: "3m" is not above the minimum 1');
    enter(input, '1.5 H');
    expect(message()).toBe('VSWR circles: "1.5 H" has the wrong unit (a plain number)');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(onChange).not.toHaveBeenCalled();
    enter(input, '1.5');
    expect(onChange).toHaveBeenCalledWith([1.5, 2]);
    expect(message()).toBeNull();
  });
});

describe('Field names and units', () => {
  it('a markup label names the field in a refusal', () => {
    render(
      <Field
        label={
          <>
            Q<sub>L</sub>
          </>
        }
        value={50}
        plain
        min={0}
        onCommit={() => undefined}
      />,
    );
    enter(screen.getByRole('textbox'), '-1');
    expect(message()).toBe('QL: "-1" is below the minimum 0');
  });

  it('the metre stays inside the input; "1.5 m" is 1.5 metres and "1.5 mm" 1.5 mm', () => {
    const onCommit = vi.fn();
    const { container } = render(
      <Field label="h" value={1.6e-3} unit="m" min={1e-9} onCommit={onCommit} />,
    );
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe('1.6 mm');
    expect(container.querySelector('.ui-field-unit')).toBeNull();
    enter(input, '1.5 m');
    enter(input, '1.5 mm');
    expect(onCommit.mock.calls.map((c) => c[0])).toEqual([1.5, 1.5e-3]);
  });

  it('typing the shown text back of a dB/m field commits nothing', () => {
    const onCommit = vi.fn();
    render(<Field label="α" value={0.5} plain suffix="dB/m" onCommit={onCommit} />);
    enter(screen.getByRole('textbox'), '0.5 dB/m');
    expect(onCommit).not.toHaveBeenCalled();
    expect(message()).toBeNull();
  });
});

describe('Datapoints add row', () => {
  it('labels the resistance and reactance fields R and X', () => {
    render(<Datapoints />);
    const r = screen.getByRole('textbox', { name: 'New datapoint resistance' });
    const x = screen.getByRole('textbox', { name: 'New datapoint reactance' });
    expect(r.closest('.ui-field')?.querySelector('.ui-field-label')?.textContent).toBe('R');
    expect(x.closest('.ui-field')?.querySelector('.ui-field-label')?.textContent).toBe('X');
  });
});
