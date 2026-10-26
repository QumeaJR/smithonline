/**
 * QA round 3 of 0.6.0: every limit a reader enforces (links, design files, the autosave) against
 * every way the application makes that value. One rule per value (core MICROSTRIP_LENGTH and
 * BOARD_LIMITS, lib/elementRule.ts, lib/datapoints.ts MAX_SWEEP_LOADS, lib/design.ts
 * MAX_DESIGN_NAME): what a maker produces, the readers take.
 */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BOARD_LIMITS,
  DEFAULT_BOARD,
  DEFAULT_STACKUP,
  MICROSTRIP_LENGTH,
  centreDesign,
  complex,
  isUsableMicrostripLength,
  microstripDimensions,
  microstripWidthAt,
  optimizeBand,
  parameterBound,
  tuneElement,
  type Element,
  type MicrostripElement,
} from '@smithonline/core';

const memory = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
});

const { emptyDesign, identify, designFromXmlsc, MAX_DESIGN_NAME } =
  await import('../src/lib/design');
const { ownBuild } = await import('../src/lib/designBuild');
const { decodeDesign, encodeDesign, designFromJsonFile, designFileText, buildPatch } =
  await import('../src/lib/share');
const { DESIGN_STORAGE_KEY, readSavedDesign } = await import('../src/lib/autosave');
const { isElement } = await import('../src/lib/elementRule');
const { newMicrostrip, withPrimaryValue } = await import('../src/lib/elements');
const { placement } = await import('../src/lib/placement');
const { MAX_SWEEP_LOADS } = await import('../src/lib/datapoints');
const { sweepOverRows } = await import('../src/lib/importDialog');
const { readImportFile } = await import('../src/lib/import');
const { useDesignStore } = await import('../src/store/useDesignStore');

const D = () => useDesignStore.getState();

/** The design through every reader: autosave, link and design file. */
function readsEverywhere(): { autosave: boolean; link: boolean; file: boolean } {
  const own = ownBuild(D().design);
  memory.set(DESIGN_STORAGE_KEY, JSON.stringify(own));
  const file = designFromJsonFile(designFileText(own));
  return {
    autosave: readSavedDesign() !== null,
    link: decodeDesign(encodeDesign(own)) !== null,
    file: 'value' in file,
  };
}
const EVERYWHERE = { autosave: true, link: true, file: true };

const strip = (f: number, length: number): MicrostripElement => ({
  kind: 'microstrip',
  width: microstripWidthAt(DEFAULT_STACKUP, 50, f)!,
  length,
  stackup: DEFAULT_STACKUP,
});

beforeEach(() => {
  memory.clear();
});

describe('the microstrip length (0 to 1 km) from each maker', () => {
  it('a new microstrip at 10 kHz (an eighth wave is 2 km) is made 1 km long', () => {
    const el = newMicrostrip(50, 10e3);
    expect(el.length).toBe(MICROSTRIP_LENGTH.max);
    D().init({ ...emptyDesign({ frequency: 10e3 }), elements: identify([el]) });
    expect(readsEverywhere()).toEqual(EVERYWHERE);
  });

  it('Dimensions offers Use microstrip at 3.5 MHz (11.8 m) and not at 20 kHz (2 km)', () => {
    expect(
      isUsableMicrostripLength(microstripDimensions(DEFAULT_STACKUP, 50, 0.25, 3.5e6)!.length),
    ).toBe(true);
    expect(
      isUsableMicrostripLength(microstripDimensions(DEFAULT_STACKUP, 50, 0.25, 20e3)!.length),
    ).toBe(false);
  });

  it('the tune slider (5x of 800 m) stops at 1 km', () => {
    expect(withPrimaryValue(strip(1e6, 800), 4000).length).toBe(MICROSTRIP_LENGTH.max);
  });

  it('a chart drag at 50 kHz stops at 1 km; placing there is refused with the reason', () => {
    const el = strip(50e3, 1);
    const tuned = tuneElement(el, complex(20, 30), complex(30, -40), 50e3)!;
    expect(tuned.length).toBeLessThanOrEqual(MICROSTRIP_LENGTH.max);
    const placed = placement(el, complex(20, 30), complex(30, -40), 50e3);
    if (tuned.length === MICROSTRIP_LENGTH.max) {
      expect(placed).toEqual({
        kind: 'unreachable',
        hint: 'a microstrip is at most 1 km long; aim along the dashed line',
      });
    } else {
      expect(placed.kind).toBe('ok');
    }
  });

  it('Optimize band at 70 kHz searches 1 km at most, and its result reads everywhere', () => {
    const el = strip(70e3, 500);
    const b = parameterBound(el, 50, 70e3)!;
    expect(b.hi).toBe(MICROSTRIP_LENGTH.max);
    expect(b.lo).toBeLessThan(b.hi);
    const res = optimizeBand(
      { z0: 50, frequency: 70e3, load: complex(25, -15), elements: [el] },
      [60e3, 70e3, 80e3],
      { restarts: 2, iterations: 60 },
    );
    const out = res.elements[0] as MicrostripElement;
    expect(out.length).toBeLessThanOrEqual(MICROSTRIP_LENGTH.max);
    D().init({ ...emptyDesign({ frequency: 70e3 }), elements: identify([out]) });
    expect(readsEverywhere()).toEqual(EVERYWHERE);
  });

  it('centring a 900 m microstrip does not grow it past 1 km', () => {
    const res = centreDesign(
      { z0: 50, frequency: 70e3, load: complex(25, -15), elements: [strip(70e3, 900)] },
      { tolerance: 0.05, vswrLimit: 2, samples: 16, maxEvaluations: 30, validationRuns: 100 },
    );
    expect((res.elements[0] as MicrostripElement).length).toBeLessThanOrEqual(
      MICROSTRIP_LENGTH.max,
    );
  });

  it('the store refuses a 2 km microstrip from any path, with the reason, and keeps the design', () => {
    D().init({ ...emptyDesign(), elements: identify([strip(1e9, 0.01)]) });
    const before = D().design;
    D().step('Longer', (d) => ({
      ...d,
      elements: d.elements.map((e) => ({ ...e, length: 2000 }) as typeof e),
    }));
    expect(D().design).toBe(before);
    expect(D().message).toBe('Refused: Microstrip 1 must be 0 to 1 km long (it would be 2 km).');
  });
});

