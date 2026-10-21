/**
 * Adversary round 3, app: re-run of the round 2 attacks on the store and the
 * share codec, then attacks on the fixes (the file map by instance id, the
 * sweep mode through every codec, the finite guards as the app sees them).
 * A failing test is a defect; see the report. Tests marked "observe" assert
 * only what a user would notice and record the rest for the report.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { complex, evaluateLadder, polarDeg, readTouchstone } from '@smithonline/core';
import {
  DEFAULT_SWEEP,
  designFromXmlsc,
  emptyDesign,
  hasDatapointSweep,
  type Design,
} from '../src/lib/design';
import { designSweep, designToXmlsc, ladderOf } from '../src/lib/files';
import { twoPortFromFile } from '../src/lib/import';
import { decodeDesign, encodeDesign } from '../src/lib/share';
import { useDesignStore } from '../src/store/useDesignStore';

const FIXTURES = join(__dirname, '..', '..', 'core', 'test', 'fixtures');
const fixture = (...parts: string[]): string => readFileSync(join(FIXTURES, ...parts), 'utf8');

const amp = readTouchstone(fixture('sparams', 'amp-synthetic.s2p'), 2);
const scaled = (k: number) => ({
  ...amp,
  points: amp.points.map((p) => ({
    ...p,
    s: p.s.map((c, i) => (i === 0 ? complex(c.re * k, c.im * k) : c)),
  })),
});
const ampV2 = scaled(0.5);
const ampV3 = scaled(0.25);
const other = readTouchstone(
  '# GHZ S MA R 50\n0.5 0.3 10 2.5 60 0.02 30 0.6 -20\n3 0.3 10 2.5 60 0.02 30 0.6 -20\n',
  2,
);
const onePort = readTouchstone('# MHZ S MA R 50\n100 0.5 -30\n200 0.4 -40\n', 1);
const store = useDesignStore;
const MANUAL = {
  s11: polarDeg(0.5, -120),
  s12: polarDeg(0.05, 50),
  s21: polarDeg(3, 80),
  s22: polarDeg(0.4, -40),
};
const dec = (json: string): Design | null => decodeDesign(btoa(json));
const roundTrip = (d: Design): Design | null => decodeDesign(encodeDesign(d));
const s11At = (data: typeof amp, f: number, z0 = 50) => twoPortFromFile(data, f, 'x', z0)!.s.s11;

beforeEach(() => {
  store.getState().init(emptyDesign());
  store.setState({ twoPortFiles: {}, selected: null, message: null });
});

describe('adv3: round 2 fixes confirmed', () => {
  it('two files, undo: the first device follows f from its own file', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp.s2p');
    s.importTwoPort(other, 'other.s2p');
    s.undo();
    s.setFrequency(2e9);
    const tp = store.getState().design.twoPort!;
    expect(tp.source?.fileName).toBe('amp.s2p');
    expect(tp.source?.frequency).toBe(2e9);
    expect(tp.s.s11).toEqual(s11At(amp, 2e9));
  });

  it('re-import under the same name, undo, setFrequency: the device stays the undone one', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp.s2p');
    s.importTwoPort(ampV2, 'amp.s2p');
    s.undo();
    s.setFrequency(1.5e9);
    expect(store.getState().design.twoPort!.s.s11).toEqual(s11At(amp, 1.5e9));
  });

  it('share links refuse non-finite target, loads, covers and circle lists', () => {
    const d = dec(
      '{"elements":[],"target":{"re":1e999,"im":0},"vswrCircles":[1e999,2],"qContours":[1e999,1],"sweep":{"enabled":true,"loads":[{"frequency":1e999,"z":{"re":50,"im":0}}]}}',
    )!;
    expect(d.target).toBeNull();
    expect(d.vswrCircles).toEqual([2]);
    expect(d.qContours).toEqual([1]);
    expect(d.sweep.loads ?? []).toHaveLength(0);
  });

  it('isElement accepts any finite alpha', () => {
    expect(
      dec('{"elements":[{"kind":"line","z0":50,"length":0.1,"alphaDbPerM":-2}]}'),
    ).not.toBeNull();
    expect(
      dec('{"elements":[{"kind":"line","z0":50,"length":0.1,"alphaDbPerM":1e999}]}'),
    ).toBeNull();
  });
});

describe('adv3: the file map', () => {
  it('same name three times, undo twice, redo, setFrequency: each device follows its own instance', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp.s2p');
    s.importTwoPort(ampV2, 'amp.s2p');
    s.importTwoPort(ampV3, 'amp.s2p');
    // The instance counter lives for the session, so ids are read from the map.
    const ids = Object.keys(store.getState().twoPortFiles);
    expect(ids).toHaveLength(3);
    expect(ids.every((id) => id.startsWith('amp.s2p#'))).toBe(true);
    s.undo();
    s.undo();
    s.setFrequency(2e9);
    expect(store.getState().design.twoPort!.s.s11).toEqual(s11At(amp, 2e9));
    expect(store.getState().design.twoPort!.source?.fileId).toBe(ids[0]);
    // The frequency change cleared the redo stack: undo returns to the first device at 1 GHz.
    s.undo();
    expect(store.getState().design.twoPort!.s.s11).toEqual(s11At(amp, 1e9));
    s.redo();
    expect(store.getState().design.frequency).toBe(2e9);
  });

  it('same name three times, undo twice, redo, setFrequency: the redone device follows its own instance', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp.s2p');
    s.importTwoPort(ampV2, 'amp.s2p');
    s.importTwoPort(ampV3, 'amp.s2p');
    const ids = Object.keys(store.getState().twoPortFiles);
    s.undo();
    s.undo();
    s.redo();
    s.setFrequency(1.5e9);
    const tp = store.getState().design.twoPort!;
    expect(tp.source?.fileId).toBe(ids[1]);
    expect(tp.s.s11).toEqual(s11At(ampV2, 1.5e9));
    s.setZ0(75);
    expect(store.getState().design.twoPort!.s.s11).toEqual(s11At(ampV2, 1.5e9, 75));
  });

  it('a link with a stale fileId of the same name follows the latest file of that name', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp.s2p');
    s.importTwoPort(ampV2, 'amp.s2p');
    const link = encodeDesign({
      ...emptyDesign(),
      twoPort: {
        s: MANUAL,
        noise: null,
        source: {
          fileName: 'amp.s2p',
          fileId: 'amp.s2p#99',
          frequency: 1e9,
          covers: [1, 2],
          clamped: false,
        },
      },
    });
    s.loadDesign(decodeDesign(link)!);
    s.setFrequency(2e9);
    const tp = store.getState().design.twoPort!;
    expect(tp.s.s11).toEqual(s11At(ampV2, 2e9));
    expect(tp.source?.fileId).toBe(Object.keys(store.getState().twoPortFiles).at(-1));
  });

  it('a link with a live fileId wins over a later file of the same name', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp.s2p');
    const first = Object.keys(store.getState().twoPortFiles)[0]!;
    s.importTwoPort(ampV2, 'amp.s2p');
    const link = encodeDesign({
      ...emptyDesign(),
      twoPort: {
        s: MANUAL,
        noise: null,
        source: {
          fileName: 'amp.s2p',
          fileId: first,
          frequency: 1e9,
          covers: [1, 2],
          clamped: false,
        },
      },
    });
    s.loadDesign(decodeDesign(link)!);
    s.setFrequency(2e9);
    expect(store.getState().design.twoPort!.s.s11).toEqual(s11At(amp, 2e9));
  });

  it('a link whose fileId names an instance of another file name (observe)', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp.s2p');
    s.importTwoPort(other, 'other.s2p');
    const link = encodeDesign({
      ...emptyDesign(),
      twoPort: {
        s: MANUAL,
        noise: null,
        source: {
          fileName: 'amp.s2p',
          fileId: 'other.s2p#2',
          frequency: 1e9,
          covers: [1, 2],
          clamped: false,
        },
      },
    });
    s.loadDesign(decodeDesign(link)!);
    s.setFrequency(2e9);
    const tp = store.getState().design.twoPort!;
    // Whichever file is followed, the label must name it.
    const followsAmp = tp.s.s11.re === s11At(amp, 2e9).re;
    expect(tp.source?.fileName).toBe(followsAmp ? 'amp.s2p' : 'other.s2p');
  });

  it('a link with fileId "__proto__", "constructor" or "toString" does not crash setFrequency', () => {
    const crashed: string[] = [];
    for (const fileId of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      store.getState().init(emptyDesign());
      store.setState({ twoPortFiles: {} });
      const s = store.getState();
      const link = encodeDesign({
        ...emptyDesign(),
        twoPort: {
          s: MANUAL,
          noise: null,
          source: { fileName: 'amp.s2p', fileId, frequency: 1e9, covers: [1, 2], clamped: false },
        },
      });
      const d = decodeDesign(link);
      expect(d, fileId).not.toBeNull();
      s.loadDesign(d!);
      try {
        s.setFrequency(2e9);
        s.setZ0(75);
      } catch (e) {
        crashed.push(`${fileId}: ${(e as Error).message}`);
        continue;
      }
      expect(store.getState().design.frequency, fileId).toBe(2e9);
    }
    expect(crashed, crashed.join('; ')).toEqual([]);
  });

  it('importTwoPort of a one-port is ignored: no file, no device, no history entry', () => {
    const s = store.getState();
    s.importTwoPort(onePort, 'ant.s1p');
    const st = store.getState();
    expect(st.twoPortFiles).toEqual({});
    expect(st.design.twoPort).toBeNull();
    expect(st.past).toHaveLength(0);
    // The next real import still gets a usable id and is followed on f.
    s.importTwoPort(amp, 'amp.s2p');
    s.setFrequency(2e9);
    expect(store.getState().design.twoPort!.s.s11).toEqual(s11At(amp, 2e9));
  });

  it('a three-port registers and the first two ports are followed on f', () => {
    const three = readTouchstone(fixture('sparams', 'splitter-synthetic.s3p'), 3);
    const s = store.getState();
    s.importTwoPort(three, 'split.s3p');
    expect(Object.keys(store.getState().twoPortFiles)).toHaveLength(1);
    const f = three.points[Math.floor(three.points.length / 2)]!.frequency;
    s.setFrequency(f);
    expect(store.getState().design.twoPort!.source?.frequency).toBe(f);
  });

  it('newDesign, undo: the device follows f again', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp.s2p');
    s.newDesign();
    s.undo();
    s.setFrequency(2e9);
    expect(store.getState().design.twoPort!.s.s11).toEqual(s11At(amp, 2e9));
  });

  it('hand edit, undo, re-import of the same name, undo twice: the original instance is followed', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp.s2p');
    s.setTwoPort({ s: MANUAL, noise: null });
    s.undo();
    s.importTwoPort(ampV2, 'amp.s2p');
    s.undo();
    s.setFrequency(2e9);
    expect(store.getState().design.twoPort!.s.s11).toEqual(s11At(amp, 2e9));
  });

  it('a design restored at startup with a fileId from an older session keeps its device (observe)', () => {
    const d: Design = {
      ...emptyDesign(),
      twoPort: {
        s: MANUAL,
        noise: null,
        source: {
          fileName: 'amp.s2p',
          fileId: 'amp.s2p#1',
          frequency: 1e9,
          covers: [1, 2],
          clamped: false,
        },
      },
    };
    store.getState().init(d);
    store.getState().setFrequency(2e9);
    const tp = store.getState().design.twoPort!;
    expect(tp.s).toEqual(MANUAL);
    // A source whose frequency differs from the design's is a known, labelled state after a reload.
    expect(tp.source?.frequency).toBe(1e9);
  });
});

describe('adv3: SweepSettings.mode through every codec', () => {
  const loads = [
    { frequency: 2e9, z: complex(20, 10) },
    { frequency: 3e9, z: complex(30, 10) },
  ];
  const freqMode = (enabled: boolean): Design => ({
    ...emptyDesign(),
    elements: [{ kind: 'L', orientation: 'series', value: 1e-9, id: 'a', color: '#000' }],
    sweep: {
      ...DEFAULT_SWEEP,
      enabled,
      start: 5e8,
      stop: 2e9,
      points: 11,
      loads,
      loadsName: 'x.s1p',
      mode: 'frequency',
    },
  });

  it('mode frequency, enabled: designSweep runs over frequency, not over the loads', () => {
    const pts = designSweep(freqMode(true))!;
    expect(pts).toHaveLength(11);
    expect(pts[0]!.frequency).toBe(5e8);
  });

  it('mode frequency, enabled: .xmlsc round trip keeps mode, range and the loads', () => {
    const back = designFromXmlsc(designToXmlsc(freqMode(true)), 'x');
    expect(back.sweep.enabled).toBe(true);
    expect(back.sweep.mode).toBe('frequency');
    expect(hasDatapointSweep(back.sweep)).toBe(false);
    expect(back.sweep.start).toBe(5e8);
    expect(back.sweep.stop).toBe(2e9);
    expect(back.sweep.points).toBe(11);
    expect(back.sweep.loads).toHaveLength(3);
    expect(back.frequency).toBe(1e9);
    expect(back.load).toEqual(complex(50, 0));
  });

  it('mode frequency, disabled (the "Back to frequency sweep" state): .xmlsc keeps the datapoints, not the mode', () => {
    const back = designFromXmlsc(designToXmlsc(freqMode(false)), 'x');
    expect(back.sweep.enabled).toBe(false);
    expect(back.sweep.loads).toHaveLength(3);
    // Documented loss: the .xmlsc format has no switched-off frequency sweep, so the
    // datapoints reopen as a disabled datapoint sweep; .json and share links keep the mode.
    expect(hasDatapointSweep(back.sweep)).toBe(true);
  });

  it('a second .xmlsc round trip is stable', () => {
    const once = designFromXmlsc(designToXmlsc(freqMode(true)), 'x');
    const twice = designFromXmlsc(designToXmlsc(once), 'x');
    expect(twice.sweep).toEqual(once.sweep);
  });

  it('mode frequency survives encode and decode; junk and loads-free modes are dropped', () => {
    expect(roundTrip(freqMode(true))!.sweep.mode).toBe('frequency');
    expect(roundTrip(freqMode(false))!.sweep.mode).toBe('frequency');
    const junk = dec(
      '{"elements":[],"sweep":{"enabled":true,"mode":"bogus","loads":[{"frequency":1e9,"z":{"re":20,"im":0}}]}}',
    )!;
    expect(junk.sweep.mode).toBeUndefined();
    expect(hasDatapointSweep(junk.sweep)).toBe(true);
    const noLoads = dec('{"elements":[],"sweep":{"enabled":true,"mode":"frequency"}}')!;
    expect(noLoads.sweep.mode).toBeUndefined();
    expect(designSweep(noLoads)).not.toBeNull();
    const objMode = dec(
      '{"elements":[],"sweep":{"enabled":true,"mode":{"a":1},"loads":[{"frequency":1e9,"z":{"re":20,"im":0}}]}}',
    )!;
    expect(objMode.sweep.mode).toBeUndefined();
  });

  it('a junk mode forced into the store behaves as datapoints and saves as .xmlsc', () => {
    const d = {
      ...freqMode(true),
      sweep: { ...freqMode(true).sweep, mode: 'bogus' as 'frequency' },
    };
    expect(hasDatapointSweep(d.sweep)).toBe(true);
    expect(designSweep(d)).toHaveLength(2);
    const back = designFromXmlsc(designToXmlsc(d), 'x');
    expect(back.sweep.enabled).toBe(true);
    expect(hasDatapointSweep(back.sweep)).toBe(true);
  });

  it('mode frequency with a single load (not a datapoint sweep) round trips through .xmlsc', () => {
    const d: Design = {
      ...freqMode(true),
      sweep: { ...freqMode(true).sweep, loads: [loads[0]!] },
    };
    const back = designFromXmlsc(designToXmlsc(d), 'x');
    expect(back.sweep.enabled).toBe(true);
    expect(hasDatapointSweep(back.sweep)).toBe(false);
  });
});

describe('adv3: finite guards as the app sees them', () => {
  const file = (dp: string, extra = '', comp = ''): string =>
    '<?xml version="1.0" encoding="utf-8"?><CSmithChartDesign>' +
    `<CDatapoint><StartDatapoint>1</StartDatapoint><IsRealDP>1</IsRealDP><IndexOfDP>0</IndexOfDP>${dp}<U>0</U><V>0</V></CDatapoint>` +
    (comp ||
      '<CComponent><GUID>x</GUID><Typ>4</Typ><Value>1E-08</Value><Xend>0</Xend><Rend>50</Rend><LineImp>0</LineImp><Xbegin>0</Xbegin><Rbegin>INF</Rbegin><Er>0</Er><Alpha>0</Alpha><Lambda>0</Lambda><RValueRLC>0</RValueRLC><LValueRLC>0</LValueRLC><CValueRLC>0</CValueRLC></CComponent>') +
    extra +
    '</CSmithChartDesign>';
  const DP = '<Frequency>1000000000</Frequency><R>50</R><X>0</X>';

  it('INF in Rbegin, NaN in a QList, INF in a CSweepDatapoint: the design opens, evaluates and shares', () => {
    const xml = file(
      DP,
      '<QList>NaN</QList><QList>1</QList><VSWRList>INF</VSWRList><VSWRList>2</VSWRList>' +
        '<CSweepDatapoint><StartDatapoint>0</StartDatapoint><IsRealDP>0</IsRealDP><IndexOfDP>0</IndexOfDP><Frequency>INF</Frequency><R>INF</R><X>NaN</X><U>0</U><V>0</V></CSweepDatapoint>',
    );
    const d = designFromXmlsc(xml, 'x');
    expect(d.qContours).toEqual([1]);
    expect(d.vswrCircles).toEqual([2]);
    expect(Number.isFinite(evaluateLadder(ladderOf(d)).zin.re)).toBe(true);
    expect(roundTrip(d)).not.toBeNull();
    expect(() => designToXmlsc(d)).not.toThrow();
  });

  it('a VSWRList spelled "Infinity" (not a .NET spelling) is not drawn as a circle (observe)', () => {
    const d = designFromXmlsc(
      file(DP, '<VSWRList>Infinity</VSWRList><QList>Infinity</QList>'),
      'x',
    );
    expect(d.vswrCircles.every(Number.isFinite)).toBe(true);
    expect(d.qContours.every(Number.isFinite)).toBe(true);
  });

  it('INF in LineImp of a line: the design opens but cannot be shared or saved as .json (observe)', () => {
    const lineComp =
      '<CComponent><GUID>x</GUID><Typ>8</Typ><Value>0.1</Value><Xend>0</Xend><Rend>50</Rend><LineImp>INF</LineImp><Xbegin>0</Xbegin><Rbegin>50</Rbegin><Er>1</Er><Alpha>0</Alpha><Lambda>0</Lambda><RValueRLC>0</RValueRLC><LValueRLC>0</LValueRLC><CValueRLC>0</CValueRLC></CComponent>';
    let d;
    try {
      d = designFromXmlsc(file(DP, '', lineComp), 'x');
    } catch (e) {
      expect((e as Error).message).toMatch(/Non-finite/);
      return;
    }
    expect(roundTrip(d), 'the opened design must be shareable').not.toBeNull();
  });

  it('INF in StartFrequency of a frequency sweep record: the sweep is off or finite, not NaN points (observe)', () => {
    const xml = file(
      DP,
      '<CSweepDatapointParameters><Sweeptype>2</Sweeptype><StartFrequency>INF</StartFrequency><StopFrequency>1E+09</StopFrequency><StepFrequency>1E+08</StepFrequency></CSweepDatapointParameters>',
    );
    const d = designFromXmlsc(xml, 'x');
    const pts = designSweep(d);
    console.log(
      'adv3 observe, StartFrequency INF:',
      JSON.stringify({ sweep: d.sweep, points: pts?.map((p) => [p.frequency, p.zin.re]) }),
    );
    expect(pts === null || pts.every((p) => Number.isFinite(p.frequency))).toBe(true);
  });
});
