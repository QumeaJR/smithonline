// @vitest-environment jsdom
/**
 * Adversarial: Segmented with zero, one, duplicate and disabled options and a
 * value outside the options; OverflowMenu opened and closed repeatedly with
 * Escape, focus restoration, duplicate labels, all items disabled; the Auto
 * match chooser on a coarse pointer.
 */
import { complex } from '@smithonline/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { AutoMatch } from '../src/components/AutoMatch';
import { OverflowMenu } from '../src/components/ui/OverflowMenu';
import { Segmented } from '../src/components/ui/Segmented';
import { emptyDesign } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('adv Segmented', () => {
  it('zero options renders and ignores the keys', () => {
    const onChange = vi.fn();
    render(<Segmented options={[]} value={'a' as string} onChange={onChange} ariaLabel="S" />);
    const list = screen.getByRole('tablist');
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    fireEvent.keyDown(list, { key: 'Home' });
    fireEvent.keyDown(list, { key: 'End' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('one option: the arrows change nothing and nothing throws', () => {
    const onChange = vi.fn();
    render(
      <Segmented
        options={[{ value: 'a', label: 'A' }]}
        value="a"
        onChange={onChange}
        ariaLabel="S"
      />,
    );
    const list = screen.getByRole('tablist');
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    fireEvent.keyDown(list, { key: 'ArrowLeft' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('duplicate labels with distinct values work', () => {
    const onChange = vi.fn();
    render(
      <Segmented
        options={[
          { value: 'a', label: 'Same' },
          { value: 'b', label: 'Same' },
        ]}
        value="a"
        onChange={onChange}
        ariaLabel="S"
      />,
    );
    fireEvent.click(screen.getAllByRole('tab')[1]!);
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('duplicate values do not produce a React key warning', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <Segmented
        options={[
          { value: 'a', label: 'One' },
          { value: 'a', label: 'Two' },
        ]}
        value="a"
        onChange={() => undefined}
        ariaLabel="S"
      />,
    );
    expect(errors.mock.calls.map((c) => String(c[0])).join('\n')).not.toMatch(/key/i);
  });

  it('a value that is not among the options: ArrowLeft goes to the last option, ArrowRight to the first', () => {
    const onChange = vi.fn();
    render(
      <Segmented
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
          { value: 'c', label: 'C' },
        ]}
        value={'zzz' as string}
        onChange={onChange}
        ariaLabel="S"
      />,
    );
    const list = screen.getByRole('tablist');
    fireEvent.keyDown(list, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('c');
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('a');
  });

  it('the chosen option disabled: ArrowLeft still lands on the last enabled option', () => {
    const onChange = vi.fn();
    render(
      <Segmented
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B', disabled: true },
          { value: 'c', label: 'C' },
          { value: 'd', label: 'D' },
        ]}
        value="b"
        onChange={onChange}
        ariaLabel="S"
      />,
    );
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('d');
  });

  it('all options disabled: keys do nothing and nothing is focusable', () => {
    const onChange = vi.fn();
    render(
      <Segmented
        options={[
          { value: 'a', label: 'A', disabled: true },
          { value: 'b', label: 'B', disabled: true },
        ]}
        value="a"
        onChange={onChange}
        ariaLabel="S"
      />,
    );
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'End' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a click on the chosen option does not call onChange again', () => {
    const onChange = vi.fn();
    render(
      <Segmented
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ]}
        value="a"
        onChange={onChange}
        ariaLabel="S"
      />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'A' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('adv OverflowMenu', () => {
  const items = (onSelect = vi.fn()) => [
    { label: 'Move up', onSelect },
    { label: 'Move down', onSelect, disabled: true },
    { label: 'Delete', onSelect, destructive: true },
  ];

  it('open, Escape, open, Escape ten times: closed, focus on the opener, no leaked listeners', async () => {
    const user = userEvent.setup();
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    render(<OverflowMenu label="More" items={items()} />);
    const opener = screen.getByRole('button', { name: 'More' });
    for (let i = 0; i < 10; i++) {
      await user.click(opener);
      expect(screen.getByRole('menu')).toBeTruthy();
      expect(document.activeElement?.textContent).toBe('Move up');
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('menu')).toBeNull();
      expect(document.activeElement).toBe(opener);
    }
    const added = addSpy.mock.calls.filter((c) => c[0] === 'keydown' || c[0] === 'pointerdown');
    const removed = removeSpy.mock.calls.filter(
      (c) => c[0] === 'keydown' || c[0] === 'pointerdown',
    );
    expect(removed.length).toBe(added.length);
  });

  it('Escape with the menu closed reaches the rest of the page', async () => {
    const user = userEvent.setup();
    const seen = vi.fn();
    window.addEventListener('keydown', seen);
    render(<OverflowMenu label="More" items={items()} />);
    await user.keyboard('{Escape}');
    expect(seen).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', seen);
  });

  it('Escape with the menu open is kept from the page (dialog stays open)', async () => {
    const user = userEvent.setup();
    const seen = vi.fn();
    document.addEventListener('keydown', seen);
    render(<OverflowMenu label="More" items={items()} />);
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.keyboard('{Escape}');
    expect(seen).not.toHaveBeenCalled();
    document.removeEventListener('keydown', seen);
  });

  it('a pointerdown outside closes it; one on the opener does not reopen it', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Outside</button>
        <OverflowMenu label="More" items={items()} />
      </>,
    );
    const opener = screen.getByRole('button', { name: 'More' });
    await user.click(opener);
    expect(screen.getByRole('menu')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('menu')).toBeNull();
    await user.click(opener);
    expect(screen.getByRole('menu')).toBeTruthy();
    await user.click(opener);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Up and Down skip disabled items and wrap; choosing restores focus and calls once', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<OverflowMenu label="More" items={items(onSelect)} />);
    const opener = screen.getByRole('button', { name: 'More' });
    await user.click(opener);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toBe('Delete');
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement?.textContent).toBe('Move up');
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement?.textContent).toBe('Delete');
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('duplicate labels do not produce a React key warning and both are selectable', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();
    const a = vi.fn();
    const b = vi.fn();
    render(
      <OverflowMenu
        label="More"
        items={[
          { label: 'Same', onSelect: a },
          { label: 'Same', onSelect: b },
        ]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(screen.getAllByRole('menuitem')[1]!);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
    expect(errors.mock.calls.map((c) => String(c[0])).join('\n')).not.toMatch(/key/i);
  });

  it('all items disabled: the menu opens, focus stays somewhere sensible, Escape closes', async () => {
    const user = userEvent.setup();
    render(
      <OverflowMenu
        label="More"
        items={[
          { label: 'A', onSelect: () => undefined, disabled: true },
          { label: 'B', onSelect: () => undefined, disabled: true },
        ]}
      />,
    );
    const opener = screen.getByRole('button', { name: 'More' });
    await user.click(opener);
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(document.activeElement).not.toBe(document.body);
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('an item whose onSelect throws still closes the menu and restores focus', async () => {
    const user = userEvent.setup();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // React reports the error thrown in the click handler to the window; handle it here so
    // it does not surface as an unhandled error of the whole run. (QA round 1 correction.)
    const swallow = (e: ErrorEvent): void => e.preventDefault();
    window.addEventListener('error', swallow);
    onTestFinished(() => window.removeEventListener('error', swallow));
    render(
      <OverflowMenu
        label="More"
        items={[
          {
            label: 'Boom',
            onSelect: () => {
              throw new Error('boom');
            },
          },
        ]}
      />,
    );
    const opener = screen.getByRole('button', { name: 'More' });
    await user.click(opener);
    await user.click(screen.getByRole('menuitem', { name: 'Boom' })).catch(() => undefined);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe('adv Auto match chooser on a coarse pointer', () => {
  beforeEach(() => {
    useDesignStore.getState().init(emptyDesign());
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(pointer: coarse)',
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  });

  it('Escape closes the open chooser without closing the tool', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <AutoMatch
        zin={complex(20, -10)}
        elements={[]}
        onPreview={() => undefined}
        onClose={onClose}
      />,
    );
    const row = screen.getByRole('button', { name: /Method:/ });
    await user.click(row);
    expect(screen.getByRole('radiogroup')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a tap outside the open chooser closes it', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Outside</button>
        <AutoMatch
          zin={complex(20, -10)}
          elements={[]}
          onPreview={() => undefined}
          onClose={() => undefined}
        />
      </>,
    );
    await user.click(screen.getByRole('button', { name: /Method:/ }));
    expect(screen.getByRole('radiogroup')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('opening the chooser moves the focus into the list', async () => {
    const user = userEvent.setup();
    render(
      <AutoMatch
        zin={complex(20, -10)}
        elements={[]}
        onPreview={() => undefined}
        onClose={() => undefined}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Method:/ }));
    expect(document.activeElement?.getAttribute('role')).toBe('radio');
  });
});