describe('the other element fields', () => {
  it('the store refuses what the readers refuse: a negative C, a transformer of 0, a line of 0 ohm', () => {
    const bad: Element[] = [
      { kind: 'C', orientation: 'shunt', value: -1e-12 },
      { kind: 'transformer', n: 0 },
      { kind: 'line', z0: 0, length: 0.1 },
    ];
    for (const el of bad) {
      expect(isElement(el)).toBe(false);
      D().init(emptyDesign());
      D().addElement(el, 'Added');
      expect(D().design.elements).toHaveLength(0);
      expect(D().message).toMatch(/^Refused: /);
    }
  });

  it('a Smith V4.1 file with a negative capacitance is refused on opening, with the reason', () => {
    const xml = readFileSync(
      new URL('../../core/test/fixtures/xmlsc/Example1.xmlsc', import.meta.url),
      'utf8',
    );
    expect(designFromXmlsc(xml, 'Example 1').elements).toHaveLength(2);
    const bad = xml.replace('<Value>3.9200000000000004E-11</Value>', '<Value>-3.92E-11</Value>');
    expect(() => designFromXmlsc(bad, 'bad')).toThrow('component 1 must have a value of 0 or more');
  });
});

describe('the board numbers at the ends of BOARD_LIMITS', () => {
  it('each end reads back; past each end is refused', () => {
    for (const [k, r] of Object.entries(BOARD_LIMITS)) {
      for (const v of [r.min, r.max]) {
        expect(buildPatch({ board: { ...DEFAULT_BOARD, [k]: v } }), `${k} ${v}`).not.toBeNull();
      }
      expect(buildPatch({ board: { ...DEFAULT_BOARD, [k]: r.max * 2 } }), k).toBeNull();
    }
  });
});

describe('sweep loads and the design name', () => {
  it('Use all rows refuses a file with more rows than a link keeps; at the limit all are kept', () => {
    const s1p = (n: number): string =>
      [
        '# Hz S RI R 50',
        ...Array.from({ length: n }, (_, i) => `${1e8 + i * 1e5} 0.1 ${i / 1e5}`),
      ].join('\n');
    D().init(emptyDesign());
    const before = D().design;
    expect(sweepOverRows(readImportFile('big.s1p', s1p(MAX_SWEEP_LOADS + 1)))).toBe(false);
    expect(D().design).toBe(before);
    expect(D().message).toBe(
      `big.s1p has ${MAX_SWEEP_LOADS + 1} rows; a sweep holds at most ${MAX_SWEEP_LOADS}. Set the load from one row instead.`,
    );
    expect(sweepOverRows(readImportFile('ok.s1p', s1p(MAX_SWEEP_LOADS)))).toBe(true);
    expect(decodeDesign(encodeDesign(ownBuild(D().design)))?.sweep.loads).toHaveLength(
      MAX_SWEEP_LOADS,
    );
  });

  it('a name typed longer than a link keeps is cut where the readers cut it', () => {
    D().init(emptyDesign());
    D().setName('x'.repeat(300));
    expect(D().design.name).toHaveLength(MAX_DESIGN_NAME);
    expect(decodeDesign(encodeDesign(ownBuild(D().design)))?.name).toBe(D().design.name);
  });
});
