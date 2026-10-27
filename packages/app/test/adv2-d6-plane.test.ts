// @vitest-environment jsdom
/**
 * Adversarial QA, D6 round 2: a real port extension, fitted with Reference plane ticked, in the
 * app: the verdict, the status line and the retune.
 */
import { act } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { driftParameters, modelGammas } from '@smithonline/core';
import {
  compareWithDesign,
  currentFit,
  resetBoardFit,
  runBoardFit,
  runRetune,
  setFitFree,
} from '../src/lib/boardFit';
import { readImportFile } from '../src/lib/import';
import { boardModel, fitVerdict } from '../src/lib/measuredBoard';
import { measureStart } from '../src/lib/workflows';
import { useDesignStore } from '../src/store/useDesignStore';

const D = () => useDesignStore.getState();
const settle = (ms = 300): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });

beforeEach(() => {
  localStorage.clear();
  resetBoardFit();
  D().init(measureStart());
});

it('Reference plane ticked, an 80 ps port extension: fitted to the noise, yet refused and told to tick it', async () => {
  const model = boardModel(D().design);
  const fs = Array.from({ length: 121 }, (_, i) => 0.7e9 + (0.6e9 * i) / 120);
  const g = modelGammas(model, { 'value:0': 0.08, 'pad:1': 0.3e-12, plane: 80e-12 }, fs);
  const text = ['# HZ S RI R 50', ...fs.map((f, i) => `${f} ${g[i]?.re} ${g[i]?.im}`)].join('\n');
  act(() => {
    compareWithDesign(readImportFile('edge-sma.s1p', text));
  });
  const defaults = driftParameters(boardModel(D().design))
    .filter((p) => p.freeByDefault)
    .map((p) => p.id);
  act(() => setFitFree('plane', true, defaults));
  act(() => runBoardFit());
  await settle();
  const out = currentFit(D().design);
  expect(out?.ok).toBe(true);
  if (!out?.ok) return;
  const plane = out.fit.parameters.find((p) => p.id === 'plane');
  expect(plane?.status).toBe('fitted');
  const verdict = fitVerdict(D().design, out.fit);
  const status = D().message ?? '';
  let refused: string | undefined;
  act(() => {
    refused = runRetune()?.refused;
  });
  // Observed: verdict 'untrusted' ("Reference plane +80 ps is 4 times its typical drift: not a
  // board built as designed ... tick Reference plane and fit again ... Do not act"), retune refused.
  expect({ level: verdict.level, refused, status }).toMatchObject({
    level: 'ok',
    refused: undefined,
  });
  expect(verdict.text).not.toMatch(/tick Reference plane/);
});
