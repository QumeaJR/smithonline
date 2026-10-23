/** QA round 3: round 2 fixes under hostile inputs, one level deeper. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { complex, readTouchstone, type Element, type SweepLoad } from '@smithonline/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { lSolutions, negligibleEffect } from '../src/lib/match';
import { designSweep, designToXmlsc } from '../src/lib/files';
import { designFromXmlsc, emptyDesign, identify, type Design } from '../src/lib/design';
import { decodeDesign, encodeDesign } from '../src/lib/share';
import { userDatapoints } from '../src/lib/datapoints';
import { useDesignStore } from '../src/store/useDesignStore';

const dp = (f: number, r: number, x: number): SweepLoad => ({ frequency: f, z: complex(r, x) });
const vals = (s: { elements: readonly Element[] }[]): string[] =>
  s.map((x) =>
    JSON.stringify(
      x.elements.map((e) => {
        const o = e as { value?: number; n?: number; length?: number; kind: string };
        return [o.kind, o.value ?? o.n ?? o.length];
      }),
    ),
  );
const finiteValues = (s: { elements: readonly Element[] }[]): boolean =>
  s.every((x) =>
    x.elements.every((e) => {
      const o = e as { value?: number; n?: number; length?: number };
      return Number.isFinite(o.value ?? o.n ?? o.length ?? 0);
    }),
  );

describe('adv r3: negligibleEffect and the solvers', () => {
  it('first part no-op, second part matches: rejected (documented)', () => {
    const els: Element[] = [
      { kind: 'transformer', n: 1 },
      { kind: 'L', orientation: 'series', value: 8e-9 },
    ];
    expect(negligibleEffect(els, complex(50, 0), 50, 1e9)).toBe(true);
  });
  it('f = 0: solutions offered must hold finite values', () => {
    const s = lSolutions(complex(25, 0), complex(50, 0), 50, 0);
    console.log('f=0 L:', vals(s));
    expect(finiteValues(s)).toBe(true);
  });
  it('start impedance 0 (short): finite element values', () => {
    const s = lSolutions(complex(0, 0), complex(50, 0), 50, 1e9);
    console.log('short start:', vals(s));
    expect(finiteValues(s)).toBe(true);
  });
  it('start impedance open (Infinity): no throw, finite element values', () => {
    const s = lSolutions(complex(Infinity, 0), complex(50, 0), 50, 1e9);
    console.log('open start:', vals(s));
    expect(finiteValues(s)).toBe(true);
  });
  it('negligibleEffect with f = 0 and NaN: observe', () => {
    const els: Element[] = [{ kind: 'L', orientation: 'series', value: 8e-9 }];
    console.log(
      'f=0 ->',
      negligibleEffect(els, complex(50, 0), 50, 0),
      'f=NaN ->',
      negligibleEffect(els, complex(50, 0), 50, NaN),
      'start 0 ->',
      negligibleEffect(els, complex(0, 0), 50, 1e9),
      'start open ->',
      negligibleEffect(els, complex(Infinity, 0), 50, 1e9),
    );
  });
});

const A = dp(1e9, 20, 10);
const B = dp(2e9, 30, -5);
const base = (): Design => ({
  ...emptyDesign(),
  elements: identify([{ kind: 'L', orientation: 'series', value: 5e-9 }]),
});
const noGuid = (t: string): string => t.replace(/<GUID>[^<]*<\/GUID>/g, '');

describe('adv r3: files.ts startRow', () => {
  it('two loads equal the start: round trip keeps the point list and the start', () => {
    const d: Design = {
      ...base(),
      frequency: A.frequency,
      load: A.z,
      sweep: { enabled: true, start: 1e9, stop: 2e9, points: 11, loads: [A, A, B], loadsName: 'f' },
    };
    const r = designFromXmlsc(designToXmlsc(d), 'f');
    console.log(
      'dup start: users',
      JSON.stringify(userDatapoints(r)),
      'loads',
      JSON.stringify(r.sweep.loads),
      'sweep',
      designSweep(r)?.length,
    );
    expect(r.frequency).toBe(A.frequency);
    expect(r.load).toEqual(A.z);
    expect(designSweep(r)?.length).toBe(3);
    expect(noGuid(designToXmlsc(designFromXmlsc(designToXmlsc(r), 'f')))).toBe(
      noGuid(designToXmlsc(r)),
    );
  });
});

describe('adv r3: share caps', () => {
  const enc = (raw: Record<string, unknown>) =>
    decodeDesign(
      Buffer.from(JSON.stringify(raw))
        .toString('base64')
        .replace(/[+]/g, '-')
        .replace(/[/]/g, '_')
        .replace(/=+$/, ''),
    );
  const loads = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ frequency: 1e9 + i, z: { re: 50, im: 0 } }));
  it('2001 loads kept, 2002 capped to 2001', () => {
    expect(enc({ elements: [], sweep: { loads: loads(2001) } })?.sweep.loads?.length).toBe(2001);
    expect(enc({ elements: [], sweep: { loads: loads(2002) } })?.sweep.loads?.length).toBe(2001);
  });
  it('loadsName 200 kept, 201 cut to 200', () => {
    expect(
      enc({ elements: [], sweep: { loads: loads(1), loadsName: 'x'.repeat(200) } })?.sweep.loadsName
        ?.length,
    ).toBe(200);
    expect(
      enc({ elements: [], sweep: { loads: loads(1), loadsName: 'x'.repeat(201) } })?.sweep.loadsName
        ?.length,
    ).toBe(200);
  });
  it('round trip of a design with 2001 loads encodes and decodes', () => {
    const d: Design = {
      ...base(),
      sweep: {
        enabled: true,
        start: 1e9,
        stop: 2e9,
        points: 11,
        loads: loads(2001),
        loadsName: 'f',
      },
    };
    expect(decodeDesign(encodeDesign(d))?.sweep.loads?.length).toBe(2001);
  });
});

const store = useDesignStore;
const amp = readTouchstone(
  readFileSync(
    join(__dirname, '..', '..', 'core', 'test', 'fixtures', 'sparams', 'amp-synthetic.s2p'),
    'utf8',
  ),
  2,
);
const fLo = amp.points[0]!.frequency;
const fHi = amp.points[amp.points.length - 1]!.frequency;

describe('adv r3: setDatapoint on the start', () => {
  beforeEach(() => {
    store.getState().init({ ...emptyDesign(), frequency: (fLo + fHi) / 2 });
    store.setState({ twoPortFiles: {}, message: null });
  });
  for (const f of [NaN, 0, -1e9, Infinity]) {
    it(`frequency ${f} is refused`, () => {
      const s = store.getState();
      s.importTwoPort(amp, 'amp.s2p');
      const before = store.getState().design.frequency;
      store.getState().setDatapoint(0, { frequency: f });
      const d = store.getState().design;
      console.log(
        `f=${f}: design.frequency`,
        d.frequency,
        'twoPort s11',
        JSON.stringify(d.twoPort?.s.s11),
        'source',
        JSON.stringify(d.twoPort?.source),
        'msg',
        store.getState().message,
      );
      expect(d.frequency).toBe(before);
    });
  }
  it('z NaN on the start: refused', () => {
    store.getState().setDatapoint(0, { z: complex(NaN, 0) });
    console.log('z NaN ->', JSON.stringify(store.getState().design.load));
    expect(Number.isFinite(store.getState().design.load.re)).toBe(true);
  });
});
