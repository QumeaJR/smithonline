/**
 * Adversarial QA, D6 round 1: boardKey (called twice by App.tsx's boardTrace on every fit
 * progress message, and on every render of the Measured board section and panel) serializes
 * the realized parts with all their measured data.
 */
import { expect, it } from 'vitest';
import { libraryPartFromData, logFrequencies, partDataFromCircuit } from '@smithonline/core';
import { boardKey } from '../src/lib/measuredBoard';
import { memoryPartStore } from '../src/lib/partStore';
import { measureStart } from '../src/lib/workflows';
import { usePartLibrary } from '../src/store/usePartLibrary';

it('boardKey of a design realized from 20001-point library parts is cheap', async () => {
  await usePartLibrary.getState().init(memoryPartStore());
  const f = logFrequencies(10e6, 10e9, 20001);
  const mk = (pn: string, circuit: Parameters<typeof partDataFromCircuit>[0]) => ({
    part: libraryPartFromData(partDataFromCircuit(circuit, 'series', f, 50), {
      manufacturer: 'X',
      partNumber: pn,
    }),
    fileName: `${pn}.s2p`,
  });
  await usePartLibrary
    .getState()
    .addParts([
      mk('L12', { type: 'L', l: 12e-9, cp: 0.08e-12, r: 0.3 }),
      mk('C27', { type: 'C', c: 2.7e-12, esl: 0.3e-9, esr: 0.3 }),
    ]);
  const d0 = measureStart();
  const d = {
    ...d0,
    realize: { ...d0.realize, series: 'library' as const },
    measurement: {
      name: 'm',
      points: Array.from({ length: 201 }, (_, i) => ({
        frequency: 0.7e9 + i * 3e6,
        z: { re: 50, im: 0 },
      })),
    },
  };
  boardKey(d);
  const t0 = performance.now();
  const key = boardKey(d);
  const ms = performance.now() - t0;
  // A key of several megabytes per call: 2 calls per progress message of the fit.
  expect({ ms: ms < 5, length: key.length < 100_000 }).toEqual({ ms: true, length: true });
});
