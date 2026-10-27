/**
 * QA D6 (closedloop.ts, suggestRetune and retuneCandidates): the search finds a known better
 * optimum, keeps to the fewest changes, and snaps to each source. The known optimum is an
 * L match of 100 ohm to 50 ohm at 1 GHz: Q = 1, shunt C = 0.01 S / (2 pi 1 GHz) = 1.5915 pF,
 * series L = 50 ohm / (2 pi 1 GHz) = 7.9577 nH; the E24 values that match best are 1.6 pF and
 * 8.2 nH, worked out below with complex arithmetic written here, not the library's.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BOARD,
  DEFAULT_PACKAGES,
  SYNTHETIC_PARTS,
  parseStock,
  partAt,
  retuneCandidates,
  retuneEvaluator,
  retunedWorst,
  suggestRetune,
  syntheticPart,
  type BuildModel,
  type Element,
} from '../src/index';

const W = 2 * Math.PI * 1e9;

/** VSWR towards 50 ohm of shunt C (pF) across 100 ohm, then series L (nH), at 1 GHz. */
function lMatchVswr(cPf: number, lNh: number): number {
  const g = 0.01;
  const b = W * cPf * 1e-12;
  const d = g * g + b * b;
  const zr = g / d;
  const zi = -b / d + W * lNh * 1e-9;
  const nr = zr - 50;
  const dr = zr + 50;
  const m = Math.sqrt((nr * nr + zi * zi) / (dr * dr + zi * zi));
  return (1 + m) / (1 - m);
}

const model = (base: Element[]): BuildModel => ({
  z0: 50,
  frequency: 1e9,
  base,
  table: DEFAULT_PACKAGES,
  board: DEFAULT_BOARD,
  load: { re: 100, im: 0 },
});
const E24 = { kind: 'series' as const, series: 'E24' as const };
const BAND = [1e9];
const value = (el: Element): number => (el as { value: number }).value;

