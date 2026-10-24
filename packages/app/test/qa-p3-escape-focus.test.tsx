// @vitest-environment jsdom
/**
 * QA round on redesign phase 3: the Escape stack of lib/overlay.ts with three
 * overlays, a mode, a panel and the tour pushed in mixed order, a field with
 * typed text (data-editing) in and outside the top layer, and the shared
 * focus trap when the opener left the document while the overlay was open.
 * Expected order from docs/07-interaction-redesign.md section 2.3 and the
 * user guide section 1: the top overlay first (most recent), then the mode,
 * then the panel, then the tour; a field with typed text takes the first
 * Escape. it.fails marks a finding.
 */
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isTopLayer,
  layerCount,
  pushLayer,
  topLevel,
  useEscapeLayer,
  useFocusTrap,
  type LayerLevel,
} from '../src/lib/overlay';

/** Every layer a test put on the stack, taken off after it (taking one off twice is a no-op). */
const allPops: (() => void)[] = [];

afterEach(() => {
  for (const pop of allPops.splice(0)) pop();
  cleanup();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

/** Fire Escape on `target`; true when nothing prevented the default (the field keeps it). */
const escapeOn = (target: Element): boolean => fireEvent.keyDown(target, { key: 'Escape' });

describe('the Escape stack: three overlays, a mode, a panel, the tour and a field', () => {
  function stack() {
    const closed: string[] = [];
    const pops = new Map<string, () => void>();
    const box = (id: string): HTMLElement => {
      const el = document.createElement('div');
      el.id = id;
      document.body.appendChild(el);
      return el;
    };
    const add = (id: string, level: LayerLevel, container: HTMLElement | null = null): void => {
      const pop = pushLayer(
        id,
        level,
        () => {
          closed.push(id);
          pops.get(id)?.();
        },
        () => container,
      );
      pops.set(id, pop);
      allPops.push(pop);
    };
    const a = box('a');
    const b = box('b');
    const c = box('c');
    // Mixed push order: the rank decides, then the push order within a rank.
    add('tour', 'tour');
    add('A', 'overlay', a);
    add('panel', 'panel');
    add('B', 'overlay', b);
    add('mode', 'mode');
    add('C', 'overlay', c);
    return { closed, pops, a, b, c };
  }

  it('closes C, B, A, then the mode, the panel and the tour, one per Escape', () => {
    const { closed } = stack();
    expect(layerCount()).toBe(6);
    expect(isTopLayer('C')).toBe(true);
    for (let i = 0; i < 6; i++) expect(escapeOn(document.body)).toBe(false);
    expect(closed).toEqual(['C', 'B', 'A', 'mode', 'panel', 'tour']);
    expect(layerCount()).toBe(0);
    expect(topLevel()).toBeNull();
    // With the stack empty the listener is gone: Escape is not taken.
    expect(escapeOn(document.body)).toBe(true);
  });

  it('a field with typed text in the top overlay takes the first Escape, C the second', () => {
    const { closed, c } = stack();
    const field = document.createElement('input');
    field.setAttribute('data-editing', '');
    c.appendChild(field);
    expect(escapeOn(field)).toBe(true);
    expect(closed).toEqual([]);
    // The field reverted: no typed text any more.
    field.removeAttribute('data-editing');
    expect(escapeOn(field)).toBe(false);
    expect(closed).toEqual(['C']);
  });

  it('a field with typed text outside the top overlay does not hold it open', () => {
    const { closed, a } = stack();
    const field = document.createElement('input');
    field.setAttribute('data-editing', '');
    a.appendChild(field);
    escapeOn(field);
    expect(closed).toEqual(['C']);
  });

  it('under a mode (no container) a field with typed text anywhere takes the Escape first', () => {
    const { closed } = stack();
    for (let i = 0; i < 3; i++) escapeOn(document.body);
    expect(closed).toEqual(['C', 'B', 'A']);
    expect(topLevel()).toBe('mode');
    const field = document.createElement('input');
    field.setAttribute('data-editing', '');
    document.body.appendChild(field);
    expect(escapeOn(field)).toBe(true);
    expect(closed).toEqual(['C', 'B', 'A']);
    field.removeAttribute('data-editing');
    escapeOn(field);
    expect(closed).toEqual(['C', 'B', 'A', 'mode']);
    escapeOn(document.body);
    escapeOn(document.body);
  });

  it('an Escape during IME composition closes nothing', () => {
    const { closed, pops } = stack();
    fireEvent.keyDown(document.body, { key: 'Escape', isComposing: true });
    expect(closed).toEqual([]);
    for (const pop of pops.values()) pop();
    expect(layerCount()).toBe(0);
  });

  it('taking a layer off twice does not take the listener away from the rest', () => {
    const { closed, pops } = stack();
    const popA = pops.get('A');
    popA?.();
    popA?.();
    expect(layerCount()).toBe(5);
    escapeOn(document.body);
    escapeOn(document.body);
    expect(closed).toEqual(['C', 'B']);
    for (const pop of pops.values()) pop();
  });
});

describe('useEscapeLayer: the place in the stack is fixed when the layer opens', () => {
  function Layer({ name, log }: { name: string; log: string[] }) {
    useEscapeLayer('overlay', true, () => log.push(name));
    return null;
  }

  it('re-rendering the lower overlay with a new handler does not lift it over the upper one', () => {
    const log: string[] = [];
    const { rerender } = render(
      <>
        <Layer name="lower" log={log} />
        <Layer name="upper" log={log} />
      </>,
    );
    rerender(
      <>
        <Layer name="lower-again" log={log} />
        <Layer name="upper" log={log} />
      </>,
    );
    escapeOn(document.body);
    expect(log).toEqual(['upper']);
  });
});

describe('useFocusTrap when the opener left the document', () => {
  function Overlay() {
    const ref = useRef<HTMLDivElement>(null);
    const layer = useEscapeLayer('overlay', true, () => undefined, ref);
    useFocusTrap(ref, { layer });
    return (
      <div ref={ref} role="dialog">
        <button type="button">First</button>
        <button type="button">Last</button>
      </div>
    );
  }
  function Page({ opener, open }: { opener: boolean; open: boolean }) {
    return (
      <>
        <button type="button">Elsewhere</button>
        {opener && <button type="button">Opener</button>}
        {open && <Overlay />}
      </>
    );
  }
  const byText = (t: string): HTMLElement | undefined =>
    [...document.querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === t);

  it('focus moves in on open; on close it does not go to the removed opener and nothing throws', () => {
    vi.useFakeTimers();
    const { rerender } = render(<Page opener open={false} />);
    const opener = byText('Opener');
    opener?.focus();
    expect(document.activeElement).toBe(opener);
    rerender(<Page opener open />);
    expect(document.activeElement?.textContent).toBe('First');
    // The opener goes (a ladder card removed under the dialog), then the dialog closes.
    rerender(<Page opener={false} open />);
    expect(opener?.isConnected).toBe(false);
    expect(() => rerender(<Page opener={false} open={false} />)).not.toThrow();
    act(() => vi.runAllTimers());
    // The spec only says the focus returns to an opener still in the document.
    expect(document.activeElement).not.toBe(opener);
    expect(document.activeElement?.isConnected).toBe(true);
    expect(layerCount()).toBe(0);
  });

  it('the opener still there gets the focus back; a field focused outside keeps it', () => {
    vi.useFakeTimers();
    const { rerender } = render(<Page opener open={false} />);
    byText('Opener')?.focus();
    rerender(<Page opener open />);
    rerender(<Page opener open={false} />);
    expect(document.activeElement?.textContent).toBe('Opener');
    // Open again, then a press on another control outside moves the focus there before close.
    rerender(<Page opener open />);
    byText('Elsewhere')?.focus();
    rerender(<Page opener open={false} />);
    act(() => vi.runAllTimers());
    expect(document.activeElement?.textContent).toBe('Elsewhere');
  });

  it('Tab from outside the trap goes to the first item, Shift+Tab to the last', () => {
    const { rerender } = render(<Page opener open={false} />);
    byText('Opener')?.focus();
    rerender(<Page opener open />);
    byText('Elsewhere')?.focus();
    fireEvent.keyDown(document.activeElement as Element, { key: 'Tab' });
    expect(document.activeElement?.textContent).toBe('First');
    byText('Elsewhere')?.focus();
    fireEvent.keyDown(document.activeElement as Element, { key: 'Tab', shiftKey: true });
    expect(document.activeElement?.textContent).toBe('Last');
    rerender(<Page opener open={false} />);
  });
});
