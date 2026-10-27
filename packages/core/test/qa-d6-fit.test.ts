/**
 * QA D6 (closedloop.ts, fitBuild): the numerics of the fit. Expected values come from the
 * synthetic truth the data was made with (the same model, known drifts), from closed forms
 * stated next to them (the residual-ratio threshold sqrt(1 - 0.05^2) = 0.998749, the 1 and 3
 * sigma coverage of a normal estimate, 68.3 % and 99.7 %), or from series arithmetic (two
 * inductors in series add).
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BOARD,
  DEFAULT_PACKAGES,
  SYNTHETIC_PARTS,
  driftParameters,
  driftedElements,
  fitBuild,
  impedanceRows,
  measuredReflections,
  modelGammas,
  readTouchstone,
  syntheticPart,
  type BuildFit,
  type BuildModel,
  type Element,
  type MeasuredReflection,
} from '../src/index';

const MODEL: BuildModel = {
  z0: 50,
  frequency: 1e9,
  base: [
    { kind: 'L', orientation: 'shunt', value: 12e-9, package: '0402' },
    { kind: 'C', orientation: 'series', value: 2.7e-12, package: '0402' },
  ],
  table: DEFAULT_PACKAGES,
  board: { ...DEFAULT_BOARD, enabled: true },
  load: { re: 100, im: -50 },
};
const TRUTH = { 'value:0': 0.08, 'pad:1': 0.3e-12 };

function frequencies(n: number, lo = 0.7e9, hi = 1.3e9): number[] {
  return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
}

function normal(seed: number): () => number {
  let s = seed;
  const u = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

function measure(
  model: BuildModel,
  drifts: Record<string, number>,
  fs: readonly number[],
  noise = 0,
  seed = 7,
): MeasuredReflection[] {
  const g = modelGammas(model, drifts, fs);
  const n = normal(seed);
  return g.map((x, i) => ({
    frequency: fs[i] as number,
    gamma: { re: x.re + noise * n(), im: x.im + noise * n() },
  }));
}

const param = (fit: BuildFit, id: string) => {
  const p = fit.parameters.find((q) => q.id === id);
  if (!p) throw new Error(`no parameter ${id}`);
  return p;
};

function ok(out: ReturnType<typeof fitBuild>): BuildFit {
  if (!out.ok) throw new Error(out.reason);
  return out.fit;
}

/** The prior-scaled Jacobian column of one parameter by central differences on modelGammas (not fitBuild's code). */
function column(model: BuildModel, id: string, prior: number, fs: readonly number[]): number[] {
  const h = 1e-5;
  const gp = modelGammas(model, { [id]: h * prior }, fs);
  const gm = modelGammas(model, { [id]: -h * prior }, fs);
  return gp.flatMap((g, i) => [
    (g.re - (gm[i] as typeof g).re) / (2 * h),
    (g.im - (gm[i] as typeof g).im) / (2 * h),
  ]);
}
const dot = (a: readonly number[], b: readonly number[]): number =>
  a.reduce((s, x, i) => s + x * (b[i] as number), 0);
const cosine = (a: readonly number[], b: readonly number[]): number =>
  dot(a, b) / Math.sqrt(dot(a, a) * dot(b, b));

/** Gauss-Jordan inverse of a small matrix. */
function invert(a: number[][]): number[][] {
  const n = a.length;
  const m = a.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++)
      if (Math.abs((m[r] as number[])[c] as number) > Math.abs((m[p] as number[])[c] as number))
        p = r;
    [m[c], m[p]] = [m[p] as number[], m[c] as number[]];
    const rc = m[c] as number[];
    const piv = rc[c] as number;
    for (let j = 0; j < 2 * n; j++) rc[j] = (rc[j] as number) / piv;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const rr = m[r] as number[];
      const k = rr[c] as number;
      for (let j = 0; j < 2 * n; j++) rr[j] = (rr[j] as number) - k * (rc[j] as number);
    }
  }
  return m.map((row) => row.slice(n));
}

/** sqrt(1 - 0.05^2): a column within 5 % of the span of another has a cosine above this. */
const COS_LIMIT = Math.sqrt(1 - 0.05 * 0.05);