describe('QA D6 retune: the search finds a known better optimum', () => {
  it('hand check of the L match: 1.6 pF and 8.2 nH give VSWR 1.0315, better than the neighbours', () => {
    expect(lMatchVswr(1.6, 8.2)).toBeCloseTo(1.0315, 3);
    expect(lMatchVswr(1.6, 8.2)).toBeLessThan(lMatchVswr(1.5, 8.2));
    expect(lMatchVswr(1.6, 8.2)).toBeLessThan(lMatchVswr(1.6, 7.5));
    expect(lMatchVswr(1.6, 8.2)).toBeLessThan(lMatchVswr(1.8, 8.2));
    expect(lMatchVswr(1.6, 8.2)).toBeLessThan(lMatchVswr(1.6, 9.1));
  });

  it('two wrong parts (1 pF, 12 nH): no single change reaches 1.05, the pair 1.6 pF + 8.2 nH does', () => {
    // Singles: with 1 pF kept the real part of Z stays 71.7 ohm, |Gamma| >= 21.7 / 121.7, VSWR >= 1.43;
    // with 12 nH kept the series reactance is at least 75.4 - 50 ohm, VSWR >= 1.66.
    const m = model([
      { kind: 'C', orientation: 'shunt', value: 1e-12 },
      { kind: 'L', orientation: 'series', value: 12e-9 },
    ]);
    const r = suggestRetune(
      m,
      {},
      { band: BAND, limit: 1.05, candidates: retuneCandidates(E24, 1e9, BAND) },
    );
    expect(r.before.vswr).toBeCloseTo(lMatchVswr(1.0, 12), 9);
    expect(r.single?.worst.vswr as number).toBeGreaterThan(1.43);
    expect(r.single?.inside).toBe(false);
    const s = r.suggestion;
    expect(s?.inside).toBe(true);
    expect(s?.changes).toHaveLength(2);
    const byIndex = new Map((s?.changes ?? []).map((c) => [c.index, value(c.to)]));
    expect((byIndex.get(0) as number) / 1.6e-12).toBeCloseTo(1, 12);
    expect((byIndex.get(1) as number) / 8.2e-9).toBeCloseTo(1, 12);
    expect(s?.worst.vswr).toBeCloseTo(lMatchVswr(1.6, 8.2), 9);
  });

  it('with two more parts of small effect, the suggestion is still the fewest changes that reach the target', () => {
    // A 1 uH shunt L at the load (6.3 kohm) and a 1 nF series C at the input (0.16 ohm) barely
    // matter; the pair above still reaches 1.05 (the extra parts move it by about 0.01), so the
    // fewest changes that reach the target are two.
    const m = model([
      { kind: 'L', orientation: 'shunt', value: 1e-6 },
      { kind: 'C', orientation: 'shunt', value: 1e-12 },
      { kind: 'L', orientation: 'series', value: 12e-9 },
      { kind: 'C', orientation: 'series', value: 1e-9 },
    ]);
    const pairOnly = retunedWorst(
      m,
      {},
      new Map<number, Element>([
        [1, { kind: 'C', orientation: 'shunt', value: 1.6e-12 }],
        [2, { kind: 'L', orientation: 'series', value: 8.2e-9 }],
      ]),
      BAND,
    );
    expect(pairOnly.vswr).toBeLessThan(1.05);
    const r = suggestRetune(
      m,
      {},
      { band: BAND, limit: 1.05, candidates: retuneCandidates(E24, 1e9, BAND) },
    );
    expect(r.suggestion?.inside).toBe(true);
    expect(r.suggestion?.changes.length).toBe(2);
  });

  it('a board already inside the target needs no change', () => {
    // 1.5 pF and 8.2 nH: VSWR 1.068 by hand, inside 1.1; 1.6 pF would do better but is not needed.
    expect(lMatchVswr(1.5, 8.2)).toBeLessThan(1.1);
    const m = model([
      { kind: 'C', orientation: 'shunt', value: 1.5e-12 },
      { kind: 'L', orientation: 'series', value: 8.2e-9 },
    ]);
    const r = suggestRetune(
      m,
      {},
      { band: BAND, limit: 1.1, candidates: retuneCandidates(E24, 1e9, BAND) },
    );
    expect(r.before.vswr).toBeCloseTo(lMatchVswr(1.5, 8.2), 9);
    expect(r.suggestion?.changes ?? []).toHaveLength(0);
  });

  it('with no change in the suggestion there is no part to change first', () => {
    const m = model([
      { kind: 'C', orientation: 'shunt', value: 1.6e-12 },
      { kind: 'L', orientation: 'series', value: 8.2e-9 },
    ]);
    const r = suggestRetune(
      m,
      {},
      { band: BAND, limit: 1.05, candidates: retuneCandidates(E24, 1e9, BAND) },
    );
    expect(r.suggestion?.changes ?? []).toHaveLength(0);
    expect(r.first).toBeNull();
  });

  it('an empty band judges nothing and suggests no change', () => {
    const m = model([
      { kind: 'C', orientation: 'shunt', value: 1e-12 },
      { kind: 'L', orientation: 'series', value: 12e-9 },
    ]);
    const r = suggestRetune(
      m,
      {},
      { band: [], limit: 1.05, candidates: retuneCandidates(E24, 1e9, BAND) },
    );
    expect(r.suggestion?.changes ?? []).toHaveLength(0);
  });
});

