/**
 * QA round 1 on docs/09 section 6 ("Numbers in workflow text come from the
 * evaluation, as in the lessons (no typed results), and the 3.2 yields match
 * yield.test.ts within its intervals"), and the copy rule (no em or en dash)
 * over every workflow string a user can see: titles, blurbs, step titles,
 * texts for several designs, doIt labels, fallback texts and short names.
 */
import { centreDesign, complex, monteCarlo, wilsonInterval } from '@smithonline/core';
import { describe, expect, it, vi } from 'vitest';

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
});

const { emptyDesign } = await import('../src/lib/design');
const { centreRequest } = await import('../src/lib/centre');
const { exportLadderOf } = await import('../src/lib/simexport');
const { effectiveElements, realizeDesign } = await import('../src/lib/realize');
const { monteCarloOptions } = await import('../src/lib/tolerance');
const { doItLabel, missingText, stepText } = await import('../src/lib/workflowKit');
const { WORKFLOWS, robustStart, buildableStart } = await import('../src/lib/workflows');
const { useMonteCarlo } = await import('../src/store/useMonteCarlo');
const { useBandLimit } = await import('../src/store/useBandLimit');
const { tourSnapshot } = await import('../src/lib/tourSnapshot');

type Design = ReturnType<typeof emptyDesign>;
const step = (w: string, s: string) => {
  const found = WORKFLOWS.find((x) => x.id === w)?.steps.find((x) => x.id === s);
  if (!found) throw new Error(`${w}/${s}`);
  return found;
};
const text = (w: string, s: string, d: Design): string =>
  stepText(step(w, s), d, tourSnapshot({}, d));

describe('3.2 yields match yield.test.ts (docs/08: E24 46.1 % (43.9 to 48.3) to 92.8 % (91.6 to 93.9))', () => {
  it('design centring of the workflow start, as the app asks for it, lands in both intervals at 12 nH, 2.7 pF', () => {
    const req = centreRequest(robustStart());
    const r = centreDesign(req.ladder, req.options);
    expect(r.before.yield).toBeGreaterThanOrEqual(0.439);
    expect(r.before.yield).toBeLessThanOrEqual(0.483);
    expect(r.after.yield).toBeGreaterThanOrEqual(0.916);
    expect(r.after.yield).toBeLessThanOrEqual(0.939);
    expect((r.elements[0] as { value: number }).value).toBeCloseTo(12e-9, 15);
    expect((r.elements[1] as { value: number }).value).toBeCloseTo(2.7e-12, 18);
  });

  it("the Tolerance panel's own 1000 runs on the start and on the centred design overlap those intervals", () => {
    for (const [d, lo, hi] of [
      [robustStart(), 0.439, 0.483],
      [{ ...robustStart(), elements: buildableStart().elements }, 0.916, 0.939],
    ] as const) {
      const ladder = exportLadderOf(d, realizeDesign(d, effectiveElements(d)));
      const opts = monteCarloOptions(d);
      // The settings the workflow sets: 5 % (E24 default), VSWR 1.38, over the 11-point band.
      expect(opts.vswrLimit).toBe(1.38);
      expect(opts.band?.length).toBe(11);
      expect(opts.runs).toBe(1000);
      const r = monteCarlo(ladder, opts);
      const ci = wilsonInterval(r.passed, r.runs);
      expect(ci.hi).toBeGreaterThanOrEqual(lo);
      expect(ci.lo).toBeLessThanOrEqual(hi);
    }
  });
});

