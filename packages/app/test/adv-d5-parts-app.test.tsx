// @vitest-environment jsdom
/**
 * Adversarial QA, D5 round 1 in the app: share links and files with part
 * entries, the part library store, attach on the recipient's side, a part out
 * of range in the running app, the autosave cost of a large part. Each test
 * asserts the correct behaviour; a failure is a defect.
 */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  complex,
  libraryPartOf,
  logFrequencies,
  MAX_PART_POINTS,
  partDataFromCircuit,
  readPartFile,
  SYNTHETIC_PARTS,
  syntheticPart,
  withoutData,
  writeTouchstone,
  type Complex,
  type LibraryPart,
  type PartCircuit,
  type PartFixture,
} from '@smithonline/core';

vi.mock('uplot', () => {
  class FakePlot {
    static pxRatio = 1;
    over = document.createElement('div');
    cursor = {};
    setCursor(): void {}
    posToIdx(): number {
      return 0;
    }
    setData(): void {}
    setSize(): void {}
    redraw(): void {}
    destroy(): void {}
  }
  return { default: FakePlot };
});
vi.mock('uplot/dist/uPlot.min.css', () => ({}));

import { emptyDesign, identify, type Design } from '../src/lib/design';
import { attachLibraryData } from '../src/lib/parts';
import { memoryPartStore } from '../src/lib/partStore';
import { decodeDesign } from '../src/lib/share';
import { useDesignStore } from '../src/store/useDesignStore';
import { usePartLibrary } from '../src/store/usePartLibrary';
import { useShell } from '../src/store/useShell';
import { useHelp } from '../src/store/useHelp';
import { useBoard } from '../src/store/useBoard';

const D = () => useDesignStore.getState();
const synth = (name: string): LibraryPart => {
  const spec = SYNTHETIC_PARTS.find((p) => p.name === name);
  if (!spec) throw new Error(name);
  return syntheticPart(spec);
};
function fileOf(circuit: PartCircuit, fixture: PartFixture, freqs: readonly number[]): string {
  const data = partDataFromCircuit(circuit, fixture, freqs, 50);
  const points = data.f.map((frequency, k) => {
    const o = 8 * k;
    const c = (i: number): Complex => complex(data.s[o + i] as number, data.s[o + i + 1] as number);
    return { frequency, s: [c(0), c(2), c(4), c(6)] };
  });
  return writeTouchstone(
    { ports: 2, z0: 50, points },
    { format: 'RI', frequencyUnit: 'MHZ', digits: 12, comments: ['Manufacturer: Acme'] },
  );
}
function b64(json: unknown): string {
  return Buffer.from(JSON.stringify(json), 'utf8').toString('base64url');
}
function designWith(elements: Parameters<typeof identify>[0], patch: Partial<Design> = {}): Design {
  return { ...emptyDesign(), load: complex(10, 5), ...patch, elements: identify(elements) };
}

function stubs(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal('innerWidth', 1440);
  vi.stubGlobal('innerHeight', 900);
}

