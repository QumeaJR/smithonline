import { complex, type Ladder } from '@smithonline/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_VSWR_LIMIT, ladderBandwidth } from '../src/lib/bandwidth';

const F0 = 100e6;
const W0 = 2 * Math.PI * F0;

/** 50 ohm load behind a series inductor with X = 20 ohm at 100 MHz. */
const ladderL: Ladder = {
  z0: 50,
  frequency: F0,
  load: complex(50, 0),
  elements: [{ kind: 'L', orientation: 'series', value: 20 / W0 }],
};

// VSWR <= 2 <=> X^2 <= 1250 (|Gamma|^2 = X^2 / (100^2 + X^2) <= 1/9): f <= 100 MHz * sqrt(1250) / 20.
const HIGH = (F0 * Math.sqrt(1250)) / 20;

describe('qa app bandwidth: ladderBandwidth', () => {
  it('default limit is 2', () => {
    expect(DEFAULT_VSWR_LIMIT).toBe(2);
  });

  it('series L behind 50 ohm: upper edge 176.777 MHz, lower side open at f0 / 8', () => {
    const bw = ladderBandwidth(ladderL, 2);
    expect(bw?.high).toBeCloseTo(HIGH, -1);
    expect(bw?.highOpen).toBe(false);
    expect(bw?.low).toBe(F0 / 8);
    expect(bw?.lowOpen).toBe(true);
  });

  it('a matched load with no elements is open on both sides over f0/8 .. 8 f0', () => {
    const bw = ladderBandwidth({ z0: 50, frequency: F0, load: complex(50, 0), elements: [] }, 2);
    expect(bw).toMatchObject({ low: F0 / 8, high: 8 * F0, lowOpen: true, highOpen: true });
  });

  it('150 ohm in 50 ohm is VSWR 3: null at limit 2, a band at limit 3.01', () => {
    const l: Ladder = { z0: 50, frequency: F0, load: complex(150, 0), elements: [] };
    expect(ladderBandwidth(l, 2)).toBeNull();
    expect(ladderBandwidth(l, 3.01)).not.toBeNull();
  });

  it('a zero or negative design frequency gives null, not a hang', () => {
    expect(ladderBandwidth({ ...ladderL, frequency: 0 }, 2)).toBeNull();
    expect(ladderBandwidth({ ...ladderL, frequency: -1 }, 2)).toBeNull();
  });

  it('a limit of 1 or below gives null', () => {
    expect(ladderBandwidth(ladderL, 1)).toBeNull();
    expect(ladderBandwidth(ladderL, 0)).toBeNull();
  });

  it('a shunt stub match is narrow: a line, an open stub resonance, closed on both sides', () => {
    // Quarter-wave open stub at f0 (shunt, Z0 = 50) across a 50 ohm load: Y = 0.02 + j 0.02 tan(theta).
    // |Gamma| = |b| / |2 + jb| with b = tan(theta); VSWR <= 2 <=> |Gamma| <= 1/3 <=> b^2 <= 4 / 8 = 0.5.
    const l: Ladder = {
      z0: 50,
      frequency: F0,
      load: complex(50, 0),
      elements: [{ kind: 'openStub', z0: 50, length: 0.5, refFrequency: F0 }],
    };
    // Half-wave open stub at f0: transparent at f0 (tan(pi) = 0), VSWR 1.
    const bw = ladderBandwidth(l, 2);
    // tan(theta) = +-0.70711, theta = pi f / f0: f = f0 * (pi - atan(0.70711)) / pi .. f0 * (pi + atan(0.70711)) / pi
    const a = Math.atan(Math.sqrt(0.5));
    expect(bw?.low).toBeCloseTo((F0 * (Math.PI - a)) / Math.PI, -1);
    expect(bw?.high).toBeCloseTo((F0 * (Math.PI + a)) / Math.PI, -1);
    expect(bw?.lowOpen).toBe(false);
    expect(bw?.highOpen).toBe(false);
  });
});
