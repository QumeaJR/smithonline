/**
 * Adversary round 2, app: re-run of the round 1 attacks on the store, the
 * share codec and the app-side file helpers, then attacks on the fixes (the
 * file slot behind the device, isElement against designs the app itself
 * makes, the sweep flags through .xmlsc). A failing test is a defect; see
 * the report.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  complex,
  evaluateLadder,
  polarDeg,
  readTouchstone,
  tryParseEngineering,
} from '@smithonline/core';
import {
  DEFAULT_SWEEP,
  designFromXmlsc,
  emptyDesign,
  identify,
  type Design,
} from '../src/lib/design';
import { PALETTE } from '../src/lib/elements';
import { designSweep, designToAscii, designToXmlsc, ladderOf } from '../src/lib/files';
import { readImportFile, twoPortFromFile } from '../src/lib/import';
import { decodeDesign, encodeDesign } from '../src/lib/share';
import { useDesignStore } from '../src/store/useDesignStore';

const FIXTURES = join(__dirname, '..', '..', 'core', 'test', 'fixtures');
const fixture = (...parts: string[]): string => readFileSync(join(FIXTURES, ...parts), 'utf8');

const amp = readTouchstone(fixture('sparams', 'amp-synthetic.s2p'), 2);
/** The same file name with other data: a re-measured device exported under the old name. */
const ampV2 = {
  ...amp,
  points: amp.points.map((p) => ({
    ...p,
    s: p.s.map((c, i) => (i === 0 ? complex(c.re * 0.5, c.im * 0.5) : c)),
  })),
};
const other = readTouchstone(
  '# GHZ S MA R 50\n0.5 0.3 10 2.5 60 0.02 30 0.6 -20\n3 0.3 10 2.5 60 0.02 30 0.6 -20\n',
  2,
);
const store = useDesignStore;
const MANUAL = {
  s11: polarDeg(0.5, -120),
  s12: polarDeg(0.05, 50),
  s21: polarDeg(3, 80),
  s22: polarDeg(0.4, -40),
};
const dec = (json: string): Design | null => decodeDesign(btoa(json));
const roundTrip = (d: Design): Design | null => decodeDesign(encodeDesign(d));

beforeEach(() => {
  store.getState().init(emptyDesign());
  store.setState({ twoPortFiles: {}, selected: null, message: null });
});

describe('adv2: round 1 fixes confirmed', () => {
  it('undo of an import leaves no device, even after a frequency change', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp.s2p');
    s.undo();
    s.setFrequency(2e9);
    expect(store.getState().design.twoPort).toBeNull();
  });

  it('undo of a hand edit restores a device that follows f again', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp.s2p');
    s.setTwoPort({ s: MANUAL, noise: null });
    s.undo();
    s.setFrequency(2e9);
    expect(store.getState().design.twoPort?.source?.frequency).toBe(2e9);
  });

  it('a new or loaded design has no source', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp.s2p');
    s.newDesign();
    expect(store.getState().design.twoPort).toBeNull();
    s.setFrequency(2e9);
    expect(store.getState().design.twoPort).toBeNull();
  });

  it('setZ0 re-reads a file-bound device', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp.s2p');
    s.setZ0(75);
    expect(store.getState().design.twoPort?.s.s11).toEqual(
      twoPortFromFile(amp, 1e9, 'amp.s2p', 75)!.s.s11,
    );
  });

  it('Z, Y, G and H files are refused in the import', () => {
    for (const p of ['Z', 'Y', 'G', 'H']) {
      expect(() => readImportFile('x.s1p', `# MHZ ${p} RI R 50\n100 75 0\n`)).toThrow(
        /not supported/,
      );
    }
  });

  it('share links clamp sweep points and refuse bad f, Z0 and element fields', () => {
    expect(dec('{"elements":[],"sweep":{"points":1e9}}')!.sweep.points).toBe(2001);
    expect(dec('{"elements":[],"sweep":{"points":-5}}')!.sweep.points).toBe(2);
    expect(dec('{"elements":[],"frequency":-1,"z0":0}')).toMatchObject({ frequency: 1e9, z0: 50 });
    expect(dec('{"elements":[{"kind":"line","z0":0,"length":0.1}]}')).toBeNull();
    expect(dec('{"elements":[{"kind":"transformer","n":-1}]}')).toBeNull();
  });

  it('an empty load list is no datapoint sweep and designSweep returns null for it', () => {
    const d: Design = { ...emptyDesign(), sweep: { ...DEFAULT_SWEEP, enabled: true, loads: [] } };
    expect(designSweep(d)).toBeNull();
  });

  it('a disabled datapoint sweep is saved as plain datapoints and reopens disabled', () => {
    const d: Design = {
      ...emptyDesign(),
      sweep: {
        ...DEFAULT_SWEEP,
        enabled: false,
        loads: [
          { frequency: 2e9, z: complex(20, 10) },
          { frequency: 3e9, z: complex(30, 10) },
        ],
      },
    };
    const back = designFromXmlsc(designToXmlsc(d), 'x');
    expect(back.sweep.enabled).toBe(false);
    expect(back.sweep.loads).toHaveLength(3);
    expect(back.frequency).toBe(1e9);
    expect(back.load).toEqual(complex(50, 0));
    const on = designFromXmlsc(designToXmlsc({ ...d, sweep: { ...d.sweep, enabled: true } }), 'x');
    expect(on.sweep.enabled).toBe(true);
  });

  it('the ASCII export still lists the stability lines', () => {
    const d: Design = {
      ...emptyDesign(),
      twoPort: { s: MANUAL, noise: null },
      showStability: true,
    };
    const text = designToAscii(d, evaluateLadder(ladderOf(d)), null, 'semicolon');
    expect(text).toMatch(/S1;Input plane stability circle/);
    expect(text).toMatch(/S2;Output plane stability circle/);
  });
});

