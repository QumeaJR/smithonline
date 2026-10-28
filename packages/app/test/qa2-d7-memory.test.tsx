// @vitest-environment jsdom
/**
 * QA round 2 on D7: what the Broadband tool keeps when Auto match closes, and
 * the wording rules that changed (the snapped "about the same" threshold, the
 * status line, the gain plot ticks). The worker run in process, as in
 * adv-d7-rft-ui.test.tsx.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { complex } from '@smithonline/core';

vi.mock('../src/lib/rft', async (orig) => {
  const core = await import('@smithonline/core');
  type Req = {
    frequencies: number[];
    load: unknown;
    z0: number;
    r0: number;
    prefix: never;
    parts: number;
  };
  return {
    ...(await orig<Record<string, unknown>>()),
    startRft: (req: Req) => ({
      result: new Promise((resolve) =>
        setTimeout(() => {
          const load = Array.isArray(req.load)
            ? core.interpolatedLoad(req.load as never, { z0: req.z0 })
            : (req.load as never);
          const result = core.realFrequencyMatch(req.frequencies, {
            load,
            z0: req.r0,
            prefix: req.prefix,
            parts: req.parts,
          });
          const limit = core.rftBandLimit(result, load, req.prefix ?? []);
          resolve({ result, floor: limit.floor, limitNote: limit.note });
        }),
      ),
      cancel: () => undefined,
    }),
  };
});

import { RealFrequency } from '../src/components/RealFrequency';
import { useDesignStore } from '../src/store/useDesignStore';
import { useBroadbandMemory } from '../src/store/useBroadbandMemory';
import { emptyDesign, type Design, type DesignElement } from '../src/lib/design';
import { comparisonText, figureOf } from '../src/lib/rft';

afterEach(cleanup);

const ELEMENTS: readonly DesignElement[] = [];

function panel() {
  return (
    <RealFrequency
      elements={ELEMENTS}
      keep={false}
      start={100e6}
      stop={150e6}
      target={complex(50, 0)}
      maxElements={4}
      search={null}
      onPreview={() => undefined}
      onClose={() => undefined}
      onJob={() => undefined}
    />
  );
}

async function waitForTable() {
  await act(async () => {
    for (let i = 0; i < 600 && !document.querySelector('.rft-table'); i++)
      await new Promise((r) => setTimeout(r, 50));
  });
}

describe('D7 round 2: the result outlives the closed tool', () => {
  it('a finished run, its Parts and its row come back when the panel mounts again', async () => {
    const design: Design = { ...emptyDesign(), frequency: 125e6, load: { re: 10, im: 30 } };
    act(() => useDesignStore.setState({ design }));
    const first = render(panel());
    const select = () =>
      screen.getByRole('combobox', { name: 'Parts of the real frequency ladder' });
    expect((select() as HTMLSelectElement).value).toBe('4');
    fireEvent.change(select(), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /Run real frequency/ }));
    await waitForTable();
    const before = document.querySelector('.rft-table')?.textContent;
    expect(before).toBeTruthy();
    expect(useDesignStore.getState().message ?? '').toMatch(/1 part reaches|2 parts reach/);
    // Auto match closes: the panel unmounts.
    first.unmount();
    expect(document.querySelector('.rft-table')).toBeNull();
    render(panel());
    expect((select() as HTMLSelectElement).value).toBe('2');
    expect(document.querySelector('.rft-table')?.textContent).toBe(before);
    expect(screen.getAllByRole('button', { name: /Run again/ })).toHaveLength(1);
    expect(document.querySelector('[data-tour="match.rft.ladder"]')).not.toBeNull();
  }, 120000);

  it('another design starts afresh: no result, Parts from Max parts', () => {
    const design: Design = { ...emptyDesign(), frequency: 125e6, load: { re: 12, im: 30 } };
    act(() => useDesignStore.setState({ design }));
    render(panel());
    expect(document.querySelector('.rft-table')).toBeNull();
    expect(
      (
        screen.getByRole('combobox', {
          name: 'Parts of the real frequency ladder',
        }) as HTMLSelectElement
      ).value,
    ).toBe('4');
    expect(useBroadbandMemory.getState().rft).toBeNull();
  });
});

describe('D7 round 2: wording', () => {
  it('snapped ladders within 0.02 VSWR read about the same, and say the threshold', () => {
    const a = figureOf(1.5);
    const b = figureOf(1.515);
    expect(comparisonText(a, b)).toMatch(/lower VSWR/);
    expect(comparisonText(a, b, true)).toMatch(/about the same as the search \(within 0\.02 VSWR/);
    expect(comparisonText(a, figureOf(1.6), true)).toMatch(/0\.100 lower VSWR/);
    expect(comparisonText(a, figureOf(1.5002), true)).toBe('the same as the search');
  });
});
