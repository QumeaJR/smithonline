// @vitest-environment jsdom
/**
 * Switch: a checkbox with role switch. Space toggles it; wired to the store
 * (the Realize and Losses switches) one toggle is one undo step.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RealizeControls } from '../src/components/RealizeControls';
import { Switch } from '../src/components/ui/Switch';
import { emptyDesign } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';

afterEach(cleanup);
beforeEach(() => {
  useDesignStore.getState().init(emptyDesign());
});

function Harness({ disabled = false }: { readonly disabled?: boolean }) {
  const [on, setOn] = useState(false);
  return (
    <Switch checked={on} onChange={setOn} disabled={disabled}>
      Sweep
    </Switch>
  );
}

describe('Switch', () => {
  it('is a checkbox with role switch, named by its label', () => {
    render(<Harness />);
    const sw = screen.getByRole('switch', { name: 'Sweep' }) as HTMLInputElement;
    expect(sw.type).toBe('checkbox');
    expect(sw.checked).toBe(false);
  });

  it('Space toggles it on and off', async () => {
    render(<Harness />);
    const user = userEvent.setup();
    const sw = screen.getByRole('switch', { name: 'Sweep' }) as HTMLInputElement;
    sw.focus();
    await user.keyboard(' ');
    expect(sw.checked).toBe(true);
    await user.keyboard(' ');
    expect(sw.checked).toBe(false);
  });

  it('a click on the label toggles it', async () => {
    render(<Harness />);
    await userEvent.setup().click(screen.getByText('Sweep'));
    expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(true);
  });

  it('a disabled switch does not toggle', async () => {
    render(<Harness disabled />);
    const user = userEvent.setup();
    const sw = screen.getByRole('switch') as HTMLInputElement;
    await user.click(sw);
    expect(sw.checked).toBe(false);
  });

  it('Realize: Space toggles the store, one undo step per toggle', async () => {
    render(<RealizeControls />);
    const user = userEvent.setup();
    const sw = screen.getByRole('switch', { name: 'Realize' }) as HTMLInputElement;
    const before = useDesignStore.getState().past.length;
    sw.focus();
    await user.keyboard(' ');
    expect(useDesignStore.getState().design.realize.enabled).toBe(true);
    expect(sw.checked).toBe(true);
    expect(useDesignStore.getState().past.length).toBe(before + 1);
    // The series selector appears with Realize on.
    expect(screen.getByRole('combobox', { name: 'Value series' })).toBeTruthy();
    useDesignStore.getState().undo();
    expect(useDesignStore.getState().design.realize.enabled).toBe(false);
    expect(useDesignStore.getState().past.length).toBe(before);
  });

  it('Losses: a toggle is one undo step and shows the default Q with Edit…', async () => {
    render(<RealizeControls />);
    const user = userEvent.setup();
    const before = useDesignStore.getState().past.length;
    await user.click(screen.getByRole('switch', { name: 'Losses' }));
    expect(useDesignStore.getState().design.losses.enabled).toBe(true);
    expect(useDesignStore.getState().past.length).toBe(before + 1);
    // The Q fields are in Build, Losses; the row says them in a line.
    const row = screen.getByRole('group', { name: 'Losses' });
    expect(row.textContent).toMatch(/Q 50 \(L\), 500 \(C\)/);
    expect(screen.getByRole('button', { name: 'Edit…' })).toBeTruthy();
  });
});
