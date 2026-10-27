/**
 * Adversarial QA, D6 round 3 (final verification of 290416e): the plane F-test under realistic
 * noise, the multi-start plane, the "X or Y" rule, library parts with board pads. Each test states
 * the correct behaviour; a failing test is a reproduced defect.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BOARD,
  DEFAULT_PACKAGES,
  HOBBY_VNA_ACCURACY,
  SYNTHETIC_PARTS,
  driftParameters,
  fitBuild,
  modelGammas,
  readTouchstone,
  retuneCandidates,
  retunedWorst,
  suggestRetune,
  syntheticPart,
  type BuildFit,
  type BuildModel,
  type Drifts,
  type Element,
  type MeasuredReflection,
} from '../src/index';

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
const grid = (n: number, a = 0.7e9, b = 1.3e9): number[] =>
  Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
const BAND = grid(11, 0.9e9, 1.1e9);
const E24 = { kind: 'series', series: 'E24' } as const;
const log = (...a: unknown[]): void => void process.stdout.write(a.map(String).join(' ') + '\n');

function normal(seed: number): () => number {
  let s = seed;
  const u = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}
/**
 * Measured Gamma of a model with drifts plus complex noise; smooth > 0 averages 2 smooth + 1
 * neighbours (an averaged or smoothed trace), rescaled to the same RMS.
 */
function measure(
  model: BuildModel,
  d: Drifts,
  fs: number[],
  noise: number,
  seed: number,
  smooth = 0,
): MeasuredReflection[] {
  const n = normal(seed);
  let er = fs.map(() => n());
  let ei = fs.map(() => n());
  if (smooth > 0) {
    const sm = (a: number[]): number[] =>
      a.map((_, i) => {
        let s = 0;
        let c = 0;
        for (let k = -smooth; k <= smooth; k++) {
          const v = a[i + k];
          if (v !== undefined) {
            s += v;
            c++;
          }
        }
        return s / c;
      });
    er = sm(er);
    ei = sm(ei);
    const rms = Math.sqrt(
      er.reduce((s, v, i) => s + v * v + (ei[i] as number) ** 2, 0) / fs.length / 2,
    );
    er = er.map((v) => v / rms);
    ei = ei.map((v) => v / rms);
  }
  return modelGammas(model, d, fs).map((g, i) => ({
    frequency: fs[i] as number,
    gamma: { re: g.re + noise * (er[i] as number), im: g.im + noise * (ei[i] as number) },
  }));
}
function ok(out: ReturnType<typeof fitBuild>): BuildFit {
  if (!out.ok) throw new Error(out.reason);
  return out.fit;
}
const defaults = (m: BuildModel): string[] =>
  driftParameters(m)
    .filter((p) => p.freeByDefault)
    .map((p) => p.id);
const offBy = (fit: BuildFit, truth: Record<string, number>, k: number): string[] =>
  fit.parameters
    .filter((p) => p.status === 'fitted' && p.sigma !== null)
    .filter((p) => Math.abs(p.drift - (truth[p.id] ?? 0)) > k * (p.sigma as number))
    .map(
      (p) =>
        `${p.id} ${p.drift.toExponential(3)} +- ${(p.sigma as number).toExponential(1)} (truth ${truth[p.id] ?? 0})`,
    );
function retuneOn(model: BuildModel, fit: BuildFit, truth: Drifts) {
  const r = suggestRetune(model, fit.drifts, {
    band: BAND,
    limit: 1.38,
    candidates: retuneCandidates(E24, 1e9, BAND),
    // Changed in the fix round: the app passes the other explanations the data allows.
    alternatives: fit.alternatives,
  });
  const s = r.suggestion;
  const real = s
    ? retunedWorst(model, truth, new Map(s.changes.map((c) => [c.index, c.to])), BAND).vswr
    : NaN;
  const asIs = retunedWorst(model, truth, new Map(), BAND).vswr;
  return {
    s,
    real,
    asIs,
    changes: s?.changes.map((c) => `${c.index}->${(c.to as { value: number }).value}`),
  };
}

