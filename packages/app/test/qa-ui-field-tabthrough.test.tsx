// @vitest-environment jsdom
/**
 * QA: tabbing through a Field without typing must not change the design.
 * The input shows the value to 4 digits; a stored value with more digits
 * (50.00001 Ω, or 16.034 nH) must survive focus and blur unchanged, else a Tab
 * through a card rounds the design and adds an undo step.
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Field } from '../src/components/ui/Field';

afterEach(cleanup);

describe('Field tab-through', () => {
  it('a value with more than 4 significant digits survives focus and Tab', async () => {
    const onCommit = vi.fn();
    render(<Field label="R" value={50.00001} unit="Ω" onCommit={onCommit} ariaLabel="R" />);
    const input = screen.getByRole('textbox', { name: 'R' }) as HTMLInputElement;
    expect(input.value).toBe('50');
    const user = userEvent.setup();
    await user.click(input);
    await user.tab();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('16.034 nH survives focus and Enter', async () => {
    const onCommit = vi.fn();
    render(<Field label="L" value={16.034e-9} unit="H" onCommit={onCommit} ariaLabel="L" />);
    const input = screen.getByRole('textbox', { name: 'L' });
    const user = userEvent.setup();
    await user.click(input);
    await user.keyboard('{Enter}');
    expect(onCommit).not.toHaveBeenCalled();
  });
});
