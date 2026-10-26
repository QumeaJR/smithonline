import { describe, expect, it } from 'vitest';
import {
  applyElement,
  bomCsv,
  bomRows,
  branchImpedance,
  buildXmlsc,
  cadd,
  cascade,
  cclose,
  cinv,
  complex,
  DEFAULT_PACKAGES,
  elementAbcd,
  elementArc,
  evaluateLadder,
  hasPackages,
  isDefaultRow,
  isPackageId,
  ladderFromXmlsc,
  normalizePackageTable,
  droppedPackageNumbers,
  isPackageNumber,
  PACKAGE_LIMITS,
  PACKAGE_NUMBERS,
  PACKAGE_IDS,
  packageById,
  packageEquivalent,
  packageSelfResonance,
  packagesFor,
  readXmlsc,
  realizeLadder,
  seriesAbcd,
  shuntAbcd,
  withPackages,
  writeLtspice,
  writeNetlist,
  writeSpice,
  writeXmlsc,
  type CapacitorElement,
  type Element,
  type InductorElement,
  type Ladder,
} from '../src/index';

const pkg0402 = packageById(DEFAULT_PACKAGES, '0402')!;
const pkg0603 = packageById(DEFAULT_PACKAGES, '0603')!;

const c0402: CapacitorElement = {
  kind: 'C',
  orientation: 'series',
  value: 10e-12,
  package: '0402',
};
const l0603: InductorElement = { kind: 'L', orientation: 'shunt', value: 10e-9, package: '0603' };

describe('package table', () => {
  it('has the six packages in order with finite, non-negative values and a source note each', () => {
    expect(DEFAULT_PACKAGES.map((p) => p.id)).toEqual(PACKAGE_IDS);
    for (const p of DEFAULT_PACKAGES) {
      for (const v of [p.esl, p.cp, p.esr, p.pad]) {
        expect(Number.isFinite(v) && v >= 0).toBe(true);
      }
      expect(p.source.length).toBeGreaterThan(20);
      expect(p.label.length).toBeGreaterThan(0);
    }
    expect(isPackageId('0402')).toBe(true);
    expect(isPackageId('0403')).toBe(false);
    expect(isPackageId(402)).toBe(false);
  });

  it('offers the wire-wound coil for inductors only', () => {
    expect(packagesFor(DEFAULT_PACKAGES, 'C').map((p) => p.id)).toEqual([
      '0201',
      '0402',
      '0603',
      '0805',
      '1206',
    ]);
    expect(packagesFor(DEFAULT_PACKAGES, 'L').map((p) => p.id)).toEqual(PACKAGE_IDS);
  });

  it('normalizes a stored table: unknown input gives the defaults, numbers are taken per field', () => {
    expect(normalizePackageTable(undefined)).toEqual(DEFAULT_PACKAGES);
    expect(normalizePackageTable('garbage')).toEqual(DEFAULT_PACKAGES);
    const edited = normalizePackageTable([
      { id: '0402', esl: 1e-9, cp: -1, esr: 'x', pad: NaN, label: 'spoofed', source: 'spoofed' },
      { id: 'bogus', esl: 5 },
    ]);
    expect(edited).toHaveLength(DEFAULT_PACKAGES.length);
    const row = packageById(edited, '0402')!;
    expect(row).toMatchObject({
      esl: 1e-9,
      cp: pkg0402.cp,
      esr: pkg0402.esr,
      pad: pkg0402.pad,
      label: pkg0402.label,
      source: pkg0402.source,
    });
    expect(isDefaultRow(row)).toBe(false);
    expect(isDefaultRow(packageById(edited, '0603')!)).toBe(true);
  });

  it('keeps one range per number (PACKAGE_LIMITS): a number outside it is the default, and named', () => {
    // 0.5.0 kept any number >= 0: "10" typed for 10 nH was stored as 10 H.
    const stored = [{ id: '0805', esl: 10, cp: 1e-9, esr: 1000.5, padLength: 0.1 }];
    const row = packageById(normalizePackageTable(stored), '0805')!;
    const d = packageById(DEFAULT_PACKAGES, '0805')!;
    expect(row.esl).toBe(d.esl);
    expect(row.cp).toBe(1e-9);
    expect(row.esr).toBe(d.esr);
    expect(row.padLength).toBe(0.1);
    expect(droppedPackageNumbers(stored)).toEqual([
      { id: '0805', key: 'esl', value: 10 },
      { id: '0805', key: 'esr', value: 1000.5 },
    ]);
    for (const k of PACKAGE_NUMBERS) {
      expect(isPackageNumber(k, PACKAGE_LIMITS[k].max)).toBe(true);
      expect(isPackageNumber(k, PACKAGE_LIMITS[k].max * 1.0001)).toBe(false);
      expect(isPackageNumber(k, -1e-15)).toBe(false);
    }
  });
});

