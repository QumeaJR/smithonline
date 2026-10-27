// @vitest-environment jsdom
/**
 * Adversarial QA, D6 round 2: Apply places exactly what the retune evaluated, judged on the whole
 * network as built (packages, pads, via, trace, drifts), for every realization source with
 * Realize on and off.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { retunedWorst } from '@smithonline/core';
import { compareWithDesign } from '../src/lib/boardFit';
import { readImportFile } from '../src/lib/import';
import { designModel, retuneFor, withRetune } from '../src/lib/measuredBoard';
import { targetOf } from '../src/lib/design';
import { memoryPartStore } from '../src/lib/partStore';
import { measureStart } from '../src/lib/workflows';
import { useDesignStore } from '../src/store/useDesignStore';
import { syntheticLibraryParts, usePartLibrary } from '../src/store/usePartLibrary';

const D = () => useDesignStore.getState();
const SAMPLE = readFileSync(
  resolve(__dirname, '../../core/test/fixtures/sparams/board-1g-synthetic.s1p'),
  'utf8',
);
const log = (...a: unknown[]) => process.stdout.write(a.map(String).join(' ') + '\n');

beforeEach(async () => {
  localStorage.clear();
  usePartLibrary.setState({ parts: [], open: false });
  await usePartLibrary.getState().init(memoryPartStore());
  await usePartLibrary.getState().addParts(syntheticLibraryParts());
  D().init(measureStart());
});

const STOCK =
  '6.8 nH; 7.5 nH; 8.2 nH; 9.1 nH; 10 nH; 11 nH; 12 nH; 13 nH; 15 nH; 1.8 pF; 2 pF; 2.2 pF; 2.4 pF; 2.7 pF; 3 pF; 3.3 pF; 3.6 pF; 3.9 pF';
const SOURCES = ['E6', 'E12', 'E24', 'E96', 'stock', 'library'] as const;
const STARTS: [number, number][] = [
  [10e-9, 2.7e-12],
  [12e-9, 2.2e-12],
  [6.8e-9, 3.3e-12],
  [15e-9, 1.8e-12],
];
const DRIFTS = [
  { 'value:0': 0.08, 'pad:1': 0.3e-12 },
  { 'value:0': -0.12, 'value:1': 0.1, via: 0.4 },
];

describe('Apply: the network as built after Apply evaluates to the promised worst VSWR', () => {
  for (const series of SOURCES)
    for (const enabled of [true, false])
      it(`${series}, Realize ${enabled ? 'on' : 'off'}`, () => {
        const bad: string[] = [];
        let applied = 0;
        let refused = 0;
        for (const [l, c] of STARTS)
          for (const drifts of DRIFTS) {
            D().init(measureStart());
            act(() =>
              D().step('vals', (d) => ({
                ...d,
                realize: { ...d.realize, enabled, series, stockText: STOCK },
                elements: d.elements.map((el, i) =>
                  i === 0 ? ({ ...el, value: l } as typeof el) : ({ ...el, value: c } as typeof el),
                ),
              })),
            );
            act(() => {
              compareWithDesign(readImportFile('board.s1p', SAMPLE));
            });
            const design = D().design;
            const r = retuneFor(design, drifts);
            const s = r.suggestion;
            if (!s || s.changes.length === 0) continue;
            const out = withRetune(design, s.changes);
            if ('reason' in out) {
              refused++;
              log('REFUSED', series, enabled, l, c, out.reason);
              continue;
            }
            applied++;
            // A part changed to a library part is taken as measured (retunedWorst drops its value
            // drift); since fix round 2 a library part has a value drift of its own (a scale), so
            // the same convention holds here: the drift was the old part's, not the new one's.
            const kept: Record<string, number> = { ...drifts };
            for (const ch of s.changes) if (ch.to.kind === 'part') delete kept[`value:${ch.index}`];
            const now = retunedWorst(
              designModel(out.design),
              kept,
              new Map(),
              r.judged,
              targetOf(out.design),
            );
            if (Math.abs(now.vswr - s.worst.vswr) > 1e-6 * s.worst.vswr)
              bad.push(
                `start ${l} ${c} drifts ${JSON.stringify(drifts)}: promised ${s.worst.vswr.toFixed(5)}, built ${now.vswr.toFixed(5)}; changes ${JSON.stringify(s.changes.map((ch) => [ch.index, ch.to.kind === 'part' ? ch.to.part.partNumber : (ch.to as { value: number }).value]))}`,
              );
          }
        log(series, enabled, 'applied', applied, 'refused', refused);
        expect(bad).toEqual([]);
      });
});
