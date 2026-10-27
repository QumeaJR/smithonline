// @vitest-environment jsdom
/**
 * Adversarial QA, D6 round 3: the VNA class a file is given, and a library-part board with the
 * board's pads on, through the app's own Compare, Fit and Retune.
 */
import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { modelGammas } from '@smithonline/core';
import {
  compareWithDesign,
  currentFit,
  resetBoardFit,
  runBoardFit,
  runRetune,
  setFitFree,
  setVnaClass,
} from '../src/lib/boardFit';
import { driftParameters, retunedWorst } from '@smithonline/core';
import { designModel, withRetune } from '../src/lib/measuredBoard';
import { targetOf } from '../src/lib/design';
import { readImportFile } from '../src/lib/import';
import { boardModel, fitVerdict } from '../src/lib/measuredBoard';
import { memoryPartStore } from '../src/lib/partStore';
import { measureStart } from '../src/lib/workflows';
import { useDesignStore } from '../src/store/useDesignStore';
import { syntheticLibraryParts, usePartLibrary } from '../src/store/usePartLibrary';

const D = () => useDesignStore.getState();
const settle = (ms = 300): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
const log = (...a: unknown[]) => process.stdout.write(a.map(String).join(' ') + '\n');
function normal(seed: number) {
  let s = seed;
  const u = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}
const grid = (n: number, a: number, b: number) =>
  Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));

beforeEach(async () => {
  localStorage.clear();
  resetBoardFit();
  usePartLibrary.setState({ parts: [], open: false });
  await usePartLibrary.getState().init(memoryPartStore());
  await usePartLibrary.getState().addParts(syntheticLibraryParts());
  D().init(measureStart());
});

const rows = (drifts: Record<string, number>, fs: number[], noise: number, seed: number) => {
  const n = normal(seed);
  return modelGammas(boardModel(D().design), drifts, fs).map((g, i) => ({
    f: fs[i] as number,
    re: g.re + noise * n(),
    im: g.im + noise * n(),
  }));
};

describe('VNA class from the file', () => {
  it('a headerless CSV (numpy savetxt, any instrument, no source info) is not silently taken as a hobby VNA', () => {
    const r = rows({ 'value:0': 0.08, 'pad:1': 0.3e-12 }, grid(121, 0.7e9, 1.3e9), 1e-3, 3);
    const text = r
      .map((x) => `${x.f.toExponential(6)},${x.re.toFixed(7)},${x.im.toFixed(7)}`)
      .join('\n');
    const file = readImportFile('zvb-board.csv', text);
    log('description:', file.description);
    act(() => {
      compareWithDesign(file);
    });
    log('message:', D().message);
    // Observed: measurement.vna 'hobby' (floor 0.02, ten times the lab floor), and the Compare
    // message says nothing about it.
    expect(D().design.measurement?.vna ?? 'lab').toBe('lab');
  });

  it('a Touchstone file whose comment names the NanoVNA is not taken as lab by its file name alone', () => {
    const r = rows({ 'value:0': 0.08, 'pad:1': 0.3e-12 }, grid(101, 0.7e9, 1.3e9), 1e-3, 3);
    const text = [
      '! NanoVNA-H4 export',
      '# HZ S RI R 50',
      ...r.map((x) => `${x.f} ${x.re} ${x.im}`),
    ].join('\n');
    act(() => {
      compareWithDesign(readImportFile('board.s1p', text));
    });
    // Observed: 'lab': vnaFromFile reads the file name and the reader's description, not the
    // comments the Touchstone reader keeps.
    expect(D().design.measurement?.vna ?? 'lab').toBe('hobby');
  });
});

describe('library parts with the board on: a pad of no drift', () => {
  for (const [label, n, a, b, seed] of [
    ['band 0.9 to 1.1 GHz, 101 points', 101, 0.9e9, 1.1e9, 3],
    ['0.7 to 1.3 GHz, 121 points', 121, 0.7e9, 1.3e9, 4],
  ] as const)
    it(`${label}: a board that fits to the noise is not refused for a pad of -0.00 pF`, async () => {
      act(() =>
        D().step('library', (d) => ({
          ...d,
          realize: { ...d.realize, enabled: true, series: 'library' },
        })),
      );
      const r = rows({ 'value:0': 0.03 }, grid(n, a, b), n === 101 ? 2e-3 : 1e-3, seed);
      const text = ['# HZ S RI R 50', ...r.map((x) => `${x.f} ${x.re} ${x.im}`)].join('\n');
      act(() => {
        compareWithDesign(readImportFile('board.s1p', text));
      });
      act(() => runBoardFit());
      await settle();
      const out = currentFit(D().design);
      expect(out?.ok).toBe(true);
      if (!out?.ok) return;
      const v = fitVerdict(D().design, out.fit);
      let refused: string | undefined;
      act(() => {
        refused = runRetune()?.refused;
      });
      log(
        label,
        'residual',
        out.fit.check.residual,
        out.fit.check.residualRatio.toFixed(2),
        'implausible',
        JSON.stringify(out.fit.check.implausible),
        '| verdict:',
        v.level,
        v.text,
        '| retune refused:',
        refused,
      );
      expect(out.fit.check.residual).toBe('noise');
      expect(out.fit.check.implausible).toEqual([]);
      expect(v.level).toBe('ok');
      expect(refused).toBeUndefined();
    });
});

