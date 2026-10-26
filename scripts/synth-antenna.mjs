#!/usr/bin/env node
/**
 * Writes the synthetic antenna sample (packages/core/test/fixtures/sparams/antenna-2g4-synthetic.s1p)
 * that Learn > Sample files and the workflow "Match a measured antenna over its band" open
 * (docs/09 section 3.0). It is not a measurement and not any manufacturer's data: the
 * feedpoint impedance of a series R, L and C (resonant near 2.45 GHz) with a shunt C across
 * it, 101 rows from 2.2 to 2.7 GHz, as a reflection coefficient in a 50 ohm system.
 *
 * Usage: node scripts/synth-antenna.mjs          writes the file
 *        node scripts/synth-antenna.mjs --check  exits 1 when the committed file differs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = resolve(root, 'packages/core/test/fixtures/sparams/antenna-2g4-synthetic.s1p');

/** The circuit: series R, L, C (the radiator) and a shunt C (the feed), ohm, H, F. */
const R = 25;
const L = 9e-9;
const F0 = 2.45e9;
const C = 1 / ((2 * Math.PI * F0) ** 2 * L);
const CP = 0.5e-12;
const Z0 = 50;
const ROWS = 101;
const START = 2.2e9;
const STOP = 2.7e9;

/** The text of the file. */
export function antennaText() {
  const lines = [
    '! Synthetic 2.4 GHz antenna feedpoint, made up for Smith Online (scripts/synth-antenna.mjs)',
    '! Not a measurement and not a vendor file: a series R, L and C with a shunt C across it',
    `! R ${R} ohm, L ${L * 1e9} nH, C ${(C * 1e12).toFixed(4)} pF (series resonance ${F0 / 1e9} GHz), shunt C ${CP * 1e12} pF`,
    `# GHZ S RI R ${Z0}`,
  ];
  for (let i = 0; i < ROWS; i++) {
    const f = START + ((STOP - START) * i) / (ROWS - 1);
    const w = 2 * Math.PI * f;
    // Series branch R + j(wL - 1/wC), in parallel with the shunt C (admittance jwCp).
    const zr = R;
    const zi = w * L - 1 / (w * C);
    const den = zr * zr + zi * zi;
    const yr = zr / den;
    const yi = -zi / den + w * CP;
    const yden = yr * yr + yi * yi;
    const re = yr / yden;
    const im = -yi / yden;
    // Gamma = (Z - Z0) / (Z + Z0)
    const nr = re - Z0;
    const dr = re + Z0;
    const gden = dr * dr + im * im;
    const gr = (nr * dr + im * im) / gden;
    const gi = (im * dr - nr * im) / gden;
    lines.push(`${(f / 1e9).toFixed(3)} ${gr.toFixed(6)} ${gi.toFixed(6)}`);
  }
  return `${lines.join('\n')}\n`;
}

const text = antennaText();
if (process.argv.includes('--check')) {
  const committed = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  if (committed !== text) {
    console.error('antenna-2g4-synthetic.s1p differs from what scripts/synth-antenna.mjs writes');
    process.exit(1);
  }
} else {
  writeFileSync(file, text);
  console.log('wrote antenna-2g4-synthetic.s1p');
}
