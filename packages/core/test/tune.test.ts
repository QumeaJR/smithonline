import { describe, expect, it } from 'vitest';
import {
  applyElement,
  cclose,
  complex,
  isTunable,
  TUNE_FLOOR,
  tuneElement,
  type Element,
} from '../src/index';

const F = 1e9;
const before = complex(30, -40);

describe('tuneElement', () => {
  it.each<Element>([
    { kind: 'R', orientation: 'series', value: 20 },
    { kind: 'R', orientation: 'shunt', value: 80 },
    { kind: 'L', orientation: 'series', value: 12e-9 },
    { kind: 'L', orientation: 'shunt', value: 7e-9 },
    { kind: 'C', orientation: 'series', value: 3e-12 },
    { kind: 'C', orientation: 'shunt', value: 4e-12 },
    { kind: 'transformer', n: 1.7 },
    { kind: 'line', z0: 50, length: 0.137, refFrequency: F },
    { kind: 'line', z0: 75, length: 0.42, refFrequency: 2e9 },
    { kind: 'openStub', z0: 50, length: 0.1, refFrequency: F },
    { kind: 'openStub', z0: 50, length: 0.35, refFrequency: F },
    { kind: 'shortStub', z0: 50, length: 0.1, refFrequency: F },
    { kind: 'shortStub', z0: 50, length: 0.4, refFrequency: F },
  ])('recovers the value of %j from its own output', (el) => {
    const after = applyElement(el, before, F);
    const tuned = tuneElement(el, before, after, F);
    expect(tuned).not.toBeNull();
    expect(cclose(applyElement(tuned as Element, before, F), after, 1e-6)).toBe(true);
    for (const key of ['value', 'n', 'length'] as const) {
      if (key in el) {
        expect((tuned as unknown as Record<string, number>)[key]).toBeCloseTo(
          (el as unknown as Record<string, number>)[key] as number,
          9,
        );
      }
    }
  });

  it('reads only the component the part can change', () => {
    // Dragging a series inductor's node to a different resistance keeps R and takes X.
    const el: Element = { kind: 'L', orientation: 'series', value: 1e-9 };
    const tuned = tuneElement(el, complex(50, 0), complex(80, 30), F);
    expect(tuned).toMatchObject({ value: 30 / (2 * Math.PI * F) });
    expect(applyElement(tuned as Element, complex(50, 0), F)).toEqual({ re: 50, im: 30 });
  });

  it('pins at the floor when dragged the wrong way', () => {
    const l: Element = { kind: 'L', orientation: 'series', value: 1e-9 };
    expect(tuneElement(l, complex(50, 0), complex(50, -30), F)).toMatchObject({
      value: TUNE_FLOOR / (2 * Math.PI * F),
    });
    const c: Element = { kind: 'C', orientation: 'shunt', value: 1e-12 };
    expect(tuneElement(c, complex(50, 0), complex(50, 30), F)).toMatchObject({
      value: TUNE_FLOOR / (2 * Math.PI * F),
    });
  });

  it('returns null for RLC blocks and for a transformer without resistance', () => {
    expect(
      tuneElement(
        { kind: 'RLC', orientation: 'series', connection: 'parallel', r: 1 },
        before,
        before,
        F,
      ),
    ).toBeNull();
    expect(
      tuneElement({ kind: 'transformer', n: 2 }, complex(0, 10), complex(50, 0), F),
    ).toBeNull();
    expect(isTunable({ kind: 'RLC', orientation: 'series', connection: 'parallel' })).toBe(false);
    expect(isTunable({ kind: 'transformer', n: 2 })).toBe(true);
  });

  it('keeps extra properties on the element', () => {
    const el = { kind: 'L', orientation: 'series', value: 1e-9, id: 'abc', color: '#fff' } as const;
    const tuned = tuneElement(el, complex(50, 0), complex(50, 10), F);
    expect(tuned).toMatchObject({ id: 'abc', color: '#fff' });
  });
});
