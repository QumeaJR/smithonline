/**
 * Adversarial, QA round on D1: the S-Plot network entry of a lossless matching
 * network. A lossless reciprocal two-port has K = 1 and mu = 1 exactly and
 * MAG = MSG = 0 dB; the gain table must not flag it as potentially unstable
 * (K < 1, the warn style) or leave MAG blank on rows where rounding put K a
 * hair below 1.
 */
import { DEFAULT_PACKAGES } from '@smithonline/core';
import { describe, expect, it } from 'vitest';
import { emptyDesign, identify, type Design } from '../src/lib/design';
import { analyze } from '../src/lib/splot';
import { networkSPlotFile } from '../src/lib/splotNetwork';

const example5: Design = {
  ...emptyDesign(),
  name: 'Example 5',
  frequency: 450e6,
  load: { re: 20, im: -12 },
  elements: identify([
    { kind: 'L', orientation: 'shunt', value: 16.03e-9 },
    { kind: 'C', orientation: 'series', value: 21.84e-12 },
  ]),
};

describe('adv D1: gain table of a lossless network entry', () => {
  it('Example 5 network (losses off, the default): no row has K < 1, mu < 1 or a blank MAG', () => {
    const file = networkSPlotFile(example5, DEFAULT_PACKAGES);
    const a = analyze(file.data);
    const k = a.k as number[];
    const mu = a.mu as number[];
    const magDb = a.magDb as number[];
    const kBelow = k.filter((v) => v < 1).length;
    const muBelow = mu.filter((v) => v < 1).length;
    const magBlank = magDb.filter((v) => Number.isNaN(v)).length;
    const worstK = Math.min(...k);
    // Report the size of the effect in the failure message.
    expect({ rows: k.length, kBelow, muBelow, magBlank, worstK }).toEqual({
      rows: k.length,
      kBelow: 0,
      muBelow: 0,
      magBlank: 0,
      worstK,
    });
  });

  it('a lossless network with deep mismatch at the band edges: K stays within 1e-3 of 1', () => {
    // Series C 1 pF then shunt L 100 nH at 450 MHz: far from 50 ohm at 225 MHz, |S21| small.
    const d: Design = {
      ...example5,
      elements: identify([
        { kind: 'C', orientation: 'series', value: 0.2e-12 },
        { kind: 'L', orientation: 'shunt', value: 2e-9 },
      ]),
    };
    const a = analyze(networkSPlotFile(d, DEFAULT_PACKAGES).data);
    const k = a.k as number[];
    const worst = Math.max(...k.map((v) => Math.abs(v - 1)));
    const s21min = Math.min(...(a.db.s21 as number[]));
    expect({ worst: worst < 1e-3, s21min }).toEqual({ worst: true, s21min });
  });
});
