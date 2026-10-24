// @vitest-environment jsdom
/**
 * QA: OverflowMenu keyboard: Escape closes and returns the focus to the
 * opener (and is stopped before other listeners), ArrowDown and ArrowUp wrap
 * and skip disabled items, other keys are ignored, a pointer outside closes,
 * a choice closes and acts, all items disabled.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OverflowMenu, type OverflowItem } from '../src/components/ui/OverflowMenu';

afterEach(cleanup);

function setup(items?: readonly OverflowItem[]) {
  const up = vi.fn();
  const down = vi.fn();
  const del = vi.fn();
  render(
    <div>
      <button type="button">before</button>
      <OverflowMenu
        label="More for element 1"
        items={
          items ?? [
            { label: 'Move up', onSelect: up, disabled: true },
            { label: 'Move down', onSelect: down },
            { label: 'Delete', onSelect: del, destructive: true },
          ]
        }
      />
    </div>,
  );
  const opener = screen.getByRole('button', { name: 'More for element 1' }) as HTMLButtonElement;
  return { opener, up, down, del, user: userEvent.setup() };
}

const item = (name: string): HTMLButtonElement =>
  screen.getByRole('menuitem', { name }) as HTMLButtonElement;

describe('OverflowMenu', () => {
  it('opens on the first enabled item with aria-expanded', async () => {
    const { opener, user } = setup();
    expect(opener.getAttribute('aria-expanded')).toBe('false');
    expect(opener.getAttribute('aria-haspopup')).toBe('menu');
    await user.click(opener);
    expect(opener.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu', { name: 'More for element 1' })).toBeTruthy();
    expect(document.activeElement).toBe(item('Move down'));
    expect(item('Move up').disabled).toBe(true);
    expect(item('Delete').classList.contains('destructive')).toBe(true);
  });

  it('Escape closes the menu, returns the focus to the opener and stops other listeners', async () => {
    const { opener, user } = setup();
    const outside = vi.fn();
    document.addEventListener('keydown', outside);
    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(opener.getAttribute('aria-expanded')).toBe('false');
    // The capture listener on window stopped the event before the document saw it.
    expect(outside).not.toHaveBeenCalled();
    // Closed: Escape reaches the document again.
    await user.keyboard('{Escape}');
    expect(outside).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', outside);
  });

  it('ArrowDown moves through enabled items and wraps to the first enabled one', async () => {
    const { opener, user } = setup();
    await user.click(opener);
    expect(document.activeElement).toBe(item('Move down'));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(item('Delete'));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(item('Move down'));
  });

  it('ArrowUp wraps from the first enabled item to the last', async () => {
    const { opener, user } = setup();
    await user.click(opener);
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(item('Delete'));
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(item('Move down'));
  });

  it('the arrow keys are consumed, other keys are not', async () => {
    const { opener, user } = setup();
    await user.click(opener);
    const menu = screen.getByRole('menu');
    expect(fireEvent.keyDown(menu, { key: 'ArrowDown' })).toBe(false);
    expect(fireEvent.keyDown(menu, { key: 'ArrowUp' })).toBe(false);
    expect(fireEvent.keyDown(menu, { key: 'ArrowRight' })).toBe(true);
    expect(fireEvent.keyDown(menu, { key: 'Home' })).toBe(true);
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('a choice closes the menu, acts once and returns the focus to the opener', async () => {
    const { opener, del, user } = setup();
    await user.click(opener);
    await user.click(item('Delete'));
    expect(del).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('a disabled item does not act', async () => {
    const { opener, up, user } = setup();
    await user.click(opener);
    await user.click(item('Move up'));
    expect(up).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('a pointer down outside closes it; one inside does not', async () => {
    const { opener, user } = setup();
    await user.click(opener);
    fireEvent.pointerDown(screen.getByRole('menu'));
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'before' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('a second click on the opener closes it', async () => {
    const { opener, user } = setup();
    await user.click(opener);
    await user.click(opener);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(opener.getAttribute('aria-expanded')).toBe('false');
  });

  it('a click inside does not bubble to the card behind', async () => {
    const onCard = vi.fn();
    render(
      <div onClick={onCard}>
        <OverflowMenu label="M" items={[{ label: 'X', onSelect: () => undefined }]} />
      </div>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'M' }));
    await user.click(screen.getByRole('menuitem', { name: 'X' }));
    expect(onCard).not.toHaveBeenCalled();
  });

  it('every item disabled: opens without a focused item, arrows do nothing', async () => {
    const { opener, user } = setup([
      { label: 'A', onSelect: () => undefined, disabled: true },
      { label: 'B', onSelect: () => undefined, disabled: true },
    ]);
    await user.click(opener);
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(document.activeElement).toBe(opener);
    expect(() => fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' })).not.toThrow();
    expect(() => fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' })).not.toThrow();
  });

  it('the listeners are removed on close: a later outside pointer is harmless', async () => {
    const { opener, user } = setup();
    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(() => fireEvent.pointerDown(document.body)).not.toThrow();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
