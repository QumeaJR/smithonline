// @vitest-environment jsdom
/**
 * QA round 2, 0.6.0 (docs/09b section 2.3 c): one VSWR limit per design. The usable
 * bandwidth readout at a limit other than 2, against a hand calculation; the limit read from
 * a link; the readout and the next steps agreeing on what "within the limit" means.
 *
 * Hand calculation used below: a series L and C on a 50 ohm load with Z0 50 give
 * Zin = 50 + jX, X = wL - 1/(wC), so |G| = |X| / sqrt(100^2 + X^2) and VSWR <= s holds while
 * |X| <= Xm = 100 g / sqrt(1 - g^2), g = (s - 1)/(s + 1). The band edges solve
 * L w^2 -/+ Xm w - 1/C = 0: w = (+/-Xm + sqrt(Xm^2 + 4 L/C)) / (2 L).
 * L = 10 nH, C = 1/(w0^2 L) with f0 = 1 GHz (C = 2.533 pF), s = 1.5: g = 0.2,
 * Xm = 20.412 ohm, 4L/C = 15791.4, edges 850.67 MHz and 1.17556 GHz, span 324.9 MHz, 32.5 %.
 * At s = 2 the edges are 757.5 MHz and 1.320 GHz, so the readout shows which limit it used.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { complex } from '@smithonline/core';
import { BandwidthReadout } from '../src/components/BandwidthReadout';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { designLadder, effectiveElements } from '../src/lib/realize';
import { DEFAULT_TOLERANCE, designVswrLimit } from '../src/lib/tolerance';
import { bandwidthText } from '../src/lib/tourKit';
import { ladderBandwidth } from '../src/lib/bandwidth';
import { isMatched } from '../src/lib/startGuide';
import { decodeDesign } from '../src/lib/share';
import { useDesignStore } from '../src/store/useDesignStore';

const D = () => useDesignStore.getState();
const F0 = 1e9;
const L = 10e-9;
const C = 1 / ((2 * Math.PI * F0) ** 2 * L);

function seriesLc(limit: number): Design {
  return {
    ...emptyDesign(),
    load: complex(50, 0),
    elements: identify([
      { kind: 'L', orientation: 'series', value: L },
      { kind: 'C', orientation: 'series', value: C },
    ]),
    tolerance: { ...DEFAULT_TOLERANCE, vswrLimit: limit },
  };
}

/** Band edges of the hand calculation, Hz. */
function edges(s: number): { low: number; high: number } {
  const g = (s - 1) / (s + 1);
  const xm = (100 * g) / Math.sqrt(1 - g * g);
  const root = Math.sqrt(xm * xm + (4 * L) / C);
  return {
    low: (-xm + root) / (2 * L) / (2 * Math.PI),
    high: (xm + root) / (2 * L) / (2 * Math.PI),
  };
}

beforeEach(() => {
  D().init(emptyDesign());
});
afterEach(cleanup);

describe('the usable bandwidth at a limit other than 2', () => {
  it('the hand calculation itself: 850.67 MHz to 1.1756 GHz at 1.5, 757.5 MHz to 1.320 GHz at 2', () => {
    expect(edges(1.5).low).toBeCloseTo(850.67e6, -5);
    expect(edges(1.5).high).toBeCloseTo(1.17556e9, -5);
    expect(edges(2).low).toBeCloseTo(757.5e6, -6);
    expect(edges(2).high).toBeCloseTo(1.3202e9, -6);
  });

  it('the readout reads the design limit 1.5 and shows its band', () => {
    const d = seriesLc(1.5);
    D().init(d);
    render(<BandwidthReadout ladder={designLadder(d, effectiveElements(d))} />);
    expect((screen.getByLabelText('VSWR limit') as HTMLInputElement).value).toBe('1.5');
    const text = screen.getByTestId('bandwidth-result').textContent ?? '';
    expect(text).toContain('850.7 MHz');
    expect(text).toContain('1.176 GHz');
    expect(text).toContain('32.5 % of f0');
    expect(text).not.toContain('757.4');
  });

  it('the core search agrees with the hand edges to 1e-5', () => {
    const d = seriesLc(1.5);
    const bw = ladderBandwidth(designLadder(d, effectiveElements(d)), designVswrLimit(d));
    expect(bw).not.toBeNull();
    expect(Math.abs(bw!.low / edges(1.5).low - 1)).toBeLessThan(1e-5);
    expect(Math.abs(bw!.high / edges(1.5).high - 1)).toBeLessThan(1e-5);
  });

  it('the lesson text quotes the same band at the same limit', () => {
    const text = bandwidthText(seriesLc(1.5));
    expect(text).toContain('For VSWR below 1.50');
    expect(text).toContain('850.7 MHz to 1.176 GHz');
  });

  it('a limit changed in the readout is the Tolerance limit of the design', () => {
    D().init(seriesLc(2));
    D().setVswrLimit(1.5);
    expect(D().design.tolerance?.vswrLimit).toBe(1.5);
    D().undo();
    expect(designVswrLimit(D().design)).toBe(2);
  });
});

describe('one limit, one meaning', () => {
  it('a link cannot carry a limit the readout refuses (it needs above 1, as Settings does)', () => {
    const json = JSON.stringify({ v: 1, ...seriesLc(1) });
    const d = decodeDesign(Buffer.from(json).toString('base64url'));
    expect(d).not.toBeNull();
    // One rule (lib/tolerance.ts isVswrLimit): a 1 from before 0.6.0 opens as the default 2.
    expect(designVswrLimit(d!)).toBe(2);
  });

  it('with a target that is not Z0, "matched" for the next steps means a usable band in the readout', () => {
    // Load 150 ohm, target 150 ohm, a 0.1 nH series L: Zin = 150 + j0.63 ohm.
    // Towards the target VSWR = 1.004 (matched); towards Z0 = 50 ohm VSWR = 3.0.
    const d: Design = {
      ...emptyDesign(),
      load: complex(150, 0),
      target: complex(150, 0),
      elements: identify([{ kind: 'L', orientation: 'series', value: 0.1e-9 }]),
    };
    const limit = designVswrLimit(d);
    expect(isMatched(d, limit)).toBe(true);
    // The readout judges towards the design's target, as the next steps do; towards Z0 there
    // is no band at all.
    const ladder = designLadder(d, effectiveElements(d));
    expect(ladderBandwidth(ladder, limit, ladder.load, d.target)).not.toBeNull();
    expect(ladderBandwidth(ladder, limit)).toBeNull();
    D().init(d);
    render(<BandwidthReadout ladder={ladder} />);
    expect(screen.getByTestId('bandwidth-result').textContent).toContain('VSWR towards the target');
  });
});