describe('QA D6 fit: the 3 sigma claim over many seeds', () => {
  // Over 200 seeds a calibrated sigma puts about 68.3 % of the estimates within 1 sigma and
  // 99.7 % within 3 sigma. Bounds: binomial, n = 200: 1 sigma in [0.58, 0.78] (about 3 sd),
  // 3 sigma at least 0.98 (at most 4 misses where 0.6 are expected).
  for (const [label, truth] of [
    ['the sample drifts', TRUTH],
    ['larger drifts (3 priors)', { 'value:0': 0.3, 'value:1': -0.25, 'pad:1': 0.6e-12 }],
  ] as const) {
    for (const noise of [1e-3, 1e-2]) {
      it(`${label}, noise ${noise}: 1 and 3 sigma coverage of every fitted drift`, () => {
        const fs = frequencies(121);
        const tally = new Map<string, { n: number; in1: number; in3: number }>();
        for (let k = 1; k <= 200; k++) {
          const fit = ok(fitBuild(MODEL, measure(MODEL, truth, fs, noise, k * 7919 + 13)));
          for (const p of fit.parameters) {
            if (p.status !== 'fitted') continue;
            const t = (truth as Record<string, number>)[p.id] ?? 0;
            const z = Math.abs(p.drift - t) / (p.sigma as number);
            const s = tally.get(p.id) ?? { n: 0, in1: 0, in3: 0 };
            s.n += 1;
            if (z <= 1) s.in1 += 1;
            if (z <= 3) s.in3 += 1;
            tally.set(p.id, s);
          }
        }
        expect(tally.get('value:0')?.n).toBe(200);
        for (const [, s] of tally) {
          if (s.n < 100) continue;
          expect(s.in3 / s.n).toBeGreaterThanOrEqual(0.98);
          expect(s.in1 / s.n).toBeGreaterThan(0.58);
          expect(s.in1 / s.n).toBeLessThan(0.78);
        }
      });
    }
  }
});

describe('QA D6 fit: drifts larger than the typical drift', () => {
  for (const truth of [
    { 'value:0': 0.5, 'value:1': -0.4, 'pad:1': 1e-12 },
    { 'value:0': 1.0 },
    { 'value:0': -0.5, 'pad:0': -0.05e-12 },
  ]) {
    it(`recovers ${JSON.stringify(truth)} from clean data, starting at no drift`, () => {
      const fit = ok(fitBuild(MODEL, measure(MODEL, truth, frequencies(121))));
      for (const id of ['value:0', 'value:1', 'pad:0', 'pad:1']) {
        const p = param(fit, id);
        expect(p.status).toBe('fitted');
        const t = (truth as Record<string, number>)[id] ?? 0;
        expect(Math.abs(p.drift - t)).toBeLessThan(1e-6 * p.prior);
      }
      expect(fit.rmsAfter).toBeLessThan(1e-8);
    });
  }
});

describe('QA D6 fit: the regularization', () => {
  // A 10 mOhm series resistor (a jumper, a sense resistor) at the input: a weak but resolvable
  // parameter, +50 % on it. With one Tikhonov weight for all (relative to the largest singular
  // value) it was shrunk by 1.6e-3 of its drift. Fix round: each parameter's weight follows its
  // own curvature. On clean data the stated sigma is round-off (1e-9), so the shrink is checked
  // against the drift there, and against sigma with a little noise (1e-6 in Gamma).
  it('a weak parameter is not shrunk (clean data: below 1e-7 of its drift; noise: within 3 sigma)', () => {
    const m: BuildModel = {
      ...MODEL,
      base: [
        { kind: 'L', orientation: 'shunt', value: 12e-9 },
        { kind: 'C', orientation: 'series', value: 2.7e-12 },
        { kind: 'R', orientation: 'series', value: 0.01 },
      ],
      board: DEFAULT_BOARD,
    };
    const truth = { 'value:0': 0.08, 'value:2': 0.5 };
    const clean = param(ok(fitBuild(m, measure(m, truth, frequencies(121)))), 'value:2');
    expect(clean.status).toBe('fitted');
    expect(Math.abs(clean.drift - 0.5) / 0.5).toBeLessThan(1e-7);
    const noisy = param(ok(fitBuild(m, measure(m, truth, frequencies(121), 1e-6))), 'value:2');
    expect(noisy.status).toBe('fitted');
    expect(Math.abs(noisy.drift - 0.5)).toBeLessThanOrEqual(3 * (noisy.sigma as number));
  });

  it('the strong parameters keep no visible bias (the clean sample to 1e-8)', () => {
    const fit = ok(fitBuild(MODEL, measure(MODEL, TRUTH, frequencies(121))));
    expect(Math.abs(param(fit, 'value:0').drift - 0.08) / 0.08).toBeLessThan(1e-8);
    expect(Math.abs(param(fit, 'pad:1').drift - 0.3e-12) / 0.3e-12).toBeLessThan(1e-8);
  });
});

