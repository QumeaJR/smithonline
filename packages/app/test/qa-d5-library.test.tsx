// @vitest-environment jsdom
/**
 * QA round 1 on phase D5 in the app: the library limit, renaming, the data a
 * share link leaves out put back from the library, the .s2p range refusal at
 * the ends of a part's data, and the card text above the resonance.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { complex, withoutData, type LibraryPart, type PartElement } from '@smithonline/core';
import { attachLibraryData, partCardInfo } from '../src/lib/parts';
import { memoryPartStore, type StoredPart } from '../src/lib/partStore';
import { partRangeRefusal } from '../src/lib/simexport';
import type { DesignElement } from '../src/lib/design';
import {
  MAX_LIBRARY_PARTS,
  syntheticLibraryParts,
  usePartLibrary,
} from '../src/store/usePartLibrary';

/** A part known by its fitted circuit only (exact closed forms). */
function cPart(
  name: string,
  c: number,
  esl = 0,
  range: [number, number] = [1e7, 1e10],
): LibraryPart {
  return {
    manufacturer: 'QA',
    partNumber: name,
    type: 'C',
    range,
    circuit: { type: 'C', c, esl, esr: 0.1 },
  };
}

beforeEach(async () => {
  usePartLibrary.setState({ parts: [], open: false });
  await usePartLibrary.getState().init(memoryPartStore());
});

describe('qa: the library limit', () => {
  it(`adding the synthetic examples to a full library keeps it at ${MAX_LIBRARY_PARTS} parts`, async () => {
    const full: StoredPart[] = Array.from({ length: MAX_LIBRARY_PARTS }, (_, i) => {
      const part = cPart(`P${i}`, 1e-12);
      return { key: `qa|p${i}`, part, fileName: `P${i}.s2p`, added: 0 };
    });
    usePartLibrary.setState({ parts: full });
    await usePartLibrary.getState().addParts(syntheticLibraryParts());
    expect(usePartLibrary.getState().parts.length).toBeLessThanOrEqual(MAX_LIBRARY_PARTS);
  });
});

describe('qa: renaming a part', () => {
  it('refuses an empty part number and a name of another part; accepts a change of case', async () => {
    await usePartLibrary.getState().addParts([
      { part: cPart('A1', 1e-12), fileName: 'A1.s2p' },
      { part: cPart('B2', 2e-12), fileName: 'B2.s2p' },
    ]);
    const lib = usePartLibrary.getState();
    expect(await lib.rename('qa|a1', { manufacturer: 'QA', partNumber: '   ' })).toMatch(
      /part number/,
    );
    expect(await lib.rename('qa|a1', { manufacturer: 'qa', partNumber: 'b2' })).toMatch(
      /already in the library/,
    );
    expect(await lib.rename('qa|a1', { manufacturer: 'QA', partNumber: 'a1' })).toBeNull();
    expect(usePartLibrary.getState().parts.map((p) => p.part.partNumber)).toEqual(['a1', 'B2']);
  });
});

describe('qa: data put back from the library', () => {
  const withData = syntheticLibraryParts()[3]?.part as LibraryPart; // SYNTH-C0402-10P
  const linkPart: LibraryPart = withoutData(withData);
  const el = (part: LibraryPart): DesignElement =>
    ({ id: 'e1', kind: 'part', orientation: 'shunt', part }) as DesignElement;

  it('returns null for an empty library, a library without the part, or a part without data there', () => {
    expect(attachLibraryData([el(linkPart)], [])).toBeNull();
    expect(attachLibraryData([el(linkPart)], [cPart('OTHER', 1e-12)])).toBeNull();
    expect(attachLibraryData([el(linkPart)], [linkPart])).toBeNull();
  });

  it('matches manufacturer and part number ignoring case and blanks, and keeps the design’s own data', () => {
    const shouted: LibraryPart = {
      ...withData,
      manufacturer: `  ${withData.manufacturer.toUpperCase()} `,
      partNumber: withData.partNumber.toLowerCase(),
    };
    const out = attachLibraryData([el(linkPart)], [shouted]);
    expect(out?.[0]?.kind === 'part' && out[0].part.data).toBe(withData.data);
    // A part that carries data keeps it even when the library holds another copy.
    expect(attachLibraryData([el(withData)], [shouted])).toBeNull();
  });
});

describe('qa: the .s2p export range against a part’s data', () => {
  const p = cPart('R1', 1e-12, 0, [1e8, 1e9]);
  const els = [{ kind: 'part', orientation: 'shunt', part: p } as PartElement];

  it('no frequencies, or a range exactly at the data’s ends, is no refusal', () => {
    expect(partRangeRefusal(els, [])).toBeNull();
    expect(partRangeRefusal(els, [1e8, 5e8, 1e9])).toBeNull();
  });

  it('a range past either end is refused, naming element 1 and the part', () => {
    expect(partRangeRefusal(els, [0.99e8, 1e9])).toMatch(/element 1 \(R1\)/);
    expect(partRangeRefusal(els, [1e8, 1.01e9])).toMatch(/element 1 \(R1\)/);
  });
});

describe('qa: the card of a capacitor above its resonance', () => {
  it('says it acts as an inductor and gives X = w ESL - 1 / (w C) (10 pF, 1 nH, SRF 1.59 GHz; at 3 GHz X = +13.54 ohm)', () => {
    // w = 2 pi 3e9: w ESL = 18.850 ohm, 1 / (w C) = 5.305 ohm, X = 13.545 ohm.
    const p = cPart('ABOVE', 10e-12, 1e-9);
    const info = partCardInfo({ kind: 'part', orientation: 'series', part: p }, 3e9);
    expect(info.outOfRange).toBe(false);
    expect(info.atF).toMatch(/acts as an inductor/);
    expect(info.atF).toMatch(/13\.5\d? Ω/);
    // The fitted-only part is flagged approximate; the SRF is 1 / (2 pi sqrt(1e-20)) = 1.592 GHz.
    expect(info.warnings.join(' ')).toMatch(/Approximate/);
    expect(info.srf).toMatch(/1\.592 GHz/);
    void complex;
  });
});