describe('parasitic equivalent', () => {
  it('a 10 pF 0402 capacitor is self-resonant at 1 / (2 pi sqrt(ESL C)), about 2.5 GHz', () => {
    const srf = packageSelfResonance(c0402, pkg0402)!;
    expect(srf).toBeCloseTo(1 / (2 * Math.PI * Math.sqrt(0.4e-9 * 10e-12)), 3);
    expect(srf / 1e9).toBeCloseTo(2.5165, 3);
    const eq = packageEquivalent(c0402, pkg0402);
    expect(eq.parasitics).toEqual({ esl: pkg0402.esl, pad: pkg0402.pad });
    // Capacitive below, resonant at, inductive above the SRF.
    const w = (f: number): number => 2 * Math.PI * f;
    expect(branchImpedance(eq, w(srf / 2)).im).toBeLessThan(0);
    expect(Math.abs(branchImpedance(eq, w(srf)).im)).toBeLessThan(1e-9);
    expect(branchImpedance(eq, w(srf * 2)).im).toBeGreaterThan(0);
    // The ESL is in series with the capacitor: a series part is a through at its SRF.
    const ladder: Ladder = { z0: 50, frequency: srf, load: complex(50, 0), elements: [eq] };
    const r = evaluateLadder(ladder);
    // Only the pads remain: 15 fF to ground at each end is about -j0.6 ohm each at 2.5 GHz.
    expect(Math.abs(r.zin.re - 50)).toBeLessThan(0.2);
    expect(Math.abs(r.zin.im)).toBeLessThan(2);
    // Without the package the ideal capacitor is still a capacitor there.
    const ideal = evaluateLadder({ ...ladder, elements: [c0402] });
    expect(ideal.zin.im).toBeLessThan(-5);
  });

  it('a 10 nH 0603 inductor has L || Cp with ESR: resonant at about 4.6 GHz, ESR at low frequency', () => {
    const srf = packageSelfResonance(l0603, pkg0603)!;
    expect(srf / 1e9).toBeCloseTo(4.594, 2);
    const eq = packageEquivalent(l0603, pkg0603);
    expect(eq.parasitics).toEqual({ cp: pkg0603.cp, esr: pkg0603.esr, pad: pkg0603.pad });
    const low = branchImpedance(eq, 2 * Math.PI * 1e6);
    expect(low.re).toBeCloseTo(pkg0603.esr, 4);
    expect(low.im).toBeCloseTo(2 * Math.PI * 1e6 * 10e-9, 6);
    const at = branchImpedance(eq, 2 * Math.PI * srf);
    // A parallel resonance: large and (almost) real.
    expect(Math.abs(at.im) / at.re).toBeLessThan(1e-3);
    expect(at.re).toBeGreaterThan(1e4);
    // Above the SRF the branch looks capacitive.
    expect(branchImpedance(eq, 2 * Math.PI * srf * 2).im).toBeLessThan(0);
  });

  it('the loss from Q still applies on top of the parasitics', () => {
    const withQ = packageEquivalent({ ...c0402, q: 100 }, pkg0402);
    const w = 2 * Math.PI * 1e9;
    const z = branchImpedance(withQ, w);
    expect(z.re).toBeCloseTo(1 / (w * 10e-12 * 100), 9);
    expect(z.im).toBeCloseTo(-1 / (w * 10e-12) + w * 0.4e-9, 9);
  });

  it('pad capacitance: half to ground at each end of a series part, half in parallel with a shunt part', () => {
    const f = 1e9;
    const w = 2 * Math.PI * f;
    const eqC = packageEquivalent(c0402, pkg0402);
    const half = shuntAbcd(complex(0, (w * pkg0402.pad) / 2));
    const expected = cascade(half, cascade(seriesAbcd(branchImpedance(eqC, w)), half));
    const got = elementAbcd(eqC, f);
    for (const k of ['a', 'b', 'c', 'd'] as const) {
      expect(cclose(got[k], expected[k], 1e-12)).toBe(true);
    }
    const eqL = packageEquivalent(l0603, pkg0603);
    const gotL = elementAbcd(eqL, f);
    const y = cadd(cinv(branchImpedance(eqL, w)), complex(0, (w * pkg0603.pad) / 2));
    expect(cclose(gotL.c, y, 1e-15)).toBe(true);
    expect(cclose(gotL.b, complex(0, 0), 1e-15)).toBe(true);
  });

  it('a series part with pads walks pad, branch, pad and ends at applyElement', () => {
    const z = complex(30, -40);
    const f = 1e9;
    const eq = packageEquivalent(c0402, pkg0402);
    const arc = elementArc(eq, z, f, 8);
    expect(arc).toHaveLength(3 * 8 + 1);
    expect(cclose(arc[0]!, z, 1e-12)).toBe(true);
    expect(cclose(arc[arc.length - 1]!, applyElement(eq, z, f), 1e-9)).toBe(true);
    // Without a package the arc is the plain nine-point segment it always was.
    expect(elementArc(c0402, z, f, 8)).toHaveLength(9);
    const shunt = elementArc(packageEquivalent(l0603, pkg0603), z, f, 8);
    expect(shunt).toHaveLength(9);
    expect(cclose(shunt[8]!, applyElement(packageEquivalent(l0603, pkg0603), z, f), 1e-9)).toBe(
      true,
    );
  });

  it('withPackages resolves packaged parts and returns every other element unchanged', () => {
    const line: Element = { kind: 'line', z0: 50, length: 0.1 };
    const plain: Element = { kind: 'C', orientation: 'shunt', value: 1e-12 };
    const unknown = {
      kind: 'L',
      orientation: 'series',
      value: 1e-9,
      package: 'bogus',
    } as unknown as Element;
    const out = withPackages([line, plain, c0402, l0603, unknown], DEFAULT_PACKAGES);
    expect(out[0]).toBe(line);
    expect(out[1]).toBe(plain);
    expect(out[2]).toEqual(packageEquivalent(c0402, pkg0402));
    expect(out[3]).toEqual(packageEquivalent(l0603, pkg0603));
    expect(out[4]).toBe(unknown);
    expect(hasPackages([line, plain])).toBe(false);
    expect(hasPackages([line, c0402])).toBe(true);
    // An all-zero row gives the element back without parasitics.
    const zero = { ...pkg0402, esl: 0, cp: 0, esr: 0, pad: 0 };
    expect(packageEquivalent(c0402, zero)).toEqual(c0402);
    expect(packageSelfResonance(c0402, zero)).toBeNull();
  });
});

