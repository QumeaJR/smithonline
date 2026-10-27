/**
 * D6 QA round 1 fixes (closedloop.ts): the checks a bench engineer makes before acting on a fit
 * (the residual against the noise floor, the size of the drifts, the design frequency against
 * the measurement), the reference plane, the board's er and h reaching a microstrip, and the
 * band a retune is judged on. The data are the model's own with known drifts and seeded noise.
 */
import { describe, expect, it } from 'vitest';
import {
  checkFit,
  DEFAULT_BOARD,
  DEFAULT_PACKAGES,
  driftParameters,
  EXPLAINED_RATIO,
  fitBuild,
  measuredPart,
  MIN_NOISE_FLOOR,
  modelGammas,
  noiseFloor,
  type BuildFit,
  type BuildModel,
  type Drifts,
  type Element,
  type MeasuredReflection,
} from '../src/index';

/** The sample's board: shunt L 10 nH, series C 2.7 pF, 0402, FR-4, at 1 GHz on 100 - j50 ohm. */
const SAMPLE: BuildModel = {
  z0: 50,
  frequency: 1e9,
  base: [
    { kind: 'L', orientation: 'shunt', value: 10e-9, package: '0402' },
    { kind: 'C', orientation: 'series', value: 2.7e-12, package: '0402' },
  ],
  table: DEFAULT_PACKAGES,
  board: { ...DEFAULT_BOARD, enabled: true },
  load: { re: 100, im: -50 },
};
const TRUTH = { 'value:0': 0.08, 'pad:1': 0.3e-12 };
const FS = Array.from({ length: 121 }, (_, i) => 0.7e9 + (0.6e9 * i) / 120);

function measure(model: BuildModel, drifts: Drifts, noise = 1e-3, seed = 11): MeasuredReflection[] {
  let s = seed;
  const u = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const n = (): number => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
  return modelGammas(model, drifts, FS).map((g, i) => ({
    frequency: FS[i] as number,
    gamma: { re: g.re + noise * n(), im: g.im + noise * n() },
  }));
}

function ok(out: ReturnType<typeof fitBuild>): BuildFit {
  if (!out.ok) throw new Error(out.reason);
  return out.fit;
}

/** 5 mm of FR-4 microstrip (effective permittivity 3.3) between the calibration and the board. */
const PLANE_5MM = 5e-3 / (299792458 / Math.sqrt(3.3));

describe('the noise floor from the point-to-point scatter', () => {
  it('reads the noise of the data within 15 %, whatever its size, and NaN under five points', () => {
    for (const noise of [3e-4, 1e-3, 3e-3]) {
      const floor = noiseFloor(measure(SAMPLE, TRUTH, noise));
      // Complex RMS of noise of sigma per part: sqrt(2) sigma.
      expect(floor / (Math.SQRT2 * noise)).toBeGreaterThan(0.85);
      expect(floor / (Math.SQRT2 * noise)).toBeLessThan(1.15);
    }
    expect(noiseFloor(measure(SAMPLE, TRUTH).slice(0, 4))).toBeNaN();
  });
});

