/**
 * Adversarial round 2: what a parseStock misread does downstream. A pasted
 * resistor list in R notation ("4R7, 100R") lands in the inductor and
 * capacitor stock too, and Realize then snaps every L and C of the design to
 * henries and farads.
 */
import { describe, expect, it } from 'vitest';
import { complex, parseStock, realizeLadder, type Ladder } from '../src/index';

const ladder: Ladder = {
  z0: 50,
  frequency: 1e9,
  load: complex(25, 10),
  elements: [
    { kind: 'L', orientation: 'series', value: 10e-9 },
    { kind: 'C', orientation: 'shunt', value: 2.2e-12 },
    { kind: 'R', orientation: 'series', value: 51.3 },
  ],
};

describe('adv ir2 stock list to Realize', () => {
  it('a resistor stock in R notation leaves L and C exact (no stock for their kind)', () => {
    const stock = parseStock('4R7, 10R, 47R, 100R');
    const r = realizeLadder(ladder, { source: { kind: 'stock', stock }, scope: 'all' });
    const [l, c, res] = r.ladder.elements as readonly { value: number }[];
    expect(res!.value).toBe(47);
    expect(l!.value).toBe(10e-9);
    expect(c!.value).toBe(2.2e-12);
  });

  it('a decimal-comma inductor list does not snap the capacitor to 2 F', () => {
    const stock = parseStock('8,2 nH; 12 nH');
    const r = realizeLadder(ladder, { source: { kind: 'stock', stock }, scope: 'all' });
    const c = r.ladder.elements[1] as { value: number };
    expect(c.value).toBe(2.2e-12);
  });
});
