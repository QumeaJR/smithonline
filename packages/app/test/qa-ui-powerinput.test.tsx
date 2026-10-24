// @vitest-environment jsdom
/**
 * QA: the source power field beside the frequency field, changed to
 * inputMode text in the same commit as ValueInput. Escape must revert like
 * ValueInput's Escape does; Enter commits; empty switches the stress off.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PowerInput } from '../src/components/PowerInput';
import { emptyDesign } from '../src/lib/design';
import { stressSettings } from '../src/lib/stress';
import { useDesignStore } from '../src/store/useDesignStore';

afterEach(cleanup);
beforeEach(() => useDesignStore.getState().init(emptyDesign()));

const power = (): number => stressSettings(useDesignStore.getState().design).power;
const steps = (): number => useDesignStore.getState().past.length;

describe('PowerInput', () => {
  it('uses the text keyboard like the value fields', () => {
    render(<PowerInput />);
    const input = screen.getByRole('textbox', { name: 'Source power' });
    expect(input.getAttribute('inputmode')).toBe('text');
  });

  it('Enter commits watts as one undo step', async () => {
    render(<PowerInput />);
    const input = screen.getByRole('textbox', { name: 'Source power' });
    const user = userEvent.setup();
    await user.click(input);
    await user.type(input, '250m{Enter}');
    expect(power()).toBeCloseTo(0.25, 12);
    expect(steps()).toBe(1);
  });

  it('Escape reverts the typed text and commits nothing', async () => {
    render(<PowerInput />);
    const input = screen.getByRole('textbox', { name: 'Source power' }) as HTMLInputElement;
    const user = userEvent.setup();
    await user.click(input);
    await user.type(input, '5{Escape}');
    expect(power()).toBe(0);
    expect(steps()).toBe(0);
    expect(input.value).toBe('');
  });

  it('clearing the field switches the stress off', async () => {
    useDesignStore.getState().setStress({ power: 1 });
    render(<PowerInput />);
    const input = screen.getByRole('textbox', { name: 'Source power' }) as HTMLInputElement;
    expect(input.value).toBe('1');
    const user = userEvent.setup();
    await user.click(input);
    await user.clear(input);
    await user.keyboard('{Enter}');
    expect(power()).toBe(0);
    expect(input.placeholder).toBe('off');
  });

  it('text that is not a power flashes and keeps the old value', async () => {
    useDesignStore.getState().setStress({ power: 1 });
    const before = steps();
    render(<PowerInput />);
    const input = screen.getByRole('textbox', { name: 'Source power' }) as HTMLInputElement;
    const user = userEvent.setup();
    await user.click(input);
    await user.clear(input);
    await user.type(input, 'abc{Enter}');
    expect(power()).toBe(1);
    expect(steps()).toBe(before);
    expect(input.className).toContain('invalid');
  });
});