describe('numbers in step texts follow the design and the last run', () => {
  it('robust/open quotes the limit and the band of the design, not a typed 1.38', () => {
    const d = robustStart();
    expect(text('robust', 'open', d)).toMatch(
      /VSWR 1\.38 over the sweep range, 900 MHz to 1\.1 GHz\.$/,
    );
    const looser = { ...d, tolerance: { ...(d.tolerance as object), vswrLimit: 1.5 } } as Design;
    expect(text('robust', 'open', looser)).toMatch(/VSWR 1\.5 over/);
    const atF = { ...d, tolerance: { ...(d.tolerance as object), overBand: false } } as Design;
    expect(text('robust', 'open', atF)).toMatch(/VSWR 1\.38 at the design frequency\.$/);
  });

  it('robust/run counts the runs of the settings', () => {
    const d = robustStart();
    expect(text('robust', 'run', d)).toBe('Run 1000 boards.');
    const fewer = { ...d, tolerance: { ...(d.tolerance as object), runs: 250 } } as Design;
    expect(text('robust', 'run', fewer)).toBe('Run 250 boards.');
  });

  it('robust/yield quotes the last run: 461 of 1000 is 46.1 % with its Wilson interval', () => {
    const interval = wilsonInterval(461, 1000);
    useMonteCarlo.setState({
      result: { passed: 461, runs: 1000, interval } as never,
    });
    const t = text('robust', 'yield', robustStart());
    expect(t).toContain('Yield 46.1 %');
    expect(t).toContain(`${(interval.lo * 100).toFixed(1)} to ${(interval.hi * 100).toFixed(1)} %`);
    // Half the interval width, rounded: (0.492 - 0.430) / 2 is about 3 %.
    expect(t).toMatch(/under about 3 % are noise/);
    useMonteCarlo.setState({ result: null } as never);
    expect(text('robust', 'yield', robustStart())).not.toMatch(/\d+\.\d %/);
  });

  it('measured-antenna/pick quotes the Bode-Fano limit of the last search', () => {
    useBandLimit.getState().setLimit({ floor: 1.25, start: 1, stop: 2, loads: [] });
    expect(text('measured-antenna', 'pick', emptyDesign())).toContain('(1.250 here)');
    useBandLimit.getState().setLimit(null);
    expect(text('measured-antenna', 'pick', emptyDesign())).not.toMatch(/here\)/);
  });

  it('amplifier/stability quotes K and mu of the device: K 4.10, mu 2.26 by hand', () => {
    // S11 = S22 = 0.3, S21 = 2, S12 = 0.05: delta = -0.01, K = 0.8201 / 0.2, mu = 0.91 / 0.403.
    const d = {
      ...emptyDesign(),
      twoPort: {
        s: {
          s11: complex(0.3, 0),
          s12: complex(0.05, 0),
          s21: complex(2, 0),
          s22: complex(0.3, 0),
        },
        noise: null,
      },
    };
    expect(text('amplifier', 'stability', d)).toMatch(/Here K 4\.10 and mu 2\.26\.$/);
    expect(text('amplifier', 'stability', emptyDesign())).not.toMatch(/Here K/);
  });
});

describe('copy: no em or en dash anywhere a workflow speaks', () => {
  const designs: Design[] = [
    emptyDesign(),
    robustStart(),
    buildableStart(),
    {
      ...robustStart(),
      target: complex(30, 10),
      realize: { ...robustStart().realize, series: 'stock' },
    },
  ];
  it('titles, short names, blurbs, step titles, texts, doIt labels and fallback texts', () => {
    const bad: string[] = [];
    const check = (where: string, s: string): void => {
      if (/[–—]/.test(s)) bad.push(`${where}: ${s}`);
    };
    for (const w of WORKFLOWS) {
      check(`${w.id} title`, w.title);
      check(`${w.id} short`, w.short);
      check(`${w.id} blurb`, w.blurb);
      for (const s of w.steps) {
        check(`${w.id}/${s.id} title`, s.title);
        check(`${w.id}/${s.id} missing`, missingText(s));
        for (const d of designs) {
          if (s.doIt) check(`${w.id}/${s.id} doIt`, doItLabel(s, d));
          check(`${w.id}/${s.id} text`, stepText(s, d, tourSnapshot({}, d)));
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
