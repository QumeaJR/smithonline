// @vitest-environment jsdom
/**
 * Adversarial QA, D6 round 3: Apply places what the retune evaluated on larger ladders (4 and 6
 * parts, off-series values so Realize has choices), every source, Realize on and off, and pins
 * only parts the retune did not change.
 */
import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { modelGammas, retunedWorst } from '@smithonline/core';
import { compareWithDesign } from '../src/lib/boardFit';
import { readImportFile } from '../src/lib/import';
import { designModel, retuneFor, withRetune } from '../src/lib/measuredBoard';
import { targetOf } from '../src/lib/design';
import { memoryPartStore } from '../src/lib/partStore';
import { measureStart } from '../src/lib/workflows';
import { useDesignStore } from '../src/store/useDesignStore';
import { syntheticLibraryParts, usePartLibrary } from '../src/store/usePartLibrary';

const strip = (e: unknown): string =>
  JSON.stringify(e, (k, v) => (k === 'id' || k === 'color' || k === 'locked' ? undefined : v));
const D = () => useDesignStore.getState();
const log = (...a: unknown[]) => process.stdout.write(a.map(String).join(' ') + '\n');

beforeEach(async () => {
  localStorage.clear();
  usePartLibrary.setState({ parts: [], open: false });
  await usePartLibrary.getState().init(memoryPartStore());
  await usePartLibrary.getState().addParts(syntheticLibraryParts());
  D().init(measureStart());
});

const STOCK =
  '1 nH; 1.5 nH; 2.2 nH; 2.7 nH; 3.3 nH; 3.9 nH; 4.7 nH; 5.6 nH; 6.8 nH; 8.2 nH; 10 nH; 12 nH; 15 nH; 0.5 pF; 0.8 pF; 1 pF; 1.2 pF; 1.5 pF; 1.8 pF; 2.2 pF; 2.7 pF; 3.3 pF; 3.9 pF; 4.7 pF; 5.6 pF';
const SOURCES = ['E6', 'E12', 'E24', 'E96', 'stock', 'library'] as const;
type Spec = [kind: 'L' | 'C', orientation: 'shunt' | 'series', value: number][];
const LADDERS: { name: string; spec: Spec; load: { re: number; im: number } }[] = [
  {
    name: '4 parts',
    spec: [
      ['C', 'shunt', 1.37e-12],
      ['L', 'series', 5.23e-9],
      ['C', 'shunt', 2.74e-12],
      ['L', 'series', 3.32e-9],
    ],
    load: { re: 25, im: 10 },
  },
  {
    name: '6 parts',
    spec: [
      ['L', 'shunt', 12.1e-9],
      ['C', 'series', 2.49e-12],
      ['C', 'shunt', 1.18e-12],
      ['L', 'series', 4.42e-9],
      ['C', 'shunt', 0.909e-12],
      ['L', 'series', 2.05e-9],
    ],
    load: { re: 150, im: -40 },
  },
];

function setLadder(
  spec: Spec,
  load: { re: number; im: number },
  series: string,
  enabled: boolean,
): void {
  const tpl = measureStart().elements;
  act(() =>
    D().step('ladder', (d) => ({
      ...d,
      load,
      realize: { ...d.realize, enabled, series: series as never, stockText: STOCK },
      elements: spec.map(
        ([kind, orientation, value], i) =>
          ({
            ...(tpl[kind === 'L' ? 0 : 1] as object),
            id: `p${i}`,
            kind,
            orientation,
            value,
          }) as never,
      ),
    })),
  );
}

describe('Apply on 4 and 6 part ladders', () => {
  for (const series of SOURCES)
    for (const enabled of [true, false])
      it(`${series}, Realize ${enabled ? 'on' : 'off'}`, () => {
        const bad: string[] = [];
        let applied = 0,
          refused = 0,
          noSugg = 0;
        for (const lad of LADDERS)
          for (const drifts of [
            { 'value:0': 0.12, 'value:1': -0.1 },
            { 'value:1': 0.15, 'value:3': -0.12 },
            { 'value:2': -0.15 },
          ]) {
            D().init(measureStart());
            setLadder(lad.spec, lad.load, series, enabled);
            const model = designModel(D().design);
            const fs = Array.from({ length: 61 }, (_, i) => 0.7e9 + (0.6e9 * i) / 60);
            const g = modelGammas({ ...model }, drifts, fs);
            const text = [
              '# HZ S RI R 50',
              ...fs.map((f, i) => `${f} ${g[i]?.re} ${g[i]?.im}`),
            ].join('\n');
            act(() => {
              compareWithDesign(readImportFile('board.s1p', text));
            });
            const design = D().design;
            const r = retuneFor(design, drifts);
            const s = r.suggestion;
            if (!s || s.changes.length === 0) {
              noSugg++;
              continue;
            }
            const out = withRetune(design, s.changes);
            if ('reason' in out) {
              refused++;
              log('REFUSED', lad.name, series, enabled, out.reason);
              continue;
            }
            applied++;
            if (out.pinned.length) log('PINNED', lad.name, series, enabled, out.pinned.join('; '));
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
                `${lad.name} ${JSON.stringify(drifts)}: promised ${s.worst.vswr.toFixed(5)}, built ${now.vswr.toFixed(5)}`,
              );
            // Pins name only unchanged parts, and every part the as-built model differs in is a change or a pin.
            const changed = new Set(s.changes.map((c) => c.index));
            const b0 = designModel(design).base,
              b1 = designModel(out.design).base;
            b0.forEach((el, i) => {
              if (strip(el) !== strip(b1[i]) && !changed.has(i))
                bad.push(
                  `${lad.name} ${JSON.stringify(drifts)}: part ${i + 1} not in the retune changed as built ${JSON.stringify((el as { value?: number }).value)} -> ${JSON.stringify((b1[i] as { value?: number }).value)}; pinned ${out.pinned.join('; ')}`,
                );
            });
          }
        log(series, enabled, 'applied', applied, 'refused', refused, 'no suggestion', noSugg);
        expect(bad).toEqual([]);
      });
});
