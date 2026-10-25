#!/usr/bin/env node
/**
 * Writes the reference networks for the independent oracle (tools/oracle/check.py).
 *
 * Every case is a ladder as the app stores it (load side first), the app's
 * S-parameters of the two-port (`ladderSParameters`, the numbers behind the
 * .s2p export and the S-Plot network), the app's input impedance with the
 * load, and where the network can be written as SPICE, the app's netlist
 * (`writeSpice`) with the input impedance that netlist describes.
 *
 * The SPICE netlist states two approximations of its own (see
 * packages/core/src/io/spice-model.ts): the load is a series R with an L or C
 * valued at the design frequency, and a part's Q becomes a fixed series loss
 * resistor valued at the design frequency. The SPICE reference impedance is
 * therefore the app's ladder evaluation of the network as netlisted (the same
 * evaluator, with the load as that R-L or R-C branch and each lossy part as an
 * R in series), which equals the design's own Zin at the design frequency;
 * this script checks that before it writes anything. Package parasitics are
 * not in the SPICE export by design, so a packaged case compares its netlist
 * with the ladder without them; ideal transformers and line attenuation are
 * not representable and those cases carry no netlist.
 *
 * Usage: node tools/oracle/export.mjs [output.json]   (default oracle-cases.json)
 * Needs the built core: pnpm --filter @smithonline/core build
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const core = await import(pathToFileURL(resolve(root, 'packages/core/dist/index.js')).href);
const {
  cabs,

  complex,
  csub,
  DEFAULT_PACKAGES,
  designStubFilter,
  evaluateAt,
  ladderFromXmlsc,
  ladderSParameters,
  ladderStages,
  lMatch,
  loadBranch,
  multisectionTransformer,
  piMatch,
  readXmlsc,
  realizeLadder,
  sweepPoints,
  teeMatch,
  withPackages,
  writeSpice,
} = core;

const out = resolve(process.argv[2] ?? 'oracle-cases.json');

/* ------------------------------------------------------------- the cases */

const fixture = (name) =>
  ladderFromXmlsc(
    readXmlsc(readFileSync(resolve(root, 'packages/core/test/fixtures/xmlsc', name), 'utf8')),
  );

const sweep = (f0, points = 21, lo = 0.6, hi = 1.4) => sweepPoints(lo * f0, hi * f0, points);

/** A ladder case; `frequencies` default to 21 points from 0.6 to 1.4 times the design frequency. */
const ladder = (name, z0, frequency, load, elements, frequencies = sweep(frequency)) => ({
  name,
  z0,
  frequency,
  load,
  elements,
  frequencies,
});