describe('adv2: the file slot behind the device', () => {
  it('importTwoPort, setZ0, undo, setFrequency: device at the undone Z0 and the new f', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp.s2p');
    s.setZ0(75);
    s.undo();
    s.setFrequency(2e9);
    const d = store.getState().design;
    expect(d.z0).toBe(50);
    expect(d.twoPort).toMatchObject(twoPortFromFile(amp, 2e9, 'amp.s2p', 50)!);
  });

  it('two files imported in a row, undo: the first device still follows f', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp.s2p');
    s.importTwoPort(other, 'other.s2p');
    s.undo();
    expect(store.getState().design.twoPort?.source?.fileName).toBe('amp.s2p');
    s.setFrequency(2e9);
    const tp = store.getState().design.twoPort!;
    // Either the device follows f from amp.s2p, or the source is dropped; a source
    // that names a frequency other than the design's is a wrong label.
    expect(tp.source === undefined || tp.source.frequency === 2e9).toBe(true);
  });

  it('two files imported in a row, undo, redo: the second device follows f', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp.s2p');
    s.importTwoPort(other, 'other.s2p');
    s.undo();
    s.redo();
    s.setFrequency(2e9);
    expect(store.getState().design.twoPort).toMatchObject(
      twoPortFromFile(other, 2e9, 'other.s2p', 50)!,
    );
  });

  it('re-import under the same name, undo, setFrequency: the device stays the undone one', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp.s2p');
    s.importTwoPort(ampV2, 'amp.s2p');
    expect(ampV2.points[0]!.s[0]!.re).not.toBe(amp.points[0]!.s[0]!.re);
    s.undo();
    expect(store.getState().design.twoPort?.s.s11).toEqual(
      twoPortFromFile(amp, 1e9, 'amp.s2p', 50)!.s.s11,
    );
    s.setFrequency(1.5e9);
    const tp = store.getState().design.twoPort!;
    expect(tp.s.s11).toMatchObject(twoPortFromFile(amp, 1.5e9, 'amp.s2p', 50)!.s.s11);
  });

  it('a share link naming a file loaded in this session attaches to it only with the same data', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp.s2p');
    const link = encodeDesign({
      ...store.getState().design,
      twoPort: {
        s: MANUAL,
        noise: null,
        source: { fileName: 'amp.s2p', frequency: 1e9, covers: [1, 2], clamped: false },
      },
    });
    s.loadDesign(decodeDesign(link)!);
    s.setFrequency(2e9);
    // Documented: the link's hand-typed values are replaced by the file's. Acceptable, listed as survived.
    expect(store.getState().design.twoPort?.source?.frequency).toBe(2e9);
  });

  it('setFrequency with a one-point file-bound device and f outside keeps clamped true', () => {
    const one = readTouchstone('# GHZ S MA R 50\n1 0.5 0 2 0 0.1 0 0.4 0\n', 2);
    const s = store.getState();
    s.importTwoPort(one, 'one.s2p');
    s.setFrequency(5e9);
    expect(store.getState().design.twoPort?.source?.clamped).toBe(true);
  });
});

