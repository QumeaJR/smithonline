import { describe, expect, it } from 'vitest';
import {
  bodeFano,
  complex,
  feasibility,
  lMatch,
  loadQ,
  nelderMead,
  OPTIMIZE_FAIL,
  optimizeBand,
  parameterBound,
  primaryValueOf,
  sweepPoints,
  worstVswr,
  type Element,
  type Ladder,
} from '../src/index';

const F = 140e6;
const LOAD = complex(25, -18);

/** The lowest-Q L-network for 25 - j18 at 140 MHz, exact at band centre. */
function centreMatch(): Element[] {
  const sols = lMatch(LOAD, complex(50, 0), F);
  return sols[0]!.elements.slice();
}

const BAND = sweepPoints(0.9 * F, 1.1 * F, 41);

describe('worstVswr', () => {
  it('is 1 at the design frequency for an exact match and grows away from it', () => {
    const els = centreMatch();
    expect(worstVswr(els, LOAD, 50, [F])).toBeCloseTo(1, 6);
    const band = worstVswr(els, LOAD, 50, BAND);
    expect(band).toBeGreaterThan(1.05);
    expect(band).toBeLessThan(3);
  });

  it('fails a load without resistance', () => {
    expect(worstVswr([], complex(0, 30), 50, [F])).toBe(OPTIMIZE_FAIL);
  });

  it('reads a frequency-dependent load', () => {
    const load = (f: number) => complex(50, (f - F) / 1e6);
    expect(worstVswr([], load, 50, [F])).toBeCloseTo(1, 9);
    expect(worstVswr([], load, 50, [F + 50e6])).toBeGreaterThan(2);
  });
});

describe('parameterBound', () => {
  it('bounds lumped parts by reactance at band centre, Z0 / 25 to 10 Z0', () => {
    const w = 2 * Math.PI * F;
    const l = parameterBound({ kind: 'L', orientation: 'series', value: 1e-9 }, 50, F)!;
    expect(l.lo * w).toBeCloseTo(2, 9);
    expect(l.hi * w).toBeCloseTo(500, 9);
    const c = parameterBound({ kind: 'C', orientation: 'shunt', value: 1e-12 }, 50, F)!;
    expect(1 / (w * c.hi)).toBeCloseTo(2, 9);
    expect(1 / (w * c.lo)).toBeCloseTo(500, 9);
    expect(l.log).toBe(true);
  });

  it('bounds lines by electrical length at band centre and scales with the reference', () => {
    const atBand = parameterBound({ kind: 'line', z0: 50, length: 0.1, refFrequency: F }, 50, F)!;
    expect(atBand.lo * 360).toBeCloseTo(10, 9);
    expect(atBand.hi * 360).toBeCloseTo(170, 9);
    expect(atBand.log).toBe(false);
    // A reference at half the band centre stores half the length for the same angle.
    const low = parameterBound(
      { kind: 'shortStub', z0: 50, length: 0.1, refFrequency: F / 2 },
      50,
      F,
    )!;
    expect(low.hi).toBeCloseTo(atBand.hi / 2, 12);
  });

  it('has no bound for an RLC block', () => {
    expect(
      parameterBound({ kind: 'RLC', orientation: 'series', connection: 'parallel', r: 1 }, 50, F),
    ).toBeNull();
    expect(
      primaryValueOf({ kind: 'RLC', orientation: 'series', connection: 'parallel', r: 1 }),
    ).toBeNull();
  });
});

describe('nelderMead', () => {
  it('finds the minimum of a quadratic bowl', () => {
    const got = nelderMead(
      ([x, y]) => (x! - 0.3) ** 2 + 2 * (y! + 0.2) ** 2,
      [0, 0],
      [0.1, 0.1],
      400,
    );
    expect(got.x[0]).toBeCloseTo(0.3, 2);
    expect(got.x[1]).toBeCloseTo(-0.2, 2);
    expect(got.value).toBeLessThan(1e-6);
  });
});

