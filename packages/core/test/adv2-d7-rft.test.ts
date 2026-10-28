/**
 * QA round 2 on D7, adversarial. A failing expectation is a kept defect; a
 * passing one an attack the code survived.
 */
import { describe, expect, it } from 'vitest';
import {
  cdiv,
  complex,
  hurwitzFactor,
  ladderBelevitch,
  realFrequencyMatch,
  rftBandLimit,
  sweepPoints,
  vswrOfGain,
  worstVswr,
  type LoadModel,
  type NormalizedPart,
  type RftResult,
} from '../src/index.js';

const w = (f: number) => 2 * Math.PI * f;

describe('D7 round 2: more parts never worse, and the chain is honest', () => {
  const LOADS: {
    name: string;
    load: LoadModel;
    band: [number, number];
    z0: number;
    wz0?: number;
  }[] = [
    {
      name: 'RC 50 || 5 pF',
      load: (f) => cdiv(complex(1, 0), complex(1 / 50, w(f) * 5e-12)),
      band: [0.6e9, 1e9],
      z0: 50,
    },
    {
      name: 'RLC 10, 100 nH, 20 pF',
      load: (f) => complex(10, w(f) * 100e-9 - 1 / (w(f) * 20e-12)),
      band: [80e6, 150e6],
      z0: 50,
    },
    { name: 'RL at 75 ohm', load: (f) => complex(5, w(f) * 300e-9), band: [100e6, 140e6], z0: 75 },
    {
      name: 'RC, r0 100, window 50',
      load: (f) => cdiv(complex(1, 0), complex(1 / 200, w(f) * 3e-12)),
      band: [0.4e9, 0.8e9],
      z0: 100,
      wz0: 50,
    },
  ];
  for (const L of LOADS) {
    it(`${L.name}: 1 to 4 parts monotone, figures recompute, no shape under a shown limit`, () => {
      const fs = sweepPoints(L.band[0], L.band[1], 33);
      const r = realFrequencyMatch(fs, {
        load: L.load,
        z0: L.z0,
        parts: 4,
        ...(L.wz0 ? { windowZ0: L.wz0 } : {}),
      });
      const chain: RftResult[] = [];
      for (let x: RftResult | null = r; x; x = x.lower) chain.unshift(x);
      let prev = Infinity;
      for (const x of chain) {
        const b = x.best!;
        expect(b.worstVswr).toBeLessThanOrEqual(prev * (1 + 1e-9));
        prev = b.worstVswr;
        const again = worstVswr(b.elements, L.load, L.z0, x.scoringFrequencies, complex(L.z0, 0));
        expect(Math.abs(again - b.worstVswr)).toBeLessThan(1e-9 * again);
        expect(Math.abs(vswrOfGain(Math.min(...b.ladderGain)) - b.worstVswr)).toBeLessThan(
          1e-6 * again,
        );
        expect(b.outsideWindow).toBe(0);
        const lim = rftBandLimit(x, L.load);
        if (lim.floor) expect(b.shapeVswr).toBeGreaterThanOrEqual(lim.floor.floor * (1 - 1e-6));
      }
    }, 300000);
  }
});

describe('D7 round 2: hurwitzFactor on valid ladders', () => {
  // A non-degenerate degree 6 bandpass ladder (k = 4, values inside 0.04 to 25, g(0) and g_6
  // both well away from zero): its g exists and is known exactly.
  const LADDER: NormalizedPart[] = [
    { orientation: 'series', kind: 'C', value: 1.285245203719363 },
    { orientation: 'shunt', kind: 'L', value: 0.997518786246949 },
    { orientation: 'series', kind: 'C', value: 1.065611572610234 },
    { orientation: 'shunt', kind: 'C', value: 4.689528505760102 },
    { orientation: 'series', kind: 'L', value: 11.45387233262873 },
    { orientation: 'shunt', kind: 'L', value: 0.04295537252419905 },
  ];

  it('returns the g of a valid degree 6 ladder, not null', () => {
    // Clears the warm roots the way every run does.
    realFrequencyMatch([1, 2], {
      load: complex(50, 0),
      z0: 50,
      parts: 1,
      starts: 1,
      polish: false,
    });
    const b = ladderBelevitch(LADDER);
    const g = hurwitzFactor(b.h, b.k);
    // Observed: null (the cold Aberth iteration does not converge in 500 steps).
    expect(g).not.toBeNull();
    const scale = Math.max(...b.g.map(Math.abs));
    for (let i = 0; i < b.g.length; i++)
      expect(Math.abs(g![i]! - b.g[i]!)).toBeLessThan(1e-8 * scale);
  });

  it('the same h gives the same answer whatever was called before (interleaved)', () => {
    const b = ladderBelevitch(LADDER);
    const others = [
      [0, 1.3, 2.1, 0.7, 3.3, 1.1, 0.2],
      [0.5, 0.1, 9, 2, 40, 3, 0],
      [0, 0, 1, 1, 1, 1, 1],
    ];
    const answers = others.map((h) => {
      hurwitzFactor(h, 2);
      const g = hurwitzFactor(b.h, b.k);
      return g === null ? 'null' : g.map((v) => v.toPrecision(9)).join(',');
    });
    expect(new Set(answers).size).toBe(1);
  });
});
