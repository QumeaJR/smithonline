/**
 * Adversarial QA, D6 round 3: the retune on 8 to 16 part ladders against a brute-force search of
 * singles and pairs: never worse than the board, a single when a single reaches the target, a pair
 * when a pair does, within the time budget. Expected to pass (the attacks the retune survived).
 */
import { expect, it } from 'vitest';
import {
  DEFAULT_BOARD,
  DEFAULT_PACKAGES,
  retuneCandidates,
  retuneEvaluator,
  suggestRetune,
  type BuildModel,
  type Element,
} from '../src/index';

function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

it('artificial-line ladders of 8, 12 and 16 parts, E12, E24, E96, limits around the best single and pair', () => {
  const r = rng(31);
  const issues: string[] = [];
  let total = 0;
  let maxT = 0;
  for (const n of [8, 12, 16]) {
    for (let k = 0; k < 5; k++) {
      const base: Element[] = [];
      for (let i = 0; i < n; i++)
        base.push(
          i % 2 === 0
            ? ({ kind: 'C', orientation: 'shunt', value: 1.5e-12, package: '0402' } as Element)
            : ({ kind: 'L', orientation: 'series', value: 3.9e-9, package: '0402' } as Element),
        );
      const model: BuildModel = {
        z0: 50,
        frequency: 1e9,
        base,
        table: DEFAULT_PACKAGES,
        board: { ...DEFAULT_BOARD, enabled: k % 3 !== 0 },
        load: { re: 50 + 30 * (r() - 0.5), im: 30 * (r() - 0.5) },
      };
      const drifts: Record<string, number> = {};
      base.forEach((_, i) => {
        if (r() < 0.7) drifts[`value:${i}`] = 0.25 * (r() - 0.5);
      });
      const band = Array.from({ length: 51 }, (_, i) => 0.8e9 + (0.4e9 * i) / 50);
      for (const series of ['E12', 'E24', 'E96'] as const) {
        const ev = retuneEvaluator(model, drifts, band);
        const before = ev(new Map()).vswr;
        const cands = retuneCandidates({ kind: 'series', series }, 1e9, band);
        let bestSingle = Infinity;
        base.forEach((a, i) => {
          for (const x of cands(i, a))
            bestSingle = Math.min(bestSingle, ev(new Map([[i, x]])).vswr);
        });
        let bestPair = Infinity;
        base.forEach((a, i) =>
          base.forEach((b, j) => {
            if (j <= i) return;
            for (const x of cands(i, a))
              for (const y of cands(j, b)) {
                const w = ev(
                  new Map([
                    [i, x],
                    [j, y],
                  ]),
                  bestPair,
                ).vswr;
                if (w < bestPair) bestPair = w;
              }
          }),
        );
        for (const limit of [
          1 + (before - 1) * 0.8,
          1 + (bestSingle - 1) * 0.98,
          1 + (bestPair - 1) * 1.0000001,
          1 + (bestPair - 1) * 0.98,
        ]) {
          if (!(limit < before)) continue;
          total++;
          const t0 = performance.now();
          const res = suggestRetune(model, drifts, { band, limit, candidates: cands });
          maxT = Math.max(maxT, performance.now() - t0);
          const s = res.suggestion;
          const nch = s?.changes.length ?? 0;
          let bad = '';
          if (s && !s.inside && !(s.worst.vswr < before)) bad = 'worse than the board';
          if (bestSingle <= limit && !(nch === 1 && s?.inside)) bad = 'single missed';
          if (bestSingle > limit && bestPair <= limit && !(nch === 2 && s?.inside))
            bad = 'pair missed';
          if (!s && Math.min(bestSingle, bestPair) < before)
            bad = 'no suggestion though improvable';
          if (bad) issues.push(`${bad}: n ${n} ${k} ${series} limit ${limit}`);
        }
      }
    }
  }
  process.stdout.write(`retune targets ${total}, slowest ${maxT.toFixed(0)} ms\n`);
  expect(issues).toEqual([]);
  expect(maxT).toBeLessThan(1000);
}, 600000);