describe('optimizeBand', () => {
  const ladder = (elements: readonly Element[]): Ladder => ({
    z0: 50,
    frequency: F,
    load: LOAD,
    elements,
  });

  it('recovers a detuned L-network to at least the centre match over a 20 % band', () => {
    const good = centreMatch();
    const bad = good.map((e) =>
      e.kind === 'L' || e.kind === 'C' ? { ...e, value: e.value * 2 } : e,
    );
    const reference = worstVswr(good, LOAD, 50, BAND);
    const res = optimizeBand(ladder(bad), BAND, { restarts: 6, iterations: 200 });
    expect(res.before).toBe(worstVswr(bad, LOAD, 50, BAND));
    expect(res.before).toBeGreaterThan(reference);
    expect(res.after).toBeLessThanOrEqual(reference + 1e-6);
    expect(res.after).toBe(worstVswr(res.elements, LOAD, 50, BAND));
    expect(res.elements.map((e) => e.kind)).toEqual(bad.map((e) => e.kind));
    expect(res.indices).toEqual([0, 1]);
    expect(res.evaluations).toBeGreaterThan(100);
  });

  it('never returns a worse ladder than the one it was given', () => {
    const good = centreMatch();
    const res = optimizeBand(ladder(good), BAND, { restarts: 3, iterations: 100 });
    expect(res.after).toBeLessThanOrEqual(res.before);
    if (res.after === res.before) expect(res.elements).toBe(good);
  });

  it('is deterministic for the same seed and changes with another', () => {
    const bad = centreMatch().map((e) =>
      e.kind === 'L' || e.kind === 'C' ? { ...e, value: e.value * 3 } : e,
    );
    const a = optimizeBand(ladder(bad), BAND, { restarts: 3, iterations: 100, seed: 7 });
    const b = optimizeBand(ladder(bad), BAND, { restarts: 3, iterations: 100, seed: 7 });
    expect(a.elements).toEqual(b.elements);
    expect(a.after).toBe(b.after);
  });

  it('keeps every varied value inside its bound', () => {
    const bad = centreMatch().map((e) =>
      e.kind === 'L' || e.kind === 'C' ? { ...e, value: e.value * 3 } : e,
    );
    const res = optimizeBand(ladder(bad), BAND, { restarts: 4, iterations: 150 });
    const f0 = (BAND[0]! + BAND[BAND.length - 1]!) / 2;
    res.elements.forEach((e) => {
      const b = parameterBound(e, 50, f0)!;
      const v = primaryValueOf(e)!;
      expect(v).toBeGreaterThanOrEqual(b.lo * (1 - 1e-12));
      expect(v).toBeLessThanOrEqual(b.hi * (1 + 1e-12));
    });
  });

  it('varies only the requested indices and leaves RLC blocks alone', () => {
    const rlc: Element = {
      kind: 'RLC',
      orientation: 'shunt',
      connection: 'series',
      r: 5,
      l: 10e-9,
    };
    const els: Element[] = [
      rlc,
      ...centreMatch().map((e) => (e.kind === 'C' ? { ...e, value: e.value * 2 } : e)),
    ];
    const res = optimizeBand(ladder(els), BAND, { indices: [0, 2], restarts: 2, iterations: 100 });
    expect(res.indices).toEqual([2]);
    expect(res.elements[0]).toBe(rlc);
    expect(res.elements[1]).toBe(els[1]);
  });

  it('returns the ladder unchanged when nothing can be varied', () => {
    const res = optimizeBand(ladder([]), BAND);
    expect(res.after).toBe(res.before);
    expect(res.indices).toEqual([]);
    expect(res.evaluations).toBe(1);
  });

  it('reports progress per restart', () => {
    const seen: number[] = [];
    optimizeBand(ladder(centreMatch()), BAND, {
      restarts: 2,
      iterations: 20,
      onProgress: (p) => seen.push(p.done),
    });
    expect(seen).toEqual([0, 1, 2]);
  });

  it('respects a bound override', () => {
    const els = centreMatch();
    const l = els.findIndex((e) => e.kind === 'L');
    const fixed = primaryValueOf(els[l]!)!;
    const res = optimizeBand(ladder(els), BAND, {
      restarts: 2,
      iterations: 50,
      bounds: { [l]: { lo: fixed * 0.999, hi: fixed * 1.001 } },
    });
    expect(primaryValueOf(res.elements[l]!)!).toBeGreaterThanOrEqual(fixed * 0.999 * (1 - 1e-12));
    expect(primaryValueOf(res.elements[l]!)!).toBeLessThanOrEqual(fixed * 1.001 * (1 + 1e-12));
  });
});

describe('bodeFano and feasibility', () => {
  it('computes the floor from Q and fractional bandwidth', () => {
    // Q 10 over 10 %: g = exp(-pi) = 0.04321, floor = 1.04321 / 0.95679
    expect(bodeFano(10, 0.1)).toBeCloseTo(1.0903, 4);
    expect(bodeFano(0, 0.1)).toBeNull();
    expect(bodeFano(10, 0)).toBeNull();
  });

  it('reads the Q of a series resonator as w0 L / R at resonance', () => {
    const r = 50;
    const l = 100e-9;
    const f0 = 100e6;
    const w0 = 2 * Math.PI * f0;
    const c = 1 / (w0 * w0 * l);
    const load = (f: number) => {
      const w = 2 * Math.PI * f;
      return complex(r, w * l - 1 / (w * c));
    };
    const freqs = sweepPoints(0.98 * f0, 1.02 * f0, 21);
    const q = loadQ(load, freqs)!;
    expect(q).toBeCloseTo((w0 * l) / r, 2);
    const feas = feasibility(load, freqs)!;
    expect(feas.q).toBe(q);
    expect(feas.fractionalBandwidth).toBeCloseTo(0.04, 9);
    expect(feas.floor).toBeCloseTo(bodeFano(q, 0.04)!, 12);
  });

  it('says nothing for a fixed load, too few points or no resistance', () => {
    expect(feasibility(complex(25, -18), BAND)).toBeNull();
    expect(loadQ(() => complex(50, 10), [1, 2, 3])).toBeNull();
    expect(loadQ(() => complex(0, 10), [1, 2, 3, 4, 5])).toBeNull();
  });
});