describe('the checks of a fit', () => {
  it('the sample: residual at the noise, drifts plausible, design frequency measured', () => {
    const fit = ok(fitBuild(SAMPLE, measure(SAMPLE, TRUTH)));
    expect(fit.check.residual).toBe('noise');
    expect(fit.check.residualRatio).toBeLessThan(EXPLAINED_RATIO);
    expect(fit.check.implausible).toEqual([]);
    expect(fit.check.frequencyOutside).toBe(false);
    expect(fit.check.trusted).toBe(true);
  });

  it('a 5 mm reference-plane offset: not explained, pads several typical drifts, not trusted', () => {
    const fit = ok(fitBuild(SAMPLE, measure(SAMPLE, { ...TRUTH, plane: PLANE_5MM })));
    // Fix round 3: the pads are linear in the model (no clamp at none), so the fit absorbs more
    // of the plane (4.4 floors, was above 10): still a pattern above the noise, never trusted, and
    // the silent plane fit calls the plane.
    expect(fit.check.residualRatio).toBeGreaterThan(EXPLAINED_RATIO);
    expect(fit.check.residual).not.toBe('noise');
    expect(fit.check.plane?.better).toBe(true);
    expect(fit.check.implausible.map((x) => x.id)).toContain('pad:1');
    expect(fit.check.trusted).toBe(false);
  });

  it('the same offset with Reference plane ticked: the plane is fitted and the residual is noise', () => {
    const free = [
      ...driftParameters(SAMPLE)
        .filter((p) => p.freeByDefault)
        .map((p) => p.id),
      'plane',
    ];
    const fit = ok(fitBuild(SAMPLE, measure(SAMPLE, { ...TRUTH, plane: PLANE_5MM }), { free }));
    const plane = fit.parameters.find((p) => p.id === 'plane');
    expect(plane?.status).toBe('fitted');
    expect(fit.check.residual).toBe('noise');
    expect(fit.check.trusted).toBe(true);
  });

  it('a wrong design (450 MHz, other parts) against the 1 GHz board: unexplained, frequency outside', () => {
    const wrong: BuildModel = {
      ...SAMPLE,
      frequency: 450e6,
      base: [
        { kind: 'C', orientation: 'shunt', value: 10e-12, package: '0402' },
        { kind: 'L', orientation: 'series', value: 22e-9, package: '0402' },
      ],
    };
    const fit = ok(fitBuild(wrong, measure(SAMPLE, TRUTH)));
    expect(fit.check.residual).toBe('unexplained');
    expect(fit.check.frequencyOutside).toBe(true);
    expect(fit.check.trusted).toBe(false);
  });

  it('flags a drift past three typical drifts and one past what is physical', () => {
    const fit = ok(fitBuild(SAMPLE, measure(SAMPLE, TRUTH)));
    const with_ = (id: string, drift: number) =>
      fit.parameters.map((p) => (p.id === id ? { ...p, status: 'fitted' as const, drift } : p));
    const large = checkFit(SAMPLE, measure(SAMPLE, TRUTH), with_('value:0', 0.35), 0.001);
    expect(large.implausible).toEqual([{ id: 'value:0', why: 'large' }]);
    const negative = checkFit(SAMPLE, measure(SAMPLE, TRUTH), with_('pad:0', -1e-12), 0.001);
    expect(negative.implausible).toEqual([{ id: 'pad:0', why: 'unphysical' }]);
  });

  it('a residual under the smallest floor taken is noise, whatever the scatter of the trace', () => {
    const smooth = measure(SAMPLE, TRUTH, 0);
    const fit = ok(fitBuild(SAMPLE, smooth));
    const c = checkFit(SAMPLE, smooth, fit.parameters, MIN_NOISE_FLOOR * 2);
    expect(c.residual).toBe('noise');
  });
});

describe('the board er and h', () => {
  const ms: Element = {
    kind: 'microstrip',
    width: 3e-3,
    length: 20e-3,
    stackup: DEFAULT_BOARD.stackup,
  };
  it('are offered for a microstrip-only network (board off), and an er drift moves the line', () => {
    const m: BuildModel = { ...SAMPLE, base: [ms], board: DEFAULT_BOARD };
    const ids = driftParameters(m).map((p) => p.id);
    expect(ids).toContain('er');
    expect(ids).toContain('h');
    const a = modelGammas(m, {}, [1e9])[0];
    const b = modelGammas(m, { er: 0.1 }, [1e9])[0];
    expect(Math.hypot((a?.re ?? 0) - (b?.re ?? 0), (a?.im ?? 0) - (b?.im ?? 0))).toBeGreaterThan(
      1e-3,
    );
  });

  it('are not offered where nothing depends on them (ideal parts, board off)', () => {
    const m: BuildModel = {
      ...SAMPLE,
      base: SAMPLE.base.map((el) => ({ ...el, package: undefined }) as never),
      board: DEFAULT_BOARD,
    };
    const ids = driftParameters(m).map((p) => p.id);
    expect(ids).not.toContain('er');
    expect(ids).not.toContain('h');
  });
});

describe('the band a retune is judged on', () => {
  it('keeps the band frequencies inside the measured span and counts the rest', () => {
    const meas = measure(SAMPLE, TRUTH);
    expect(measuredPart([0.9e9, 1e9, 1.1e9], meas)).toEqual({
      inside: [0.9e9, 1e9, 1.1e9],
      outside: 0,
    });
    expect(measuredPart([0.5e9, 1e9, 1.5e9], meas)).toEqual({ inside: [1e9], outside: 2 });
    expect(measuredPart([0.45e9], meas)).toEqual({ inside: [], outside: 1 });
  });
});
