import { describe, expect, it } from 'vitest';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { effectiveElements, realizeDesign, realizedText } from '../src/lib/realize';
import { decodeDesign, encodeDesign } from '../src/lib/share';

const example5: Design = {
  ...emptyDesign(),
  frequency: 450e6,
  load: { re: 20, im: -12 },
  elements: identify([
    { kind: 'L', orientation: 'shunt', value: 1.6033386409903585e-8 },
    { kind: 'C', orientation: 'series', value: 2.1835513398047903e-11 },
    { kind: 'L', orientation: 'shunt', value: 2.1883430954167689e-8 },
    { kind: 'C', orientation: 'series', value: 1.6e-11 },
    { kind: 'L', orientation: 'shunt', value: 2.9500000000000003e-8 },
  ]),
};

describe('realize helpers', () => {
  it('leaves the design untouched while Realize and Losses are off', () => {
    expect(effectiveElements(example5)).toBe(example5.elements);
    expect(realizeDesign(example5, example5.elements)).toBeNull();
  });

  it('gives default Q only to parts without their own Q', () => {
    const d: Design = {
      ...example5,
      elements: [
        example5.elements[0]!,
        { ...example5.elements[1]!, q: 200 } as Design['elements'][number],
      ],
      losses: { enabled: true, inductorQ: 40, capacitorQ: 500 },
    };
    const els = effectiveElements(d);
    expect(els[0]).toMatchObject({ q: 40 });
    expect(els[1]).toMatchObject({ q: 200 });
  });

  it('realizes Example 5 to E24 and keeps locked elements exact', () => {
    const d: Design = {
      ...example5,
      elements: example5.elements.map((el, i) => (i === 4 ? { ...el, locked: true } : el)),
      realize: { enabled: true, series: 'E24', stockText: '', scope: 'all' },
    };
    const r = realizeDesign(d, d.elements);
    expect(r).not.toBeNull();
    expect(r!.ladder.elements.map((e) => (e as { value: number }).value)).toEqual([
      16e-9, 22e-12, 22e-9, 16e-12, 2.9500000000000003e-8,
    ]);
    expect(realizedText(r!.elements[0]!, 'E24')).toBe('E24: 16 nH (-0.2 %)');
    expect(realizedText(r!.elements[3]!, 'E24')).toBe('E24: 16 pF (0 %)');
    expect(r!.elements[4]!.locked).toBe(true);
  });

  it('round-trips the realize and loss settings through a share link', () => {
    const d: Design = {
      ...example5,
      elements: [{ ...example5.elements[0]!, locked: true }],
      realize: { enabled: true, series: 'stock', stockText: '15n, 18 nH', scope: 'pairs' },
      losses: { enabled: true, inductorQ: 60, capacitorQ: 800 },
    };
    const decoded = decodeDesign(encodeDesign(d));
    expect(decoded?.realize).toEqual(d.realize);
    expect(decoded?.losses).toEqual(d.losses);
    expect(decoded?.elements[0]).toMatchObject({ locked: true });
    // Old links without the fields decode to the defaults.
    expect(decodeDesign(encodeDesign(example5))?.realize).toEqual(emptyDesign().realize);
  });
});
