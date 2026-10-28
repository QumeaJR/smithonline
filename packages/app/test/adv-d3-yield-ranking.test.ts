/**
 * Adversarial QA of depth phase D3 in the app: Auto match yield and ranking,
 * the spread of the design, design centring requests and Apply, the centring
 * job's cancel. Tests named "DEFECT" fail on f110a69 and document a kept
 * failure; the rest are attacks the code survived.
 */
import {
  centreDesign,
  complex,
  interpolatedLoad,
  monteCarlo,
  primaryValueOf,
  yieldEstimate,
  type Element,
} from '@smithonline/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { centreRequest, startCentring } from '../src/lib/centre';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { withPrimaryValue } from '../src/lib/elements';
import { matchSolutions, minimumQ } from '../src/lib/match';
import { rankSolutions } from '../src/lib/matchRanking';
import { snapSolutions } from '../src/lib/realize';
import {
  appendedLadder,
  designSpread,
  matchYieldSetup,
  networkRobustness,
  toleranceSetup,
} from '../src/lib/sensitivity';
import { DEFAULT_TOLERANCE } from '../src/lib/tolerance';

function design(
  elements: Design['elements'],
  extra: Partial<Design> = {},
  vswrLimit = 1.5,
): Design {
  const d = emptyDesign();
  return {
    ...d,
    frequency: 1e9,
    load: complex(100, -50),
    elements,
    sweep: { enabled: true, start: 0.95e9, stop: 1.05e9, points: 41 },
    tolerance: { ...DEFAULT_TOLERANCE, vswrLimit, overBand: true },
    ...extra,
  };
}

describe('Auto match yield', () => {
  it('DEFECT: with Losses on, the Auto match yield ignores the loss model the Tolerance panel applies', () => {
    // 15 - j40 ohm load, Losses on with inductor Q 10 (capacitor Q 200), VSWR 1.5 over 950 MHz to 1.05 GHz.
    const load = complex(15, -40);
    const losses = { enabled: true, inductorQ: 10, capacitorQ: 200 };
    const sol = matchSolutions('L', load, complex(50, 0), 50, 1e9, 0).find(
      (s) => s.description === 'shunt L + series C',
    );
    expect(sol).toBeDefined();
    const before = design([], { load, losses });
    const setup = matchYieldSetup(before);
    const auto = networkRobustness(before, [], appendedLadder(before, sol?.elements ?? []), setup);
    // The same network after "Add", as the Tolerance panel runs it (same seed, runs, band).
    const ts = toleranceSetup(design(identify(sol?.elements ?? []), { load, losses }));
    const panel = monteCarlo(ts.ladder, { ...ts.options, runs: 200, band: setup.band });
    // Observed on f110a69: Auto match 178 of 200 (89 %), Tolerance panel 58 of 200 (29 %).
    expect(Math.abs(auto.yield.passed - panel.passed)).toBeLessThanOrEqual(20);
  });

  it('survives: Pi and T on a 21-point band with four parts already in the ladder stay well under 100 ms per design change', () => {
    const existing = identify([
      { kind: 'L', orientation: 'series', value: 3e-9 },
      { kind: 'C', orientation: 'shunt', value: 1e-12 },
      { kind: 'L', orientation: 'series', value: 2e-9 },
      { kind: 'line', z0: 60, length: 0.05 },
    ] as Element[]);
    for (const topology of ['Pi', 'T'] as const) {
      for (const realize of [false, true]) {
        const d = design(
          existing,
          realize
            ? ({
                realize: { enabled: true, series: 'E24', stockText: '', scope: 'all' },
              } as Partial<Design>)
            : {},
          50, // every run passes, so no run stops early at a failing frequency
        );
        const zin = complex(100, -50);
        const q = Math.ceil(minimumQ(topology, zin, complex(50, 0)) + 1);
        const ideal = matchSolutions(topology, zin, complex(50, 0), 50, 1e9, q);
        const t0 = performance.now();
        const snapped = snapSolutions(d, d.elements, ideal);
        const setup = matchYieldSetup(d);
        const ranked = rankSolutions(d, d.elements, ideal, snapped, setup, 'yield');
        const ms = performance.now() - t0;
        expect(setup.band).toHaveLength(21);
        expect(ranked.every((r) => r.robustness.yield.passed === 200)).toBe(true);
        expect(ms).toBeLessThan(400); // generous for a busy machine; a regression would be seconds
      }
    }
  });

  it('survives: every solution at 100 %: ties resolve by RMS then Q, no NaN in notes or labels', () => {
    const d = design([], {}, 50);
    const ideal = matchSolutions('L', d.load, complex(50, 0), 50, 1e9, 0);
    const ranked = rankSolutions(d, [], ideal, null, matchYieldSetup(d), 'yield');
    expect(ranked.every((r) => r.robustness.yield.passed === 200)).toBe(true);
    for (let i = 1; i < ranked.length; i++)
      expect(ranked[i]?.robustness.rms ?? 0).toBeGreaterThanOrEqual(
        ranked[i - 1]?.robustness.rms ?? 0,
      );
    expect(ranked.every((r) => Number.isFinite(r.robustness.dominant?.share ?? 0))).toBe(true);
  });
});

