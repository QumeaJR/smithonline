/**
 * Physics invariants as property tests (phase D1 of docs/08-depth-plan.md).
 *
 * Random ladders of every element kind between random loads and reference
 * impedances, at random frequencies, from a seeded generator so a failure
 * reproduces exactly. The checks are laws of circuit theory, not values the
 * code happens to produce:
 *
 * - every network built from R, L, C, transformers, lines and stubs is
 *   reciprocal: S12 = S21 and det(ABCD) = 1;
 * - a network without resistance, Q or line loss is lossless: S^H S = I;
 * - a network with loss is passive: |S11|, |S22| <= 1 and I - S^H S has no
 *   negative eigenvalue;
 * - matrix products are associative, so grouping a cascade differently
 *   gives the same two-port;
 * - the S, Z, Y, H and ABCD conversions are inverses of each other;
 * - the input impedance from the ABCD cascade equals the one from S11 and
 *   the terminated two-port formula;
 * - a lossless L, Pi or T match synthesized in closed form lands on its target;
 * - no broadband search result beats the Bode-Fano floor of its load.
 *
 * 10 000 networks in total across the cases. Tolerances are fixed up front
 * from the size of the numbers involved (double precision, about 1e-16
 * relative, times the magnitude of the terms that cancel), never widened to
 * make a case pass.
 */
import { describe, expect, it } from 'vitest';
import {
  abcdMatrixToS,
  broadbandMatch,
  cabs,
  cadd,
  cascade,
  cdiv,
  cinv,
  cmul,
  complex,
  conj,
  convertS,
  cscale,
  convertToS,
  csub,
  DEFAULT_PACKAGES,
  evaluateAt,
  feasibility,
  ladderAbcd,
  ladderSParameters,
  lMatch,
  NetworkParameterError,
  piMatch,
  SPEED_OF_LIGHT,
  sweepPoints,
  teeMatch,
  throughAbcd,
  withPackages,
  zToGamma,
  type Abcd,
  type Complex,
  type Element,
  type NetworkParameter,
  type Orientation,
  type PackageId,
  type SParameters,
} from '../src/index';

/* ---------------------------------------------------------------- random */

/** Mulberry32: a small, fast, seedable generator with a full 2^32 period. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;
const uniform = (r: Rand, lo: number, hi: number): number => lo + (hi - lo) * r();
const logUniform = (r: Rand, lo: number, hi: number): number =>
  Math.exp(uniform(r, Math.log(lo), Math.log(hi)));
const pick = <T>(r: Rand, list: readonly T[]): T => list[Math.floor(r() * list.length)] as T;
const orientation = (r: Rand): Orientation => (r() < 0.5 ? 'series' : 'shunt');

const KINDS = [
  'R',
  'L',
  'C',
  'RLCs',
  'RLCp',
  'transformer',
  'line',
  'lossyLine',
  'openStub',
  'shortStub',
] as const;
type Kind = (typeof KINDS)[number];

/** Kinds that store no energy loss, so a ladder of them alone is lossless. */
const LOSSLESS_KINDS: readonly Kind[] = [
  'L',
  'C',
  'RLCs',
  'RLCp',
  'transformer',
  'line',
  'openStub',
  'shortStub',
];

const PACKAGES: readonly PackageId[] = ['0201', '0402', '0603', '0805', '1206'];

/**
 * One random element valued for frequency f. Reactances are drawn between
 * 1 and 2000 ohm so no part is a dead short or open at f; Q from 5 to 500.
 * `lossless` drops resistors, Q, packages (whose ESR is a loss) and line loss.
 */
