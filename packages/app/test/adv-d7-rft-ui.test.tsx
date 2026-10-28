// @vitest-environment jsdom
/**
 * QA round 1 on D7, the Broadband panel's real frequency section rendered on
 * its own, the worker run in process with the core's defaults (as the worker
 * does). Adversarial: what the comparison table and the gain plot show.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cadd, cinv, complex, sweepPoints, type Complex, type SweepLoad } from '@smithonline/core';

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
import { emptyDesign, type Design } from '../src/lib/design';

afterEach(cleanup);

const par = (a: Complex, b: Complex) => cinv(cadd(cinv(a), cinv(b)));
/** A multi-resonant measured load: 20 ohm in series with three damped tanks (110, 140, 175 MHz). */
const multi = (f: number): Complex => {
  const w = 2 * Math.PI * f;
  let z = complex(20, 0);
  for (const [fr, q] of [
    [110e6, 30],
    [140e6, 20],
    [175e6, 40],
  ] as const) {
    const wr = 2 * Math.PI * fr;
    const L = 200 / (q * wr);
    const C = 1 / (wr * wr * L);
    z = cadd(z, par(complex(200, 0), par(complex(0, w * L), complex(0, -1 / (w * C)))));
  }
  return z;
};

async function runPanel(design: Design, parts: number, start: number, stop: number) {
  act(() => useDesignStore.setState({ design }));
  const props = {
    elements: [] as never[],
    keep: false,
    start,
    stop,
    target: { re: 50, im: 0 },
    maxElements: parts,
    search: null,
    onPreview: () => undefined,
    onClose: () => undefined,
    onJob: () => undefined,
  };
  const view = render(<RealFrequency {...props} />);
  fireEvent.click(screen.getByRole('button', { name: /Run real frequency/ }));
  await act(async () => {
    for (let i = 0; i < 600 && !document.querySelector('.rft-table'); i++)
      await new Promise((r) => setTimeout(r, 50));
  });
  return { view, props };
}

const cell = (row: RegExp): string => {
  const th = screen.getByText(row, { selector: 'th, th *' });
  return th.closest('tr')!.querySelector('.rft-value')!.textContent ?? '';
};
const vswrIn = (text: string): number => Number(/VSWR ([\d.]+)/.exec(text)?.[1]);

describe('D7 UI adversarial', () => {
  it('a multi-resonant measured load: the ladder shown never beats the Bode-Fano limit shown', async () => {
    const loads: SweepLoad[] = sweepPoints(80e6, 220e6, 141).map((f) => ({
      frequency: f,
      z: multi(f),
    }));
    const design: Design = {
      ...emptyDesign(),
      frequency: 145e6,
      sweep: { enabled: true, start: 100e6, stop: 190e6, points: 21, loads },
    };
    await runPanel(design, 3, 100e6, 190e6);
    const limit = vswrIn(cell(/Bode-Fano limit/));
    const ladder = vswrIn(cell(/Real frequency ladder/));
    console.log(`[ui multi] limit ${limit} ladder ${ladder}`);
    // Round 1: estimate 7.168 shown as the limit beside a ladder of 3.64. QA fix: a number the
    // ladder or the load beats is not shown as a limit; the row says the estimate does not hold.
    expect(Number.isFinite(ladder)).toBe(true);
    if (Number.isFinite(limit)) expect(ladder).toBeGreaterThanOrEqual(limit);
    else expect(document.body.textContent).toMatch(/does not hold for this load/);
  }, 120000);

  it('the gain plot draws the ladder that the row applies, not only the gain shape', async () => {
    const design: Design = { ...emptyDesign(), frequency: 125e6, load: { re: 2, im: 0 } };
    // Which curves the plot has does not depend on the load: a 2 ohm resistor is enough.
    await runPanel(design, 3, 100e6, 150e6);
    const paths = [...document.querySelectorAll('.rft-plot path')].map((p) =>
      p.getAttribute('class'),
    );
    console.log(`[ui plot] paths ${paths.join(', ')}`);
    expect(paths.some((c) => c !== 'rft-shape' && c !== 'rft-search')).toBe(true);
  }, 120000);

  it('changing only Parts after a run does not say the design or the band changed', async () => {
    const design: Design = { ...emptyDesign(), frequency: 125e6, load: { re: 10, im: 30 } };
    await runPanel(design, 1, 100e6, 150e6);
    fireEvent.change(screen.getByRole('combobox', { name: 'Parts of the real frequency ladder' }), {
      target: { value: '2' },
    });
    const stale = document.body.textContent ?? '';
    expect(stale).not.toMatch(/The design or the band has changed since this run/);
    // QA fix: it says what changed, with one Run again, not two.
    expect(stale).toMatch(/Parts changed since this run/);
    expect(screen.getAllByRole('button', { name: /Run again|Run real frequency/ })).toHaveLength(1);
  }, 120000);
});
