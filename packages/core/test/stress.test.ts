import { describe, expect, it } from 'vitest';
import {
  bomCsv,
  bomRows,
  complex,
  dbmToWatt,
  elementExceeds,
  evaluateLadder,
  ladderStress,
  lMatch,
  partExceeds,
  realizeLadder,
  wattToDbm,
  type ElementStress,
  type Ladder,
} from '../src/index';

const F = 100e6;
const W = 2 * Math.PI * F;

function stressOf(ladder: Ladder, p: number): ElementStress[] {
  return ladderStress(ladder, p).map((s) => {
    expect(s).not.toBeNull();
    return s as ElementStress;
  });
}

describe('power units', () => {
  it('converts dBm and watts both ways', () => {
    expect(dbmToWatt(30)).toBeCloseTo(1, 12);
    expect(dbmToWatt(0)).toBeCloseTo(1e-3, 15);
    expect(wattToDbm(1)).toBeCloseTo(30, 12);
    expect(wattToDbm(dbmToWatt(43))).toBeCloseTo(43, 9);
    expect(wattToDbm(0)).toBe(-Infinity);
  });
});

describe('ladderStress', () => {
  it('matches the textbook divider for a series resistor in a 50 ohm system', () => {
    // 1 W available: Vs = sqrt(8 * 50 * 1) = 20 V; R in series with a 50 ohm load: I = 20 / 150.
    const ladder: Ladder = {
      z0: 50,
      frequency: F,
      load: complex(50, 0),
      elements: [{ kind: 'R', orientation: 'series', value: 50 }],
    };
    const [r] = stressOf(ladder, 1);
    expect(r!.iRms).toBeCloseTo(20 / 150 / Math.SQRT2, 12);
    expect(r!.vPeak).toBeCloseTo((20 / 150) * 50, 12);
    expect(r!.parts).toEqual([{ part: 'R', vPeak: r!.vPeak, iRms: r!.iRms }]);
  });

  it('scales with the square root of the power', () => {
    const ladder: Ladder = {
      z0: 50,
      frequency: F,
      load: complex(50, 0),
      elements: [{ kind: 'R', orientation: 'series', value: 50 }],
    };
    const a = stressOf(ladder, 1)[0]!;
    const b = stressOf(ladder, 100)[0]!;
    expect(b.vPeak / a.vPeak).toBeCloseTo(10, 10);
    expect(b.iRms / a.iRms).toBeCloseTo(10, 10);
  });

  it('puts the load voltage across the shunt capacitor of an L match to a high load', () => {
    // A lossless match delivers all of P into the load: V_peak = sqrt(2 P R_load).
    const load = complex(200, 0);
    const sols = lMatch(load, complex(50, 0), F);
    const sol = sols.find(
      (s) => s.elements[0]?.kind === 'C' && s.elements[0].orientation === 'shunt',
    );
    expect(sol).toBeDefined();
    const ladder: Ladder = { z0: 50, frequency: F, load, elements: sol!.elements.slice() };
    const [c, l] = stressOf(ladder, 2);
    expect(c!.vPeak).toBeCloseTo(Math.sqrt(2 * 2 * 200), 6);
    const cap = sol!.elements[0] as { value: number };
    expect(c!.iRms).toBeCloseTo((c!.vPeak * W * cap.value) / Math.SQRT2, 6);
    // The series inductor carries the input current: P = I_rms^2 * 50 at the matched input.
    expect(l!.iRms).toBeCloseTo(Math.sqrt(2 / 50), 6);
  });

  it('conserves power: the load absorbs what the input takes, and a mismatch takes less', () => {
    const ladder: Ladder = {
      z0: 50,
      frequency: F,
      load: complex(30, 20),
      elements: [
        { kind: 'C', orientation: 'shunt', value: 20e-12 },
        { kind: 'L', orientation: 'series', value: 60e-9 },
      ],
    };
    const r = evaluateLadder(ladder);
    const gamma = r.info[r.info.length - 1]!.gammaMag;
    const [c, l] = stressOf(ladder, 4);
    // Current through the last (series) element is the source current: P_in = I^2 Re(Zin).
    const pIn = l!.iRms ** 2 * r.zin.re;
    expect(pIn).toBeCloseTo(4 * (1 - gamma * gamma), 9);
    // Lossless network: the same power in the load. I_load via the shunt C node voltage V.
    const vNode = c!.vPeak;
    const pLoad = (vNode ** 2 / 2) * (30 / (30 ** 2 + 20 ** 2));
    expect(pLoad).toBeCloseTo(pIn, 9);
  });

  it('gives each part of an RLC block the stress of its connection', () => {
    const series: Ladder = {
      z0: 50,
      frequency: F,
      load: complex(50, 0),
      elements: [
        { kind: 'RLC', orientation: 'shunt', connection: 'series', r: 10, l: 40e-9, c: 30e-12 },
      ],
    };
    const e = stressOf(series, 1)[0]!;
    const [pr, pl, pc] = e.parts;
    expect(e.parts.map((p) => p.part)).toEqual(['R', 'L', 'C']);
    // One current through all three; voltage per part is I times its impedance.
    for (const p of e.parts) expect(p.iRms).toBeCloseTo(e.iRms, 12);
    expect(pr!.vPeak).toBeCloseTo(e.iRms * Math.SQRT2 * 10, 9);
    expect(pl!.vPeak).toBeCloseTo(e.iRms * Math.SQRT2 * W * 40e-9, 9);
    expect(pc!.vPeak).toBeCloseTo((e.iRms * Math.SQRT2) / (W * 30e-12), 9);
    expect(e.vPeak).toBeLessThan(pl!.vPeak + pc!.vPeak);

    const parallel: Ladder = {
      ...series,
      elements: [
        { kind: 'RLC', orientation: 'series', connection: 'parallel', r: 100, l: 80e-9, c: 25e-12 },
      ],
    };
    const q = stressOf(parallel, 1)[0]!;
    for (const p of q.parts) expect(p.vPeak).toBeCloseTo(q.vPeak, 12);
    const cap = q.parts.find((p) => p.part === 'C')!;
    expect(cap.iRms).toBeCloseTo((q.vPeak * W * 25e-12) / Math.SQRT2, 9);
  });

  it('has no stress for lines, stubs and transformers, and zero for no power', () => {
    const ladder: Ladder = {
      z0: 50,
      frequency: F,
      load: complex(50, 0),
      elements: [
        { kind: 'line', z0: 50, length: 0.1 },
        { kind: 'openStub', z0: 50, length: 0.1 },
        { kind: 'transformer', n: 2 },
        { kind: 'L', orientation: 'series', value: 10e-9 },
      ],
    };
    const out = ladderStress(ladder, 1);
    expect(out.slice(0, 3)).toEqual([null, null, null]);
    expect(out[3]!.vPeak).toBeGreaterThan(0);
    for (const p of [0, -1, NaN, Infinity]) {
      expect(ladderStress(ladder, p)[3]).toMatchObject({ vPeak: 0, iRms: 0 });
    }
  });

  it('survives a load of zero and an empty ladder', () => {
    expect(ladderStress({ z0: 50, frequency: F, load: complex(0, 0), elements: [] }, 1)).toEqual(
      [],
    );
    const short: Ladder = {
      z0: 50,
      frequency: F,
      load: complex(0, 0),
      elements: [{ kind: 'L', orientation: 'series', value: 10e-9 }],
    };
    const s = stressOf(short, 1)[0]!;
    expect(Number.isFinite(s.vPeak) && Number.isFinite(s.iRms)).toBe(true);
  });
});

