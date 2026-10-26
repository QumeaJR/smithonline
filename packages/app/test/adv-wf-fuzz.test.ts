// @vitest-environment jsdom
/**
 * Adversarial: every shipped step's text and predicate on odd designs must not throw
 * (a throw in TourPanel's render blanks the shell into the error boundary).
 */
import { describe, expect, it } from 'vitest';
import { complex } from '@smithonline/core';
import { emptyDesign, withIdentity, type Design } from '../src/lib/design';
import { WORKFLOWS } from '../src/lib/workflows';
import { isShipped, shippedSteps, stepText } from '../src/lib/workflowKit';
import { tourSnapshot } from '../src/lib/tourSnapshot';
import { useDesignStore } from '../src/store/useDesignStore';
import { openSample } from '../src/lib/samples';

function els(d: Design, list: Array<Record<string, unknown>>): Design {
  const out: Design['elements'][number][] = [];
  for (const e of list) out.push(withIdentity(e as never, out));
  return { ...d, elements: out };
}

const base = emptyDesign();
const designs: Array<[string, Design]> = [
  ['empty', base],
  ['short load', { ...base, load: complex(0, 0) }],
  ['open-ish load', { ...base, load: complex(1e12, 0) }],
  ['negative R', { ...base, load: complex(-10, 5) }],
  ['z0 75 tiny f', { ...base, z0: 75, frequency: 1e-3 }],
  [
    'realize library empty',
    {
      ...els(base, [{ kind: 'L', orientation: 'shunt', value: 1e-9 }]),
      realize: { ...base.realize, enabled: true, series: 'library' },
    },
  ],
  [
    'realize stock',
    {
      ...els(base, [{ kind: 'C', orientation: 'series', value: 1e-12 }]),
      realize: { ...base.realize, enabled: true, series: 'stock' },
    },
  ],
  [
    'one datapoint load',
    {
      ...base,
      sweep: {
        ...base.sweep,
        enabled: true,
        loads: [{ frequency: 1e9, z: complex(50, 0) }],
      } as never,
    },
  ],
  [
    'two equal-f loads',
    {
      ...base,
      sweep: {
        ...base.sweep,
        enabled: true,
        loads: [
          { frequency: 1e9, z: complex(50, 0) },
          { frequency: 1e9, z: complex(20, 5) },
        ],
      } as never,
    },
  ],
  ['sweep start>stop', { ...base, sweep: { ...base.sweep, enabled: true, start: 2e9, stop: 1e9 } }],
];

describe('step texts and predicates on odd designs', () => {
  const cases: string[] = [];
  it('collects throws', () => {
    // a real two-port design from the sample
    openSample('amplifier');
    designs.push(['amplifier sample', useDesignStore.getState().design]);
    designs.push(['amplifier at 1 Hz', { ...useDesignStore.getState().design, frequency: 1 }]);
    for (const w of WORKFLOWS.filter(isShipped)) {
      for (const step of shippedSteps(w)) {
        for (const [name, d] of designs) {
          useDesignStore.setState({ design: d });
          const snap = tourSnapshot({}, d);
          try {
            stepText(step, d, snap);
          } catch (e) {
            cases.push(`text ${w.id}/${step.id} on ${name}: ${(e as Error).message}`);
          }
          try {
            if (typeof step.advance === 'function') step.advance(snap);
          } catch (e) {
            cases.push(`advance ${w.id}/${step.id} on ${name}: ${(e as Error).message}`);
          }
          try {
            w.start(d, true);
            w.start(d, false);
          } catch (e) {
            cases.push(`start ${w.id} on ${name}: ${(e as Error).message}`);
          }
        }
      }
    }
    expect(cases).toEqual([]);
  });
});
