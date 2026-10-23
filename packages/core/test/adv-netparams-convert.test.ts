/**
 * Adversarial tests, QA round 1: network parameter conversions, the converted
 * Touchstone export, the matching-network .s2p and the SPICE and LTspice
 * writers. Each test states the behaviour a user would expect; a failing
 * test is a defect, see the adversary report.
 */
import { describe, expect, it } from 'vitest';
import {
  abcdMatrixToS,
  abcdToS,
  cabs,
  complex,
  convertS,
  convertToS,
  csub,
  hToS,
  ladderAbcd,
  ladderSParameters,
  NetworkParameterError,
  polarDeg,
  readTouchstone,
  sToAbcd,
  sToH,
  sToY,
  sToZ,
  writeConvertedTouchstone,
  writeLadderS2p,
  writeLtspice,
  writeSpice,
  writeTouchstone,
  yToS,
  zToS,
  type Complex,
  type Ladder,
  type TouchstoneData,
} from '../src/index';

/** Deterministic pseudo-random values so a failure is reproducible. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function randomS(n: number, rand: () => number, mag = 0.9): Complex[] {
  return Array.from({ length: n * n }, () => polarDeg(mag * rand(), 360 * rand() - 180));
}

const maxErr = (a: readonly Complex[], b: readonly Complex[]): number =>
  Math.max(...a.map((c, i) => cabs(csub(c, b[i] as Complex))));

const twoPortData = (points: readonly { f: number; s: Complex[] }[], z0 = 50): TouchstoneData => ({
  ports: 2,
  parameter: 'S',
  format: 'RI',
  frequencyUnit: 'GHZ',
  z0,
  points: points.map((p) => ({ frequency: p.f, s: p.s })),
  noise: [],
  comments: [],
});

describe('adv: netparams round trips', () => {
  it('S -> Z -> S, S -> Y -> S for 1 to 4 ports over random matrices', () => {
    const rand = lcg(7);
    for (let n = 1; n <= 4; n++) {
      for (let k = 0; k < 50; k++) {
        const s = randomS(n, rand);
        expect(maxErr(zToS(sToZ(s)), s)).toBeLessThan(1e-9);
        expect(maxErr(yToS(sToY(s)), s)).toBeLessThan(1e-9);
      }
    }
  });

  it('S -> H -> S and S -> ABCD -> S for two-ports', () => {
    const rand = lcg(11);
    for (let k = 0; k < 200; k++) {
      const s = randomS(2, rand);
      expect(maxErr(hToS(sToH(s)), s)).toBeLessThan(1e-9);
      expect(maxErr(abcdToS(sToAbcd(s)), s)).toBeLessThan(1e-9);
    }
  });

  it('unnormalized convertS / convertToS are inverses for every kind and an odd Z0', () => {
    const rand = lcg(13);
    const s = randomS(2, rand);
    for (const kind of ['S', 'Z', 'Y', 'H', 'ABCD'] as const) {
      const m = convertS(s, kind, 75, false);
      expect(maxErr(convertToS(m, kind, 75, false), s)).toBeLessThan(1e-9);
    }
  });

  it('a one-port open (S = 1) has no Z matrix and says so; a short has no Y', () => {
    expect(() => sToZ([complex(1, 0)])).toThrow(NetworkParameterError);
    expect(() => sToY([complex(-1, 0)])).toThrow(NetworkParameterError);
  });

  it('a non-square list is refused, not read as a smaller matrix', () => {
    expect(() => sToZ([complex(0.1), complex(0.2), complex(0.3)])).toThrow(/square/);
    expect(() => sToZ([])).toThrow(NetworkParameterError);
  });

  it('S21 = 0 has no ABCD matrix (zero denominator), not Infinity', () => {
    const s = [complex(0.5, 0), complex(0, 0), complex(0, 0), complex(0.5, 0)];
    expect(() => sToAbcd(s)).toThrow(/S21/);
  });

  it('abcdMatrixToS of network-s2p agrees with netparams.abcdToS on the normalized matrix', () => {
    const ladder: Ladder = {
      z0: 75,
      frequency: 1e9,
      load: complex(20, 10),
      elements: [
        { kind: 'L', orientation: 'series', value: 5e-9 },
        { kind: 'C', orientation: 'shunt', value: 3e-12 },
        { kind: 'line', z0: 60, length: 0.13, refFrequency: 1e9 },
      ],
    };
    const m = ladderAbcd(ladder.elements, 1e9);
    const viaS2p = abcdMatrixToS(m, 75);
    const viaNet = abcdToS([
      m.a,
      complex(m.b.re / 75, m.b.im / 75),
      complex(m.c.re * 75, m.c.im * 75),
      m.d,
    ]);
    expect(maxErr([viaS2p.s11, viaS2p.s12, viaS2p.s21, viaS2p.s22], viaNet)).toBeLessThan(1e-12);
  });
});

describe('adv: converted Touchstone export', () => {
  const rand = lcg(17);
  const data = twoPortData([
    { f: 1e9, s: randomS(2, rand) },
    { f: 2e9, s: randomS(2, rand) },
    { f: 3e9, s: randomS(2, rand) },
  ]);

  it('Z and Y exports read back and convert to the original S within the written digits', () => {
    for (const kind of ['Z', 'Y', 'H'] as const) {
      const text = writeConvertedTouchstone(data, kind, { format: 'RI', digits: 12 });
      const back = readTouchstone(text, 2);
      expect(back.parameter).toBe(kind);
      expect(back.z0).toBe(50);
      back.points.forEach((p, i) => {
        const s = convertToS(p.s, kind, back.z0, true);
        expect(maxErr(s, data.points[i]!.s)).toBeLessThan(1e-9);
      });
    }
  });

  it('an ABCD export is refused by the reader (the writer says so), not read as S-parameters', () => {
    const text = writeConvertedTouchstone(data, 'ABCD', { format: 'RI' });
    expect(text).toMatch(/^# GHZ A RI R 50$/m);
    // The reader must either throw or at least not claim the file holds S-parameters.
    let parsed: TouchstoneData;
    try {
      parsed = readTouchstone(text, 2);
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      return;
    }
    expect(parsed.parameter).not.toBe('S');
  });

  it('an unnormalized Z export is self-describing: R 1 and ohm values', () => {
    const text = writeConvertedTouchstone(data, 'Z', {
      normalized: false,
      format: 'RI',
      digits: 12,
    });
    const back = readTouchstone(text, 2);
    expect(back.z0).toBe(1);
    const zOhm = convertS(data.points[0]!.s, 'Z', 50, false);
    expect(maxErr(back.points[0]!.s, zOhm)).toBeLessThan(1e-6);
  });

  it('the noise block survives an S export in another format but not a Z export', () => {
    const withNoise: TouchstoneData = {
      ...data,
      noise: [{ frequency: 1e9, nfMinDb: 1.2, gammaOpt: polarDeg(0.4, 30), rn: 0.3 }],
    };
    const s = readTouchstone(writeConvertedTouchstone(withNoise, 'S', { format: 'DB' }), 2);
    expect(s.noise).toHaveLength(1);
    expect(cabs(s.noise[0]!.gammaOpt)).toBeCloseTo(0.4, 6);
    const z = readTouchstone(writeConvertedTouchstone(withNoise, 'Z'), 2);
    expect(z.noise).toHaveLength(0);
  });

  it('frequencies 100 Hz apart at 10 GHz keep distinct in the exported file', () => {
    // A narrow resonator sweep: 201 points over 20 kHz at 10 GHz is 100 Hz per step.
    const narrow = twoPortData([
      { f: 10.0000001e9, s: randomS(2, rand) },
      { f: 10.0000002e9, s: randomS(2, rand) },
      { f: 10.0000003e9, s: randomS(2, rand) },
    ]);
    const text = writeConvertedTouchstone(narrow, 'S');
    const back = readTouchstone(text, 2);
    const fs = back.points.map((p) => p.frequency);
    expect(new Set(fs).size).toBe(3);
  });

  it('a point at which the conversion fails names the frequency', () => {
    const open = twoPortData([
      { f: 1e9, s: [complex(1, 0), complex(0, 0), complex(0, 0), complex(1, 0)] },
    ]);
    expect(() => writeConvertedTouchstone(open, 'Z')).toThrow(/1000000000 Hz/);
  });

  it('a three-port cannot be exported as H or ABCD, and says why', () => {
    const three: TouchstoneData = {
      ...data,
      ports: 3,
      points: [{ frequency: 1e9, s: randomS(3, rand) }],
    };
    expect(() => writeConvertedTouchstone(three, 'H')).toThrow(/two-ports only/);
    expect(() => writeConvertedTouchstone(three, 'ABCD')).toThrow(/two-ports only/);
    // Z works and reads back as a three-port.
    const back = readTouchstone(
      writeConvertedTouchstone(three, 'Z', { format: 'RI', digits: 12 }),
      3,
    );
    expect(back.ports).toBe(3);
    expect(maxErr(convertToS(back.points[0]!.s, 'Z', 50), three.points[0]!.s)).toBeLessThan(1e-9);
  });
});

describe('adv: matching network .s2p', () => {
  const ladder: Ladder = {
    z0: 50,
    frequency: 1e9,
    load: complex(20, -12),
    elements: [
      { kind: 'L', orientation: 'shunt', value: 8e-9 },
      { kind: 'C', orientation: 'series', value: 3e-12 },
    ],
  };

  it('an empty ladder is a through: S21 = 1, S11 = 0, and the file reads back', () => {
    const text = writeLadderS2p({ ...ladder, elements: [] }, [1e9, 2e9]);
    const back = readTouchstone(text, 2);
    expect(back.points).toHaveLength(2);
    expect(cabs(back.points[0]!.s[0]!)).toBe(0);
    expect(cabs(back.points[0]!.s[2]!)).toBeCloseTo(1, 12);
  });

  it('the written S21 matches ladderSParameters and the file reads back to it', () => {
    const fs = [0.5e9, 1e9, 1.5e9];
    const back = readTouchstone(writeLadderS2p(ladder, fs), 2);
    fs.forEach((f, i) => {
      const s = ladderSParameters(ladder, f);
      expect(cabs(csub(back.points[i]!.s[2]!, s.s21))).toBeLessThan(1e-8);
      expect(cabs(csub(back.points[i]!.s[1]!, s.s12))).toBeLessThan(1e-8);
    });
  });

  it('a zero-length shorted stub and an open stub at a quarter wave write finite numbers', () => {
    const stubs: Ladder = {
      ...ladder,
      elements: [
        { kind: 'shortStub', z0: 50, length: 0, refFrequency: 1e9 },
        { kind: 'openStub', z0: 50, length: 0.25, refFrequency: 1e9 },
      ],
    };
    const text = writeLadderS2p(stubs, [1e9]);
    expect(text).not.toMatch(/NaN|Infinity/);
    expect(() => readTouchstone(text, 2)).not.toThrow();
  });

  it('a design name with a line break cannot inject data rows into the file', () => {
    const text = writeLadderS2p(ladder, [1e9], { name: 'evil\n1 0 0 1 0 1 0 0 0' });
    const back = readTouchstone(text, 2);
    expect(back.points).toHaveLength(1);
  });

  it('descending frequencies are kept as given and the reader refuses the result', () => {
    // writeLadderS2p promises "any order is kept"; the reader then refuses it. Either the
    // writer should sort or the caller must; here we only pin the current contract.
    const text = writeLadderS2p(ladder, [2e9, 1e9]);
    expect(() => readTouchstone(text, 2)).toThrow(/ascending/);
  });
});

describe('adv: SPICE and LTspice writers', () => {
  const base: Ladder = {
    z0: 50,
    frequency: 1e9,
    load: complex(20, -12),
    elements: [
      { kind: 'L', orientation: 'shunt', value: 8e-9, q: 50 },
      { kind: 'C', orientation: 'series', value: 3e-12, q: 500 },
    ],
  };

  it('a load with negative resistance is not silently written as 1 micro-ohm', () => {
    const neg: Ladder = { ...base, load: complex(-30, 10) };
    let text: string;
    try {
      text = writeSpice(neg);
    } catch (e) {
      expect((e as Error).message).toMatch(/negative|resist|load/i);
      return;
    }
    expect(text).toMatch(/^RLOAD n0 \S+ -30$/m);
  });

  it('a design name with a line break cannot inject a netlist line', () => {
    const text = writeSpice(base, { name: 'x\nR999 n0 0 1' });
    expect(text.split('\n').filter((l) => /^R999 /.test(l))).toHaveLength(0);
    const asc = writeLtspice(base, { name: 'x\r\nFLAG 0 0 evil' });
    expect(asc.split('\r\n').filter((l) => l === 'FLAG 0 0 evil')).toHaveLength(0);
  });

  it('values of 1e-30 and 1e30 and a 0 Hz-free sweep write plain SPICE numbers', () => {
    const wide: Ladder = {
      ...base,
      elements: [
        { kind: 'C', orientation: 'series', value: 1e-30 },
        { kind: 'L', orientation: 'shunt', value: 1e30 },
      ],
    };
    const text = writeSpice(wide);
    expect(text).toMatch(/^C1 \S+ \S+ 1e-30$/m);
    expect(text).toMatch(/^L2 \S+ \S+ 1e\+30$/m);
    expect(text).not.toMatch(/NaN|Infinity/);
  });

  it('a zero-valued part is refused with a message naming the element, not written as 0', () => {
    const zero: Ladder = { ...base, elements: [{ kind: 'C', orientation: 'series', value: 0 }] };
    expect(() => writeSpice(zero)).toThrow(/element 1/);
    expect(() => writeLtspice(zero)).toThrow(/element 1/);
  });

  it('LTspice refuses lines and the netlist models them; both name the alternative', () => {
    const line: Ladder = {
      ...base,
      elements: [{ kind: 'line', z0: 50, length: 0.125, refFrequency: 1e9, alphaDbPerM: 1 }],
    };
    expect(() => writeLtspice(line)).toThrow(/\.cir/);
    const text = writeSpice(line);
    expect(text).toMatch(/^T1 n0 0 n1 0 Z0=50 TD=1\.25e-10$/m);
    expect(text).toMatch(/attenuation is not modelled/);
  });

  it('the LTspice sheet never places two different symbols on the same pin coordinates', () => {
    const busy: Ladder = {
      ...base,
      elements: [
        { kind: 'RLC', orientation: 'shunt', connection: 'parallel', r: 100, l: 5e-9, c: 2e-12 },
        { kind: 'RLC', orientation: 'series', connection: 'parallel', r: 10, l: 1e-9, c: 1e-12 },
        { kind: 'C', orientation: 'shunt', value: 1e-12, q: 100 },
        { kind: 'L', orientation: 'series', value: 2e-9, q: 20 },
        { kind: 'R', orientation: 'shunt', value: 1e3 },
      ],
    };
    const asc = writeLtspice(busy);
    const origins = asc
      .split('\r\n')
      .filter((l) => l.startsWith('SYMBOL '))
      .map((l) => l.split(' ').slice(1, 4).join(' '));
    expect(new Set(origins).size).toBe(origins.length);
    const names = asc
      .split('\r\n')
      .filter((l) => l.startsWith('SYMATTR InstName '))
      .map((l) => l.slice('SYMATTR InstName '.length));
    expect(new Set(names).size).toBe(names.length);
  });

  it('the netlist node list is consistent: every node named in a part line appears on two lines or is ground', () => {
    const text = writeSpice(base);
    const counts = new Map<string, number>();
    for (const l of text.split('\n')) {
      const m = /^([RLCTV]\w*) (\S+) (\S+)/.exec(l);
      if (!m) continue;
      for (const n of [m[2]!, m[3]!]) counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    for (const [node, c] of counts) {
      if (node === '0') continue;
      expect(c, `node ${node}`).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('adv: Touchstone writer with awkward values', () => {
  it('a -0 reactance writes 0 and a DB export of a zero parameter writes -400 dB', () => {
    const text = writeTouchstone(
      {
        ports: 2,
        z0: 50,
        points: [
          { frequency: 1e9, s: [complex(0, -0), complex(0, 0), complex(1, 0), complex(-0, 0)] },
        ],
      },
      { format: 'DB' },
    );
    expect(text).not.toMatch(/-0\b/);
    expect(text).toMatch(/-400 /);
    expect(() => readTouchstone(text, 2)).not.toThrow();
  });
});
