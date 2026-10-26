/**
 * Adversarial QA round 3b (0.6.0 verification): the link writer's full-precision fallback for a
 * build on the edge of its range, and board numbers at their limits through every reader.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BOARD,
  DEFAULT_STACKUP,
  dsLowestPermittivity,
  isUsableStackup,
  type BoardSettings,
} from '@smithonline/core';

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
});
const { emptyDesign } = await import('../src/lib/design');
const { decodeDesign, encodeDesign } = await import('../src/lib/share');
const { DESIGN_STORAGE_KEY, readSavedDesign } = await import('../src/lib/autosave');

function edgeTanD(er: number): number {
  let lo = 0;
  let hi = 0.5;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (dsLowestPermittivity(er, mid, 1e9) >= 1) lo = mid;
    else hi = mid;
  }
  return lo;
}

describe('build at its edges through link, file and autosave', () => {
  const boards = {
    'drill 1 um': { viaDrill: 1e-6 },
    'drill 10 mm': { viaDrill: 0.01 },
    '100 vias': { viasPerShunt: 100 },
    'trace 1 m': { traceLength: 1 },
    'trace width 1 um': { traceWidth: 1e-6 },
    'h 0.1 m': { stackup: { ...DEFAULT_STACKUP, h: 0.1, name: undefined } },
    'h 1 um, t 1 mm, Rq 100 um': {
      stackup: { ...DEFAULT_STACKUP, h: 1e-6, t: 1e-3, roughness: 100e-6, name: undefined },
    },
    'er 1.0001 tanD 0': { stackup: { ...DEFAULT_STACKUP, er: 1.0001, tanD: 0, name: undefined } },
    'er 1.05 tanD on the edge': {
      stackup: { ...DEFAULT_STACKUP, er: 1.05, tanD: edgeTanD(1.05), name: undefined },
    },
    'rho 1e-4': { stackup: { ...DEFAULT_STACKUP, rho: 1e-4, name: undefined } },
    'name 200 chars': { stackup: { ...DEFAULT_STACKUP, name: 'x'.repeat(80) } },
  } as const;
  for (const [what, patch] of Object.entries(boards)) {
    it(what, () => {
      // `name: undefined` stands for a nameless stackup (JSON leaves it out).
      const board = { ...DEFAULT_BOARD, enabled: true, ...patch } as BoardSettings;
      expect(isUsableStackup(board.stackup)).toBe(true);
      const d = {
        ...emptyDesign(),
        name: what,
        build: {
          board,
          packages: [
            {
              id: '0402' as const,
              esl: 1e-6,
              cp: 1e-9,
              esr: 1000,
              pad: 1e-9,
              padLength: 0.1,
              padWidth: 0.1,
            },
          ],
        },
      };
      memory.set(DESIGN_STORAGE_KEY, JSON.stringify(d));
      const link = decodeDesign(encodeDesign(d));
      expect({
        autosave: readSavedDesign()?.name ?? null,
        link: link?.name ?? null,
        tanD: link?.build?.board?.stackup.tanD,
      }).toEqual({ autosave: what, link: what, tanD: board.stackup.tanD });
    });
  }
});
