// @vitest-environment jsdom
/**
 * QA round 2: PowerInput in dBm, negative and foreign entries, the store changing under the
 * focus, and the status message for a refused entry.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PowerInput } from '../src/components/PowerInput';
import { emptyDesign } from '../src/lib/design';
import { stressSettings } from '../src/lib/stress';
import { useDesignStore } from '../src/store/useDesignStore';

afterEach(cleanup);
beforeEach(() => {
  useDesignStore.getState().init(emptyDesign());
  useDesignStore.getState().setMessage(null);
});

const power = (): number => stressSettings(useDesignStore.getState().design).power;
const steps = (): number => useDesignStore.getState().past.length;
const message = (): string | null => useDesignStore.getState().message;

function setup(): HTMLInputElement {
  render(<PowerInput />);
  return screen.getByRole('textbox', { name: 'Source power' }) as HTMLInputElement;
}
const enter = (input: HTMLInputElement, text: string): void => {
  act(() => input.focus());
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
};

describe('PowerInput in dBm', () => {
  beforeEach(() => useDesignStore.getState().setStress({ unit: 'dBm' }));

  it('30 dBm is 1 W (10^(30/10) mW)', () => {
    const input = setup();
    enter(input, '30');
    expect(power()).toBeCloseTo(1, 12);
  });

  it('-10 dBm is 0.1 mW', () => {
    const input = setup();
    enter(input, '-10');
    expect(power()).toBeCloseTo(1e-4, 15);
  });

  it('"20 dBm" with the unit typed is 100 mW', () => {
    const input = setup();
    enter(input, '20 dBm');
    expect(power()).toBeCloseTo(0.1, 12);
  });

  it('0 dBm is 1 mW, not off (only an empty field switches the stress off)', () => {
    const input = setup();
    enter(input, '0');
    expect(power()).toBeCloseTo(1e-3, 15);
  });

  it('shows 1 W as 30', () => {
    useDesignStore.getState().setStress({ power: 1 });
    const input = setup();
    expect(input.value).toBe('30');
  });

  it('"1 W" in dBm is refused and keeps the value', () => {
    useDesignStore.getState().setStress({ power: 1 });
    const before = steps();
    const input = setup();
    enter(input, '1 W');
    expect(power()).toBe(1);
    expect(steps()).toBe(before);
    // QA round 2: the ValueInput wording for a foreign unit.
    expect(message()).toBe('P: "1 W" has the wrong unit (dBm)');
  });
});

describe('PowerInput in W', () => {
  it('a negative power is refused with its own reason', () => {
    useDesignStore.getState().setStress({ power: 1 });
    const before = steps();
    const input = setup();
    enter(input, '-1');
    expect(power()).toBe(1);
    expect(steps()).toBe(before);
    expect(message()).toBe('P: "-1" is below the minimum 0 W');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('"1e" is not a number', () => {
    const input = setup();
    enter(input, '1e');
    expect(message()).toBe('P: "1e" is not a number');
    expect(power()).toBe(0);
  });

  it('"10 mW" and "2w" carry the unit', () => {
    const input = setup();
    enter(input, '10 mW');
    expect(power()).toBeCloseTo(0.01, 15);
    enter(input, '2w');
    expect(power()).toBe(2);
  });

  it('typing 0 switches the stress off', () => {
    useDesignStore.getState().setStress({ power: 1 });
    const input = setup();
    enter(input, '0');
    expect(power()).toBe(0);
    expect(input.value).toBe('');
  });

  it('Enter keeps the focus', () => {
    const input = setup();
    enter(input, '1');
    expect(document.activeElement).toBe(input);
  });

  it('an unchanged value commits no undo step', () => {
    useDesignStore.getState().setStress({ power: 1 });
    const before = steps();
    const input = setup();
    enter(input, '1');
    expect(steps()).toBe(before);
  });

  it('focused and untouched: a store change shows at once, the blur records nothing', () => {
    useDesignStore.getState().setStress({ power: 1 });
    const input = setup();
    act(() => input.focus());
    act(() => useDesignStore.getState().setStress({ power: 0.5 }));
    expect(input.value).toBe('500m');
    const before = steps();
    act(() => input.blur());
    expect(power()).toBe(0.5);
    expect(steps()).toBe(before);
  });

  it('typed, store change, Escape: the store value stays and shows', () => {
    useDesignStore.getState().setStress({ power: 1 });
    const input = setup();
    act(() => input.focus());
    fireEvent.change(input, { target: { value: '3' } });
    act(() => useDesignStore.getState().setStress({ power: 0.5 }));
    expect(input.value).toBe('3');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(power()).toBe(0.5);
    expect(input.value).toBe('500m');
  });

  it('clearing an already empty field records nothing', () => {
    const input = setup();
    enter(input, '   ');
    expect(steps()).toBe(0);
    expect(power()).toBe(0);
  });
});
