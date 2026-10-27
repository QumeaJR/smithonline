#!/usr/bin/env node
/**
 * Writes the synthetic measurement of a built board
 * (packages/core/test/fixtures/sparams/board-1g-synthetic.s1p) that Learn > Sample files and
 * the workflow "Measure, compare, retune" open (docs/09 section 3.8, phase D6). It is not a
 * measurement: it is the network as built of the workflow's start design (the buildable board
 * with the shunt L re-centred for the 0402 parts and the board: shunt L 10 nH and series C
 * 2.7 pF in 0402 packages, board on FR-4 1.6 mm, one 0.3 mm via under the shunt part, at 1 GHz
 * on a 100 - j50 ohm load; as built it meets VSWR 1.38 over 0.9 to 1.1 GHz, worst 1.30) with
 * known drifts, +8 % on the shunt L and +0.3 pF on the pads of the series C, which take it out
 * of the target (worst 1.55), plus a little noise (normal, 0.001 on each of the real and
 * imaginary parts of Gamma, seeded), 121 rows from 0.7 to 1.3 GHz in a 50 ohm system.
 * It uses the model of packages/core/src/closedloop.ts, so the fit has a known answer.
 *
 * Usage: node scripts/synth-board.mjs          writes the file (build packages/core first)
 *        node scripts/synth-board.mjs --check  exits 1 when the committed file differs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = resolve(root, 'packages/core/test/fixtures/sparams/board-1g-synthetic.s1p');
const core = await import(pathToFileURL(resolve(root, 'packages/core/dist/index.js')).href);

/** The drifts, by the fit's parameter ids: element 0 is the shunt L, element 1 the series C. */
export const DRIFTS = { 'value:0': 0.08, 'pad:1': 0.3e-12 };
export const NOISE = 1e-3;
const ROWS = 121;
const START = 0.7e9;
const STOP = 1.3e9;

/** The board as designed: the start of the workflow "Measure, compare, retune". */
export const MODEL = {
  z0: 50,
  frequency: 1e9,
  base: [
    { kind: 'L', orientation: 'shunt', value: 10e-9, package: '0402' },
    { kind: 'C', orientation: 'series', value: 2.7e-12, package: '0402' },
  ],
  table: core.DEFAULT_PACKAGES,
  board: { ...core.DEFAULT_BOARD, enabled: true },
  load: { re: 100, im: -50 },
};

/** Park-Miller with Box-Muller: the same noise on every machine. */
function normal(seed) {
  let s = seed;
  const u = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

/** The text of the file. */
export function boardText() {
  const fs = Array.from({ length: ROWS }, (_, i) => START + ((STOP - START) * i) / (ROWS - 1));
  const g = core.modelGammas(MODEL, DRIFTS, fs);
  const n = normal(20261026);
  const lines = [
    '! Synthetic measurement of a built board, made up for Smith Online (scripts/synth-board.mjs)',
    '! Not a measurement: the "Measure, compare, retune" network as built (shunt L 10 nH, series C 2.7 pF,',
    '! 0402, FR-4 1.6 mm, one 0.3 mm via) on 100 - j50 ohm, with known drifts:',
    '! +8 % on the shunt L, +0.3 pF on the pads of the series C, noise 0.001 in Gamma',
    '# GHZ S RI R 50',
  ];
  g.forEach((x, i) => {
    const re = x.re + NOISE * n();
    const im = x.im + NOISE * n();
    lines.push(`${(fs[i] / 1e9).toFixed(4)} ${re.toFixed(6)} ${im.toFixed(6)}`);
  });
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = boardText();
  if (process.argv.includes('--check')) {
    const same = readFileSync(file, 'utf8').replace(/\r\n/g, '\n') === text;
    if (!same) {
      console.error(`${file} differs from what scripts/synth-board.mjs writes`);
      process.exit(1);
    }
    console.log('board-1g-synthetic.s1p is up to date');
  } else {
    writeFileSync(file, text);
    console.log(`wrote ${file}`);
  }
}
