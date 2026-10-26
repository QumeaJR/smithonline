// @vitest-environment jsdom
/**
 * Adversarial: every shipped doIt and prepare on odd designs (an event handler that throws
 * does nothing and says nothing).
 */
import { describe, expect, it } from 'vitest';
import { complex } from '@smithonline/core';
import { emptyDesign, withIdentity, type Design } from '../src/lib/design';
import { WORKFLOWS } from '../src/lib/workflows';
import { isShipped, shippedSteps } from '../src/lib/workflowKit';
import { tourUi } from '../src/lib/tourUi';
import { useDesignStore } from '../src/store/useDesignStore';

function els(d: Design, list: Array<Record<string, unknown>>): Design {
  const out: Design['elements'][number][] = [];
  for (const e of list) out.push(withIdentity(e as never, out));
  return { ...d, elements: out };
}
const base = emptyDesign();
const designs: Array<[string, Design]> = [
  ['empty', base],
  [
    'short load',
    els({ ...base, load: complex(0, 0) }, [{ kind: 'C', orientation: 'series', value: 1e-12 }]),
  ],
  [
    'line',
    els(base, [{ kind: 'line', z0: 50, length: 0.125, refFrequency: 1e9, er: 1, alphaDbPerM: 0 }]),
  ],
  ['zero C', els(base, [{ kind: 'C', orientation: 'series', value: 0 }])],
  [
    'sweep 1 point',
    {
      ...els(base, [{ kind: 'L', orientation: 'shunt', value: 1e-9 }]),
      sweep: { ...base.sweep, enabled: true, points: 1 },
    },
  ],
];

describe('doIt and prepare on odd designs', () => {
  it('none throws', () => {
    const cases: string[] = [];
    for (const w of WORKFLOWS.filter(isShipped)) {
      for (const step of shippedSteps(w)) {
        for (const [name, d] of designs) {
          useDesignStore.getState().init(d);
          for (const [what, fn] of [
            ['prepare', step.prepare],
            ['doIt', step.doIt?.run],
          ] as const) {
            if (!fn) continue;
            try {
              fn(tourUi);
            } catch (e) {
              cases.push(`${what} ${w.id}/${step.id} on ${name}: ${(e as Error).message}`);
            }
          }
        }
      }
    }
    expect(cases).toEqual([]);
  });
});