describe('QA D6 retune: the snap to each source', () => {
  const L12: Element = { kind: 'L', orientation: 'shunt', value: 12e-9, package: '0402' };
  const C27: Element = { kind: 'C', orientation: 'series', value: 2.7e-12, package: '0402' };
  const R: Element = { kind: 'R', orientation: 'series', value: 10 };

  it('E12, span 6: the six E12 values each side of 12 nH, package kept', () => {
    // E12: 1.0 1.2 1.5 1.8 2.2 2.7 3.3 3.9 4.7 5.6 6.8 8.2.
    const want = [3.9, 4.7, 5.6, 6.8, 8.2, 10, 12, 15, 18, 22, 27, 33, 39];
    const got = retuneCandidates({ kind: 'series', series: 'E12' }, 1e9, BAND)(0, L12);
    expect(got.map((e) => value(e) * 1e9).sort((a, b) => a - b)).toEqual(
      want.map((v) => expect.closeTo(v, 9)),
    );
    for (const e of got) {
      expect(e.kind).toBe('L');
      expect((e as { package?: string }).package).toBe('0402');
      expect((e as { orientation: string }).orientation).toBe('shunt');
    }
  });

  it('a stock list: only its values, of the part kind; none for a kind it has not', () => {
    // 'L: 10n 11n 15n' (the form closedloop.test.ts uses) parses to nothing; units name the kind.
    const stock = parseStock('10nH, 11nH, 15nH, 2.2pF');
    const cands = retuneCandidates({ kind: 'stock', stock }, 1e9, BAND);
    expect(
      cands(0, L12)
        .map((e) => value(e) * 1e9)
        .sort((a, b) => a - b),
    ).toEqual([expect.closeTo(10, 9), expect.closeTo(11, 9), expect.closeTo(15, 9)]);
    expect(cands(1, C27).map((e) => value(e) * 1e12)).toEqual([expect.closeTo(2.2, 9)]);
    expect(cands(2, R)).toEqual([]);
  });

  it('a stock retune with a locked part changes only the free part, to a stock value (non-vacuous)', () => {
    // The buildable board of closedloop.test.ts with its true drifts; 12 nH is not in the stock,
    // and 10 nH lowers the worst VSWR (E24's 9.1 nH is the documented best), so a change exists.
    const m: BuildModel = {
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
    const band = Array.from({ length: 11 }, (_, i) => 0.9e9 + 0.02e9 * i);
    const stock = parseStock('10nH, 11nH, 15nH, 2.2pF, 2.7pF, 3.3pF');
    const r = suggestRetune(
      m,
      { 'value:0': 0.08, 'pad:1': 0.3e-12 },
      {
        band,
        limit: 1.38,
        candidates: retuneCandidates({ kind: 'stock', stock }, 1e9, band),
        locked: [1],
      },
    );
    const changes = r.suggestion?.changes ?? [];
    expect(changes.length).toBeGreaterThan(0);
    for (const c of changes) {
      expect(c.index).toBe(0);
      expect([10, 11, 15].some((v) => Math.abs(value(c.to) * 1e9 - v) < 1e-9)).toBe(true);
    }
  });

  it('the part library: parts of the kind, nearest by effective value first, covering the band', () => {
    const parts = SYNTHETIC_PARTS.map(syntheticPart);
    const cands = retuneCandidates({ kind: 'library', parts }, 1e9, [0.9e9, 1.1e9]);
    const got = cands(0, L12).map((e) => (e as { part: { partNumber: string } }).part.partNumber);
    // The synthetic inductors are 2.2, 4.7, 10 and 22 nH: by |ln(v / 12 nH)| 10 nH, 22 nH, 4.7, 2.2.
    expect(got).toEqual([
      'SYNTH-L0402-10N',
      'SYNTH-L0402-22N',
      'SYNTH-L0402-4N7',
      'SYNTH-L0402-2N2',
    ]);
    // A band beyond the data (10 MHz to 10 GHz) leaves none.
    expect(retuneCandidates({ kind: 'library', parts }, 1e9, [9e9, 11e9])(0, L12)).toEqual([]);
    // No resistor in a library.
    expect(cands(2, R)).toEqual([]);
  });

  it('a placed library part is retuned to other library parts; the fast evaluation equals the full model', () => {
    const parts = SYNTHETIC_PARTS.map(syntheticPart);
    const p10 = parts.find((p) => p.partNumber === 'SYNTH-L0402-10N');
    const p22 = parts.find((p) => p.partNumber === 'SYNTH-L0402-22N');
    if (!p10 || !p22) throw new Error('synthetic parts missing');
    const m: BuildModel = {
      z0: 50,
      frequency: 1e9,
      base: [
        { kind: 'part', orientation: 'shunt', part: p10 },
        { kind: 'C', orientation: 'series', value: 2.7e-12, package: '0402' },
      ],
      table: DEFAULT_PACKAGES,
      board: { ...DEFAULT_BOARD, enabled: true, traceLength: 2e-3 },
      load: { re: 100, im: -50 },
    };
    const band = [0.9e9, 1e9, 1.1e9];
    const cands = retuneCandidates({ kind: 'library', parts }, 1e9, band)(0, m.base[0] as Element);
    expect((cands[0] as { part: { partNumber: string } }).part.partNumber).toBe('SYNTH-L0402-10N');
    expect(partAt(p10, 1e9)?.value as number).toBeGreaterThan(0);
    const drifts = { 'value:1': 0.05, via: 0.3, trace: 0.5e-3 };
    const evaluate = retuneEvaluator(m, drifts, band);
    const replace = new Map<number, Element>([
      [0, { kind: 'part', orientation: 'shunt', part: p22 }],
    ]);
    const fast = evaluate(replace);
    const full = retunedWorst(m, drifts, replace, band);
    expect(fast.frequency).toBe(full.frequency);
    expect(Math.abs(fast.vswr - full.vswr) / full.vswr).toBeLessThan(1e-12);
  });
});