describe('round 2 confirmations (expected to pass)', () => {
  it('the 5 mm offset file, plane ticked: plane near 30.3 ps, series C pads blamed, at the floor; unticked: flagged', () => {
    const p =
      'C:/Users/JONASR~1/AppData/Local/Temp/claude/C--mygits-smithonline/1bd667ec-198c-41e0-a72d-ba622e703781/scratchpad/d6b/board-offset5mm.s1p';
    const d = readTouchstone(readFileSync(p, 'utf8'), 1);
    const m = d.points.map((q) => ({
      frequency: q.frequency,
      gamma: q.s[0] as { re: number; im: number },
    }));
    const fit = ok(fitBuild(SAMPLE, m, { free: [...defaults(SAMPLE), 'plane'] }));
    const plane = fit.parameters.find((q) => q.id === 'plane');
    expect(Math.abs((plane?.drift ?? 0) - 30.3e-12)).toBeLessThan(3 * (plane?.sigma ?? 0));
    expect(Math.abs((fit.drifts['pad:1'] ?? 0) - 0.3e-12)).toBeLessThan(0.05e-12);
    expect(fit.check.residual).toBe('noise');
    expect(fit.check.trusted).toBe(true);
    const unticked = ok(fitBuild(SAMPLE, m));
    expect(unticked.check.plane?.better).toBe(true);
    expect(unticked.check.trusted).toBe(false);
  }, 120000);
});

describe('multi-start plane: a band-only sweep with a plane and one E-step part drift', () => {
  // A VNA calibrated at its port, 4 cm of cable to the board (200 ps), sweeping the design band
  // only (0.9 to 1.1 GHz, 201 points); the shunt L one E12 step high (+10 %), the sample's series
  // C pads. Reference plane ticked, as the app advises.
  const truth = { 'value:0': 0.1, 'pad:1': 0.3e-12, plane: 200e-12 };
  const fs = grid(201, 0.9e9, 1.1e9);
  it('hobby VNA class: trusted only if the plane is found, and then the retune holds on the real board', () => {
    const m = measure(SAMPLE, truth, fs, 1e-3, 7);
    const fit = ok(
      fitBuild(SAMPLE, m, {
        free: [...defaults(SAMPLE), 'plane'],
        accuracy: HOBBY_VNA_ACCURACY,
      }),
    );
    const r = retuneOn(SAMPLE, fit, truth);
    log(
      'hobby 200 ps: plane',
      ((fit.drifts.plane ?? 0) * 1e12).toFixed(1),
      'ps, ratio',
      fit.check.residualRatio.toFixed(2),
      fit.check.residual,
      'trusted',
      fit.check.trusted,
      'drifts',
      JSON.stringify(fit.drifts),
      'retune',
      r.changes,
      'predicted',
      r.s?.worst.vswr.toFixed(3),
      'on the real board',
      r.real.toFixed(3),
      'board as it is',
      r.asIs.toFixed(3),
    );
    // Observed: plane -685.5 ps (truth +200), Series C value +17.6 % (truth 0), 1.95 floors,
    // trusted; retune Series C 2.7 -> 2.2 pF promised 1.333, the real board 1.594 (1.588 as it is).
    if (fit.check.trusted) {
      expect(Math.abs((fit.drifts.plane ?? 0) - 200e-12)).toBeLessThan(10e-12);
      // Changed in the fix round: the guarantee is no worse than the board as it is (a
      // promise of inside the target rests on the fit, which no fit can make certain).
      expect(r.real).toBeLessThanOrEqual(r.asIs);
    }
  }, 120000);
  it('lab VNA class with a 0.005 scatter (300 ps): trusted only if the plane is found', () => {
    const t = { ...truth, plane: 300e-12 };
    const m = measure(SAMPLE, t, fs, 5e-3, 7);
    const fit = ok(fitBuild(SAMPLE, m, { free: [...defaults(SAMPLE), 'plane'] }));
    const r = retuneOn(SAMPLE, fit, t);
    log(
      'lab 300 ps n 0.005: plane',
      ((fit.drifts.plane ?? 0) * 1e12).toFixed(1),
      'ps, ratio',
      fit.check.residualRatio.toFixed(2),
      fit.check.residual,
      'trusted',
      fit.check.trusted,
      'retune',
      r.changes,
      'predicted',
      r.s?.worst.vswr.toFixed(3),
      'real',
      r.real.toFixed(3),
    );
    // Observed: plane -139.3 ps, 3.69 floors ('above', still trusted), retune promised 1.333, real 1.405.
    if (fit.check.trusted) {
      expect(Math.abs((fit.drifts.plane ?? 0) - 300e-12)).toBeLessThan(10e-12);
      // Changed in the fix round: the guarantee is no worse than the board as it is (a
      // promise of inside the target rests on the fit, which no fit can make certain).
      expect(r.real).toBeLessThanOrEqual(r.asIs);
    }
  }, 120000);
  it('unticked (the default), hobby: the silent plane fit does not advise a wrong plane', () => {
    const m = measure(SAMPLE, truth, fs, 1e-3, 7);
    const fit = ok(fitBuild(SAMPLE, m, { accuracy: HOBBY_VNA_ACCURACY }));
    log(
      'unticked: plane check',
      JSON.stringify(
        fit.check.plane && {
          drift: fit.check.plane.drift,
          better: fit.check.plane.better,
          p: fit.check.plane.p,
        },
      ),
      'trusted',
      fit.check.trusted,
    );
    if (fit.check.plane?.better)
      expect(Math.abs(fit.check.plane.drift - 200e-12)).toBeLessThan(10e-12);
  }, 120000);
});

