// @vitest-environment jsdom
/**
 * Adversarial: tap-to-preview on a coarse pointer inside the real tools,
 * where the parent re-renders on every preview (App keeps the preview in state).
 */
import { complex, type Complex, type MatchSolution } from '@smithonline/core';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useMemo, useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoMatch } from '../src/components/AutoMatch';
import { emptyDesign } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';

let coarse = true;
beforeAll(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('coarse') ? coarse : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});
beforeEach(() => {
  coarse = true;
  useDesignStore.getState().init(emptyDesign());
});
afterEach(() => cleanup());

function Host({ onApplied }: { onApplied: (n: number) => void }) {
  const [preview, setPreview] = useState<MatchSolution | null>(null);
  const zin = useMemo((): Complex => complex(10, 20), []);
  const design = useDesignStore((s) => s.design);
  onApplied(design.elements.length);
  return (
    <>
      <AutoMatch zin={zin} elements={[]} onPreview={setPreview} onClose={() => undefined} />
      <span data-testid="preview">{preview ? 'on' : 'off'}</span>
    </>
  );
}

describe('Add parts on a coarse pointer (target = Z0, the default)', () => {
  it('a tap selects the row and shows Add; a second tap adds', () => {
    expect(useDesignStore.getState().design.target ?? null).toBeNull();
    let n = 0;
    const { container, getByTestId } = render(<Host onApplied={(k) => (n = k)} />);
    const rows = container.querySelectorAll<HTMLButtonElement>('.solution-pick');
    expect(rows.length).toBeGreaterThan(0);
    act(() => fireEvent.click(rows[0] as HTMLButtonElement));
    expect(getByTestId('preview').textContent).toBe('on');
    const after = container.querySelectorAll<HTMLButtonElement>('.solution-pick');
    // The row stays selected and the Add button shows.
    expect(after[0]?.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.solution-add')).not.toBeNull();
    act(() => fireEvent.click(after[0] as HTMLButtonElement));
    expect(n).toBeGreaterThan(0);
  });

  it('control: with an explicit target the same taps work', () => {
    act(() => useDesignStore.getState().setTarget(complex(50, 0)));
    let n = 0;
    const { container } = render(<Host onApplied={(k) => (n = k)} />);
    const rows = container.querySelectorAll<HTMLButtonElement>('.solution-pick');
    act(() => fireEvent.click(rows[0] as HTMLButtonElement));
    expect(container.querySelector('.solution-add')).not.toBeNull();
    act(() =>
      fireEvent.click(
        container.querySelectorAll<HTMLButtonElement>('.solution-pick')[0] as HTMLButtonElement,
      ),
    );
    expect(n).toBeGreaterThan(0);
  });
});