function randomElement(r: Rand, kind: Kind, f: number, lossless: boolean): Element {
  const w = 2 * Math.PI * f;
  const x = (): number => logUniform(r, 1, 2000);
  const q = (): number | undefined => (lossless || r() < 0.5 ? undefined : logUniform(r, 5, 500));
  const ref = (): number | undefined => (r() < 0.8 ? f * logUniform(r, 0.5, 2) : undefined);
  const withRef = <T extends object>(el: T, refFrequency: number | undefined): T =>
    refFrequency === undefined ? el : { ...el, refFrequency };
  switch (kind) {
    case 'R':
      return { kind: 'R', orientation: orientation(r), value: logUniform(r, 0.5, 2000) };
    case 'L': {
      const qq = q();
      const el: Element = {
        kind: 'L',
        orientation: orientation(r),
        value: x() / w,
        ...(qq === undefined ? {} : { q: qq }),
      };
      return !lossless && r() < 0.3 ? { ...el, package: pick(r, PACKAGES) } : el;
    }
    case 'C': {
      const qq = q();
      const el: Element = {
        kind: 'C',
        orientation: orientation(r),
        value: 1 / (w * x()),
        ...(qq === undefined ? {} : { q: qq }),
      };
      return r() < 0.3 ? { ...el, package: pick(r, PACKAGES) } : el;
    }
    case 'RLCs':
    case 'RLCp': {
      // Any subset of the three parts, never empty; R only when loss is allowed.
      const parts = { r: !lossless && r() < 0.6, l: r() < 0.7, c: r() < 0.7 };
      if (!parts.l && !parts.c) parts.l = true;
      return {
        kind: 'RLC',
        orientation: orientation(r),
        connection: kind === 'RLCs' ? 'series' : 'parallel',
        ...(parts.r ? { r: logUniform(r, 1, 2000) } : {}),
        ...(parts.l ? { l: x() / w } : {}),
        ...(parts.c ? { c: 1 / (w * x()) } : {}),
      };
    }
    case 'transformer':
      return { kind: 'transformer', n: logUniform(r, 0.3, 3) };
    case 'line':
    case 'lossyLine': {
      const fref = ref();
      const length = uniform(r, 0.01, 0.6);
      const er = r() < 0.5 ? uniform(r, 1, 10) : undefined;
      const line = withRef(
        {
          kind: 'line' as const,
          z0: uniform(r, 15, 150),
          length,
          ...(er === undefined ? {} : { er }),
        },
        fref,
      );
      if (kind !== 'lossyLine' || lossless) return line;
      // Attenuation per metre such that the whole line loses 0.01 to 300 dB at f. Above
      // about 700 nepers in one cascade cosh overflows a double; no real line gets there.
      const metres = (length * (SPEED_OF_LIGHT / (fref ?? f))) / Math.sqrt(er ?? 1);
      const lossDb = logUniform(r, 0.01, 300);
      return { ...line, alphaDbPerM: lossDb / (metres * Math.sqrt(f / (fref ?? f))) };
    }
    case 'openStub':
    case 'shortStub':
      return withRef({ kind, z0: uniform(r, 15, 150), length: uniform(r, 0.01, 0.6) }, ref());
  }
}

interface Case {
  readonly elements: Element[];
  readonly load: Complex;
  readonly z0: number;
  readonly f: number;
  readonly lossless: boolean;
}

function randomCase(r: Rand, lossless: boolean): Case {
  const f = logUniform(r, 1e5, 2e10);
  const n = 1 + Math.floor(r() * 6);
  const kinds = lossless ? LOSSLESS_KINDS : KINDS;
  const raw = Array.from({ length: n }, () => randomElement(r, pick(r, kinds), f, lossless));
  return {
    // Packages resolve into parasitics exactly as the app's built network does.
    elements: withPackages(raw, DEFAULT_PACKAGES),
    load: complex(logUniform(r, 0.5, 1000), uniform(r, -1000, 1000)),
    z0: logUniform(r, 5, 300),
    f,
    lossless,
  };
}

const describeCase = (c: Case): string => JSON.stringify(c);

/** The ladder's S-parameters as the app computes them for the .s2p export and the S-Plot. */
const sOf = (c: Case): SParameters =>
  ladderSParameters({ z0: c.z0, frequency: c.f, load: c.load, elements: c.elements }, c.f);

/* ------------------------------------------------------------ small linalg */

const sMatrix = (s: SParameters): Complex[] => [s.s11, s.s12, s.s21, s.s22];