describe('limits', () => {
  const part = { part: 'C', vPeak: 300, iRms: 2 } as const;
  it('flags voltage and current above the limit of the part kind only', () => {
    expect(partExceeds(part, { C: { vPeak: 250 } })).toEqual({ voltage: true, current: false });
    expect(partExceeds(part, { C: { vPeak: 350, iRms: 1.5 } })).toEqual({
      voltage: false,
      current: true,
    });
    expect(partExceeds(part, { L: { vPeak: 1 } })).toEqual({ voltage: false, current: false });
    expect(partExceeds(part, { C: { vPeak: 300 } })).toEqual({ voltage: false, current: false });
    expect(partExceeds(part, { C: { vPeak: 0 } })).toEqual({ voltage: false, current: false });
  });

  it('flags an element when any part is over', () => {
    const e: ElementStress = {
      index: 0,
      vPeak: 10,
      iRms: 1,
      parts: [
        { part: 'R', vPeak: 10, iRms: 1 },
        { part: 'C', vPeak: 500, iRms: 1 },
      ],
    };
    expect(elementExceeds(e, { C: { vPeak: 400 } })).toEqual({ voltage: true, current: false });
    expect(elementExceeds(e, {})).toEqual({ voltage: false, current: false });
  });
});

describe('stress in the bill of materials', () => {
  const ladder: Ladder = {
    z0: 50,
    frequency: F,
    load: complex(200, 0),
    elements: lMatch(complex(200, 0), complex(50, 0), F)[0]!.elements.slice(),
  };
  const realization = realizeLadder(ladder, {
    source: { kind: 'series', series: 'E24' },
    scope: 'all',
  });
  const stress = ladderStress(realization.ladder, 10);

  it('adds voltage, current and the flag columns only when stress is given', () => {
    const plain = bomCsv(bomRows(realization));
    expect(plain).not.toContain('Peak voltage');
    const rows = bomRows(realization, undefined, {
      elements: stress,
      limits: { C: { vPeak: 10 } },
    });
    const csv = bomCsv(rows);
    const [header, ...lines] = csv.split('\n');
    expect(header).toContain('Peak voltage[V];RMS current[A];Over limit;Manufacturer');
    expect(lines).toHaveLength(rows.length);
    for (const l of lines) expect(l.split(';')).toHaveLength(header!.split(';').length);
  });

  it('flags only the parts above their kind limit', () => {
    const rows = bomRows(realization, undefined, {
      elements: stress,
      limits: { C: { vPeak: 10 }, L: { iRms: 1000 } },
    });
    const cap = rows.find((r) => r.part === 'C')!;
    const ind = rows.find((r) => r.part === 'L')!;
    expect(cap.vPeak).toBeGreaterThan(10);
    expect(cap.overLimit).toBe('V');
    expect(ind.overLimit).toBe('');
  });
});