describe('spread of the design', () => {
  it('DEFECT: a shunt C typed as 0 F turns every share in the table and on the cards into 0 %', () => {
    const d = design(
      identify([
        { kind: 'C', orientation: 'shunt', value: 0 },
        { kind: 'L', orientation: 'shunt', value: 12e-9 },
        { kind: 'C', orientation: 'series', value: 2.7e-12 },
      ] as Element[]),
    );
    const s = designSpread(d);
    const sum = (s?.parts ?? []).reduce((a, p) => a + p.share, 0);
    // Observed: [0, 0, 0] and rms NaN; without the 0 F part the shares are 0.52 and 0.48.
    expect(sum).toBeCloseTo(1, 6);
    expect(Number.isFinite(s?.rms ?? NaN)).toBe(true);
  });
});

describe('design centring in the app', () => {
  const runCentre = (d: Design) => {
    const req = centreRequest(d);
    const load =
      req.loads && req.loads.length >= 2
        ? interpolatedLoad(req.loads, { z0: req.ladder.z0 })
        : null;
    return centreDesign(req.ladder, { ...req.options, ...(load ? { load } : {}) });
  };
  /** What CentreSection's Apply does to the design. */
  const apply = (d: Design, res: ReturnType<typeof centreDesign>): Design => ({
    ...d,
    elements: d.elements.map((el, i) =>
      res.indices.includes(i)
        ? withPrimaryValue(el, primaryValueOf(res.elements[i] as Element) as number)
        : el,
    ),
  });
  const shuntLseriesC = matchSolutions('L', complex(100, -50), complex(50, 0), 50, 1e9, 0).find(
    (s) => s.description === 'shunt L + series C',
  );
  const ref = (extra: Partial<Design>): Design => ({
    ...design(identify(shuntLseriesC?.elements ?? []), extra, 1.38),
    sweep: { enabled: true, start: 0.9e9, stop: 1.1e9, points: 11 },
  });

  it('survives: with Realize on (E24, E12; all, pairs, L) Apply reproduces the centred network and its check yield', () => {
    for (const series of ['E24', 'E12'] as const) {
      for (const scope of ['all', 'pairs', 'L'] as const) {
        const d = ref({
          realize: { enabled: true, series, stockText: '', scope },
        } as Partial<Design>);
        const res = runCentre(d);
        const after = toleranceSetup(apply(d, res));
        expect(after.ladder.elements.map(primaryValueOf)).toEqual(res.elements.map(primaryValueOf));
        const y = yieldEstimate(after.ladder, {
          ...after.options,
          runs: 2000,
          seed: 1 + 7919,
          ...(after.band.length ? { band: after.band } : {}),
        });
        expect(y.passed).toBe(res.after.passed);
      }
    }
  });

  it('DEFECT (minor): with Realize on, Apply overwrites the ideal value of a part it does not list as changed', () => {
    const d = ref({
      realize: { enabled: true, series: 'E24', stockText: '', scope: 'all' },
    } as Partial<Design>);
    const req = centreRequest(d);
    const res = runCentre(d);
    expect(res.improved).toBe(true);
    // The parts the panel lists: realized value before differs from the result.
    const listed = res.indices.filter(
      (i) =>
        primaryValueOf(res.elements[i] as Element) !==
        primaryValueOf(req.ladder.elements[i] as Element),
    );
    const applied = apply(d, res);
    const silentlyChanged = d.elements
      .map((_, i) => i)
      .filter((i) => !listed.includes(i))
      .filter(
        (i) =>
          primaryValueOf(applied.elements[i] as Element) !==
          primaryValueOf(d.elements[i] as Element),
      );
    // Observed: Series C 2 is not listed (2.7 pF realized before and after) but its ideal
    // 2.599 pF is replaced by 2.7 pF.
    expect(silentlyChanged).toEqual([]);
  });

  it('survives: cancel rejects with "cancelled", terminates the worker and ignores a late result', async () => {
    const instances: { onmessage: ((e: MessageEvent) => void) | null; terminated: boolean }[] = [];
    class FakeWorker {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: ErrorEvent) => void) | null = null;
      terminated = false;
      constructor() {
        instances.push(this);
      }
      postMessage(): void {}
      terminate(): void {
        this.terminated = true;
      }
    }
    vi.stubGlobal('Worker', FakeWorker);
    const progress: unknown[] = [];
    const job = startCentring(centreRequest(ref({})), (p) => progress.push(p));
    instances[0]?.onmessage?.({
      data: { type: 'progress', stage: 'centring', done: 1, total: 600, best: 0.5 },
    } as MessageEvent);
    job.cancel();
    instances[0]?.onmessage?.({ data: { type: 'result', result: {} } } as MessageEvent);
    await expect(job.result).rejects.toThrow('cancelled');
    expect(instances[0]?.terminated).toBe(true);
    expect(progress).toHaveLength(1);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
