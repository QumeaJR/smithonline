/**
 * QA, phase D4: the microstrip model against a third-party simulator, Keysight
 * ADS (MLIN on MSUB), not against scikit-rf, of which line.ts is a port.
 *
 * Source of the reference values: scikit-rf's own regression data,
 * skrf/media/tests/ads/mlin,djordjevicsvensson,kirschning.s2p (scikit-rf 2.2.0,
 * BSD 3-clause; written by ADS on 10 May 2022), copied unchanged to
 * test/fixtures/ads/mlin-djordjevicsvensson-kirschning.s2p (its README names the
 * source and carries the licence), and the parameters of the scikit-rf test that
 * reads it (skrf/media/tests/test_mline.py, MLineTestCase.setUp): W 3.00 mm,
 * H 1.55 mm, T 35 um, er 4.413 and tanD 0.0182 at 1 GHz (Djordjevic-Svensson),
 * rho 1.7e-8 ohm m, roughness 0.15 um RMS, length 25 mm, 50 ohm ports. ADS
 * there uses Kirschning-Jansen dispersion.
 *
 * Tolerance: the one scikit-rf's test_line_ads applies to the element-wise
 * ratio of the two S-matrices: S21 within 0.1 dB and 1 degree, S11 within
 * 1 dB and 10 degrees (its "10 x limit" for S11). Observed over all 100 points:
 * at worst 0.014 dB and 0.26 degrees in S21, 0.56 dB and 2.0 degrees in S11.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cabs,
  cadd,
  carg,
  cdiv,
  complex,
  cscale,
  csub,
  microstripAbcd,
  readTouchstone,
  type Stackup,
} from '../src/index';

const STACKUP: Stackup = {
  h: 1.55e-3,
  er: 4.413,
  tanD: 0.0182,
  fRef: 1e9,
  t: 35e-6,
  roughness: 0.15e-6,
  rho: 1.7e-8,
};
const W = 3e-3;
const LEN = 25e-3;
const Z0 = 50;

// The ADS file, all 100 points from 0.2 to 20 GHz (fixtures/ads/README.md: source, licence).
const ADS = readTouchstone(
  readFileSync(
    join(__dirname, 'fixtures', 'ads', 'mlin-djordjevicsvensson-kirschning.s2p'),
    'utf8',
  ),
  2,
).points;

function sParams(f: number) {
  const m = microstripAbcd(STACKUP, W, LEN, f);
  const bz = cscale(m.b, 1 / Z0);
  const cz = cscale(m.c, Z0);
  const den = cadd(cadd(m.a, bz), cadd(cz, m.d));
  return {
    s11: cdiv(csub(cadd(m.a, bz), cadd(cz, m.d)), den),
    s21: cdiv(complex(2, 0), den),
  };
}

const db = (r: number): number => 20 * Math.log10(r);
const deg = (r: number): number => (r * 180) / Math.PI;

describe('qa d4: microstrip against Keysight ADS MLIN (scikit-rf regression data)', () => {
  it('reads all 100 points of the ADS file, 0.2 to 20 GHz', () => {
    expect(ADS.length).toBe(100);
    expect(ADS[0]?.frequency).toBe(2e8);
    expect(ADS[99]?.frequency).toBe(2e10);
  });

  it('S21 within 0.1 dB and 1 degree from 0.2 to 20 GHz', () => {
    for (const { frequency: f, s } of ADS) {
      const ratio = cdiv(sParams(f).s21, s[2]!);
      expect(Math.abs(db(cabs(ratio))), `|S21| at ${f / 1e9} GHz`).toBeLessThan(0.1);
      expect(Math.abs(deg(carg(ratio))), `ang S21 at ${f / 1e9} GHz`).toBeLessThan(1);
    }
  });

  it('S11 within 1 dB and 10 degrees from 0.2 to 20 GHz', () => {
    for (const { frequency: f, s } of ADS) {
      const ratio = cdiv(sParams(f).s11, s[0]!);
      expect(Math.abs(db(cabs(ratio))), `|S11| at ${f / 1e9} GHz`).toBeLessThan(1);
      expect(Math.abs(deg(carg(ratio))), `ang S11 at ${f / 1e9} GHz`).toBeLessThan(10);
    }
  });
});
