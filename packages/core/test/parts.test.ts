/**
 * Phase D5, real parts: a library part from its two-port S-parameter file.
 *
 * The data here is synthetic, made from equivalent circuits (parts.ts,
 * SYNTHETIC_PARTS), so every quantity has an exact answer: the fixture
 * conversions are checked both ways against the circuit, the interpolation
 * against the generating circuit between the samples, the extracted nominal
 * value, self-resonance and fitted circuit against the circuit's own values.
 * No manufacturer data is in the repository (docs/08-depth-plan.md, D5).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  applyElement,
  bomCsv,
  bomRows,
  cabs,
  circuitImpedance,
  circuitSrf,
  complex,
  csub,
  dataImpedance,
  detectFixture,
  elementArc,
  elementParameters,
  evaluateAt,
  evaluateLadder,
  fitPartCircuit,
  fixtureS,
  inPartRange,
  isApproximatePart,
  ladderSParameters,
  ladderStress,
  libraryCandidates,
  libraryPartFromData,
  libraryPartOf,
  logFrequencies,
  MAX_PART_NAME,
  MAX_PART_POINTS,
  manufacturerOf,
  partAbcd,
  partAt,
  partDataFromCircuit,
  partDataOf,
  partImpedance,
  partKey,
  partNominal,
  partNumberOf,
  partRangeProblem,
  partSParametersAt,
  partSrf,
  placementNote,
  readPartFile,
  readTouchstone,
  realizeLadder,
  SYNTHETIC_FILES,
  SYNTHETIC_FREQUENCIES,
  SYNTHETIC_MANUFACTURER,
  SYNTHETIC_PARTS,
  syntheticFileText,
  syntheticPart,
  throughAbcd,
  usesFullTwoPort,
  withFixture,
  withoutData,
  writeLadderS2p,
  writeSpice,
  type Complex,
  type Element,
  type Ladder,
  type LibraryPart,
  type PartCircuit,
  type PartElement,
  type SyntheticPartSpec,
} from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureFile = (name: string): string =>
  readFileSync(resolve(here, 'fixtures/parts', `${name}.s2p`), 'utf8');

const spec = (name: string): SyntheticPartSpec => {
  const s = SYNTHETIC_PARTS.find((p) => p.name === name);
  if (!s) throw new Error(name);
  return s;
};
const part = (name: string): LibraryPart => syntheticPart(spec(name));
const rel = (a: Complex, b: Complex): number => cabs(csub(a, b)) / cabs(b);

describe('fixture conversions', () => {
  const z0 = 50;
  const zs = [complex(0.2, -15.9), complex(3, 40), complex(1e3, -2e3), complex(0.01, 0.5)];

  it('series-through: S11 + S21 = 1 and Z = 2 Z0 (1 - S21) / S21', () => {
    for (const z of zs) {
      const [s11, s21] = fixtureS(z, 'series', z0);
      expect(cabs(csub(complex(s11.re + s21.re, s11.im + s21.im), complex(1)))).toBeLessThan(1e-15);
      // The textbook formula of the series-through fixture.
      const one = complex(1 - s21.re, -s21.im);
      const textbook = complex(
        2 * z0 * ((one.re * s21.re + one.im * s21.im) / (s21.re ** 2 + s21.im ** 2)),
        2 * z0 * ((one.im * s21.re - one.re * s21.im) / (s21.re ** 2 + s21.im ** 2)),
      );
      expect(rel(textbook, z)).toBeLessThan(1e-12);
    }
  });

  it('shunt-through: S21 - S11 = 1 and Z = Z0 S21 / (2 (1 - S21))', () => {
    for (const z of zs) {
      const [s11, s21] = fixtureS(z, 'shunt', z0);
      expect(Math.hypot(s21.re - s11.re - 1, s21.im - s11.im)).toBeLessThan(1e-15);
      const den = complex(2 * (1 - s21.re), -2 * s21.im);
      const num = complex(z0 * s21.re, z0 * s21.im);
      const d2 = den.re ** 2 + den.im ** 2;
      const textbook = complex(
        (num.re * den.re + num.im * den.im) / d2,
        (num.im * den.re - num.re * den.im) / d2,
      );
      expect(rel(textbook, z)).toBeLessThan(1e-12);
    }
  });

  it('the part impedance from the data equals the circuit at every sample, in both fixtures', () => {
    const circuits: PartCircuit[] = [
      { type: 'C', c: 10e-12, esl: 0.4e-9, esr: 0.2 },
      { type: 'L', l: 10e-9, cp: 0.08e-12, r: 0.35 },
    ];
    for (const circuit of circuits) {
      for (const fixture of ['series', 'shunt'] as const) {
        const data = partDataFromCircuit(circuit, fixture, SYNTHETIC_FREQUENCIES);
        for (const f of SYNTHETIC_FREQUENCIES) {
          const z = dataImpedance(data, f) as Complex;
          expect(rel(z, circuitImpedance(circuit, 2 * Math.PI * f))).toBeLessThan(1e-9);
        }
      }
    }
  });

  it('detects the fixture from the data and is confident on clean data', () => {
    for (const s of SYNTHETIC_PARTS) {
      const g = detectFixture(syntheticPart(s).data as NonNullable<LibraryPart['data']>);
      expect(g.fixture).toBe(s.fixture);
      expect(g.confident).toBe(true);
    }
  });

  it('is not confident when the part is invisible in both readings (S11 = 0, S21 = 1)', () => {
    const f = [1e6, 2e6, 3e6];
    const s = f.flatMap(() => [0, 0, 1, 0, 1, 0, 0, 0]);
    expect(detectFixture({ f, s }).confident).toBe(false);
  });

  it('a series part from a series-through file uses the measured two-port; otherwise the impedance', () => {
    const series = part('SYNTH-C0402-10P');
    const shunt = part('SYNTH-C0402-10P-SHUNT');
    expect(usesFullTwoPort(series, 'series')).toBe(true);
    expect(usesFullTwoPort(series, 'shunt')).toBe(false);
    expect(usesFullTwoPort(shunt, 'shunt')).toBe(false);
    expect(placementNote(series, 'series')).toBeNull();
    expect(placementNote(shunt, 'shunt')).toBeNull();
    expect(placementNote(series, 'shunt')).toMatch(/ground path/);
    expect(placementNote(shunt, 'series')).toMatch(/ground path/);
    // For an ideal fixture the two-port and the impedance give the same network.
    const f = 1.3e9;
    const m = partAbcd(series, 'series', f);
    const z = partImpedance(series, f) as Complex;
    expect(rel(m.b, z)).toBeLessThan(1e-9);
    expect(cabs(csub(m.a, complex(1)))).toBeLessThan(1e-9);
    expect(cabs(m.c)).toBeLessThan(1e-12);
  });

  it('measured S12 and S21 that differ are averaged, so the part is reciprocal', () => {
    const base = part('SYNTH-C0402-10P').data as NonNullable<LibraryPart['data']>;
    const s = [...base.s];
    for (let k = 0; k < base.f.length; k++) {
      s[8 * k + 2] = (s[8 * k + 2] as number) * 1.01;
      s[8 * k + 4] = (s[8 * k + 4] as number) * 0.99;
    }
    const p = libraryPartFromData({ ...base, s }, { manufacturer: 'X', partNumber: 'Y' });
    const m = partAbcd(p, 'series', 1e9);
    const det = csub(
      complex(m.a.re * m.d.re - m.a.im * m.d.im, m.a.re * m.d.im + m.a.im * m.d.re),
      complex(m.b.re * m.c.re - m.b.im * m.c.im, m.b.re * m.c.im + m.b.im * m.c.re),
    );
    expect(cabs(csub(det, complex(1)))).toBeLessThan(1e-12);
    const sp = partSParametersAt(p.data as NonNullable<LibraryPart['data']>, 1e9);
    expect(sp?.s12).toEqual(sp?.s21);
  });
});

describe('interpolation between the samples', () => {
  it('is linear in S: within 5e-4 of the generating circuit at a quarter, half and three quarters of every step', () => {
    for (const s of SYNTHETIC_PARTS) {
      const p = syntheticPart(s);
      const fs = SYNTHETIC_FREQUENCIES;
      let worst = 0;
      for (let k = 0; k < fs.length - 1; k++) {
        for (const t of [0.25, 0.5, 0.75]) {
          const f = (fs[k] as number) + t * ((fs[k + 1] as number) - (fs[k] as number));
          const [s11, s21] = fixtureS(circuitImpedance(s.circuit, 2 * Math.PI * f), s.fixture, 50);
          const got = partSParametersAt(p.data as NonNullable<LibraryPart['data']>, f);
          worst = Math.max(
            worst,
            cabs(csub(got?.s11 as Complex, s11)),
            cabs(csub(got?.s21 as Complex, s21)),
          );
        }
      }
      expect(worst, s.name).toBeLessThan(5e-4);
    }
  });

  it('gives the part impedance within 0.5 % of the circuit below half the self-resonance', () => {
    for (const s of SYNTHETIC_PARTS) {
      const p = syntheticPart(s);
      const srf = circuitSrf(s.circuit);
      for (const f of logFrequencies(10.5e6, Math.min(9.9e9, srf / 2), 157)) {
        const z = partImpedance(p, f) as Complex;
        expect(rel(z, circuitImpedance(s.circuit, 2 * Math.PI * f)), `${s.name} ${f}`).toBeLessThan(
          5e-3,
        );
      }
    }
  });

  it('is exact at the samples', () => {
    const s = spec('SYNTH-L0402-10N');
    const p = syntheticPart(s);
    for (const f of SYNTHETIC_FREQUENCIES.slice(0, 50)) {
      expect(
        rel(partImpedance(p, f) as Complex, circuitImpedance(s.circuit, 2 * Math.PI * f)),
      ).toBeLessThan(1e-9);
    }
  });
});

describe('outside the data', () => {
  const p = part('SYNTH-C0402-10P');

  it('refuses with a flag instead of extrapolating', () => {
    expect(partImpedance(p, 9e6)).toBeNull();
    expect(partImpedance(p, 10.1e9)).toBeNull();
    expect(partAt(p, 20e9)).toBeNull();
    const m = partAbcd(p, 'series', 5e6);
    expect(Number.isNaN(m.a.re)).toBe(true);
    expect(partRangeProblem(p, 5e6)).toBe("below the part's data (10 MHz to 10 GHz)");
    expect(partRangeProblem(p, 12e9)).toBe("above the part's data (10 MHz to 10 GHz)");
    expect(partRangeProblem(p, 1e9)).toBeNull();
  });

  it('holds the end points themselves', () => {
    expect(inPartRange(p.range, 10e6)).toBe(true);
    expect(inPartRange(p.range, 10e9)).toBe(true);
    expect(partImpedance(p, 10e9)).not.toBeNull();
    expect(partImpedance(p, 10e6)).not.toBeNull();
  });

  it('a ladder evaluated outside the data gives NaN, not a number from nowhere', () => {
    const ladder: Ladder = {
      z0: 50,
      frequency: 20e9,
      load: complex(50),
      elements: [{ kind: 'part', orientation: 'series', part: p }],
    };
    const r = evaluateLadder(ladder);
    expect(Number.isNaN(r.zin.re)).toBe(true);
    const inside = evaluateAt(ladder, 1e9, complex(50));
    expect(Number.isFinite(inside.zin.re)).toBe(true);
  });

  it('the fitted circuit alone (a part from a share link) keeps the range too', () => {
    const bare = withoutData(p);
    expect(isApproximatePart(bare)).toBe(true);
    expect(partImpedance(bare, 1e9)).not.toBeNull();
    expect(partImpedance(bare, 20e9)).toBeNull();
  });
});

describe('what the data says about the part', () => {
  it('nominal value, self-resonance and fitted circuit match the generating circuit', () => {
    for (const s of SYNTHETIC_PARTS) {
      const p = syntheticPart(s);
      const c = s.circuit;
      const value = c.type === 'C' ? c.c : c.l;
      expect(p.type).toBe(c.type);
      // The nominal value is the effective value at 10 MHz: within 0.01 % of C or L there.
      expect(Math.abs((partNominal(p) as number) / value - 1), s.name).toBeLessThan(1e-4);
      const srf = circuitSrf(c);
      const found = partSrf(p);
      if (srf <= 10e9) expect(Math.abs((found as number) / srf - 1), s.name).toBeLessThan(5e-4);
      else expect(found, s.name).toBeNull();
      const fit = p.circuit;
      if (c.type === 'C' && fit.type === 'C') {
        expect(fit.c / c.c - 1).toBeCloseTo(0, 6);
        expect(fit.esl / c.esl - 1).toBeCloseTo(0, 6);
        expect(fit.esr / c.esr - 1).toBeCloseTo(0, 6);
      } else if (c.type === 'L' && fit.type === 'L') {
        expect(Math.abs(fit.l / c.l - 1), s.name).toBeLessThan(1e-4);
        expect(Math.abs(fit.r / c.r - 1), s.name).toBeLessThan(1e-3);
        // Without a resonance in the data Cp is only seen through its slope: 2 %.
        expect(Math.abs(fit.cp / c.cp - 1), s.name).toBeLessThan(srf <= 10e9 ? 1e-3 : 0.02);
      }
    }
  });

  it('effective value, ESR and Q at a frequency', () => {
    const p = part('SYNTH-C0402-10P');
    const f = 1e9;
    const at = partAt(p, f);
    // C / (1 - w^2 L C) for C = 10 pF, ESL 0.38 nH.
    const w = 2 * Math.PI * f;
    const ceff = 10e-12 / (1 - w * w * 0.38e-9 * 10e-12);
    expect(Math.abs((at?.value as number) / ceff - 1)).toBeLessThan(1e-3);
    expect(at?.esr).toBeCloseTo(0.2, 2);
    expect(Math.abs((at?.q as number) / (1 / (w * ceff) / 0.2) - 1)).toBeLessThan(1e-2);
    // Above the self-resonance a capacitor has no effective capacitance.
    expect(partAt(p, 4e9)?.value).toBeNull();
  });

  it('fits any part file of either type, a lossless one too', () => {
    const data = partDataFromCircuit(
      { type: 'C', c: 3.3e-12, esl: 0, esr: 0 },
      'series',
      logFrequencies(1e6, 1e9, 31),
    );
    const fit = fitPartCircuit(data);
    expect(fit.type).toBe('C');
    if (fit.type === 'C') expect(fit.c).toBeCloseTo(3.3e-12, 16);
  });
});

describe('reading part files', () => {
  it('the committed synthetic files are what the generator writes', () => {
    for (const name of SYNTHETIC_FILES) {
      const text = fixtureFile(name).replace(/\r\n/g, '\n');
      expect(text, name).toBe(syntheticFileText(spec(name)));
    }
  });

  it('reads a synthetic file: names, type, fixture, range, and the same part as the generator', () => {
    const { part: p, guess } = readPartFile(fixtureFile('SYNTH-C0402-10P'), 'SYNTH-C0402-10P.s2p');
    expect(p.manufacturer).toBe(SYNTHETIC_MANUFACTURER);
    expect(p.partNumber).toBe('SYNTH-C0402-10P');
    expect(p.type).toBe('C');
    expect(p.data?.fixture).toBe('series');
    expect(guess.confident).toBe(true);
    expect(p.range[0]).toBeCloseTo(10e6, 0);
    expect(p.range[1]).toBeCloseTo(10e9, 0);
    const z = partImpedance(p, 1.234e9) as Complex;
    const zRef = partImpedance(part('SYNTH-C0402-10P'), 1.234e9) as Complex;
    // The file holds 10 significant digits.
    expect(rel(z, zRef)).toBeLessThan(1e-7);
    const shunt = readPartFile(
      fixtureFile('SYNTH-C0402-10P-SHUNT'),
      'SYNTH-C0402-10P-SHUNT.s2p',
    ).part;
    expect(shunt.data?.fixture).toBe('shunt');
    const l = readPartFile(fixtureFile('SYNTH-L0402-10N'), 'SYNTH-L0402-10N.s2p').part;
    expect(l.type).toBe('L');
  });

  it('the user may override the fixture; data that cannot be read that way is refused', () => {
    // Shunt-through data read as series-through: the exact chain-matrix form gives B = Z0^2 / Z.
    const ambiguous = partDataFromCircuit(
      { type: 'C', c: 10e-12, esl: 0, esr: 0.5 },
      'shunt',
      logFrequencies(1e6, 1e8, 21),
    );
    const p = libraryPartFromData(ambiguous, { manufacturer: 'X', partNumber: 'Y' });
    expect(withFixture(p, 'shunt')).toBe(p);
    // Series-through data has no shunt admittance at all (the C element is zero): read as a shunt
    // part it is refused rather than turned into a number.
    expect(() => withFixture(part('SYNTH-L0402-10N'), 'shunt')).toThrow(/measured to ground/);
    expect(() => withFixture(part('SYNTH-C0402-10P-SHUNT'), 'series')).toThrow(
      /measured in series/,
    );
  });

  it('reads Z-parameter files by converting them', () => {
    const z0 = 50;
    const lines = ['# MHZ Z RI R 50'];
    for (const f of [10, 100, 1000]) {
      // A series 10 pF capacitor has no Z matrix; a shunt one does: Z11 = Z12 = Z21 = Z22 = Zc.
      const zc = circuitImpedance(
        { type: 'C', c: 10e-12, esl: 0, esr: 0.1 },
        2 * Math.PI * f * 1e6,
      );
      const n = { re: zc.re / z0, im: zc.im / z0 };
      lines.push([f, n.re, n.im, n.re, n.im, n.re, n.im, n.re, n.im].join(' '));
    }
    const { part: p } = readPartFile(lines.join('\n'), 'shuntcap.s2p');
    expect(p.data?.fixture).toBe('shunt');
    expect(Math.abs((partNominal(p) as number) / 10e-12 - 1)).toBeLessThan(1e-9);
  });

  it('refuses what is not a two-port part file', () => {
    expect(() => readPartFile('# MHZ S MA R 50\n1 0.5 0\n2 0.5 0\n', 'a.s1p')).toThrow(/two-port/);
    expect(() => readPartFile('# MHZ S MA R 50\n1 0.5 0 1 0 1 0 0.5 0\n', 'a.s2p')).toThrow(
      /at least two/,
    );
    expect(() =>
      readPartFile('# MHZ S MA R 50\n2 0.5 0 1 0 1 0 0.5 0\n1 0.5 0 1 0 1 0 0.5 0\n', 'a.s2p'),
    ).toThrow(/ascending/);
    // S21 = 0 in a series-through reading: an open, no impedance.
    expect(() =>
      readPartFile('# MHZ S RI R 50\n1 1 0 0 0 0 0 1 0\n2 1 0 0 0 0 0 1 0\n', 'open.s2p', 'series'),
    ).toThrow(/measured in series/);
    expect(() =>
      readPartFile('# MHZ S RI R 50\n1 99 0 1 0 1 0 0 0\n2 0 0 1 0 1 0 0 0\n', 'x.s2p'),
    ).toThrow(/Unusable/);
  });

  it('names: manufacturer from a Manufacturer line, a known name or a prefix; part number from the file name', () => {
    expect(manufacturerOf(['Manufacturer: ACME Parts'], 'X')).toBe('ACME Parts');
    expect(manufacturerOf(['Created by Murata Manufacturing'], 'X')).toBe('Murata');
    expect(manufacturerOf(['Coilcraft, Inc.'], 'X')).toBe('Coilcraft');
    expect(manufacturerOf([], 'GRM1555C1H100JA01')).toBe('Murata');
    expect(manufacturerOf([], '0402HP-10N')).toBe('');
    expect(partNumberOf('C:\\data\\GRM1555C1H100JA01.s2p')).toBe('GRM1555C1H100JA01');
    expect(partNumberOf('a/b/0402HP-10N.S2P')).toBe('0402HP-10N');
    expect(partNumberOf('.s2p')).toBe('Unnamed part');
  });
});

describe('the part in the ladder', () => {
  const c10 = part('SYNTH-C0402-10P');
  const l10 = part('SYNTH-L0402-10N');
  const cShunt = part('SYNTH-C0402-10P-SHUNT');

  it('equals the ladder of its generating circuit at the samples (series and shunt, with a via)', () => {
    const f = SYNTHETIC_FREQUENCIES[150] as number;
    const via = 0.5e-9;
    const elements: Element[] = [
      { kind: 'part', orientation: 'shunt', part: cShunt, board: { via } },
      { kind: 'part', orientation: 'series', part: l10 },
      { kind: 'part', orientation: 'series', part: c10 },
    ];
    const lumped: Element[] = [
      // Shunt C, ESL, ESR and the via in series to ground.
      {
        kind: 'RLC',
        orientation: 'shunt',
        connection: 'series',
        r: 0.2,
        l: 0.45e-9 + via,
        c: 10e-12,
      },
      // (R + L) || Cp in series: as an impedance through a series RLC is not possible, compare Zin.
      { kind: 'RLC', orientation: 'series', connection: 'series', r: 0.2, l: 0.38e-9, c: 10e-12 },
    ];
    const load = complex(20, -15);
    const zPart = evaluateAt({ z0: 50, frequency: f, load, elements }, f, load).zin;
    // Hand-built: shunt branch, then series (R + jwL) || Cp, then the series RLC.
    const w = 2 * Math.PI * f;
    const z1 = applyElement(lumped[0] as Element, load, f);
    const zl = circuitImpedance({ type: 'L', l: 10e-9, cp: 0.08e-12, r: 0.35 }, w);
    const z2 = complex(z1.re + zl.re, z1.im + zl.im);
    const z3 = applyElement(lumped[1] as Element, z2, f);
    expect(rel(zPart, z3)).toBeLessThan(1e-9);
  });

  it('the arc runs from the node before to the node after', () => {
    const load = complex(30, 10);
    for (const el of [
      { kind: 'part', orientation: 'series', part: c10 } as PartElement,
      { kind: 'part', orientation: 'shunt', part: l10 } as PartElement,
    ]) {
      const arc = elementArc(el, load, 1e9, 16);
      expect(rel(arc[0] as Complex, load)).toBeLessThan(1e-12);
      expect(rel(arc[arc.length - 1] as Complex, applyElement(el, load, 1e9))).toBeLessThan(1e-12);
    }
  });

  it('has no parameters to vary, writes a reciprocal .s2p and carries its stress as one part', () => {
    const el: PartElement = { kind: 'part', orientation: 'series', part: c10 };
    expect(elementParameters(el)).toEqual([]);
    const ladder: Ladder = { z0: 50, frequency: 1e9, load: complex(25, 10), elements: [el] };
    const s = ladderSParameters(ladder, 1e9);
    expect(s.s12).toEqual(s.s21);
    const text = writeLadderS2p(ladder, [0.5e9, 1e9, 1.5e9]);
    expect(readTouchstone(text, 2).points).toHaveLength(3);
    const stress = ladderStress(ladder, 1);
    expect(stress[0]?.parts).toHaveLength(1);
    expect(stress[0]?.parts[0]?.part).toBe('C');
  });

  it('SPICE writes the fitted circuit and says so', () => {
    const ladder: Ladder = {
      z0: 50,
      frequency: 1e9,
      load: complex(25, 10),
      elements: [
        { kind: 'part', orientation: 'series', part: c10 },
        { kind: 'part', orientation: 'shunt', part: l10 },
      ],
    };
    const text = writeSpice(ladder);
    expect(text).toMatch(/fitted equivalent circuits, not their measured S-parameters/);
    expect(text).toMatch(/Element 1: Synthetic \(not a real part\) SYNTH-C0402-10P/);
    // C with its ESL (and the ESR as the ESL's loss resistor), L with its R, across Cp.
    expect(text).toMatch(/^L1 /m);
    expect(text).toMatch(/^C1 /m);
    expect(text).toMatch(/^RL1 /m);
    expect(text).toMatch(/^L2 /m);
    expect(text).toMatch(/^C2 /m);
  });
});

describe('Realize from the part library', () => {
  const library = SYNTHETIC_PARTS.map((s) => syntheticPart(s));

  it('chooses by effective reactance at the design frequency, not by nominal value', () => {
    // At 2 GHz a 10 pF part with 0.38 nH acts as 25 pF and the 22 pF part is past its resonance.
    // An ideal 15 pF is nearest the 22 pF part by nominal value; by effective reactance its
    // candidates are the 10 pF part (25 pF effective) and the 4.7 pF part (6.4 pF effective).
    const f = 2e9;
    const c = libraryCandidates(library, 'C', 15e-12, f).map((p) => p.partNumber);
    expect(c).toEqual(['SYNTH-C0402-10P', 'SYNTH-C0402-4P7']);
    expect(c).not.toContain('SYNTH-C0402-22P');
    // The shunt-through 10 pF part (0.45 nH, resonance 2.37 GHz) acts as 34 pF there, further away.
    const ceff = (name: string): number => partAt(part(name), f)?.value as number;
    expect(ceff('SYNTH-C0402-10P')).toBeGreaterThan(24e-12);
    expect(ceff('SYNTH-C0402-10P-SHUNT')).toBeGreaterThan(ceff('SYNTH-C0402-10P'));
  });

  it('replaces the ideal element by the library part, ranks the bracket by VSWR and respects locks and scope', () => {
    // An L match at 1 GHz: 10 + j0 ohm to 50 ohm, series L then shunt C (load side first).
    const f = 1e9;
    const ideal: Ladder = {
      z0: 50,
      frequency: f,
      load: complex(10, 0),
      elements: [
        { kind: 'L', orientation: 'series', value: 3.18e-9 },
        { kind: 'C', orientation: 'shunt', value: 12.7e-12 },
      ],
    };
    const r = realizeLadder(ideal, { source: { kind: 'library', parts: library }, scope: 'all' });
    expect(r.sourceLabel).toBe('library');
    const [a, b] = r.ladder.elements;
    expect(a?.kind).toBe('part');
    expect(b?.kind).toBe('part');
    if (a?.kind === 'part' && b?.kind === 'part') {
      expect(a.orientation).toBe('series');
      expect(a.part.type).toBe('L');
      expect(b.orientation).toBe('shunt');
      expect(b.part.type).toBe('C');
    }
    expect(r.elements[0]?.parts[0]?.source).toBe('library');
    // Whichever bracketing part was kept, the other one is no better on VSWR.
    const vswr = (els: readonly Element[]): number => {
      const g = evaluateAt({ ...ideal, elements: els }, f, ideal.load).info;
      return (g[g.length - 1] as { vswr: number }).vswr;
    };
    const chosen = vswr(r.ladder.elements);
    for (const alt of libraryCandidates(library, 'C', 12.7e-12, f)) {
      const els = [
        r.ladder.elements[0] as Element,
        { kind: 'part', orientation: 'shunt', part: alt } as Element,
      ];
      expect(chosen).toBeLessThanOrEqual(vswr(els) + 1e-9);
    }
    // Locked: kept exact. Scope L: the capacitor stays.
    const locked = realizeLadder(ideal, {
      source: { kind: 'library', parts: library },
      scope: 'all',
      locked: [1],
    });
    expect(locked.ladder.elements[1]?.kind).toBe('C');
    const onlyL = realizeLadder(ideal, { source: { kind: 'library', parts: library }, scope: 'L' });
    expect(onlyL.ladder.elements[0]?.kind).toBe('part');
    expect(onlyL.ladder.elements[1]?.kind).toBe('C');
  });

  it('leaves a part without candidates as it is (resistors, RLC blocks, no part covers f)', () => {
    const ladder: Ladder = {
      z0: 50,
      frequency: 20e9,
      load: complex(10, 0),
      elements: [
        { kind: 'C', orientation: 'shunt', value: 1e-12 },
        { kind: 'R', orientation: 'series', value: 5 },
        { kind: 'RLC', orientation: 'shunt', connection: 'series', r: 1, l: 1e-9, c: 1e-12 },
      ],
    };
    const r = realizeLadder(ladder, { source: { kind: 'library', parts: library }, scope: 'all' });
    expect(r.ladder.elements).toEqual(ladder.elements);
  });

  it('the BOM lists manufacturer and part number for chosen and placed library parts', () => {
    const f = 1e9;
    const ladder: Ladder = {
      z0: 50,
      frequency: f,
      load: complex(10, 0),
      elements: [
        { kind: 'L', orientation: 'series', value: 3.18e-9 },
        { kind: 'part', orientation: 'shunt', part: part('SYNTH-C0402-10P') },
      ],
    };
    const r = realizeLadder(ladder, { source: { kind: 'library', parts: library }, scope: 'all' });
    const rows = bomRows(r);
    expect(rows[0]?.manufacturer).toBe(SYNTHETIC_MANUFACTURER);
    expect(rows[0]?.partNumber).toMatch(/^SYNTH-L0402-/);
    expect(rows[1]?.partNumber).toBe('SYNTH-C0402-10P');
    expect(rows[1]?.source).toBe('library');
    const csv = bomCsv(rows);
    expect(csv).toMatch(/;Synthetic \(not a real part\);SYNTH-C0402-10P$/m);
  });
});

describe('stored parts: round trips and hostile input', () => {
  const p = part('SYNTH-L0402-4N7');

  it('a part survives JSON as it is, and without its data keeps names, range and circuit', () => {
    expect(libraryPartOf(JSON.parse(JSON.stringify(p)))).toEqual(p);
    const bare = libraryPartOf(JSON.parse(JSON.stringify(withoutData(p))));
    expect(bare).toEqual(withoutData(p));
    expect(bare?.data).toBeUndefined();
    expect(partKey(p)).toBe('synthetic (not a real part)|synth-l0402-4n7');
  });

  it('refuses a part with anything missing, mistyped or out of range', () => {
    const json = JSON.parse(JSON.stringify(p)) as Record<string, unknown>;
    const bad: unknown[] = [
      null,
      42,
      'part',
      [],
      { ...json, manufacturer: 7 },
      { ...json, partNumber: null },
      { ...json, type: 'R' },
      { ...json, circuit: { type: 'C', c: 1e-12, esl: 0, esr: 0 } },
      { ...json, circuit: { type: 'L', l: -1, cp: 0, r: 0 } },
      { ...json, circuit: { type: 'L', l: Number.NaN, cp: 0, r: 0 } },
      { ...json, circuit: { type: 'L', l: 1e-9, cp: 1, r: 0 } },
      { ...json, data: { ...(json.data as object), z0: 0 } },
      { ...json, data: { ...(json.data as object), fixture: 'through' } },
      { ...json, data: { ...(json.data as object), f: [1, 3, 2] } },
      { ...json, data: { ...(json.data as object), s: [1, 2, 3] } },
      { ...json, data: { ...(json.data as object), s: 'abc' } },
      { ...withoutData(p), range: [2e9, 1e9] },
      { ...withoutData(p), range: [0, 1e9] },
      { ...withoutData(p), range: 'wide' },
    ];
    for (const b of bad) expect(libraryPartOf(b), JSON.stringify(b)?.slice(0, 120)).toBeNull();
  });

  it('refuses data too long, non-finite or unbounded', () => {
    const f = Array.from({ length: MAX_PART_POINTS + 1 }, (_, i) => i + 1);
    expect(
      partDataOf({ z0: 50, fixture: 'series', f, s: f.flatMap(() => [0, 0, 1, 0, 1, 0, 0, 0]) }),
    ).toBeNull();
    expect(
      partDataOf({
        z0: 50,
        fixture: 'series',
        f: [1, 2],
        s: [Infinity, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0],
      }),
    ).toBeNull();
    expect(
      partDataOf({
        z0: 50,
        fixture: 'series',
        f: [1, 2],
        s: [100, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0],
      }),
    ).toBeNull();
  });

  it('cuts long names and removes control characters', () => {
    const json = JSON.parse(JSON.stringify(withoutData(p))) as Record<string, unknown>;
    const got = libraryPartOf({
      ...json,
      manufacturer: 'A\u0000B\nC',
      partNumber: 'X'.repeat(500),
    });
    expect(got?.manufacturer).toBe('A B C');
    expect(got?.partNumber).toHaveLength(MAX_PART_NAME);
  });

  it('the range of a part with data is the data\u2019s own, whatever the stored range says', () => {
    const json = JSON.parse(JSON.stringify(p)) as Record<string, unknown>;
    const got = libraryPartOf({ ...json, range: [1, 1e15] });
    expect(got?.range).toEqual([p.data?.f[0], p.data?.f[(p.data?.f.length ?? 1) - 1]]);
  });

  it('a hostile part never makes the ladder throw', () => {
    const bare = withoutData(p);
    const el: PartElement = { kind: 'part', orientation: 'shunt', part: bare };
    const r = evaluateAt(
      { z0: 50, frequency: 1e9, load: complex(50), elements: [el] },
      1e9,
      complex(50),
    );
    expect(Number.isFinite(r.zin.re)).toBe(true);
    const z = throughAbcd(partAbcd(bare, 'shunt', 1e9), complex(50));
    expect(rel(z, r.zin)).toBeLessThan(1e-12);
  });
});