const s1p = (r: { f: number; re: number; im: number }[]): string =>
  ['# HZ S RI R 50', ...r.map((x) => [x.f, x.re, x.im].join(' '))].join('\n');

describe('the app path: a hobby VNA, a band-only sweep, a 4 cm cable, the shunt L one E12 step high', () => {
  it('Reference plane ticked as advised: no Apply that makes the real board worse', async () => {
    const truth = { 'value:0': 0.1, 'pad:1': 0.3e-12, plane: 200e-12 };
    const text = s1p(rows(truth, grid(201, 0.9e9, 1.1e9), 1e-3, 7));
    act(() => {
      compareWithDesign(readImportFile('board.s1p', text));
    });
    act(() => setVnaClass('hobby'));
    const defaults = driftParameters(boardModel(D().design))
      .filter((p) => p.freeByDefault)
      .map((p) => p.id);
    act(() => runBoardFit());
    await settle();
    const first = currentFit(D().design);
    if (first?.ok) log('unticked verdict:', fitVerdict(D().design, first.fit).text);
    act(() => setFitFree('plane', true, defaults));
    act(() => runBoardFit());
    await settle();
    const out = currentFit(D().design);
    expect(out?.ok).toBe(true);
    if (!out?.ok) return;
    const v = fitVerdict(D().design, out.fit);
    let ret: ReturnType<typeof runRetune> = null;
    act(() => {
      ret = runRetune();
    });
    const r = ret as ReturnType<typeof runRetune>;
    const s = r?.suggestion;
    log(
      'ticked: plane',
      out.fit.drifts.plane,
      'verdict',
      v.level,
      v.text,
      '| retune',
      JSON.stringify(s?.changes.map((c) => [c.index, (c.to as { value: number }).value])),
      s?.worst.vswr,
      '| status:',
      D().message,
    );
    if (!r || !s || s.changes.length === 0) return;
    const applied = withRetune(D().design, s.changes);
    expect('design' in applied).toBe(true);
    if (!('design' in applied)) return;
    const board = { 'value:0': truth['value:0'], 'pad:1': truth['pad:1'] };
    const real = retunedWorst(
      designModel(applied.design),
      board,
      new Map(),
      r.judged,
      targetOf(applied.design),
    ).vswr;
    const asIs = retunedWorst(
      designModel(D().design),
      board,
      new Map(),
      r.judged,
      targetOf(D().design),
    ).vswr;
    log(
      'the real board after Apply:',
      real.toFixed(3),
      'as it is:',
      asIs.toFixed(3),
      'promised',
      s.worst.vswr.toFixed(3),
    );
    expect(real).toBeLessThanOrEqual(asIs);
  });
});

describe('a clean measurement of the sample with ordinary drifts', () => {
  it('Shunt L +8.9 %, Series C -14.6 %, Shunt L pads -0.1 pF (of 0.12), no noise: fitted, not "tick Reference plane"', async () => {
    const t = {
      'value:0': 0.08939221623002108,
      'value:1': -0.14635005833092293,
      'pad:1': 3.8710297457351276e-14,
      'pad:0': -1e-13,
    };
    act(() => {
      compareWithDesign(readImportFile('board.s1p', s1p(rows(t, grid(121, 0.7e9, 1.3e9), 0, 1))));
    });
    act(() => runBoardFit());
    await settle();
    const out = currentFit(D().design);
    expect(out?.ok).toBe(true);
    if (!out?.ok) return;
    const pad0 = out.fit.parameters.find((p) => p.id === 'pad:0');
    const v = fitVerdict(D().design, out.fit);
    log(
      'clean: pad:0',
      pad0?.status,
      pad0?.why,
      'rms',
      out.fit.rmsAfter,
      '| verdict',
      v.level,
      v.text,
    );
    expect(pad0?.status).toBe('fitted');
    expect(v.level).toBe('ok');
  });
});