describe('plane not ticked: the comparison must catch a plane that moves the drifts', () => {
  it('hobby class, -12 ps (1.8 mm of FR-4 microstrip): the plane is called or the fit is not trusted', () => {
    const t = { ...TRUTH, plane: -12e-12 };
    const fit = ok(
      fitBuild(SAMPLE, measure(SAMPLE, t, grid(121), 1e-3, 11), {
        accuracy: HOBBY_VNA_ACCURACY,
      }),
    );
    const wrong = offBy(fit, t, 3);
    log(
      'hobby -12 ps: p',
      fit.check.plane?.p.toExponential(2),
      'rms',
      fit.rmsAfter.toExponential(3),
      'with plane',
      fit.check.plane?.rmsWith.toExponential(3),
      'moved',
      JSON.stringify(fit.check.plane?.moved.map((x) => x.id)),
      'trusted',
      fit.check.trusted,
      'off by >3 sigma:',
      wrong.join('; '),
    );
    // Observed: p 6.6e-62, every drift moved by tens of sigma (PlaneCheck.moved lists them, nothing
    // reads it), yet better false (the RMS drop 0.0011 is under 0.1 of the 0.02 floor) and trusted,
    // with Series C value -3.75 % +- 0.03 % (truth 0), Series C pads -0.085 pF (truth +0.3).
    expect(fit.check.trusted && wrong.length > 0).toBe(false);
  }, 120000);
  it('lab class, planes of a millimetre or less: a trusted fit has its drifts within 4 sigma', () => {
    const rnd = normal(4242);
    let trusted = 0;
    let wrong = 0;
    let first = '';
    for (let k = 0; k < 40; k++) {
      const t: Record<string, number> = {
        'value:0': 0.08 * rnd(),
        'value:1': 0.06 * rnd(),
        'pad:1': Math.abs(0.15e-12 * rnd()),
        'pad:0': Math.abs(0.15e-12 * rnd()),
        plane: 6e-12 * rnd(),
      };
      const fit = ok(fitBuild(SAMPLE, measure(SAMPLE, t, grid(121), 1e-3, 100 + k)));
      if (!fit.check.trusted) continue;
      trusted++;
      const off = offBy(fit, t, 4);
      if (off.length > 0) {
        wrong++;
        if (!first) first = `${JSON.stringify(t)} seed ${100 + k}: ${off.join('; ')}`;
      }
    }
    log(
      'lab sub-mm planes: trusted',
      trusted,
      'of 40; trusted with a drift >4 sigma off:',
      wrong,
      '; first:',
      first,
    );
    expect(wrong).toBeLessThanOrEqual(1);
  }, 120000);
  it('an averaged trace (5-point moving average, 0.003 RMS, no plane) is not told to tick Reference plane', () => {
    let alarms = 0;
    for (let s = 1; s <= 60; s++) {
      const fit = ok(fitBuild(SAMPLE, measure(SAMPLE, TRUTH, grid(121), 3e-3, 1000 + s * 7, 5)));
      if (fit.check.plane?.better) alarms++;
    }
    log('averaged trace, no plane: false alarms', alarms, 'of 60');
    // PLANE_P is 0.001; the F-test assumes independent points.
    expect(alarms).toBeLessThanOrEqual(1);
  }, 120000);
});

