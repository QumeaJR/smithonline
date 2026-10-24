// @vitest-environment jsdom
/**
 * Auto match methods: a segmented control on a fine pointer, a chooser row
 * with the grouped list of methods and their descriptions on a coarse one.
 */
import { complex } from '@smithonline/core';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoMatch } from '../src/components/AutoMatch';
import { emptyDesign } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';

function stubPointer(coarse: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: coarse && query === '(pointer: coarse)',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

const noop = (): void => undefined;

beforeEach(() => {
  useDesignStore.getState().init(emptyDesign());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Auto match method choice', () => {
  it('a fine pointer shows the five methods as a segmented control', async () => {
    stubPointer(false);
    const onPreview = vi.fn();
    render(<AutoMatch zin={complex(20, -10)} elements={[]} onPreview={onPreview} onClose={noop} />);
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual([
      'Tune existing parts',
      'Add parts',
      'Broadband',
      'Transformer',
      'Stub filter',
    ]);
    // An empty network opens on Add parts.
    expect(screen.getByRole('tab', { name: 'Add parts' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Stub filter' }));
    expect(screen.getByRole('tab', { name: 'Stub filter' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    // Leaving Add parts drops its preview, as the buttons did.
    expect(onPreview).toHaveBeenCalledWith(null);
  });

  it('a coarse pointer shows one chooser row that opens the grouped list', async () => {
    stubPointer(true);
    render(<AutoMatch zin={complex(20, -10)} elements={[]} onPreview={noop} onClose={noop} />);
    expect(screen.queryByRole('tab')).toBeNull();
    const user = userEvent.setup();
    const row = screen.getByRole('button', { name: /Method:/ });
    // The panel reopens on the designer used last in the session (Stub filter, above).
    expect(row.textContent).toContain('Stub filter');
    await user.click(row);
    expect(screen.getByRole('group', { name: 'Towards the target' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Distributed designers' })).toBeTruthy();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(5);
    expect(radios.every((r) => (r.querySelector('span')?.textContent ?? '').length > 0)).toBe(true);
    await user.click(screen.getByRole('radio', { name: /^Transformer/ }));
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(screen.getByRole('button', { name: /Method:/ }).textContent).toContain('Transformer');
  });
});