function cases() {
  const list = [];
  const f1 = 500e6;

  list.push(
    ladder('series resistor', 50, 100e6, complex(50), [
      { kind: 'R', orientation: 'series', value: 30 },
    ]),
  );
  list.push(
    ladder('resistive attenuator, series and shunt R', 75, 10e6, complex(120, -35), [
      { kind: 'R', orientation: 'shunt', value: 220 },
      { kind: 'R', orientation: 'series', value: 47 },
      { kind: 'R', orientation: 'shunt', value: 330 },
    ]),
  );

  // Pozar Example 5.1, both closed-form L networks (ideal parts).
  for (const sol of lMatch(complex(200, -100), complex(100), f1)) {
    list.push(ladder(`L match ${sol.description}`, 100, f1, complex(200, -100), [...sol.elements]));
  }

  list.push(
    ladder('high-pass with Q: series C (Q 200), shunt L (Q 40)', 50, 150e6, complex(10, 7), [
      { kind: 'C', orientation: 'series', value: 39.2e-12, q: 200 },
      { kind: 'L', orientation: 'shunt', value: 26.6e-9, q: 40 },
    ]),
  );

  list.push(
    ladder('RLC blocks in both orientations and connections', 50, 300e6, complex(35, 20), [
      { kind: 'RLC', orientation: 'shunt', connection: 'series', r: 12, l: 40e-9, c: 8e-12 },
      { kind: 'RLC', orientation: 'series', connection: 'parallel', r: 400, l: 22e-9, c: 5e-12 },
      { kind: 'RLC', orientation: 'series', connection: 'series', l: 15e-9, c: 30e-12 },
      { kind: 'RLC', orientation: 'shunt', connection: 'parallel', r: 900, l: 60e-9 },
    ]),
  );

  list.push(
    ladder('ideal transformer and parts', 50, 1e9, complex(12, -8), [
      { kind: 'L', orientation: 'series', value: 3e-9 },
      { kind: 'transformer', n: 1.8 },
      { kind: 'C', orientation: 'shunt', value: 1.5e-12 },
    ]),
  );

  // Smith V4.1 examples as stored in the fixtures.
  for (const name of ['Example5', 'Example9', 'Example10', 'Example11', 'Example12', 'Example15']) {
    const lad = fixture(`${name}.xmlsc`);
    list.push(ladder(`Smith V4.1 ${name}`, lad.z0, lad.frequency, lad.load, [...lad.elements]));
  }

  // Lines with permittivity, a line whose electrical length is fixed (no reference
  // frequency), and a lossy line in a ladder.
  list.push(
    ladder('lines on a substrate and a fixed-length line', 50, 2.4e9, complex(80, 45), [
      { kind: 'line', z0: 35, length: 0.13, refFrequency: 2.4e9, er: 3.66 },
      { kind: 'openStub', z0: 70, length: 0.21, refFrequency: 2.4e9 },
      { kind: 'line', z0: 90, length: 0.07 },
      { kind: 'shortStub', z0: 40, length: 0.11, refFrequency: 2.4e9 },
    ]),
  );
  list.push(
    ladder(
      'lossy line, 4 dB/m on PTFE, between parts',
      50,
      900e6,
      complex(30, -60),
      [
        { kind: 'C', orientation: 'shunt', value: 2.2e-12 },
        { kind: 'line', z0: 60, length: 1.3, refFrequency: 900e6, er: 2.1, alphaDbPerM: 4 },
        { kind: 'L', orientation: 'series', value: 6.8e-9 },
      ],
      sweep(900e6, 15),
    ),
  );

  // Synthesis results: a Pi and a T match, a Chebyshev multisection transformer, a stub filter.
  const pi = piMatch(complex(20, -12), complex(50), 450e6, 3)[0];
  list.push(ladder(`Pi match: ${pi.description}`, 50, 450e6, complex(20, -12), [...pi.elements]));
  const tee = teeMatch(complex(250, 80), complex(50), 900e6, 4)[0];
  list.push(ladder(`T match: ${tee.description}`, 50, 900e6, complex(250, 80), [...tee.elements]));
  const cheb = multisectionTransformer(50, 150, 3, { type: 'chebyshev', frequency: 1e9 });
  list.push(
    ladder('Chebyshev 3-section transformer 150 to 50 ohm', 50, 1e9, complex(150), [
      ...cheb.elements,
    ]),
  );
  const filter = designStubFilter({
    kind: 'lowpass',
    response: 'chebyshev',
    order: 3,
    cutoff: 1e9,
    z0: 50,
  });
  list.push(
    ladder(
      'stub low-pass filter, Chebyshev order 3',
      50,
      1e9,
      complex(50),
      [...filter.elements],
      sweep(1e9, 25, 0.2, 1.8),
    ),
  );

  // Realized: the Pozar L match snapped to E12 values.
  const ideal = {
    z0: 50,
    frequency: 450e6,
    load: complex(20, -12),
    elements: [...lMatch(complex(20, -12), complex(50), 450e6)[0].elements],
  };
  const realized = realizeLadder(ideal, {
    source: { kind: 'series', series: 'E12' },
    scope: 'all',
  });
  list.push(
    ladder(
      'realized L match (E12)',
      50,
      450e6,
      complex(20, -12),
      [...realized.ladder.elements],
      sweep(450e6, 13),
    ),
  );

  // Packaged: parts in 0402 and 0805 with their parasitics resolved as the app does.
  const packaged = withPackages(
    [
      { kind: 'L', orientation: 'shunt', value: 12e-9, q: 60, package: '0402' },
      { kind: 'C', orientation: 'series', value: 3.3e-12, q: 300, package: '0402' },
      { kind: 'L', orientation: 'series', value: 8.2e-9, package: '0805' },
      { kind: 'C', orientation: 'shunt', value: 1.8e-12, package: '0805' },
    ],
    DEFAULT_PACKAGES,
  );
  list.push(
    ladder('packaged ladder (0402, 0805)', 50, 1.2e9, complex(18, 25), packaged, sweep(1.2e9, 30)),
  );
  return list;
}

/* --------------------------------------------------- SPICE as netlisted */

const pair = (z) => [z.re, z.im];

/** Why a ladder has no netlist, or null when it can be written. */
function spiceSkip(elements) {
  if (elements.some((e) => e.kind === 'transformer')) return 'ideal transformer (not written)';
  if (elements.some((e) => e.kind === 'line' && (e.alphaDbPerM ?? 0) > 0)) {
    return 'line attenuation (not modelled by the ideal T element)';
  }
  if (elements.some((e) => (e.kind === 'line' || e.kind.endsWith('Stub')) && !e.refFrequency)) {
    return 'line with a fixed electrical length (a netlist has a fixed delay)';
  }
  return null;
}

/** The element without package parasitics, as the SPICE export writes it. */
function withoutParasitics(el) {
  if ((el.kind === 'L' || el.kind === 'C') && el.parasitics) {
    const { parasitics: _p, ...rest } = el;
    void _p;
    return rest;
  }
  return el;
}