describe('files with and without the package field', () => {
  const f = 450e6;
  const packaged: Ladder = {
    z0: 50,
    frequency: f,
    load: complex(20, -12),
    elements: [
      { kind: 'L', orientation: 'shunt', value: 16e-9, package: '0603', q: 40 },
      { kind: 'C', orientation: 'series', value: 22e-12, package: '0402' },
      { kind: 'L', orientation: 'shunt', value: 22e-9 },
    ],
  };
  const stripped: Ladder = {
    ...packaged,
    elements: packaged.elements.map((el) => {
      const { package: _p, ...rest } = el as Element & { package?: string };
      void _p;
      return rest as Element;
    }),
  };

  it('.xmlsc keeps the values and drops the package, like Q, and reads back the same with or without it', () => {
    const guid = () => '00000000-0000-0000-0000-000000000000';
    const withField = writeXmlsc(buildXmlsc(packaged, { guid }));
    const without = writeXmlsc(buildXmlsc(stripped, { guid }));
    expect(withField).toBe(without);
    const back = ladderFromXmlsc(readXmlsc(withField));
    expect(back.elements).toEqual([
      { kind: 'L', orientation: 'shunt', value: 16e-9 },
      { kind: 'C', orientation: 'series', value: 22e-12 },
      { kind: 'L', orientation: 'shunt', value: 22e-9 },
    ]);
  });

  it('netlist, SPICE and LTspice writers ignore the field', () => {
    expect(writeNetlist(packaged, { name: 'p' })).toBe(writeNetlist(stripped, { name: 'p' }));
    expect(writeSpice(packaged)).toBe(writeSpice(stripped));
    expect(writeLtspice(packaged)).toBe(writeLtspice(stripped));
  });

  it('the BOM names the package and adds the column only when a part has one', () => {
    const options = { source: { kind: 'series', series: 'E24' }, scope: 'all' } as const;
    const rows = bomRows(realizeLadder(packaged, options));
    expect(rows.map((r) => r.pkg)).toEqual(['0603', '0402', undefined]);
    const csv = bomCsv(rows).split('\n');
    expect(csv[0]).toBe(
      'Position;Element;Part;Ideal;Realized;Unit;Series;Deviation[%];Detuning[%];Locked;Package;Manufacturer;Part number',
    );
    expect(csv[1]).toMatch(/^1;Shunt L;L;16n;16n;H;E24;0.00;;;0603;;$/);
    expect(csv[3]).toMatch(/;;;$/);
    const plain = bomCsv(bomRows(realizeLadder(stripped, options))).split('\n');
    expect(plain[0]).toBe(
      'Position;Element;Part;Ideal;Realized;Unit;Series;Deviation[%];Detuning[%];Locked;Manufacturer;Part number',
    );
  });
});