describe('adv2: isElement against designs the app makes', () => {
  const variants = (): Design['elements'] => {
    const els = PALETTE.map((p) => p.make(50, 1e9));
    return identify([
      ...els,
      { kind: 'R', orientation: 'series', value: 0 },
      { kind: 'L', orientation: 'shunt', value: 0 },
      { kind: 'L', orientation: 'series', value: 1e-9, q: 0 },
      { kind: 'C', orientation: 'series', value: 1e-12, q: 1e9 },
      { kind: 'RLC', orientation: 'series', connection: 'parallel', l: 1e-9 },
      { kind: 'RLC', orientation: 'shunt', connection: 'series' },
      { kind: 'line', z0: 50, length: 0.25 },
      { kind: 'line', z0: 50, length: 0, refFrequency: 1e9, er: 1, alphaDbPerM: 0 },
      { kind: 'openStub', z0: 1e-3, length: 0.5 },
      { kind: 'transformer', n: 1e-6 },
      { kind: 'transformer', n: 1 },
    ]);
  };

  it('every palette element and its legal variants survive encode and decode', () => {
    const d: Design = { ...emptyDesign(), elements: variants() };
    const back = roundTrip(d);
    expect(back).not.toBeNull();
    expect(back!.elements).toHaveLength(d.elements.length);
  });

  it('every Smith V4.1 example opens, encodes and decodes', () => {
    for (const name of readdirSync(join(FIXTURES, 'xmlsc')).filter((n) => n.endsWith('.xmlsc'))) {
      const d = designFromXmlsc(fixture('xmlsc', name), name);
      const back = roundTrip(d);
      expect(back, name).not.toBeNull();
      expect(
        back!.elements.map((e) => e.kind),
        name,
      ).toEqual(d.elements.map((e) => e.kind));
    }
  });

  it('a lossy line from an .xmlsc with a negative Alpha still saves and reopens as .json', () => {
    const xml = fixture('xmlsc', 'Example15.xmlsc').replace(
      /<Alpha>2<\/Alpha>/,
      '<Alpha>-2</Alpha>',
    );
    expect(xml).toContain('<Alpha>-2</Alpha>');
    const d = designFromXmlsc(xml, 'x');
    expect(roundTrip(d)).not.toBeNull();
  });

  it('a value typed as 1e400 cannot make the saved .json unreadable', () => {
    const p = tryParseEngineering('1e400');
    if (p === null || Number.isFinite(p.value)) return;
    // ValueInput accepts it (min check only), the element carries Infinity, the .json carries null.
    const d: Design = {
      ...emptyDesign(),
      elements: identify([{ kind: 'L', orientation: 'series', value: p.value }]),
    };
    const json = JSON.stringify({ app: 'Smith Online', version: 1, design: encodeDesign(d) });
    const back = decodeDesign((JSON.parse(json) as { design: string }).design);
    expect(back).not.toBeNull();
  });

  it('a design frequency of 1e400 does not reopen silently at 1 GHz', () => {
    const p = tryParseEngineering('1e400');
    if (p === null || Number.isFinite(p.value)) return;
    const s = store.getState();
    s.addElement({ kind: 'line', z0: 50, length: 0.1, refFrequency: 1e9 });
    s.setFrequency(p.value);
    const back = roundTrip(store.getState().design);
    expect(back === null || back.frequency === p.value).toBe(true);
  });

  it('an element whose value is Infinity is written as INF and refused on reading', () => {
    const d: Design = {
      ...emptyDesign(),
      elements: identify([{ kind: 'L', orientation: 'series', value: Infinity }]),
    };
    const text = designToXmlsc(d);
    expect(text).toContain('<Value>INF</Value>');
    // The reader refuses a non-finite element value (the parser no longer produces one).
    expect(() => designFromXmlsc(text, 'x')).toThrow(/Non-finite/);
  });
});

describe('adv2: share link fields beyond the elements', () => {
  it('a target or load of 1e999 (Infinity after JSON.parse) is not taken into the design', () => {
    const d = dec('{"elements":[],"target":{"re":1e999,"im":0},"load":{"re":1e999,"im":0}}')!;
    expect(d.load.re).toBe(50);
    expect(d.target === null || Number.isFinite(d.target.re)).toBe(true);
  });

  it('sweep loads with a non-positive or non-finite frequency are dropped', () => {
    const d = dec(
      '{"elements":[],"sweep":{"enabled":true,"loads":[{"frequency":0,"z":{"re":50,"im":0}},{"frequency":1e999,"z":{"re":50,"im":0}},{"frequency":1e9,"z":{"re":1e999,"im":0}}]}}',
    )!;
    expect(d.sweep.loads ?? []).toHaveLength(0);
  });

  it('a source with covers of the wrong order or NaN is dropped', () => {
    const d = dec(
      `{"elements":[],"twoPort":{"s":${JSON.stringify(MANUAL)},"source":{"fileName":"a.s2p","frequency":1e9,"covers":[2e9,1e9],"clamped":false}}}`,
    )!;
    expect(
      d.twoPort?.source === undefined || d.twoPort.source.covers[0] <= d.twoPort.source.covers[1],
    ).toBe(true);
  });

  it('a vswr or q list of 1e999 entries is filtered', () => {
    const d = dec('{"elements":[],"vswrCircles":[1e999,2],"qContours":[1e999,1]}')!;
    expect(d.vswrCircles.every(Number.isFinite)).toBe(true);
    expect(d.qContours.every(Number.isFinite)).toBe(true);
  });
});
