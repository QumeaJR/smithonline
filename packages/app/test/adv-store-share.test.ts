/**
 * Adversarial tests for the app side of the file-format work: the design
 * store with a file-bound two-port, the share codec with hostile JSON and
 * the export helpers on decoded designs. A failing test is a defect, see the
 * adversary report.
 *
 * Lives under the session worktree directory; the sources are imported from
 * the repository checkout. Run from packages/app with
 *   npx vitest run --dir <this directory>
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { complex, polarDeg, readTouchstone } from '@smithonline/core';
import { DEFAULT_SWEEP, designFromXmlsc, emptyDesign, type Design } from '../src/lib/design';
import {
  designSweep,
  designToAscii,
  designToNetlist,
  designToXmlsc,
  ladderOf,
} from '../src/lib/files';
import { readImportFile, twoPortFromFile } from '../src/lib/import';
import { decodeDesign } from '../src/lib/share';
import { useDesignStore } from '../src/store/useDesignStore';
import { evaluateLadder } from '@smithonline/core';

const ROOT = join(__dirname, '..', '..', '..', '..', '..', '..');
const fixture = (...parts: string[]): string =>
  readFileSync(join(ROOT, 'packages', 'core', 'test', 'fixtures', ...parts), 'utf8');

const amp = readTouchstone(fixture('sparams', 'amp-synthetic.s2p'), 2);
const store = useDesignStore;
const MANUAL = {
  s11: polarDeg(0.5, -120),
  s12: polarDeg(0.05, 50),
  s21: polarDeg(3, 80),
  s22: polarDeg(0.4, -40),
};

beforeEach(() => {
  store.getState().init(emptyDesign());
  store.setState({ twoPortFile: null, selected: null });
});

describe('adv: store with a file-bound two-port', () => {
  it('undo of an import forgets the file, so a frequency change does not bring the device back', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp.s2p');
    expect(store.getState().design.twoPort).not.toBeNull();
    s.undo();
    expect(store.getState().design.twoPort).toBeNull();
    s.setFrequency(2e9);
    expect(store.getState().design.twoPort).toBeNull();
  });

  it('undo after replacing the device by hand restores a device that still follows the file', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp.s2p');
    s.setTwoPort({ s: MANUAL, noise: null });
    s.undo();
    expect(store.getState().design.twoPort?.source?.fileName).toBe('amp.s2p');
    s.setFrequency(2e9);
    expect(store.getState().design.twoPort?.source?.frequency).toBe(2e9);
  });

  it('undo of opening another design restores the file binding of the previous one', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp.s2p');
    s.loadDesign({ ...emptyDesign(), name: 'Other' });
    s.undo();
    expect(store.getState().design.twoPort?.source?.fileName).toBe('amp.s2p');
    s.setFrequency(3e9);
    expect(store.getState().design.twoPort?.source?.frequency).toBe(3e9);
  });

  it('a Z0 change re-references the device read from a file', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp.s2p');
    s.setZ0(75);
    const expected = twoPortFromFile(amp, 1e9, 'amp.s2p', 75)!;
    expect(store.getState().design.twoPort?.s.s11).toEqual(expected.s.s11);
  });

  it('redo after undo of an import restores device and file binding together', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp.s2p');
    s.undo();
    s.redo();
    expect(store.getState().design.twoPort?.source?.fileName).toBe('amp.s2p');
    expect(store.getState().twoPortFile?.fileName).toBe('amp.s2p');
    s.setFrequency(2e9);
    expect(store.getState().design.twoPort?.source?.frequency).toBe(2e9);
  });

  it('a frequency change with a file-bound device is one undo step', () => {
    const s = store.getState();
    s.importTwoPort(amp, 'amp.s2p');
    const before = store.getState().past.length;
    s.setFrequency(2e9);
    expect(store.getState().past.length).toBe(before + 1);
    s.undo();
    expect(store.getState().design.frequency).toBe(1e9);
    expect(store.getState().design.twoPort?.source?.frequency).toBe(1e9);
  });
});

describe('adv: datapoint sweep edge cases', () => {
  it('loads of length 0 do not silently become a frequency sweep', () => {
    const d: Design = { ...emptyDesign(), sweep: { ...DEFAULT_SWEEP, enabled: true, loads: [] } };
    const sw = designSweep(d);
    // The right panel calls this a datapoint sweep over 0 points; the sweep must agree.
    expect(sw === null || sw.length === 0).toBe(true);
  });

  it('loads of length 1 give one sweep point', () => {
    const d: Design = {
      ...emptyDesign(),
      sweep: {
        ...DEFAULT_SWEEP,
        enabled: true,
        loads: [{ frequency: 2e9, z: complex(20, 10) }],
      },
    };
    const sw = designSweep(d)!;
    expect(sw).toHaveLength(1);
    expect(sw[0]!.frequency).toBe(2e9);
    const back = designFromXmlsc(designToXmlsc(d), 'x');
    expect(back.frequency).toBe(1e9);
  });
});

describe('adv: share codec with hostile JSON', () => {
  const dec = (json: string): Design | null => decodeDesign(btoa(json));

  it('caps the sweep points carried by a link', () => {
    const d = dec('{"elements":[],"sweep":{"enabled":true,"points":1e9,"start":1e6,"stop":1e9}}');
    expect(d).not.toBeNull();
    expect(d!.sweep.points).toBeLessThanOrEqual(2001);
  });

  it('refuses non-positive frequency and Z0', () => {
    const d = dec('{"elements":[],"frequency":0,"z0":-50}');
    expect(d === null || (d.frequency > 0 && d.z0 > 0)).toBe(true);
  });

  it('refuses elements with missing fields', () => {
    expect(dec('{"elements":[{"kind":"line"}]}')).toBeNull();
    expect(dec('{"elements":[{"kind":"L"}]}')).toBeNull();
    expect(dec('{"elements":[{"kind":"transformer"}]}')).toBeNull();
  });

  it('refuses elements with wrong-typed fields', () => {
    expect(dec('{"elements":[{"kind":"L","orientation":"series","value":"1e-9"}]}')).toBeNull();
    expect(dec('{"elements":[{"kind":"C","orientation":"up","value":1e-12}]}')).toBeNull();
  });

  it('does not pollute Object.prototype', () => {
    dec(
      '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"elements":[]}',
    );
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it('decodes a link with 20000 elements without throwing', () => {
    const els = JSON.stringify(
      Array.from({ length: 20000 }, () => ({ kind: 'L', orientation: 'series', value: 1e-9 })),
    );
    expect(dec(`{"elements":${els}}`)?.elements).toHaveLength(20000);
  });

  it.each([
    '{"elements":[{"kind":"line"}]}',
    '{"elements":[{"kind":"L","orientation":"series","value":"1e-9"}]}',
    '{"elements":[{"kind":"line","z0":50,"length":0.1,"er":0}]}',
    '{"elements":[{"kind":"line","z0":50,"length":0.1}],"frequency":0}',
    '{"elements":[],"load":{"re":0,"im":0}}',
  ])('exports of the decoded design %s never throw or write NaN', (p) => {
    const d = dec(p);
    if (!d) return;
    let net = '';
    expect(() => (net = designToNetlist(d, 'x'))).not.toThrow();
    expect(net).not.toMatch(/NaN|Infinity|undefined/);
    let ascii = '';
    expect(
      () => (ascii = designToAscii(d, evaluateLadder(ladderOf(d)), designSweep(d), 'semicolon')),
    ).not.toThrow();
    expect(ascii).not.toMatch(/NaN|Infinity|undefined/);
  });

  it('the chart evaluation of a decoded design with a bare line element stays finite', () => {
    const d = dec('{"elements":[{"kind":"line"}]}');
    if (!d) return;
    const r = evaluateLadder(ladderOf(d));
    expect(Number.isFinite(r.zin.re)).toBe(true);
  });
});

describe('adv: import by file name', () => {
  it('a Z-parameter Touchstone file is refused or converted, not used as S', () => {
    let f;
    try {
      f = readImportFile('load.s1p', '# MHZ Z RI R 50\n100 75 0\n200 75 0\n');
    } catch {
      return;
    }
    expect(f.rows[0]!.z.re).toBeCloseTo(75, 6);
  });
});

describe('adv: xmlsc from the app', () => {
  it('a device with S12 = 0 saved as .xmlsc opens again', () => {
    const d: Design = {
      ...emptyDesign(),
      twoPort: { s: { ...MANUAL, s12: complex(0, 0) }, noise: null },
      showStability: true,
      gainCircles: [{ type: 'available', gainDb: 10 }],
    };
    const text = designToXmlsc(d);
    expect(() => designFromXmlsc(text, 'x')).not.toThrow();
  });

  it('the ASCII export of a device with S12 = 0 and a gain circle holds no NaN', () => {
    const d: Design = {
      ...emptyDesign(),
      twoPort: { s: { ...MANUAL, s12: complex(0, 0) }, noise: null },
      showStability: true,
      gainCircles: [{ type: 'available', gainDb: 10 }],
    };
    const text = designToAscii(d, evaluateLadder(ladderOf(d)), null, 'semicolon');
    expect(text).not.toMatch(/NaN/);
  });
});
