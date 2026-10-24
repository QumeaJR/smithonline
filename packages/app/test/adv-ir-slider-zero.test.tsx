// @vitest-environment jsdom
/** Adversarial: the ladder tune slider after an element value of 0 is typed. */
import { evaluateLadder } from '@smithonline/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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
const state = () => useDesignStore.getState();
const value = () => {
  const el = state().design.elements[0]!;
  return 'value' in el ? el.value : NaN;
};

beforeEach(() => {
  state().init(emptyDesign());
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('typing 0 into R, then Reset: the slider still moves the value off 0', () => {
  state().addElements([PALETTE.find((p) => p.id === 'seriesR')!.make(50, 1e9)]);
  render(<LiveLadder />);
  const field = screen.getByRole('textbox', { name: 'Series R 1 resistance' }) as HTMLInputElement;
  fireEvent.focus(field);
  fireEvent.change(field, { target: { value: '0' } });
  fireEvent.blur(field);
  expect(value()).toBe(0);
  const s = screen.getByRole('slider', { name: /Tune/ }) as HTMLInputElement;
  // The knob was centred on 50 before: the slider still works until Reset.
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  fireEvent.pointerDown(s);
  fireEvent.change(s, { target: { value: '1' } });
  fireEvent.pointerUp(window);
  expect(value()).toBeGreaterThan(0);
});

it('an element with value 0 (added or loaded) gets a finite slider that moves it off 0', () => {
  const el = PALETTE.find((p) => p.id === 'seriesR')!.make(50, 1e9);
  state().addElements([{ ...el, value: 0 } as typeof el]);
  render(<LiveLadder />);
  const s = screen.getByRole('slider', { name: /Tune/ }) as HTMLInputElement;
  const attr = s.getAttribute('value');
  fireEvent.pointerDown(s);
  fireEvent.change(s, { target: { value: '1' } });
  fireEvent.pointerUp(window);
  expect({ attr, value: value() }).toEqual({
    attr: expect.not.stringMatching(/NaN/),
    value: expect.any(Number),
  });
  expect(value()).toBeGreaterThan(0);
});
