// @vitest-environment jsdom
/**
 * QA: Segmented keyboard wrap in both directions (ArrowUp/ArrowDown too),
 * Home and End from the far ends, disabled segments at the ends, a chosen
 * value that is itself disabled, all segments disabled, one segment, classes.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Segmented } from '../src/components/ui/Segmented';

afterEach(cleanup);

type K = 'a' | 'b' | 'c' | 'd';

function Harness({
  initial = 'a',
  disabled = [],
  onChange,
  options = ['a', 'b', 'c', 'd'],
  size,
  wrap,
  className,
}: {
  readonly initial?: K;
  readonly disabled?: readonly K[];
  readonly onChange?: (v: K) => void;
  readonly options?: readonly K[];
  readonly size?: 'md' | 'sm';
  readonly wrap?: boolean;
  readonly className?: string;
}) {
  const [value, setValue] = useState<K>(initial);
  return (
    <Segmented<K>
      ariaLabel="Pick"
      value={value}
      {...(size !== undefined ? { size } : {})}
      {...(wrap !== undefined ? { wrap } : {})}
      {...(className !== undefined ? { className } : {})}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
      options={options.map((o) => ({
        value: o,
        label: o.toUpperCase(),
        title: `title ${o}`,
        disabled: disabled.includes(o),
      }))}
    />
  );
}

const tab = (name: string): HTMLButtonElement =>
  screen.getByRole('tab', { name }) as HTMLButtonElement;
const chosen = (): string[] =>
  screen
    .getAllByRole('tab')
    .filter((t) => t.getAttribute('aria-selected') === 'true')
    .map((t) => t.textContent ?? '');
/** fireEvent returns false when the handler called preventDefault. */
const key = (el: Element, k: string): boolean => fireEvent.keyDown(el, { key: k });

describe('Segmented keyboard wrap', () => {
  it('ArrowLeft on the first segment wraps to the last and moves the focus', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    tab('A').focus();
    const consumed = !key(tab('A'), 'ArrowLeft');
    expect(consumed).toBe(true);
    expect(chosen()).toEqual(['D']);
    expect(document.activeElement).toBe(tab('D'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('d');
  });

  it('ArrowUp on the first segment wraps to the last', () => {
    render(<Harness />);
    tab('A').focus();
    key(tab('A'), 'ArrowUp');
    expect(chosen()).toEqual(['D']);
    expect(document.activeElement).toBe(tab('D'));
  });

  it('ArrowRight on the last segment wraps to the first', () => {
    render(<Harness initial="d" />);
    tab('D').focus();
    key(tab('D'), 'ArrowRight');
    expect(chosen()).toEqual(['A']);
    expect(document.activeElement).toBe(tab('A'));
  });

  it('ArrowDown on the last segment wraps to the first', () => {
    render(<Harness initial="d" />);
    tab('D').focus();
    key(tab('D'), 'ArrowDown');
    expect(chosen()).toEqual(['A']);
  });

  it('the wrap skips a disabled last segment', () => {
    render(<Harness disabled={['d']} />);
    tab('A').focus();
    key(tab('A'), 'ArrowLeft');
    expect(chosen()).toEqual(['C']);
    expect(document.activeElement).toBe(tab('C'));
  });

  it('the wrap skips a disabled first segment', () => {
    render(<Harness initial="d" disabled={['a']} />);
    key(tab('D'), 'ArrowRight');
    expect(chosen()).toEqual(['B']);
  });
});

describe('Segmented Home and End', () => {
  it('Home from the last segment chooses and focuses the first', () => {
    const onChange = vi.fn();
    render(<Harness initial="d" onChange={onChange} />);
    tab('D').focus();
    key(tab('D'), 'Home');
    expect(chosen()).toEqual(['A']);
    expect(document.activeElement).toBe(tab('A'));
    expect(onChange).toHaveBeenCalledWith('a');
    expect(screen.getAllByRole('tab').map((t) => t.tabIndex)).toEqual([0, -1, -1, -1]);
  });

  it('End from the first segment chooses and focuses the last', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    tab('A').focus();
    key(tab('A'), 'End');
    expect(chosen()).toEqual(['D']);
    expect(document.activeElement).toBe(tab('D'));
    expect(onChange).toHaveBeenCalledWith('d');
    expect(screen.getAllByRole('tab').map((t) => t.tabIndex)).toEqual([-1, -1, -1, 0]);
  });

  it('Home on the first segment changes nothing but is still consumed', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const consumed = !key(tab('A'), 'Home');
    expect(consumed).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    expect(chosen()).toEqual(['A']);
  });

  it('End on the last segment changes nothing', () => {
    const onChange = vi.fn();
    render(<Harness initial="d" onChange={onChange} />);
    key(tab('D'), 'End');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Home and End land on the first and last enabled segment', () => {
    render(<Harness initial="b" disabled={['a', 'd']} />);
    key(tab('B'), 'End');
    expect(chosen()).toEqual(['C']);
    key(tab('C'), 'Home');
    expect(chosen()).toEqual(['B']);
  });
});