/** S^H S for a 2 x 2 matrix in row-major order. */
function sHs(s: readonly Complex[]): Complex[] {
  const [a, b, c, d] = s as [Complex, Complex, Complex, Complex];
  // (S^H S)_ij = sum_k conj(S_ki) S_kj
  return [
    cadd(cmul(conj(a), a), cmul(conj(c), c)),
    cadd(cmul(conj(a), b), cmul(conj(c), d)),
    cadd(cmul(conj(b), a), cmul(conj(d), c)),
    cadd(cmul(conj(b), b), cmul(conj(d), d)),
  ];
}

/** Smallest eigenvalue of the Hermitian 2 x 2 matrix I - S^H S. */
function minLossEigen(s: readonly Complex[]): number {
  const p = sHs(s);
  const m11 = 1 - (p[0] as Complex).re;
  const m22 = 1 - (p[3] as Complex).re;
  const m12 = cabs(p[1] as Complex);
  const mean = (m11 + m22) / 2;
  const half = Math.hypot((m11 - m22) / 2, m12);
  return mean - half;
}

const abcdNorm = (m: Abcd): number => Math.max(cabs(m.a), cabs(m.b), cabs(m.c), cabs(m.d));

function maxDiff(a: readonly Complex[], b: readonly Complex[]): number {
  return Math.max(...a.map((x, i) => cabs(csub(x, b[i] as Complex))));
}

/* ------------------------------------------------------------------ tests */

const LADDERS = 6000;
const LOSSLESS_SHARE = 2000;
const CONVERSIONS = 2000;
const MATCHES = 2000;