beforeEach(async () => {
  stubs();
  localStorage.clear();
  useBoard.getState().reset();
  useShell.setState({
    detent: 'half',
    held: null,
    holds: [],
    guideClosed: true,
    guideShown: false,
  });
  useHelp.getState().closeHelp();
  D().init({ ...emptyDesign(), load: { re: 25, im: 10 } });
  D().setView('chart');
  D().setMessage(null);
  usePartLibrary.setState({ parts: [], open: false });
  await usePartLibrary.getState().init(memoryPartStore());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderApp(): Promise<HTMLElement> {
  const { App } = await import('../src/App');
  return render(<App />).container;
}
function nanInDom(c: HTMLElement): string[] {
  const hits: string[] = [];
  const text = c.textContent ?? '';
  const m = /.{0,40}NaN.{0,20}/.exec(text);
  if (m) hits.push(`text: ${m[0]}`);
  c.querySelectorAll('*').forEach((el) => {
    for (const a of Array.from(el.attributes)) {
      if (/NaN/.test(a.value)) hits.push(`${el.tagName}[${a.name}]`);
    }
  });
  return [...new Set(hits)];
}

describe('a share link part meets a different library part under the same number', () => {
  it('a capacitor in the link is not replaced by an inductor of the same part number', () => {
    // Sender: "Acme X1" is a 10 pF capacitor. Recipient: their "Acme X1" file is a 10 nH inductor.
    const cap = {
      ...withoutData(synth('SYNTH-C0402-10P')),
      manufacturer: 'Acme',
      partNumber: 'X1',
    };
    const ind = { ...synth('SYNTH-L0402-10N'), manufacturer: 'Acme', partNumber: 'X1' };
    const els = identify([{ kind: 'part', orientation: 'shunt', part: cap }]);
    const out = attachLibraryData(els, [ind]);
    const el = out?.[0] ?? els[0];
    expect(el?.kind === 'part' ? el.part.type : null).toBe('C');
  });
  it('a 10 pF link part is not silently swapped for 2.2 pF data of the same number', () => {
    const c10 = {
      ...withoutData(synth('SYNTH-C0402-10P')),
      manufacturer: 'Acme',
      partNumber: 'X1',
    };
    const c22 = { ...synth('SYNTH-C0402-2P2'), manufacturer: 'Acme', partNumber: 'X1' };
    const els = identify([{ kind: 'part', orientation: 'shunt', part: c10 }]);
    const out = attachLibraryData(els, [c22]);
    // Either refuse, or at least the fitted circuit the link carried must agree with the data.
    const el = out?.[0] ?? els[0];
    const c = el?.kind === 'part' && el.part.circuit.type === 'C' ? el.part.circuit.c : 0;
    expect(c).toBeCloseTo(10e-12, 13);
  });
});

describe('share links and files with hostile part entries', () => {
  const base = {
    v: 1,
    name: 'x',
    z0: 50,
    frequency: 1e9,
    load: { re: 25, im: 10 },
  };
  const C = { type: 'C', c: 1e-11, esl: 0, esr: 0 };
  const P = { manufacturer: 'm', partNumber: 'p', type: 'C', range: [1e6, 1e10], circuit: C };
  const cases: [string, unknown][] = [
    ['part null', { kind: 'part', orientation: 'series', part: null }],
    ['part array', { kind: 'part', orientation: 'series', part: [] }],
    [
      'circuit zero C',
      { kind: 'part', orientation: 'series', part: { ...P, circuit: { ...C, c: 0 } } },
    ],
    [
      'circuit negative ESR',
      { kind: 'part', orientation: 'series', part: { ...P, circuit: { ...C, esr: -1 } } },
    ],
    ['range NaN', { kind: 'part', orientation: 'series', part: { ...P, range: [null, 1e9] } }],
    ['type R', { kind: 'part', orientation: 'series', part: { ...P, type: 'R' } }],
    ['type mismatch', { kind: 'part', orientation: 'series', part: { ...P, type: 'L' } }],
    [
      'data huge f',
      {
        kind: 'part',
        orientation: 'series',
        part: {
          ...P,
          data: {
            z0: 50,
            fixture: 'series',
            f: new Array(MAX_PART_POINTS + 1).fill(0).map((_, i) => i + 1),
            s: new Array(8 * (MAX_PART_POINTS + 1)).fill(0),
          },
        },
      },
    ],
  ];
  for (const [name, el] of cases) {
    it(`"${name}" is refused (null), never thrown and never NaN`, () => {
      expect(decodeDesign(b64({ ...base, elements: [el] }))).toBeNull();
    });
  }
  it('prototype keys inside a part element do not pollute Object.prototype', () => {
    const text =
      '{"v":1,"z0":50,"frequency":1e9,"load":{"re":25,"im":10},"elements":[{"kind":"part","orientation":"series","__proto__":{"evil":1},"constructor":{"prototype":{"evil":1}},"part":{"manufacturer":"m","partNumber":"p","type":"C","range":[1e6,1e10],"circuit":{"type":"C","c":1e-11,"esl":0,"esr":0},"__proto__":{"evil":1}}}]}';
    const d = decodeDesign(Buffer.from(text, 'utf8').toString('base64url'));
    expect(({} as Record<string, unknown>).evil).toBeUndefined();
    expect(d === null || d.elements[0]?.kind === 'part').toBe(true);
  });
});

describe('the running app with a part out of its range', () => {
  it('a design frequency above the part data neither blanks the app nor shows NaN', async () => {
    D().loadDesign(
      designWith([{ kind: 'part', orientation: 'series', part: synth('SYNTH-C0402-10P') }], {
        frequency: 1e9,
      }),
      'x',
    );
    const c = await renderApp();
    act(() => D().setFrequency(20e9));
    expect(c.textContent?.length ?? 0).toBeGreaterThan(100);
    expect(nanInDom(c)).toEqual([]);
    expect(Number.isFinite(D().design.frequency)).toBe(true);
  });
  it('a sweep reaching past the part data shows no NaN', async () => {
    D().loadDesign(
      designWith([{ kind: 'part', orientation: 'shunt', part: synth('SYNTH-L0402-10N') }], {
        frequency: 1e9,
        sweep: { ...emptyDesign().sweep, enabled: true, start: 1e6, stop: 20e9, points: 41 },
      }),
      'x',
    );
    const c = await renderApp();
    expect(nanInDom(c)).toEqual([]);
  });
  it('undo after the library attached data to a link part does not lose the data permanently', async () => {
    const p = synth('SYNTH-C0402-10P');
    await usePartLibrary.getState().addParts([{ part: p, fileName: 'x.s2p' }]);
    D().loadDesign(
      designWith([{ kind: 'part', orientation: 'series', part: withoutData(p) }]),
      'link',
    );
    await renderApp();
    const el0 = D().design.elements[0];
    expect(el0?.kind === 'part' && el0.part.data !== undefined).toBe(true);
    act(() => D().setFrequency(2e9));
    act(() => D().undo());
    const el1 = D().design.elements[0];
    expect(el1?.kind === 'part' && el1.part.data !== undefined).toBe(true);
  });
  it('removing from the library a part the design uses keeps the design evaluable', async () => {
    const p = synth('SYNTH-C0402-10P');
    await usePartLibrary.getState().addParts([{ part: p, fileName: 'x.s2p' }]);
    D().loadDesign(designWith([{ kind: 'part', orientation: 'series', part: p }]), 'x');
    const c = await renderApp();
    await act(async () => {
      await usePartLibrary.getState().remove(usePartLibrary.getState().parts[0]!.key);
    });
    const el = D().design.elements[0];
    expect(el?.kind === 'part' && el.part.data !== undefined).toBe(true);
    expect(nanInDom(c)).toEqual([]);
  });
});

describe('the part library store', () => {
  it('setFixture on a part whose data cannot be read the other way keeps the part', async () => {
    const p = synth('SYNTH-C0402-10P');
    await usePartLibrary.getState().addParts([{ part: p, fileName: 'x.s2p' }]);
    const key = usePartLibrary.getState().parts[0]!.key;
    const problem = await usePartLibrary.getState().setFixture(key, 'shunt');
    expect(usePartLibrary.getState().parts).toHaveLength(1);
    const kept = usePartLibrary.getState().parts[0]!.part;
    if (problem) expect(kept.data?.fixture).toBe('series');
  });
  it('rename refuses a part number of control characters only', async () => {
    const p = synth('SYNTH-C0402-10P');
    await usePartLibrary.getState().addParts([{ part: p, fileName: 'x.s2p' }]);
    const key = usePartLibrary.getState().parts[0]!.key;
    const r = await usePartLibrary
      .getState()
      .rename(key, { manufacturer: 'x', partNumber: '\u0000\u0007 ' });
    expect(r).not.toBeNull();
  });
  it('loading 600 files reports the cap without parsing the files past it slowly', async () => {
    const text = fileOf(
      { type: 'C', c: 10e-12, esl: 0.38e-9, esr: 0.2 },
      'series',
      logFrequencies(1e6, 6e9, 1601),
    );
    const files = Array.from({ length: 600 }, (_, i) => ({ name: `P${i}.s2p`, text }));
    const t0 = performance.now();
    const report = await usePartLibrary.getState().addFiles(files);
    const dt = performance.now() - t0;
    console.log('600 files ms', dt, 'added', report.added.length, 'failed', report.failed.length);
    expect(report.added.length).toBe(500);
    expect(report.failed.length).toBe(100);
  }, 120000);
});

describe('autosave with a large part', () => {
  it('serializing a design with a 20 001 point part for the autosave takes under 50 ms', () => {
    const text = fileOf(
      { type: 'C', c: 10e-12, esl: 0.38e-9, esr: 0.2 },
      'series',
      logFrequencies(1e6, 10e9, MAX_PART_POINTS),
    );
    const p = readPartFile(text, 'BIG.s2p').part;
    const d = designWith([{ kind: 'part', orientation: 'series', part: p }]);
    const t0 = performance.now();
    const json = JSON.stringify(d);
    const dt = performance.now() - t0;
    console.log('stringify ms', dt, 'chars', json.length);
    expect(libraryPartOf(JSON.parse(json).elements[0].part)).not.toBeNull();
    expect(dt).toBeLessThan(50);
  }, 60000);
});
