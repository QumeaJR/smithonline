/**
 * Adversarial, phase D4 (the board in the network): the Djordjevic-Sarkar stackup at inputs
 * that isUsableStackup and the Settings > Board fields accept, the microstrip outside its
 * range, the trace width search, lands and vias at their limits, and the D1 invariants
 * (passivity, reciprocity) and the D3 sensitivities on board ladders. Each test asserts the
 * correct behaviour; a failure is a defect.
 */
import { describe, expect, it } from 'vitest';
import {
  boardTrace,
  cabs,
  cadd,
  cmul,
  complex,
  conj,
  csub,
  DEFAULT_BOARD,
  DEFAULT_PACKAGES,
  djordjevicSarkar,
  evaluateLadder,
  isUsableStackup,
  ladderParameters,
  ladderSParameters,
  landCapacitance,
  layoutAssumptions,
  microstripProperties,
  microstripWidthAt,
  monteCarlo,
  optimizeBand,
  parameterValue,
  sensitivityAt,
  stackupProblem,
  STACKUP_PRESETS,
  tuneElement,
  viaInductance,
  withBoard,
  zinWith,
  type BoardSettings,
  type Complex,
  type Element,
  type ParameterRef,
  type Stackup,
} from '../src/index';

const FR4 = (STACKUP_PRESETS[0] as { stackup: Stackup }).stackup;
const fin = (z: Complex): boolean => Number.isFinite(z.re) && Number.isFinite(z.im);

function minEig(s: readonly Complex[]): number {
  const [a, b, c, d] = s as [Complex, Complex, Complex, Complex];
  const p0 = cadd(cmul(conj(a), a), cmul(conj(c), c));
  const p1 = cadd(cmul(conj(a), b), cmul(conj(c), d));
  const p3 = cadd(cmul(conj(b), b), cmul(conj(d), d));
  const m11 = 1 - p0.re;
  const m22 = 1 - p3.re;
  return (m11 + m22) / 2 - Math.hypot((m11 - m22) / 2, cabs(p1));
}

/* Stackups every one of which isUsableStackup and the Settings > Board fields accepted before
 * the D4 QA fixes (er 1.0001 to 100, tanD 0 to 0.5, reference frequency from 1 Hz up). Each is
 * unphysical (eps' below 1 somewhere up to 110 GHz, or fRef outside the Djordjevic-Sarkar
 * band), so the fix refuses them; whatever is accepted must stay physical. */
const ACCEPTED: readonly [string, Stackup, number][] = [
  [
    'FR-4 with the reference frequency typed as 1 (1 Hz, the field minimum), at 1 GHz',
    { ...FR4, fRef: 1 },
    1e9,
  ],
  ['FR-4 with the reference frequency typed as 10 (10 Hz), at 1 GHz', { ...FR4, fRef: 10 }, 1e9],
  ['FR-4 with tanD 0.5 (the field maximum), at 40 GHz', { ...FR4, tanD: 0.5 }, 40e9],
  [
    'FR-4 with tanD 0.05 at 1 kHz (the lower band corner), at 1 GHz',
    { ...FR4, tanD: 0.05, fRef: 1e3 },
    1e9,
  ],
  [
    'FR-4 with the reference frequency at 1 PHz (no upper bound on the field), at 1 GHz',
    { ...FR4, fRef: 1e15 },
    1e9,
  ],
  ['er 1.0001 (the field minimum) with FR-4 tanD, at 110 GHz', { ...FR4, er: 1.0001 }, 110e9],
];