describe('physics invariants on random ladders', () => {
  const r = rng(0xd1);
  const cases: Case[] = Array.from({ length: LADDERS }, (_, i) =>
    randomCase(r, i < LOSSLESS_SHARE),
  );

  it(`builds ${LADDERS} random ladders covering every element kind`, () => {
    const seen = new Set<string>();
    for (const c of cases) {
      for (const el of c.elements) {
        if (el.kind === 'RLC') seen.add(`RLC ${el.connection}`);
        else if (el.kind === 'line') seen.add((el.alphaDbPerM ?? 0) > 0 ? 'lossy line' : 'line');
        else if ((el.kind === 'L' || el.kind === 'C') && el.parasitics) seen.add('packaged');
        else if ((el.kind === 'L' || el.kind === 'C') && el.q !== undefined) seen.add('with Q');
        else seen.add(el.kind);
      }
    }
    expect([...seen].sort()).toEqual(
      [
        'C',
        'L',
        'R',
        'RLC parallel',
        'RLC series',
        'line',
        'lossy line',
        'openStub',
        'packaged',
        'shortStub',
        'transformer',
        'with Q',
      ].sort(),
    );
  });

  it('every ladder is reciprocal: det(ABCD) = 1 and S12 = S21', () => {
    for (const c of cases) {
      const m = ladderAbcd(c.elements, c.f);
      const det = csub(cmul(m.a, m.d), cmul(m.b, m.c));
      // The two products that cancel set the size of the rounding error.
      const scale = Math.max(1, cabs(cmul(m.a, m.d)), cabs(cmul(m.b, m.c)));
      if (cabs(csub(det, complex(1))) > 1e-12 * scale) {
        throw new Error(`det(ABCD) = ${det.re} ${det.im}j for ${describeCase(c)}`);
      }
      // S12 = 2 det / Delta from the raw matrix, within the rounding of the determinant.
      const raw = abcdMatrixToS(m, c.z0);
      const delta = cabs(cadd(cadd(m.a, cscale(m.b, 1 / c.z0)), cadd(cscale(m.c, c.z0), m.d)));
      if (cabs(csub(raw.s12, raw.s21)) > (2e-12 * scale) / delta) {
        throw new Error(`S12 != S21 for ${describeCase(c)}`);
      }
      const s = sOf(c);
      expect(s.s12).toEqual(s.s21);
    }
  });

  it('lossless ladders keep S^H S = I to 1e-9', () => {
    let worst = 0;
    for (const c of cases.filter((x) => x.lossless)) {
      const s = sMatrix(sOf(c));
      const err = maxDiff(sHs(s), [complex(1), complex(0), complex(0), complex(1)]);
      worst = Math.max(worst, err);
      if (err > 1e-9) throw new Error(`S^H S - I = ${err} for ${describeCase(c)}`);
    }
    expect(worst).toBeLessThanOrEqual(1e-9);
  });

  it('every ladder is passive: |S11|, |S22| <= 1 and I - S^H S has no negative eigenvalue', () => {
    for (const c of cases) {
      const s = sOf(c);
      if (cabs(s.s11) > 1 + 1e-12 || cabs(s.s22) > 1 + 1e-12) {
        throw new Error(`|S11| ${cabs(s.s11)} |S22| ${cabs(s.s22)} for ${describeCase(c)}`);
      }
      const lambda = minLossEigen(sMatrix(s));
      if (lambda < -1e-12) {
        throw new Error(`eigenvalue ${lambda} of I - S^H S for ${describeCase(c)}`);
      }
    }
  });

  it('cascading in either grouping gives the same ABCD', () => {
    for (const c of cases) {
      const n = c.elements.length;
      const i = Math.floor(n / 3);
      const j = Math.max(i, Math.floor((2 * n) / 3));
      // Load side first: P is nearest the load, R nearest the source.
      const p = ladderAbcd(c.elements.slice(0, i), c.f);
      const q = ladderAbcd(c.elements.slice(i, j), c.f);
      const rr = ladderAbcd(c.elements.slice(j), c.f);
      const left = cascade(cascade(rr, q), p);
      const right = cascade(rr, cascade(q, p));
      const whole = ladderAbcd(c.elements, c.f);
      const scale = abcdNorm(rr) * abcdNorm(q) * abcdNorm(p);
      const toList = (m: Abcd): Complex[] => [m.a, m.b, m.c, m.d];
      const err = Math.max(
        maxDiff(toList(left), toList(right)),
        maxDiff(toList(left), toList(whole)),
      );
      if (err > 1e-13 * scale) {
        throw new Error(`grouping changes the cascade by ${err} for ${describeCase(c)}`);
      }
    }
  });

  it('Zin from the cascade equals Zin from S11 with the load', () => {
    for (const c of cases) {
      const ladder = { z0: c.z0, frequency: c.f, load: c.load, elements: c.elements };
      const zCascade = evaluateAt(ladder, c.f, c.load, { arcSteps: 0 }).zin;
      const zDirect = throughAbcd(ladderAbcd(c.elements, c.f), c.load);
      const s = sOf(c);
      const gl = zToGamma(c.load, c.z0);
      // Gamma_in = S11 + S12 S21 Gamma_L / (1 - S22 Gamma_L).
      const gin = cadd(
        s.s11,
        cdiv(cmul(cmul(s.s12, s.s21), gl), csub(complex(1), cmul(s.s22, gl))),
      );
      // Compared as reflection coefficients, which are bounded; an impedance near an open
      // is ill-conditioned in ohms but not in Gamma.
      const gCascade = zToGamma(zCascade, c.z0);
      if (cabs(csub(gCascade, gin)) > 1e-9) {
        throw new Error(
          `Gamma ${gCascade.re} ${gCascade.im} vs ${gin.re} ${gin.im}: ${describeCase(c)}`,
        );
      }
      if (cabs(csub(zCascade, zDirect)) > 1e-9 * Math.max(1, cabs(zDirect))) {
        throw new Error(`evaluateAt and ladderAbcd disagree for ${describeCase(c)}`);
      }
    }
  });
});