describe('Segmented edge cases', () => {
  it('a chosen segment that is disabled: ArrowRight goes to the first enabled one', () => {
    render(<Harness initial="b" disabled={['b']} />);
    key(tab('B'), 'ArrowRight');
    expect(chosen()).toEqual(['A']);
  });

  it('a chosen segment that is disabled: ArrowLeft goes to the last enabled one', () => {
    render(<Harness initial="b" disabled={['b']} />);
    key(tab('B'), 'ArrowLeft');
    expect(chosen()).toEqual(['D']);
  });

  it('every segment disabled: keys change nothing and are not consumed', () => {
    const onChange = vi.fn();
    render(<Harness disabled={['a', 'b', 'c', 'd']} onChange={onChange} />);
    for (const k of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
      const consumed = !key(tab('A'), k);
      expect(consumed).toBe(false);
    }
    expect(onChange).not.toHaveBeenCalled();
    expect(chosen()).toEqual(['A']);
  });

  it('one segment: the arrows stay on it without a change', () => {
    const onChange = vi.fn();
    render(<Harness options={['a']} onChange={onChange} />);
    key(tab('A'), 'ArrowRight');
    key(tab('A'), 'ArrowLeft');
    key(tab('A'), 'End');
    expect(onChange).not.toHaveBeenCalled();
    expect(chosen()).toEqual(['A']);
  });

  it('a click on a disabled segment changes nothing', () => {
    const onChange = vi.fn();
    render(<Harness disabled={['c']} onChange={onChange} />);
    fireEvent.click(tab('C'));
    expect(onChange).not.toHaveBeenCalled();
    expect(tab('C').disabled).toBe(true);
  });

  it('other keys are not consumed', () => {
    render(<Harness />);
    expect(key(tab('A'), 'Enter')).toBe(true);
    expect(key(tab('A'), 'PageDown')).toBe(true);
  });

  it('carries the size, wrap and extra classes and the option titles', () => {
    render(<Harness size="sm" wrap className="extra" />);
    const list = screen.getByRole('tablist', { name: 'Pick' });
    expect(list.classList.contains('segmented')).toBe(true);
    expect(list.classList.contains('sm')).toBe(true);
    expect(list.classList.contains('wrap')).toBe(true);
    expect(list.classList.contains('extra')).toBe(true);
    expect(tab('B').title).toBe('title b');
    expect(tab('A').type).toBe('button');
  });

  it('md without wrap carries neither class', () => {
    render(<Harness />);
    const list = screen.getByRole('tablist', { name: 'Pick' });
    expect(list.className).toBe('segmented');
  });

  it('the thumb is decoration and the host is not ready without layout', () => {
    render(<Harness />);
    const list = screen.getByRole('tablist', { name: 'Pick' });
    expect(list.querySelector('.segmented-thumb')?.getAttribute('aria-hidden')).toBe('true');
    // jsdom has no layout: offsetWidth is 0, so the thumb is not placed.
    expect(list.classList.contains('ready')).toBe(false);
  });
});
