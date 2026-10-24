// @vitest-environment jsdom
/**
 * Segmented control: role tablist, aria-selected on the chosen segment, the
 * arrow keys, Home and End move the choice and the focus, one tab stop.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Segmented } from '../src/components/ui/Segmented';

afterEach(cleanup);

type View = 'chart' | 'response' | 'splot';

function Harness({
  onChange,
  disabled,
}: {
  readonly onChange?: (v: View) => void;
  readonly disabled?: View;
}) {
  const [value, setValue] = useState<View>('chart');
  return (
    <Segmented<View>
      ariaLabel="View"
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
      options={[
        { value: 'chart', label: 'Smith chart' },
        { value: 'response', label: 'Response', disabled: disabled === 'response' },
        { value: 'splot', label: 'S-Plot' },
      ]}
    />
  );
}

const selected = (): string[] =>
  screen
    .getAllByRole('tab')
    .filter((t) => t.getAttribute('aria-selected') === 'true')
    .map((t) => t.textContent ?? '');

describe('Segmented', () => {
  it('is a tablist with one selected tab and one tab stop', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist', { name: 'View' })).toBeTruthy();
    expect(selected()).toEqual(['Smith chart']);
    const stops = screen.getAllByRole('tab').map((t) => t.tabIndex);
    expect(stops).toEqual([0, -1, -1]);
  });

  it('ArrowRight and ArrowLeft move the choice and the focus, wrapping at the ends', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Smith chart' }));
    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard('{ArrowRight}');
    expect(selected()).toEqual(['Response']);
    expect(document.activeElement?.textContent).toBe('Response');
    await user.keyboard('{ArrowRight}{ArrowRight}');
    expect(selected()).toEqual(['Smith chart']);
    await user.keyboard('{ArrowLeft}');
    expect(selected()).toEqual(['S-Plot']);
    expect(document.activeElement?.textContent).toBe('S-Plot');
    expect(onChange.mock.calls.map((c) => c[0])).toEqual(['response', 'splot', 'chart', 'splot']);
  });

  it('Home and End jump to the first and the last segment', async () => {
    render(<Harness />);
    const user = userEvent.setup();
    screen.getByRole('tab', { name: 'Smith chart' }).focus();
    await user.keyboard('{End}');
    expect(selected()).toEqual(['S-Plot']);
    await user.keyboard('{Home}');
    expect(selected()).toEqual(['Smith chart']);
  });

  it('the tab stop follows the choice', async () => {
    render(<Harness />);
    const user = userEvent.setup();
    screen.getByRole('tab', { name: 'Smith chart' }).focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('tab').map((t) => t.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('arrow keys skip a disabled segment', () => {
    render(<Harness disabled="response" />);
    const first = screen.getByRole('tab', { name: 'Smith chart' });
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(selected()).toEqual(['S-Plot']);
  });

  it('a click selects', async () => {
    render(<Harness />);
    await userEvent.setup().click(screen.getByRole('tab', { name: 'S-Plot' }));
    expect(selected()).toEqual(['S-Plot']);
  });

  it('other keys leave the choice alone', () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Smith chart' }), { key: 'a' });
    expect(selected()).toEqual(['Smith chart']);
  });
});