describe('network parameter conversions round trip', () => {
  const r = rng(0xc0);
  const KINDS_OF: readonly NetworkParameter[] = ['Z', 'Y', 'H', 'ABCD'];

  it(`S -> Z, Y, H, ABCD -> S on ${CONVERSIONS} random two-ports`, () => {
    let checked = 0;
    let skipped = 0;
    for (let k = 0; k < CONVERSIONS; k++) {
      const c = randomCase(r, k % 3 === 0);
      const m = ladderAbcd(c.elements, c.f);
      const s = sMatrix(sOf(c));
      for (const kind of KINDS_OF) {
        for (const normalized of [true, false]) {
          let p: Complex[];
          try {
            p = convertS(s, kind, c.z0, normalized);
          } catch (e) {
            // A pure series element has no Z matrix and a pure shunt element no Y matrix.
            if (e instanceof NetworkParameterError) {
              skipped++;
              continue;
            }
            throw e;
          }
          const back = convertToS(p, kind, c.z0, normalized);
          // The round trip inverts (I - S), (I + S) or a 2 x 2 denominator; its rounding grows
          // with the size of the intermediate matrix in normalized units.
          const pn = normalized ? p : convertS(s, kind, c.z0, true);
          const scale = Math.max(1, ...pn.map(cabs));
          const err = maxDiff(back, s);
          if (err > 1e-13 * scale * scale) {
            throw new Error(
              `${kind} round trip off by ${err} (scale ${scale}): ${describeCase(c)}`,
            );
          }
          checked++;
        }
      }
      // The ABCD conversion agrees with the cascade itself, where S21 is not vanishingly small.
      if (cabs(s[2] as Complex) > 1e-6) {
        const abcd = convertS(s, 'ABCD', c.z0, false);
        const scale = abcdNorm(m);
        const direct = [m.a, m.b, m.c, m.d];
        if (maxDiff(abcd, direct) > 1e-9 * scale) {
          throw new Error(`S -> ABCD differs from the cascade: ${describeCase(c)}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(CONVERSIONS * 6);
    expect(skipped).toBeLessThan(CONVERSIONS);
  });
});

describe('closed-form matches land on their target', () => {
  const r = rng(0x3a);

  it(`L, Pi and T networks on ${MATCHES} random impedance pairs reach the target to 1e-9`, () => {
    let solutions = 0;
    for (let k = 0; k < MATCHES; k++) {
      const f = logUniform(r, 1e5, 2e10);
      const zin = complex(logUniform(r, 0.5, 2000), uniform(r, -2000, 2000));
      const target = complex(logUniform(r, 0.5, 2000), uniform(r, -500, 500));
      const which = k % 3;
      // A loaded Q above the L-network's own, so a Pi or T exists.
      const q =
        Math.max(Math.abs(zin.im) / zin.re, Math.abs(target.im) / target.re, 0.1) +
        logUniform(r, 0.5, 30);
      const sols =
        which === 0
          ? lMatch(zin, target, f)
          : which === 1
            ? piMatch(zin, target, f, q)
            : teeMatch(zin, target, f, q);
      if (which === 0) expect(sols.length).toBeGreaterThan(0);
      for (const sol of sols) {
        const ladder = { z0: 50, frequency: f, load: zin, elements: [...sol.elements] };
        const z = evaluateAt(ladder, f, zin, { arcSteps: 0 }).zin;
        const err = cabs(csub(z, target)) / cabs(target);
        if (err > 1e-9) {
          throw new Error(
            `${sol.description} lands ${err} off: zin ${JSON.stringify(zin)} target ${JSON.stringify(target)} f ${f} q ${q}`,
          );
        }
        if (sol.elements.some((e) => (e.kind === 'L' || e.kind === 'C') && !(e.value > 0))) {
          throw new Error(`non-positive part in ${sol.description}`);
        }
        solutions++;
      }
    }
    expect(solutions).toBeGreaterThan(MATCHES);
  });
});

describe('broadband search against the Bode-Fano floor', () => {
  /**
   * Single-reactance loads whose exact Bode-Fano bound is known in closed
   * form (Fano 1950; Pozar, Microwave Engineering, section 5.9). With a
   * constant |Gamma| = Gm over the band and total reflection outside:
   *   series RL, parallel RC: (w2 - w1) ln(1/Gm) <= pi / tau, tau = L/R or RC;
   *   series RC, parallel RL: (1/w1 - 1/w2) ln(1/Gm) <= pi tau, tau = RC or L/R.
   * No network of any size can have a worst-case VSWR below the floor.
   */
  const bands = [
    { lo: 0.9e9, hi: 1.1e9 },
    { lo: 0.8e9, hi: 1.2e9 },
  ];
  const loads: {
    name: string;
    z: (f: number) => Complex;
    floor: (w1: number, w2: number) => number;
  }[] = [
    {
      name: 'series RL, R 10, L 20 nH',
      z: (f) => complex(10, 2 * Math.PI * f * 20e-9),
      floor: (w1, w2) => Math.PI / ((w2 - w1) * (20e-9 / 10)),
    },
    {
      name: 'parallel RC, R 200, C 3 pF',
      z: (f) => cinv(complex(1 / 200, 2 * Math.PI * f * 3e-12)),
      floor: (w1, w2) => Math.PI / ((w2 - w1) * 200 * 3e-12),
    },
    {
      name: 'series RC, R 8, C 4 pF',
      z: (f) => complex(8, -1 / (2 * Math.PI * f * 4e-12)),
      floor: (w1, w2) => (Math.PI * 8 * 4e-12) / (1 / w1 - 1 / w2),
    },
    {
      name: 'parallel RL, R 400, L 5 nH',
      z: (f) => cinv(complex(1 / 400, -1 / (2 * Math.PI * f * 5e-9))),
      floor: (w1, w2) => (Math.PI * (5e-9 / 400)) / (1 / w1 - 1 / w2),
    },
  ];
  const vswrOf = (lnInvGamma: number): number => {
    const g = Math.exp(-lnInvGamma);
    return (1 + g) / (1 - g);
  };

  for (const load of loads) {
    for (const band of bands) {
      it(`${load.name}, ${band.lo / 1e9} to ${band.hi / 1e9} GHz`, () => {
        const freqs = sweepPoints(band.lo, band.hi, 21);
        const res = broadbandMatch(freqs, {
          load: load.z,
          z0: 50,
          maxElements: 3,
          evaluationsPerCandidate: 300,
        });
        const exact = vswrOf(load.floor(2 * Math.PI * band.lo, 2 * Math.PI * band.hi));
        const floor = feasibility(load.z, freqs);
        expect(floor).not.toBeNull();
        // The app's floor (Yaghjian-Best Q of the load) never claims more than physics allows.
        expect((floor as { floor: number }).floor).toBeLessThanOrEqual(exact * (1 + 1e-9));
        expect(res.floor?.floor).toBe(floor?.floor);
        for (const cand of res.candidates) {
          expect(cand.worstVswr).toBeGreaterThanOrEqual(exact * (1 - 1e-9));
          expect(cand.worstVswr).toBeGreaterThanOrEqual((res.floor as { floor: number }).floor);
        }
      });
    }
  }
});

describe('regression: reciprocity through a very lossy line', () => {
  it('ladderSParameters keeps S12 = S21 and passivity where 2 det / Delta loses its digits', () => {
    // 0.3 wavelength of 75 ohm line at 1 GHz with 4500 dB/m: about 400 dB of loss.
    const line: Element = { kind: 'line', z0: 75, length: 0.3, alphaDbPerM: 4500 };
    const ladder = { z0: 50, frequency: 1e9, load: complex(50), elements: [line] };
    const raw = abcdMatrixToS(ladderAbcd([line], 1e9), 50);
    // The raw determinant route has no correct digit left here: cosh^2 - sinh^2 rounds to 0.
    expect(cabs(csub(raw.s12, raw.s21))).toBeGreaterThan(0.5 * cabs(raw.s21));
    const s = ladderSParameters(ladder, 1e9);
    expect(s.s12).toEqual(s.s21);
    expect(cabs(s.s21)).toBeLessThan(1e-15);
    expect(minLossEigen(sMatrix(s))).toBeGreaterThanOrEqual(-1e-12);
  });
});