describe('QA D6 fit: the identifiability thresholds at their boundary', () => {
  // value:0 (prior 1.2 nH) has the larger column than via (prior 50 % of about 0.5 nH), so it is
  // picked first and via is "like another" exactly when cos(value:0, via) > sqrt(1 - 0.05^2).
  // The cosine is computed here from central differences of modelGammas over a band whose top
  // moves from 1.2 to 2.2 GHz; cases within 2e-5 of the limit are skipped (difference error).
  it('the via is fixed exactly when its cosine with the shunt L is above 0.998749', () => {
    const truth = { 'value:0': 0.05, via: 0.2 };
    let above = 0;
    let below = 0;
    for (let hi = 1.2e9; hi <= 2.2e9 + 1; hi += 0.05e9) {
      const fs = frequencies(41, 0.3e9, hi);
      const c = cosine(column(MODEL, 'value:0', 0.1, fs), column(MODEL, 'via', 0.5, fs));
      if (Math.abs(c - COS_LIMIT) < 2e-5) continue;
      const fit = ok(fitBuild(MODEL, measure(MODEL, truth, fs), { free: ['value:0', 'via'] }));
      const via = param(fit, 'via');
      if (c > COS_LIMIT) {
        above += 1;
        expect(via.status).toBe('unresolved');
        expect(via.why).toBe('like-another');
        expect(via.partner).toBe('value:0');
        expect(Math.abs((via.correlation as number) - c)).toBeLessThan(1e-4);
      } else {
        below += 1;
        expect(via.status).toBe('fitted');
        expect(via.drift).toBeCloseTo(0.2, 6);
        // Two fitted parameters: the correlation of their estimates is minus the cosine of
        // their columns; above 0.95 it is reported as a pair.
        if (c > 0.955) {
          expect(fit.correlated).toHaveLength(1);
          expect(Math.abs(Math.abs((fit.correlated[0] as { rho: number }).rho) - c)).toBeLessThan(
            5e-3,
          );
        }
      }
    }
    expect(above).toBeGreaterThan(0);
    expect(below).toBeGreaterThan(0);
  });

  it('pairs are reported exactly when the correlation of the estimates is above 0.95', () => {
    // The four default-free parameters other than the via, clean data, so the solution is the
    // truth; the correlation from (J^T J)^-1 of central-difference columns at the truth.
    const free = ['value:0', 'value:1', 'pad:0', 'pad:1'];
    const priors = [0.1, 0.1, 0.2e-12, 0.2e-12];
    let checked = 0;
    for (const [lo, hi] of [
      [0.7e9, 1.3e9],
      [0.95e9, 1.05e9],
      [0.98e9, 1.02e9],
    ] as const) {
      const fs = frequencies(31, lo, hi);
      const fit = ok(fitBuild(MODEL, measure(MODEL, TRUTH, fs), { free }));
      if (free.some((id) => param(fit, id).status !== 'fitted')) continue;
      checked += 1;
      const atTruth: BuildModel = MODEL;
      const cols = free.map((id, i) => {
        const h = 1e-5;
        const p = priors[i] as number;
        const up = { ...TRUTH, [id]: ((TRUTH as Record<string, number>)[id] ?? 0) + h * p };
        const dn = { ...TRUTH, [id]: ((TRUTH as Record<string, number>)[id] ?? 0) - h * p };
        const gp = modelGammas(atTruth, up, fs);
        const gm = modelGammas(atTruth, dn, fs);
        return gp.flatMap((g, k) => [
          (g.re - (gm[k] as typeof g).re) / (2 * h),
          (g.im - (gm[k] as typeof g).im) / (2 * h),
        ]);
      });
      const inv = invert(cols.map((a) => cols.map((b) => dot(a, b))));
      for (let i = 0; i < 4; i++) {
        for (let j = i + 1; j < 4; j++) {
          const rho =
            ((inv[i] as number[])[j] as number) /
            Math.sqrt(((inv[i] as number[])[i] as number) * ((inv[j] as number[])[j] as number));
          if (Math.abs(Math.abs(rho) - 0.95) < 5e-3) continue;
          const reported = fit.correlated.some(
            (c) => (c.a === free[i] && c.b === free[j]) || (c.a === free[j] && c.b === free[i]),
          );
          expect(reported, `${free[i]} ~ ${free[j]} rho ${rho} over ${lo}-${hi}`).toBe(
            Math.abs(rho) > 0.95,
          );
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('QA D6 fit: a design where only one parameter is identifiable', () => {
  // Two 5 nH inductors in series on 25 ohm: only their sum is seen. +10 % on the second is
  // 5.5 + 5 = 10.5 nH, the same as +10 % on the first: x = 0.1 whichever is fitted.
  const m: BuildModel = {
    z0: 50,
    frequency: 1e9,
    base: [
      { kind: 'L', orientation: 'series', value: 5e-9 },
      { kind: 'L', orientation: 'series', value: 5e-9 },
    ],
    table: DEFAULT_PACKAGES,
    board: DEFAULT_BOARD,
    load: { re: 25, im: 0 },
  };
  it('fits one, names the other as like it, and the fitted one carries the sum', () => {
    expect(
      driftParameters(m)
        .filter((p) => p.freeByDefault)
        .map((p) => p.id),
    ).toEqual(['value:0', 'value:1']);
    const fit = ok(fitBuild(m, measure(m, { 'value:1': 0.1 }, frequencies(21))));
    const fitted = fit.parameters.filter((p) => p.status === 'fitted');
    const unresolved = fit.parameters.filter((p) => p.status === 'unresolved');
    expect(fitted).toHaveLength(1);
    expect(unresolved).toHaveLength(1);
    const f = fitted[0] as (typeof fitted)[number];
    const u = unresolved[0] as (typeof unresolved)[number];
    expect(f.drift).toBeCloseTo(0.1, 9);
    expect(u.why).toBe('like-another');
    expect(u.partner).toBe(f.id);
    expect(u.correlation as number).toBeGreaterThan(0.9999);
    expect(u.drift).toBe(0);
    expect(fit.condition).toBeCloseTo(1, 9);
    expect(fit.dof).toBe(2 * 21 - 1);
  });
});

describe('QA D6 fit: the measured frequency grid', () => {
  it('irregular, with a gap, unsorted and with a repeated frequency: the same drifts', () => {
    const fs = [
      ...frequencies(17, 0.7e9, 0.86e9),
      ...frequencies(9, 1.17e9, 1.3e9),
      0.913e9,
      1.0001e9,
    ];
    const meas = measure(MODEL, TRUTH, fs);
    const shuffled = [...meas].reverse();
    shuffled.splice(5, 0, meas[3] as MeasuredReflection);
    const fit = ok(fitBuild(MODEL, shuffled));
    expect(fit.used).toBe(fs.length + 1);
    expect(fit.leftOut).toBe(0);
    expect(param(fit, 'value:0').drift).toBeCloseTo(0.08, 8);
    expect(param(fit, 'pad:1').drift / 0.3e-12).toBeCloseTo(1, 8);
  });
});

describe('QA D6 fit: a measurement referred to another Z0', () => {
  it('a 75 ohm Touchstone file, read and re-referred to the design Z0 of 50 ohm', () => {
    // The file's S11 is Gamma at 75 ohm of the input impedance Z = 50 (1 + G50) / (1 - G50).
    const fs = frequencies(61);
    const g50 = modelGammas(MODEL, TRUTH, fs);
    const lines = ['# HZ S RI R 75'];
    g50.forEach((g, i) => {
      const d = (1 - g.re) ** 2 + g.im ** 2;
      const zr = (50 * (1 - g.re * g.re - g.im * g.im)) / d;
      const zi = (50 * 2 * g.im) / d;
      const nr = zr - 75;
      const dr = zr + 75;
      const dd = dr * dr + zi * zi;
      const re = (nr * dr + zi * zi) / dd;
      const im = (zi * dr - nr * zi) / dd;
      lines.push(`${fs[i]} ${re.toPrecision(15)} ${im.toPrecision(15)}`);
    });
    const data = readTouchstone(`${lines.join('\n')}\n`, 1);
    expect(data.z0).toBe(75);
    const meas = measuredReflections(impedanceRows(data, 1), 50);
    const fit = ok(fitBuild(MODEL, meas));
    expect(param(fit, 'value:0').drift).toBeCloseTo(0.08, 8);
    expect(param(fit, 'pad:1').drift / 0.3e-12).toBeCloseTo(1, 7);
  });

  it('a design at Z0 75 ohm with Gamma referred to 75 ohm', () => {
    const m: BuildModel = { ...MODEL, z0: 75 };
    const fit = ok(fitBuild(m, measure(m, TRUTH, frequencies(121))));
    expect(param(fit, 'value:0').drift).toBeCloseTo(0.08, 8);
  });
});

describe('QA D6 fit: library parts and microstrips in the network', () => {
  const board = { ...DEFAULT_BOARD, enabled: true, traceLength: 2e-3 };
  it('a library part: no value or pad parameter of its own; the C, via and trace are recovered', () => {
    const parts = SYNTHETIC_PARTS.map(syntheticPart);
    const l10 = parts.find((p) => p.partNumber === 'SYNTH-L0402-10N');
    if (!l10) throw new Error('no SYNTH-L0402-10N');
    const m: BuildModel = {
      ...MODEL,
      base: [
        { kind: 'part', orientation: 'shunt', part: l10 },
        { kind: 'C', orientation: 'series', value: 2.7e-12, package: '0402' },
      ],
      board,
    };
    const ids = driftParameters(m).map((p) => p.id);
    expect(ids).not.toContain('value:0');
    expect(ids).not.toContain('pad:0');
    const truth = { 'value:1': 0.05, via: 0.3, trace: 0.5e-3 };
    const fit = ok(fitBuild(m, measure(m, truth, frequencies(121))));
    expect(param(fit, 'value:1').drift).toBeCloseTo(0.05, 8);
    expect(param(fit, 'via').drift).toBeCloseTo(0.3, 6);
    expect(param(fit, 'trace').drift / 0.5e-3).toBeCloseTo(1, 6);
  });

  // A microstrip in the network is built on the board's stackup (the app makes it on
  // currentBuild().board.stackup). An er or h drift of the board is a drift of that laminate,
  // so the microstrip's er and h move with it: er 4.17 x 1.1 = 4.587, h 1.6 mm x 1.1 = 1.76 mm.
  const ms: Element = {
    kind: 'microstrip',
    width: 3e-3,
    length: 20e-3,
    stackup: board.stackup,
  };
  const withLine: BuildModel = {
    ...MODEL,
    base: [
      { kind: 'C', orientation: 'shunt', value: 2.2e-12, package: '0402' },
      ms,
      { kind: 'L', orientation: 'series', value: 6.8e-9, package: '0402' },
    ],
    board,
    load: { re: 30, im: 10 },
  };
  it('an er and h drift of the board reaches a microstrip on it', () => {
    const els = driftedElements(withLine, { er: 0.1, h: 0.1 });
    const line = els[1] as Extract<Element, { kind: 'microstrip' }>;
    expect(line.stackup.er).toBeCloseTo(4.17 * 1.1, 12);
    expect(line.stackup.h).toBeCloseTo(1.6e-3 * 1.1, 15);
  });

  it('a board whose er is 10 % high, microstrip included, fits back er = +10 %', () => {
    const s = board.stackup;
    const high = { ...s, er: s.er * 1.1 };
    const truthModel: BuildModel = {
      ...withLine,
      base: [withLine.base[0] as Element, { ...ms, stackup: high }, withLine.base[2] as Element],
      board: { ...board, stackup: high },
    };
    const fs = frequencies(61, 0.5e9, 1.5e9);
    const meas = modelGammas(truthModel, {}, fs).map((gamma, i) => ({
      frequency: fs[i] as number,
      gamma,
    }));
    const fit = ok(fitBuild(withLine, meas, { free: ['er'] }));
    expect(param(fit, 'er').status).toBe('fitted');
    expect(param(fit, 'er').drift).toBeCloseTo(0.1, 6);
  });
});