describe('Djordjevic-Sarkar stackup at accepted inputs', () => {
  for (const [name, s, f] of ACCEPTED) {
    it(`${name}: refused with a reason, or eps'(f) >= 1 and the microstrip is finite`, () => {
      // Corrected expectation (D4 QA): these inputs are now refused, which is the fix.
      expect(isUsableStackup(s)).toBe(false);
      expect(stackupProblem(s)?.reason).toMatch(/Djordjevic-Sarkar/);
      if (!isUsableStackup(s)) return;
      const d = djordjevicSarkar(s.er, s.tanD, s.fRef, f);
      const p = microstripProperties(s, 2 * s.h, f);
      expect({
        epsRe: d.er.re >= 1,
        eeffRe: p.eeff.re >= 1,
        z0: fin(p.z0) && p.z0.re > 0,
        gamma: fin(p.gamma),
      }).toEqual({ epsRe: true, eeffRe: true, z0: true, gamma: true });
    });
  }

  it('the network with such a microstrip gives finite datapoints (no NaN to the chart)', () => {
    const el: Element = {
      kind: 'microstrip',
      width: 3e-3,
      length: 0.02,
      stackup: { ...FR4, fRef: 1 },
    };
    const r = evaluateLadder({ z0: 50, frequency: 1e9, load: complex(25, 10), elements: [el] });
    expect(r.datapoints.every(fin)).toBe(true);
  });

  it('dragging that microstrip on the chart does not write a NaN length into the design', () => {
    const el: Element = {
      kind: 'microstrip',
      width: 3e-3,
      length: 0.02,
      stackup: { ...FR4, fRef: 1 },
    };
    const t = tuneElement(el, complex(25, 10), complex(50, 0), 1e9);
    expect(t === null || Number.isFinite((t as { length: number }).length)).toBe(true);
  });

  it('the width search does not report a "50 ohm" width on a line whose eeff is negative', () => {
    const s = { ...FR4, tanD: 0.5 };
    const w = microstripWidthAt(s, 50, 40e9);
    if (w !== null) expect(microstripProperties(s, w, 40e9).eeff.re).toBeGreaterThanOrEqual(1);
  });

  it('with the board on, such a stackup does not silently drop the traces while keeping the pads', () => {
    const board: BoardSettings = {
      ...DEFAULT_BOARD,
      enabled: true,
      traceLength: 2e-3,
      stackup: { ...FR4, fRef: 1 },
    };
    const els: Element[] = [
      { kind: 'C', orientation: 'shunt', value: 2e-12, package: '0402' },
      { kind: 'L', orientation: 'series', value: 5e-9, package: '0402' },
    ];
    const built = withBoard(els, DEFAULT_PACKAGES, board, { z0: 50, frequency: 1e9 });
    // Corrected expectation (D4 QA): the package table's own pad value stays with the board
    // refused (it is the packages' model, as with the board off); a board pad is one computed
    // from the land size, so that is what must not appear without the traces.
    const tablePad = DEFAULT_PACKAGES.find((p) => p.id === '0402')?.pad;
    const pad = (built[1] as { parasitics?: { pad?: number } }).parasitics?.pad;
    const hasPad = pad !== undefined && pad !== tablePad;
    const hasTrace = (built[1] as { board?: { trace?: unknown } }).board?.trace !== undefined;
    const hasVia = (built[0] as { board?: { via?: unknown } }).board?.via !== undefined;
    // Either the stackup is refused as a whole (no board pads, vias or traces) or all are in.
    expect(hasPad === hasTrace).toBe(true);
    expect(hasVia === hasTrace).toBe(true);
  });
});

describe('trace width search for the design Z0', () => {
  const board: BoardSettings = { ...DEFAULT_BOARD, enabled: true, traceLength: 2e-3 };
  it('5 ohm: a width exists on every preset (survives)', () => {
    for (const p of STACKUP_PRESETS) expect(microstripWidthAt(p.stackup, 5, 1e9)).not.toBeNull();
  });
  it('300 ohm: no width on any preset, the trace is dropped; the layout notes say so', () => {
    for (const p of STACKUP_PRESETS) {
      const b = { ...board, stackup: p.stackup };
      expect(boardTrace(b, { z0: 300, frequency: 1e9 })).toBeNull();
      const notes = layoutAssumptions([], DEFAULT_PACKAGES, b, { z0: 300, frequency: 1e9 });
      expect(notes.some((n) => n.includes('no width gives 300 ohm'))).toBe(true);
    }
  });
});

describe('lands and vias at their limits (survives)', () => {
  it('land capacitance is positive and finite from 1 nm to 10 m, copper 0 to 10 mm', () => {
    for (const p of STACKUP_PRESETS) {
      for (const t of [0, 35e-6, 1e-3, 10e-3]) {
        for (const L of [1e-9, 1e-6, 1e-3, 1, 10]) {
          for (const W of [1e-9, 1e-6, 1e-3, 1, 10]) {
            const c = landCapacitance({ ...p.stackup, t }, L, W);
            expect(c > 0 && Number.isFinite(c)).toBe(true);
          }
        }
      }
    }
    expect(landCapacitance(FR4, 0, 1e-3)).toBe(0);
  });
  it('via inductance is positive and finite from a 1 pm drill to one 1000 times the length', () => {
    for (const h of [1e-6, 1.6e-3, 1e-2]) {
      for (const d of [1e-12, 1e-9, h / 1000, 1e-4, 1e-3, 1, 1e3]) {
        const l = viaInductance(h, d);
        expect(l > 0 && Number.isFinite(l)).toBe(true);
      }
    }
  });
});

describe('microstrip passivity outside the model range (survives)', () => {
  it('|eig(I - S^H S)| >= 0 for W/h 0.05 to 100, t 0 and 35 um, 1 MHz to 110 GHz, all presets', () => {
    for (const p of STACKUP_PRESETS) {
      for (const t of [0, 35e-6]) {
        for (const u of [0.05, 0.3, 1, 3, 20, 100]) {
          for (const f of [1e6, 1e9, 10e9, 60e9, 110e9]) {
            const s = { ...p.stackup, t };
            const el: Element = { kind: 'microstrip', width: u * s.h, length: 0.05, stackup: s };
            const S = ladderSParameters(
              { z0: 50, frequency: 1e9, load: complex(50, 0), elements: [el] },
              f,
            );
            expect(minEig([S.s11, S.s12, S.s21, S.s22])).toBeGreaterThan(-1e-9);
          }
        }
      }
    }
  });
});

