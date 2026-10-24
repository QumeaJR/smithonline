// @vitest-environment jsdom
/**
 * The ladder card with the new controls: inline small buttons on a fine
 * pointer, one overflow menu on a coarse one, and the tune slider as one
 * undo step per drag.
 */
import { evaluateLadder } from '@smithonline/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ladder } from '../src/components/Ladder';
import { emptyDesign } from '../src/lib/design';
import { PALETTE } from '../src/lib/elements';
import { effectiveElements } from '../src/lib/realize';
import { useDesignStore } from '../src/store/useDesignStore';

function LiveLadder() {
  const design = useDesignStore((s) => s.design);
  const result = evaluateLadder({
    z0: design.z0,
    frequency: design.frequency,
    load: design.load,
    elements: effectiveElements(design),
  });
  return <Ladder result={result} realization={null} />;
}

const make = (id: string) => {
  const entry = PALETTE.find((p) => p.id === id);
  if (!entry) throw new Error(id);
  return entry.make(50, 1e9);
};

function stubPointer(coarse: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: coarse && query === '(pointer: coarse)',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

beforeEach(() => {
  useDesignStore.getState().init(emptyDesign());
  useDesignStore.getState().addElements([make('seriesL'), make('shuntL')]);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ladder card controls', () => {
  it('a fine pointer shows Move up, Move down and Delete inline', () => {
    stubPointer(false);
    render(<LiveLadder />);
    expect(screen.getAllByRole('button', { name: 'Move up' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /More for element/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Winding…' })).toHaveLength(2);
  });

  it('a coarse pointer collapses them into one overflow menu per card', async () => {
    stubPointer(true);
    render(<LiveLadder />);
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Winding…' })).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'More for element 1' }));
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Move up', 'Move down', 'Winding…', 'Delete']);
    expect((items[0] as HTMLButtonElement).disabled).toBe(true);
    const before = useDesignStore.getState().past.length;
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(useDesignStore.getState().design.elements).toHaveLength(1);
    expect(useDesignStore.getState().past.length).toBe(before + 1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Escape closes the overflow menu without acting', async () => {
    stubPointer(true);
    render(<LiveLadder />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'More for element 2' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(useDesignStore.getState().design.elements).toHaveLength(2);
  });

  it('the tune slider of a card is one undo step per drag', () => {
    stubPointer(false);
    render(<LiveLadder />);
    const tune = screen.getByRole('slider', { name: /^Tune Series L/ }) as HTMLInputElement;
    const before = useDesignStore.getState().past.length;
    const start = useDesignStore.getState().design.elements[0];
    fireEvent.pointerDown(tune);
    for (const v of ['0.1', '0.2', '0.3']) fireEvent.change(tune, { target: { value: v } });
    fireEvent.pointerUp(window);
    expect(useDesignStore.getState().past.length).toBe(before + 1);
    useDesignStore.getState().undo();
    expect(useDesignStore.getState().design.elements[0]).toEqual(start);
  });

  it('the value fields carry the unit in their box', () => {
    stubPointer(false);
    render(<LiveLadder />);
    const card = screen.getAllByRole('slider')[0]?.closest('.card');
    const units = [...(card?.querySelectorAll('.ui-field-unit') ?? [])].map((u) => u.textContent);
    expect(units).toContain('H');
  });
});
