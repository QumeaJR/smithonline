// @vitest-environment jsdom
/**
 * Adversarial: tap-to-preview in the Broadband match list on a coarse pointer,
 * with the target given as AutoMatch gives it (targetOf(design), a new object
 * per render while the target is Z0) and a parent that re-renders on preview.
 */
import { broadbandMatch, complex, type MatchSolution } from '@smithonline/core';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useMemo, useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/broadband', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  startBroadband: (req: {
    frequencies: number[];
    load: { re: number; im: number };
    z0: number;
    target: { re: number; im: number };
    prefix: never[];
    maxElements: number;
    allowLine: boolean;
  }) => {
    const result = broadbandMatch(req.frequencies, {
      load: req.load as never,
      z0: req.z0,
      target: req.target as never,
      prefix: req.prefix,
      maxElements: 2,
      allowLine: false,
    });
    return { result: Promise.resolve(result), cancel: () => undefined };
  },
}));

import { BroadbandMatch } from '../src/components/BroadbandMatch';
import { emptyDesign, targetOf } from '../src/lib/design';
import { useDesignStore } from '../src/store/useDesignStore';

beforeAll(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('coarse'),
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
  useDesignStore.getState().init({
    ...emptyDesign(),
    frequency: 1e9,
    load: complex(12, -30),
    sweep: { enabled: true, start: 0.8e9, stop: 1.2e9, points: 21 },
  });
});
afterEach(() => cleanup());

function Host({ stable = false }: { stable?: boolean }) {
  const [preview, setPreview] = useState<MatchSolution | null>(null);
  const design = useDesignStore((s) => s.design);
  const fixed = useMemo(() => targetOf(design), [design]);
  const target = stable ? fixed : targetOf(design); // as AutoMatch does
  const elements = useMemo(() => [], []);
  return (
    <>
      <BroadbandMatch
        elements={elements}
        target={target}
        onPreview={setPreview}
        onClose={() => undefined}
      />
      <span data-testid="preview">{preview ? 'on' : 'off'}</span>
    </>
  );
}

describe('Broadband list on a coarse pointer, target = Z0', () => {
  it('a tap selects the row and shows Add', async () => {
    const { container } = render(<Host />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run' }));
      await Promise.resolve();
      await Promise.resolve();
    });
    const rows = container.querySelectorAll<HTMLButtonElement>('.solution-pick');
    expect(rows.length).toBeGreaterThan(0);
    act(() => fireEvent.click(rows[0] as HTMLButtonElement));
    expect(screen.getByTestId('preview').textContent).toBe('on');
    expect(container.querySelector('.solution-add')).not.toBeNull();
  });
  it('control: with a stable target object the same tap shows Add', async () => {
    const { container } = render(<Host stable />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Run' }));
      await Promise.resolve();
      await Promise.resolve();
    });
    const rows = container.querySelectorAll<HTMLButtonElement>('.solution-pick');
    act(() => fireEvent.click(rows[0] as HTMLButtonElement));
    expect(container.querySelector('.solution-add')).not.toBeNull();
  });
});