describe('"X or Y cannot be told apart" is not bypassed by the uncertainty rule', () => {
  it('εr and h both ticked on a board with a 50 Ω microstrip: the drift is not given to h when εr moved', () => {
    const M: BuildModel = {
      ...SAMPLE,
      base: [
        ...SAMPLE.base,
        {
          kind: 'microstrip',
          width: 3e-3,
          length: 20e-3,
          stackup: DEFAULT_BOARD.stackup,
        } as Element,
      ],
    };
    const t = { er: 0.08, 'value:0': 0.05 };
    const fit = ok(
      fitBuild(M, measure(M, t, grid(121), 1e-3, 9), {
        free: [...defaults(M), 'plane', 'er', 'h'],
      }),
    );
    const er = fit.parameters.find((p) => p.id === 'er');
    const h = fit.parameters.find((p) => p.id === 'h');
    log(
      'er',
      er?.status,
      er?.why,
      er?.partner,
      er?.correlation,
      '| h',
      h?.status,
      h?.drift,
      '+-',
      h?.sigma,
      '| pairs',
      JSON.stringify(fit.correlated),
      'trusted',
      fit.check.trusted,
    );
    const hWrong = h?.status === 'fitted' && Math.abs(h.drift) > 3 * (h.sigma ?? Infinity);
    // Observed: εr unresolved ('uncertain', correlation 1.000 with h), h fitted -5.6 % +- 0.32 % (truth 0),
    // h in no reported pair, trusted: the table gives the laminate drift to the wrong one of the two.
    const hPaired = fit.correlated.some((c) => c.a === 'h' || c.b === 'h');
    expect(hWrong && !hPaired).toBe(false);
  }, 120000);
});

describe('library parts with the board on', () => {
  const part = (n: string) =>
    syntheticPart(SYNTHETIC_PARTS.find((p) => p.name === n) as (typeof SYNTHETIC_PARTS)[number]);
  const LIB: BuildModel = {
    ...SAMPLE,
    base: [
      { kind: 'part', orientation: 'shunt', part: part('SYNTH-L0402-10N') } as Element,
      { kind: 'part', orientation: 'series', part: part('SYNTH-C0402-2P2') } as Element,
    ],
  };
  it('a pad with no drift is not called unphysical (0.7 to 1.3 GHz, 121 points, noise 0.001, 40 seeds)', () => {
    let refused = 0;
    let shown = '';
    for (let seed = 1; seed <= 40; seed++) {
      const fit = ok(
        fitBuild(LIB, measure(LIB, { 'value:0': 0.03 }, grid(121), 1e-3, seed * 13 + 1)),
      );
      const bad = fit.check.implausible.filter(
        (x) => x.why === 'unphysical' && x.id.startsWith('pad'),
      );
      if (bad.length > 0) {
        refused++;
        if (!shown) {
          const p = fit.parameters.find((q) => q.id === bad[0]?.id);
          shown = `seed ${seed * 13 + 1}: ${p?.id} drift ${p?.drift.toExponential(2)} F, residual ${fit.check.residualRatio.toFixed(2)} floors, trusted ${fit.check.trusted}`;
        }
      }
    }
    log('library pads called unphysical:', refused, 'of 40;', shown);
    expect(refused).toBe(0);
  }, 120000);
});

