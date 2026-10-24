import { readTouchstone } from '@smithonline/core';
import { describe, expect, it } from 'vitest';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { realizeDesign } from '../src/lib/realize';
import { designToLtspice, designToS2p, designToSpice, exportBand } from '../src/lib/simexport';

const design: Design = {
  ...emptyDesign(),
  name: 'Example',
  frequency: 450e6,
  load: { re: 20, im: -12 },
  elements: identify([
    { kind: 'L', orientation: 'shunt', value: 16.03e-9 },
    { kind: 'C', orientation: 'series', value: 21.84e-12 },
  ]),
  sweep: { enabled: true, start: 225e6, stop: 900e6, points: 31 },
};

describe('simulator exports of a design', () => {
  it('use the realized values when Realize is on', () => {
    const on: Design = { ...design, realize: { ...design.realize, enabled: true, series: 'E12' } };
    const r = realizeDesign(on, on.elements);
    expect(designToSpice(design, null)).toContain('L1 n0 0 1.603e-8');
    expect(designToSpice(on, r)).toContain('L1 n0 0 1.5e-8');
    expect(designToLtspice(on, r)).toContain('SYMATTR Value 1.5e-8');
  });

  it('use the Q of the loss model', () => {
    const lossy: Design = { ...design, losses: { enabled: true, inductorQ: 50, capacitorQ: 500 } };
    expect(designToSpice(lossy, null)).toContain('RL1 ');
    expect(designToSpice(design, null)).not.toContain('RL1 ');
  });

  it('writes the s2p over the sweep range', () => {
    const data = readTouchstone(designToS2p(design, null), 2);
    expect(data.points).toHaveLength(31);
    expect(data.points[0]?.frequency).toBeCloseTo(225e6, 0);
    expect(data.points[30]?.frequency).toBeCloseTo(900e6, 0);
  });

  // Phase 3 of the redesign: 0.5 f to 2 f, the range of the S-Plot network entry (was 1.5 f).
  it('falls back to half to twice f without a usable sweep', () => {
    expect(exportBand({ ...design, sweep: { ...design.sweep, start: 0, stop: 0 } })).toEqual({
      start: 225e6,
      stop: 900e6,
      points: 201,
    });
  });

  it('reports a network a format cannot hold', () => {
    const t: Design = { ...design, elements: identify([{ kind: 'transformer', n: 2 }]) };
    expect(() => designToSpice(t, null)).toThrow(/transformer/);
    const line: Design = {
      ...design,
      elements: identify([{ kind: 'line', z0: 50, length: 0.1, refFrequency: 450e6 }]),
    };
    expect(() => designToLtspice(line, null)).toThrow(/netlist/);
    expect(designToSpice(line, null)).toContain('T1 n0 0 n1 0');
  });
});
