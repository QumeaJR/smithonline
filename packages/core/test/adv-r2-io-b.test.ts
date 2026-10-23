/** QA round 2 follow-ups: exact line injection through the CKT netlist name, and option tokens with digits. */
import { describe, expect, it } from 'vitest';
import { complex, readTouchstone, writeNetlist, type Ladder } from '../src/index';

const ladder: Ladder = {
  z0: 50,
  frequency: 1e9,
  load: complex(20, -12),
  elements: [{ kind: 'L', orientation: 'series', value: 5e-9 }],
};

describe('adv r2b: netlist name', () => {
  it('a design name with a line break injects a netlist line into the .ckt', () => {
    const ckt = writeNetlist(ladder, { name: 'my design\nRES 1 2 R=1000' });
    const rows = ckt.split(/\r?\n/);
    expect(rows.some((l) => l === 'RES 1 2 R=1000')).toBe(false);
  });
});

describe('adv r2b: option tokens that are not purely alphabetic', () => {
  const two = (option: string): string => `${option}\n1 0.5 -30 2 100 0.05 40 0.4 -60\n`;
  it('Z0 50 is refused or honoured, not dropped', () => {
    let z0: number;
    try {
      z0 = readTouchstone(two('# GHz S MA Z0 75'), 2).z0;
    } catch {
      return; // refused: fine
    }
    expect(z0).toBe(75);
  });
  it('R75 is refused or honoured, not dropped', () => {
    let z0: number;
    try {
      z0 = readTouchstone(two('# GHz S MA R75'), 2).z0;
    } catch {
      return;
    }
    expect(z0).toBe(75);
  });
  it('S2P or MA2 as stray tokens are refused like other unknown words', () => {
    expect(() => readTouchstone(two('# GHz S2P MA R 50'), 2)).toThrow();
  });
});