describe('pair wording', () => {
  it('a pair whose drifts are both resolved to a fraction of their prior is not "cannot be told apart"', () => {
    // Series C value -8 %, nothing else; a 100 MHz sweep, 51 points, noise 0.003.
    const t = { 'value:1': -0.08 };
    const fit = ok(fitBuild(SAMPLE, measure(SAMPLE, t, grid(51, 0.95e9, 1.05e9), 3e-3, 3)));
    const v = fit.parameters.find((p) => p.id === 'value:1');
    const pad = fit.parameters.find((p) => p.id === 'pad:1');
    log(
      'value:1',
      v?.drift,
      '+-',
      v?.sigma,
      '| pad:1',
      pad?.drift,
      '+-',
      pad?.sigma,
      '| pairs',
      JSON.stringify(fit.correlated),
    );
    const resolved = (p?: { sigma: number | null; prior: number }): boolean =>
      p?.sigma != null && p.sigma < 0.25 * p.prior;
    const weak = Math.abs(pad?.drift ?? 0) < 2 * (pad?.sigma ?? 0);
    // pairText calls a pair ambiguous ("cannot be told apart ... not which of them moved") when
    // either is within 2 sigma of 0, though here both are resolved to a quarter of their prior.
    expect(resolved(v) && resolved(pad) && weak && fit.correlated.length > 0).toBe(false);
  }, 120000);
});

describe('clean data: a resolvable pad is not set aside', () => {
  it('100 clean measurements of the sample, drifts within one prior (pads down to -0.1 of 0.12 pF): every fit exact', () => {
    const rnd = normal(777);
    const bad: string[] = [];
    for (let k = 0; k < 100; k++) {
      const t: Record<string, number> = {
        'value:0': 0.1 * rnd(),
        'value:1': 0.1 * rnd(),
        'pad:1': Math.min(Math.max(0.2e-12 * rnd(), -0.1e-12), 0.4e-12),
        'pad:0': Math.min(Math.max(0.2e-12 * rnd(), -0.1e-12), 0.4e-12),
      };
      const fit = ok(fitBuild(SAMPLE, measure(SAMPLE, t, grid(121), 0, 1)));
      const dropped = fit.parameters
        .filter((p) => p.status === 'unresolved' && p.why === 'uncertain')
        .map((p) => p.id);
      if (dropped.length > 0 || fit.rmsAfter > 1e-6 || fit.check.plane?.better)
        bad.push(
          `${JSON.stringify(t)}: set aside ${dropped.join(',')}, rms ${fit.rmsAfter.toExponential(2)}, plane called ${fit.check.plane?.better} at ${((fit.check.plane?.drift ?? 0) * 1e12).toFixed(3)} ps`,
        );
    }
    log(
      'clean fits that fail:',
      bad.length,
      'of 100; first:',
      bad[0],
      '; with both pads above -0.05 pF:',
      bad.filter((b) => !b.includes('-1e-13')).length,
      bad.filter((b) => !b.includes('-1e-13'))[0],
    );
    expect(bad).toEqual([]);
  }, 300000);
});

describe('a laminate drift on a board with a microstrip is not sent to the reference plane', () => {
  it('h -10 % on a 1.2 mm wide, 20 mm microstrip at the input: no "tick Reference plane"; ticked, no confident wrong drifts', () => {
    const M: BuildModel = {
      ...SAMPLE,
      base: [
        ...SAMPLE.base,
        {
          kind: 'microstrip',
          width: 1.2e-3,
          length: 20e-3,
          stackup: DEFAULT_BOARD.stackup,
        } as Element,
      ],
    };
    const t = { h: -0.1, 'value:0': 0.05 };
    const m = measure(M, t, grid(121), 1e-3, 9);
    const fit = ok(fitBuild(M, m));
    const ticked = ok(fitBuild(M, m, { free: [...defaults(M), 'plane'] }));
    const wrong = offBy(ticked, t, 4);
    log(
      'laminate: unticked plane called',
      fit.check.plane?.better,
      ((fit.check.plane?.drift ?? 0) * 1e12).toFixed(2),
      'ps | ticked trusted',
      ticked.check.trusted,
      'off >4 sigma:',
      wrong.join('; '),
    );
    // Observed: unticked, "a reference-plane offset of about +3.2 ps explains this better: tick
    // Reference plane"; ticked, trusted with the plane +3.15 +- 0.12 ps and Series C value
    // -4.2 % +- 0.05 % (truth 0); εr and h, offered, are never named.
    expect(fit.check.plane?.better === true && ticked.check.trusted && wrong.length > 0).toBe(
      false,
    );
  }, 120000);
});
