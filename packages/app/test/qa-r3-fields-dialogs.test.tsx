// @vitest-environment jsdom
/**
 * QA round 3: the shared parser seen through the app (a farad Field, PowerInput in dBm, the
 * noise circle list), Escape in the Winding and Dimensions dialogs, and the sticky actions row
 * of every dialog that has one. it.fails marks a finding: the test states the expected
 * behaviour and fails on the current code.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DimensionsDialog } from '../src/components/DimensionsDialog';
import { NumberList } from '../src/components/NumberList';
import { PowerInput } from '../src/components/PowerInput';
import { SettingsDialog } from '../src/components/SettingsDialog';
import { WindingDialog } from '../src/components/WindingDialog';
import { Field } from '../src/components/ui/Field';
import { emptyDesign } from '../src/lib/design';
import { stressSettings } from '../src/lib/stress';
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

describe('qa r3 a capacitor Field', () => {
  it('"22pf" commits 22 pF (round 1 accepted it; "22nh" is accepted in an H field)', () => {
    const onCommit = vi.fn();
    render(<Field label="C" value={1e-12} unit="F" min={0} onCommit={onCommit} />);
    enter(screen.getByRole('textbox'), '22pf');
    expect(message()).toBeNull();
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]![0]).toBeCloseTo(22e-12, 20);
  });

  // Corrected after round 3: "2e-12 f" has two readings (2e-12 fF, or 2e-12 F with the unit
  // in lower case); the refusal names both instead of calling f a wrong unit.
  it('"22 pF" commits 22 pF and "2e-12 f" is refused as ambiguous with both readings', () => {
    const onCommit = vi.fn();
    render(<Field label="C" value={1e-12} unit="F" min={0} onCommit={onCommit} />);
    const input = screen.getByRole('textbox');
    enter(input, '2e-12 f');
    expect(onCommit).not.toHaveBeenCalled();
    expect(message()).toBe('C: "2e-12 f" is ambiguous (2e-12 fF or 2e-12 F?)');
    enter(input, '22 pF');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]![0]).toBeCloseTo(22e-12, 20);
    expect(message()).toBeNull();
  });
});

describe('qa r3 PowerInput in dBm', () => {
  beforeEach(() => useDesignStore.getState().setStress({ unit: 'dBm' }));

  it('"20 dbm" (another letter case of the unit) is 0.1 W: 10^(20/10) mW', () => {
    render(<PowerInput />);
    enter(screen.getByRole('textbox', { name: 'Source power' }), '20 dbm');
    expect(stressSettings(useDesignStore.getState().design).power).toBeCloseTo(0.1, 12);
  });

  it('"1 W" in the dBm field is refused as the wrong unit', () => {
    render(<PowerInput />);
    enter(screen.getByRole('textbox', { name: 'Source power' }), '1 W');
    expect(stressSettings(useDesignStore.getState().design).power).toBe(0);
    expect(message()).toBe('P: "1 W" has the wrong unit (dBm)');
  });
});

describe('qa r3 NumberList with a dB unit', () => {
  const setup = () => {
    const onChange = vi.fn();
    render(
      <NumberList
        label="Noise circles"
        itemName="noise circle"
        values={[]}
        min={0.5}
        swatch="red"
        placeholder="1"
        unit=" dB"
        onChange={onChange}
      />,
    );
    return { onChange, input: screen.getByRole('textbox', { name: 'Add Noise circles' }) };
  };

  it('"0.8dB" is added as 0.8: the trimmed unit is accepted after the number', () => {
    const { onChange, input } = setup();
    enter(input, '0.8dB');
    expect(onChange).toHaveBeenCalledWith([0.8]);
  });

  it('the minimum in the refusal reads in dB as the chips do: 0.5 dB, not 500 mdB', () => {
    const { onChange, input } = setup();
    enter(input, '0.4');
    expect(onChange).not.toHaveBeenCalled();
    expect(message()).toBe('Noise circles: "0.4" is not above the minimum 0.5 dB');
  });

  it('Escape with typed text clears it and does not reach a window listener', () => {
    const { input } = setup();
    const onWindow = vi.fn();
    window.addEventListener('keydown', onWindow);
    try {
      act(() => input.focus());
      fireEvent.change(input, { target: { value: '3' } });
      fireEvent.keyDown(input, { key: 'Escape' });
      expect((input as HTMLInputElement).value).toBe('');
      expect(onWindow).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', onWindow);
    }
  });
});

describe('qa r3 Escape in the Winding and Dimensions dialogs', () => {
  it.each([
    [
      'Winding',
      { kind: 'L', orientation: 'series', value: 10e-9 } as const,
      (onClose: () => void) => <WindingDialog index={0} onClose={onClose} />,
    ],
    [
      'Dimensions',
      { kind: 'line', z0: 50, length: 0.1 } as const,
      (onClose: () => void) => <DimensionsDialog index={0} onClose={onClose} />,
    ],
  ])('%s: the first Escape reverts and keeps the focus, the second closes', (_, el, make) => {
    useDesignStore.getState().addElement(el);
    const onClose = vi.fn();
    render(make(onClose));
    const input = screen.getAllByRole('textbox')[0] as HTMLInputElement;
    const before = input.value;
    act(() => input.focus());
    fireEvent.change(input, { target: { value: '123' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(input.value).toBe(before);
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('qa r3 the actions row of every dialog that has one', () => {
  it.each([
    ['Settings', null, (c: () => void) => <SettingsDialog onClose={c} />],
    [
      'Winding',
      { kind: 'L', orientation: 'series', value: 10e-9 } as const,
      (c: () => void) => <WindingDialog index={0} onClose={c} />,
    ],
    [
      'Dimensions',
      { kind: 'line', z0: 50, length: 0.1 } as const,
      (c: () => void) => <DimensionsDialog index={0} onClose={c} />,
    ],
  ])('%s: one .actions row is a direct child and the last child of .modal', (_, el, make) => {
    if (el) useDesignStore.getState().addElement(el);
    const { container } = render(make(() => undefined));
    const modal = container.querySelector('.modal');
    expect(modal).not.toBeNull();
    const direct = modal!.querySelectorAll(':scope > .actions');
    expect(direct).toHaveLength(1);
    expect(modal!.lastElementChild).toBe(direct[0]);
  });
});