/**
 * The ladder the netlist describes: each stage of `ladderStages` as an
 * element, a part with a loss resistor as a series R-L or R-C block.
 */
function netlistedElements(lad) {
  const stages = ladderStages(lad);
  return stages.map((s, k) => {
    const el = lad.elements[k];
    if (s.type !== 'lumped') return el;
    const lossy = s.parts.find((p) => p.loss);
    if (!lossy) return el;
    // Only plain L and C carry a Q; they are one part with its loss resistor in series.
    return {
      kind: 'RLC',
      orientation: s.orientation,
      connection: 'series',
      r: lossy.loss.value,
      ...(lossy.kind === 'L' ? { l: lossy.value } : { c: lossy.value }),
    };
  });
}

/** The load the netlist describes at frequency f: R plus the L or C valued at f0. */
function netlistedLoad(load, f0, f) {
  const w = 2 * Math.PI * f;
  let z = complex(0, 0);
  for (const p of loadBranch(load, f0)) {
    if (p.kind === 'R') z = complex(z.re + p.value, z.im);
    else if (p.kind === 'L') z = complex(z.re, z.im + w * p.value);
    else z = complex(z.re, z.im - 1 / (w * p.value));
  }
  return z;
}

function spiceCase(c) {
  const skip = spiceSkip(c.elements);
  if (skip) return { skip };
  const base = { ...c, elements: c.elements.map(withoutParasitics) };
  const netEls = netlistedElements(base);
  const netLadder = { ...base, elements: netEls };
  const points = c.frequencies.length;
  const start = c.frequencies[0];
  const stop = c.frequencies[points - 1];
  const frequencies = sweepPoints(start, stop, points);
  const zin = frequencies.map(
    (f) => evaluateAt(netLadder, f, netlistedLoad(c.load, c.frequency, f), { arcSteps: 0 }).zin,
  );
  // At the design frequency the netlisted network is the design itself.
  const z0Design = evaluateAt(base, c.frequency, c.load, { arcSteps: 0 }).zin;
  const z0Net = evaluateAt(
    netLadder,
    c.frequency,
    netlistedLoad(c.load, c.frequency, c.frequency),
    {
      arcSteps: 0,
    },
  ).zin;
  if (cabs(csub(z0Design, z0Net)) > 1e-12 * Math.max(1, cabs(z0Design))) {
    throw new Error(`${c.name}: the netlisted network differs from the design at f0`);
  }
  const netlist = writeSpice(base, {
    name: c.name,
    sweep: { start, stop, points },
    digits: 17,
  });
  return {
    netlist,
    frequencies,
    zin: zin.map(pair),
    note: c.elements.some((e) => e.parasitics)
      ? 'package parasitics are not in the SPICE export by design; compared without them'
      : undefined,
  };
}

/* ------------------------------------------------------------------ write */

const all = cases().map((c) => {
  const lad = { z0: c.z0, frequency: c.frequency, load: c.load, elements: c.elements };
  const s = c.frequencies.map((f) => {
    const p = ladderSParameters(lad, f);
    return [pair(p.s11), pair(p.s12), pair(p.s21), pair(p.s22)];
  });
  const zin = c.frequencies.map((f) => pair(evaluateAt(lad, f, c.load, { arcSteps: 0 }).zin));
  if (c.frequencies.length < 10 || c.frequencies.length > 30) {
    throw new Error(`${c.name}: ${c.frequencies.length} frequencies, expected 10 to 30`);
  }
  if (!c.elements.length) throw new Error(`${c.name}: no elements`);
  return {
    name: c.name,
    z0: c.z0,
    frequency: c.frequency,
    load: pair(c.load),
    elements: c.elements,
    frequencies: c.frequencies,
    s,
    zin,
    spice: spiceCase(c),
  };
});

// Every element kind and variant appears at least once.
const seen = new Set();
for (const c of all) {
  for (const e of c.elements) {
    seen.add(e.kind === 'RLC' ? `RLC ${e.connection}` : e.kind);
    if (e.kind === 'line' && (e.alphaDbPerM ?? 0) > 0) seen.add('lossy line');
    if (e.q) seen.add('Q');
    if (e.parasitics) seen.add('parasitics');
  }
}
const wanted = [
  'R',
  'L',
  'C',
  'RLC series',
  'RLC parallel',
  'transformer',
  'line',
  'lossy line',
  'openStub',
  'shortStub',
  'Q',
  'parasitics',
];
const missing = wanted.filter((k) => !seen.has(k));
if (missing.length) throw new Error(`no case covers: ${missing.join(', ')}`);

writeFileSync(
  out,
  JSON.stringify({ generator: 'tools/oracle/export.mjs', version: 1, cases: all }, null, 1) + '\n',
);
const withSpice = all.filter((c) => c.spice.netlist).length;
console.log(`Wrote ${all.length} cases (${withSpice} with a SPICE netlist) to ${out}`);
