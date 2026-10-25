// @vitest-environment jsdom
/**
 * Adversarial, phase 6 quiet labels with user text: typing a design name into the name field
 * against the 100-step history. Each test asserts the correct behaviour; a failure is a defect.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DesignFields } from '../src/components/DesignFields';
import { emptyDesign } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';

const D = () => useDesignStore.getState();
beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  }));
  D().init(emptyDesign());
  D().setMessage(null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('typing the design name', () => {
  it('a typed name does not push the earlier steps out of the history', () => {
    for (let i = 1; i <= 30; i++) D().setFrequency(i * 1e6);
    render(<DesignFields />);
    const input = screen.getByRole('textbox', { name: 'Design name' });
    const name = 'Low noise amplifier input match, 2.4 GHz ISM band, rev B for the 2026 board';
    let typed = '';
    for (const ch of name) {
      typed += ch;
      fireEvent.change(input, { target: { value: typed } });
    }
    // The name commits like the other typed fields: on the blur (or Enter), as one step.
    expect(D().design.name).toBe('Untitled');
    fireEvent.blur(input);
    expect(D().design.name).toBe(name);
    // The 30 frequency edits are still there to undo after the rename.
    D().undo();
    expect(D().message).toBe(`Undo: Renamed the design to "${name}"`);
    expect(D().design.name).toBe('Untitled');
  });

  it('Enter commits as one step; Escape reverts the draft and records nothing', () => {
    render(<DesignFields />);
    const input = screen.getByRole('textbox', { name: 'Design name' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Amp' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('Untitled');
    fireEvent.blur(input);
    expect(D().past).toHaveLength(0);
    fireEvent.change(input, { target: { value: 'Amp' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(D().design.name).toBe('Amp');
    expect(D().past).toHaveLength(1);
  });
});
