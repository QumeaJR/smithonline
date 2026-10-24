// @vitest-environment jsdom
/**
 * QA round 2: the coarse Auto match method chooser and the ladder card overflow menu, which
 * round 1 made behave alike: keys, focus return, and closing on a tap outside, including a
 * tap on a panel that stops pointerdown from bubbling (the tool panels and the dialogs do).
 */
import { complex } from '@smithonline/core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoMatch } from '../src/components/AutoMatch';
import { OverflowMenu } from '../src/components/ui/OverflowMenu';
import { emptyDesign } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Auto match chooser on a coarse pointer', () => {
  beforeEach(() => {
    useDesignStore.getState().init(emptyDesign());
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(pointer: coarse)',
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
  });

  function setup() {
    render(
      <AutoMatch
        zin={complex(20, -10)}
        elements={[]}
        onPreview={() => undefined}
        onClose={() => undefined}
      />,
    );
    return screen.getByRole('button', { name: /Method:/ });
  }

  it('Up from the first method wraps to the last, Down from the last to the first', async () => {
    const row = setup();
    await userEvent.setup().click(row);
    const radios = screen.getAllByRole('radio');
    expect(radios.length).toBe(5);
    act(() => radios[0]!.focus());
    fireEvent.keyDown(radios[0]!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(radios[4]);
    fireEvent.keyDown(radios[4]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(radios[0]);
  });

  it('choosing a method closes the list, returns the focus to the row and names the method', async () => {
    const row = setup();
    const user = userEvent.setup();
    await user.click(row);
    const radios = screen.getAllByRole('radio');
    const last = radios[4]!;
    const label = last.firstChild?.textContent ?? '';
    await user.click(last);
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(document.activeElement).toBe(row);
    expect(row.textContent).toContain(label);
    expect(row.getAttribute('aria-expanded')).toBe('false');
  });

  // Fixed in QA round 2. The row announced a listbox popup while the popup is a radiogroup;
  // aria-haspopup cannot name a radiogroup, so the row says true (a popup) with aria-expanded.
  it('the row announces a popup and its state, not a listbox', async () => {
    const row = setup();
    expect(row.getAttribute('aria-haspopup')).toBe('true');
    expect(row.getAttribute('aria-expanded')).toBe('false');
    await userEvent.setup().click(row);
    expect(screen.getByRole('radiogroup')).toBeTruthy();
    expect(row.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('Overflow menu: a tap outside', () => {
  const items = () => [
    { label: 'Move up', onSelect: () => undefined },
    { label: 'Delete', onSelect: () => undefined, destructive: true },
  ];

  it('a tap on plain page content closes the menu', () => {
    render(
      <>
        <div data-testid="outside">page</div>
        <OverflowMenu label="More" items={items()} />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.pointerDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  // Fixed in QA round 2: the menu listens in the capture phase, as the Auto match chooser.
  it('a tap on a panel that stops pointerdown from bubbling also closes the menu', () => {
    render(
      <>
        <div data-testid="panel" onPointerDown={(e) => e.stopPropagation()}>
          tool panel
        </div>
        <OverflowMenu label="More" items={items()} />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.pointerDown(screen.getByTestId('panel'));
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