describe('random board ladders: passivity, reciprocity, sensitivities (survives)', () => {
  let seed = 4242;
  const rnd = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const logU = (a: number, b: number): number => Math.exp(Math.log(a) + rnd() * Math.log(b / a));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
  it('600 ladders x 3 frequencies', () => {
    for (let k = 0; k < 600; k++) {
      const stackup: Stackup = {
        h: logU(0.1e-3, 3e-3),
        er: 2 + rnd() * 10,
        tanD: logU(1e-4, 0.03),
        fRef: logU(1e8, 1e10),
        t: pick([0, 18e-6, 35e-6]),
        roughness: pick([0, 1e-6, 5e-6]),
      };
      const board: BoardSettings = {
        enabled: true,
        stackup,
        viaDrill: logU(0.1e-3, 0.6e-3),
        viasPerShunt: pick([1, 2, 100]),
        traceLength: pick([0, 1e-3, 5e-3]),
        traceWidth: pick([0, 0.3e-3]),
      };
      const els: Element[] = [];
      for (let i = 0; i < 4; i++) {
        const o = pick(['series', 'shunt'] as const);
        const kind = pick(['L', 'C', 'RLC', 'microstrip'] as const);
        if (kind === 'L')
          els.push({ kind, orientation: o, value: logU(1e-9, 50e-9), package: '0402' });
        else if (kind === 'C')
          els.push({ kind, orientation: o, value: logU(0.5e-12, 50e-12), package: '0603' });
        else if (kind === 'RLC')
          els.push({ kind, orientation: o, connection: 'series', r: 1, l: 3e-9, c: 4e-12 });
        else
          els.push({
            kind: 'microstrip',
            width: logU(0.3, 5) * stackup.h,
            length: logU(1e-3, 3e-2),
            stackup,
          });
      }
      const built = withBoard(els, DEFAULT_PACKAGES, board, { z0: 50, frequency: 1e9 });
      for (const f of [0.3e9, 1e9, 3e9]) {
        const S = ladderSParameters(
          { z0: 50, frequency: 1e9, load: complex(50, 0), elements: built },
          f,
        );
        expect(minEig([S.s11, S.s12, S.s21, S.s22])).toBeGreaterThan(-1e-9);
        expect(S.s12).toEqual(S.s21);
        const load = complex(logU(5, 300), (rnd() - 0.5) * 200);
        const sens = sensitivityAt(built, load, 50, f);
        ladderParameters(built).forEach((ref: ParameterRef, i) => {
          const v = parameterValue(built[ref.index] as Element, ref.parameter);
          const fd = (h: number): Complex => {
            const up = zinWith(built, ref, v + h, load, f);
            const dn = zinWith(built, ref, v - h, load, f);
            return complex((up.re - dn.re) / (2 * h), (up.im - dn.im) / (2 * h));
          };
          const a = fd(Math.abs(v) * 1e-5);
          const b = fd(Math.abs(v) * 1e-6);
          const scale = Math.max(cabs(b), 1e-300);
          if (cabs(csub(a, b)) / scale > 1e-7) return; // the difference itself has not converged
          const got = sens.dZin[i] as Complex;
          expect(cabs(csub(got, b)) / Math.max(cabs(got), scale)).toBeLessThan(1e-5);
        });
      }
    }
  }, 60000);
});

describe('a microstrip in Monte Carlo and the optimizer (survives)', () => {
  const ms: Element = { kind: 'microstrip', width: 3e-3, length: 0.02, stackup: FR4 };
  const ladder = {
    z0: 50,
    frequency: 1e9,
    load: complex(25, 10),
    elements: [ms, { kind: 'C', orientation: 'shunt', value: 3e-12 } as Element],
  };
  it('Monte Carlo with a 5 % length override gives finite VSWRs', () => {
    const r = monteCarlo(ladder, {
      runs: 300,
      seed: 3,
      tolerance: 0.05,
      overrides: { 0: 0.05 },
      vswrLimit: 2,
    });
    expect(Array.from(r.vswr as ArrayLike<number>).every((v) => Number.isFinite(v))).toBe(true);
  });
  it('the optimizer improves the band and keeps a finite length', () => {
    const o = optimizeBand(ladder, [0.9e9, 1e9, 1.1e9]);
    expect(o.after).toBeLessThanOrEqual(o.before);
    expect(Number.isFinite((o.elements[0] as { length: number }).length)).toBe(true);
  });
});
