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
 * Most cases are ladders built here from core functions. The "app path"
 * cases go through the app's own export code instead (packages/app/src/lib,
 * loaded with Vite's module runner): the default-Q loss model
 * (effectiveElements), Realize with the design's series, target and locked
 * parts (realizeDesign), the package table (builtNetwork), and the .s2p text
 * the user downloads (designToS2p) read back with the Touchstone reader. The
 * round-trip case carries the S-parameters as read from that text, so it is
 * compared at the text's precision (9 significant digits, `tolerance` 1e-8).
 *
 * Phase D4 adds ladders with microstrip elements and with the board in the
 * network (pads from the stackup, vias under shunt parts, traces between
 * parts; through core's withBoard and through the app's builtNetwork), which
 * check.py rebuilds from scikit-rf's MLine, and a `d4` section (d4_check.py):
 * microstrip Z0, eeff, losses and beta over frequency, via inductances and
 * land capacitances.
 *
 * Phase D6 adds a `d6` section (d6_check.py): the closed loop on the synthetic
 * board measurement of scripts/synth-board.mjs, the networks as built with no
 * drift, fitted and retuned, with the app's numbers for scikit-rf and scipy.
 *
 * Phase D5 adds a `d5` section (d5_check.py): cascades of library parts read
 * from the synthetic part files in packages/core/test/fixtures/parts (made from
 * equivalent circuits; no manufacturer data is in the repository) with the
 * app's Touchstone and part readers, series and shunt, in the fixture they
 * were measured in and across it, with a via, at the files' own frequencies
 * and between them, a ladder realized from that library, and the part
 * values the app extracts (nominal value, self-resonance). d5_check.py reads
 * the same files with scikit-rf and rebuilds every cascade.
 *
 * Usage: node tools/oracle/export.mjs [output.json]   (default oracle-cases.json)
 * Needs the built core: pnpm --filter @smithonline/core build
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const core = await import(pathToFileURL(resolve(root, 'packages/core/dist/index.js')).href);
const {
  cabs,
  complex,
  csub,
  DEFAULT_BOARD,
  DEFAULT_PACKAGES,
  designStubFilter,
  landCapacitance,
  microstripProperties,
  packageById,
  packagePadCapacitance,
  STACKUP_PRESETS,
  viaInductance,
  withBoard,
  evaluateAt,
  feasibility,
  interpolatedLoad,
  ladderFromXmlsc,
  measuredLoadInfo,
  ladderSParameters,
  ladderStages,
  ladderParameters,
  bandSensitivity,
  scalarSpread,
  lMatch,
  loadBranch,
  monteCarlo,
  multisectionTransformer,
  parameterValue,
  sensitivityAt,
  toleranceSampler,
  wilsonInterval,
  worstCorner,
  piMatch,
  readTouchstone,
  readXmlsc,
  realizeLadder,
  sIndex,
  sweepPoints,
  teeMatch,
  withPackages,
  writeSpice,
  zToGamma,
  readPartFile,
  partNominal,
  partSrf,
  circuitSrf,
  SYNTHETIC_FILES,
  SYNTHETIC_PARTS,
} = core;

const out = resolve(process.argv[2] ?? 'oracle-cases.json');

/** The app's own modules, TypeScript, loaded through Vite's module runner (no build needed). */
const vite = await import(
  pathToFileURL(createRequire(resolve(root, 'packages/app/package.json')).resolve('vite')).href
);
const appModule = async (path) =>
  (
    await vite.runnerImport(resolve(root, 'packages/app/src/lib', path), {
      configFile: false,
      root: resolve(root, 'packages/app'),
      logLevel: 'error',
    })
  ).module;
const appDesign = await appModule('design.ts');
const appRealize = await appModule('realize.ts');
const appExport = await appModule('simexport.ts');

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

  // A line on a substrate (er 3.66, length in wavelengths at the reference frequency, so its
  // electrical length scales with frequency) between stubs: netlisted, unlike the case above
  // with its fixed-length line.
  list.push(
    ladder('line on a substrate (er 3.66) between stubs, netlisted', 50, 2.4e9, complex(80, 45), [
      { kind: 'openStub', z0: 70, length: 0.21, refFrequency: 2.4e9, er: 3.66 },
      { kind: 'line', z0: 35, length: 0.13, refFrequency: 2.4e9, er: 3.66 },
      { kind: 'shortStub', z0: 40, length: 0.11, refFrequency: 2.4e9, er: 3.66 },
    ]),
  );

  // Realized with Q: the Pozar L match with lossy parts, snapped to E24 (netlisted).
  const lossyIdeal = {
    ...ideal,
    elements: ideal.elements.map((e) => ({ ...e, q: e.kind === 'L' ? 45 : 350 })),
  };
  const realizedQ = realizeLadder(lossyIdeal, {
    source: { kind: 'series', series: 'E24' },
    scope: 'all',
  });
  if (!realizedQ.ladder.elements.every((e) => e.q > 0)) {
    throw new Error('realized L match with Q: the parts lost their Q');
  }
  list.push(
    ladder(
      'realized L match with Q (E24)',
      50,
      450e6,
      complex(20, -12),
      [...realizedQ.ladder.elements],
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

  // Phase D4: microstrip elements on two stackups between lumped parts, over a wide band
  // (dispersion and loss change with frequency).
  const fr4 = stackup('fr4-1.6');
  const ro4003 = stackup('ro4003c-0.508');
  list.push(
    ladder(
      'microstrip elements on RO4003C and FR-4 between parts',
      50,
      2.4e9,
      complex(22, -35),
      [
        { kind: 'C', orientation: 'shunt', value: 1.2e-12 },
        { kind: 'microstrip', width: 1.1e-3, length: 14e-3, stackup: ro4003 },
        { kind: 'L', orientation: 'series', value: 3.3e-9, q: 50 },
        { kind: 'microstrip', width: 0.6e-3, length: 9e-3, stackup: fr4 },
        { kind: 'microstrip', width: 3.0e-3, length: 21e-3, stackup: { ...fr4, t: 0 } },
      ],
      sweep(2.4e9, 25, 0.2, 2.5),
    ),
  );
  // The board in the network through core: pads from the land size and the stackup, two vias
  // under every shunt part, 2.5 mm traces of the 50 ohm width between neighbouring parts.
  const board = {
    ...DEFAULT_BOARD,
    enabled: true,
    stackup: fr4,
    viaDrill: 0.3e-3,
    viasPerShunt: 2,
    traceLength: 2.5e-3,
  };
  const onBoard = withBoard(
    [
      { kind: 'C', orientation: 'shunt', value: 2.2e-12, q: 300, package: '0402' },
      { kind: 'L', orientation: 'series', value: 6.8e-9, q: 45, package: '0402' },
      { kind: 'R', orientation: 'shunt', value: 390 },
      { kind: 'C', orientation: 'series', value: 4.7e-12, package: '0603' },
      { kind: 'RLC', orientation: 'shunt', connection: 'series', r: 3, l: 2e-9, c: 3e-12 },
    ],
    DEFAULT_PACKAGES,
    board,
    { z0: 50, frequency: 1.5e9 },
  );
  if (
    onBoard.filter((e) => e.board?.via).length !== 3 ||
    onBoard.filter((e) => e.board?.trace).length !== 4
  ) {
    throw new Error('board case: expected 3 vias and 4 traces');
  }
  list.push(
    ladder(
      'board parasitics: pads, vias and traces (core withBoard)',
      50,
      1.5e9,
      complex(15, 30),
      onBoard,
      sweep(1.5e9, 25, 0.3, 2),
    ),
  );
  return [...list, ...appCases()];
}

/* ------------------------------------------------- through the app's code */

/** A design as the app holds it, with the sweep on so the export takes its frequencies. */
function appDesignOf(name, fields) {
  const base = appDesign.emptyDesign();
  return {
    ...base,
    name,
    ...fields,
    elements: appDesign.identify(fields.elements),
    sweep: { ...base.sweep, enabled: true, ...fields.sweep },
  };
}

/** The element as the core stores it: the app's identity and colour dropped. */
function coreElement(el) {
  const { id: _id, color: _color, ...rest } = el;
  void _id;
  void _color;
  return rest;
}

/** The network the app exports for a design (as Header passes it), and the export frequencies. */
function appBuilt(design, board = DEFAULT_BOARD) {
  const realization = appRealize.realizeDesign(design, appRealize.effectiveElements(design));
  const built = appExport.builtNetwork(design, DEFAULT_PACKAGES, realization, board);
  return { realization, built, frequencies: appExport.exportFrequencies(design) };
}

function appCase(name, design, board = DEFAULT_BOARD) {
  const { built, frequencies } = appBuilt(design, board);
  const { ladder: lad } = built;
  return {
    ...ladder(name, lad.z0, lad.frequency, lad.load, lad.elements.map(coreElement), frequencies),
    built,
  };
}

function appCases() {
  const list = [];
  const sweep21 = (f0) => ({ start: 0.6 * f0, stop: 1.4 * f0, points: 21 });
  const realizeOn = (series) => ({
    ...appDesign.emptyDesign().realize,
    enabled: true,
    series,
    scope: 'all',
  });

  // The loss model: parts without a Q of their own get the default Q of their kind.
  const losses = appDesignOf('app path: default-Q loss model', {
    frequency: 450e6,
    load: complex(20, -12),
    elements: [
      { kind: 'L', orientation: 'shunt', value: 16.03e-9 },
      { kind: 'C', orientation: 'series', value: 21.84e-12 },
      { kind: 'C', orientation: 'shunt', value: 4.7e-12, q: 900 },
    ],
    losses: { enabled: true, inductorQ: 35, capacitorQ: 250 },
    sweep: sweep21(450e6),
  });
  const lossCase = appCase(losses.name, losses);
  const qs = lossCase.elements.map((e) => e.q);
  if (qs.join() !== '35,250,900') throw new Error(`loss model case: Q ${qs.join()}`);
  list.push(lossCase);

  // Realize and packages together: snapped values, then the package parasitics on them.
  const both = appDesignOf('app path: realized (E12) and packaged (0402, 0603)', {
    frequency: 900e6,
    load: complex(15, 22),
    elements: [
      { kind: 'C', orientation: 'shunt', value: 3.07e-12, package: '0402' },
      { kind: 'L', orientation: 'series', value: 5.31e-9, package: '0603' },
      { kind: 'C', orientation: 'shunt', value: 2.11e-12, package: '0402' },
    ],
    realize: realizeOn('E12'),
    sweep: sweep21(900e6),
  });
  const bothCase = appCase(both.name, both);
  if (!bothCase.built.realized || !bothCase.built.packaged) {
    throw new Error('realized and packaged case: not both');
  }
  if (!bothCase.elements.every((e) => e.parasitics)) {
    throw new Error('realized and packaged case: parasitics missing');
  }
  list.push(bothCase);

  // Realize towards a target with one locked part: the locked value stays exact.
  const lockedValue = 7.77e-9;
  const target = appDesignOf('app path: realize to a target with a locked part (E6)', {
    frequency: 600e6,
    load: complex(30, -40),
    target: complex(25, 10),
    elements: [
      { kind: 'L', orientation: 'series', value: lockedValue, locked: true },
      { kind: 'C', orientation: 'shunt', value: 5.13e-12 },
      { kind: 'L', orientation: 'series', value: 9.21e-9 },
    ],
    realize: realizeOn('E6'),
    sweep: sweep21(600e6),
  });
  const targetCase = appCase(target.name, target);
  const v = targetCase.elements.map((e) => e.value);
  if (v[0] !== lockedValue || v[1] === 5.13e-12 || v[2] === 9.21e-9) {
    throw new Error(`target and locked case: values ${v.join()}`);
  }
  list.push(targetCase);

  // The board in the network through the app's builtNetwork, with Realize and packages: the
  // trace width follows the design's Z0 at its frequency (trace width 0).
  const boardDesign = appDesignOf('app path: realized (E24), packaged and on the board', {
    frequency: 2.45e9,
    load: complex(12, -18),
    elements: [
      { kind: 'L', orientation: 'shunt', value: 3.9e-9, package: '0402' },
      { kind: 'C', orientation: 'series', value: 1.5e-12, package: '0402' },
      { kind: 'C', orientation: 'shunt', value: 0.82e-12, package: '0201' },
    ],
    realize: realizeOn('E24'),
    sweep: sweep21(2.45e9),
  });
  const boardSettings = {
    ...DEFAULT_BOARD,
    enabled: true,
    stackup: stackup('ro4350b-0.762'),
    viaDrill: 0.25e-3,
    viasPerShunt: 1,
    traceLength: 1.2e-3,
    traceWidth: 0,
  };
  const boardCase = appCase(boardDesign.name, boardDesign, boardSettings);
  if (!boardCase.built.board || !boardCase.built.realized || !boardCase.built.packaged) {
    throw new Error('board app case: not realized, packaged and on the board');
  }
  const traces = boardCase.elements.filter((e) => e.board?.trace);
  if (
    traces.length !== 2 ||
    Math.abs(
      microstripProperties(traces[0].board.trace.stackup, traces[0].board.trace.width, 2.45e9).z0
        .re - 50,
    ) > 1e-6
  ) {
    throw new Error('board app case: the traces are not the 50 ohm width');
  }
  list.push(boardCase);

  // The .s2p text the user downloads, read back: losses, Realize and packages all on.
  const roundTrip = appDesignOf('app path: .s2p text round trip (losses, E24, packages)', {
    frequency: 1.2e9,
    load: complex(18, 25),
    elements: [
      { kind: 'L', orientation: 'shunt', value: 12.3e-9, package: '0402' },
      { kind: 'C', orientation: 'series', value: 3.41e-12, package: '0402' },
      { kind: 'L', orientation: 'series', value: 8.4e-9 },
    ],
    losses: { enabled: true, inductorQ: 60, capacitorQ: 300 },
    realize: realizeOn('E24'),
    sweep: sweep21(1.2e9),
  });
  const rt = appCase(roundTrip.name, roundTrip);
  const { realization } = appBuilt(roundTrip);
  const text = appExport.designToS2p(roundTrip, realization, DEFAULT_PACKAGES);
  const read = readTouchstone(text, 2);
  if (read.points.length !== rt.frequencies.length) throw new Error('round trip: point count');
  read.points.forEach((pt, k) => {
    if (Math.abs(pt.frequency / rt.frequencies[k] - 1) > 1e-12) {
      throw new Error(`round trip: frequency ${pt.frequency} against ${rt.frequencies[k]}`);
    }
  });
  list.push({
    ...rt,
    frequencies: read.points.map((pt) => pt.frequency),
    // S from the text, not from the evaluator: compared at the text's 9 significant digits.
    sFromText: read.points.map((pt) =>
      [
        [1, 1],
        [1, 2],
        [2, 1],
        [2, 2],
      ].map(([i, j]) => pair(pt.s[sIndex(2, i, j)])),
    ),
    tolerance: 1e-8,
  });
  return list;
}

/* --------------------------------------------------- SPICE as netlisted */

const pair = (z) => [z.re, z.im];

/** Why a ladder has no netlist, or null when it can be written. */
function spiceSkip(elements) {
  if (elements.some((e) => e.kind === 'microstrip')) {
    return 'microstrip (its Z0, dispersion and loss change with frequency; the netlist has an ideal line)';
  }
  if (elements.some((e) => e.board)) return 'board parasitics (not in the SPICE export)';
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

/* ------------------------------------------------- fitted loads (phase D2)
 *
 * A measured load is the input impedance of a ladder of L and C on a
 * resistor, sampled at the "measured" frequencies (with deterministic noise
 * in Gamma for one case) and fitted by the app's measured-load model
 * (core's interpolatedLoad, the passive rational fit of measured.ts). The
 * case carries the element values, the data, the fitted poles, residues, d
 * and e, the residuals the app reports, the app's model on a dense grid (as
 * Gamma and as the impedance the band tools read) and, for a single-reactance
 * load, the app's Bode-Fano floor. check.py recomputes the true load from the
 * element values with scikit-rf and evaluates the poles and residues with
 * numpy, independently of the app's evaluator.
 */
function fitCase(
  name,
  { z0, termination, elements, lo, hi, points, noise, truthTolerance, fano, nonPassive },
) {
  const measured = sweepPoints(lo, hi, points);
  const lad = { z0, frequency: measured[0], load: complex(termination), elements };
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647 - 0.5;
  };
  const rows = measured.map((f) => {
    const g = zToGamma(evaluateAt(lad, f, lad.load, { arcSteps: 0 }).zin, z0);
    const gn = complex(g.re + noise * rnd(), g.im + noise * rnd());
    // The impedance a file would hold for that Gamma.
    const d = (1 - gn.re) ** 2 + gn.im ** 2;
    const z = complex((z0 * (1 - gn.re ** 2 - gn.im ** 2)) / d, (z0 * 2 * gn.im) / d);
    return { frequency: f, z, gamma: gn };
  });
  const load = interpolatedLoad(
    rows.map((r) => ({ frequency: r.frequency, z: r.z })),
    { z0 },
  );
  const info = measuredLoadInfo(load);
  if (info?.mode !== 'fitted' || !info.fit) throw new Error(`${name}: the load was not fitted`);
  const fit = info.fit;
  // A case meant to exercise passivity enforcement must start non-passive.
  if (nonPassive && !(fit.passivity && fit.passivity.maxBefore > 1)) {
    throw new Error(`${name}: the raw fit was already passive, nothing was enforced`);
  }
  const check = sweepPoints(lo, hi, 1001);
  const out = {
    name,
    z0,
    termination,
    elements,
    measured,
    data: rows.map((r) => pair(r.gamma)),
    noise,
    model: {
      poles: fit.model.poles.map(pair),
      residues: fit.model.residues.map(pair),
      d: fit.model.d,
      e: fit.model.e,
    },
    order: fit.order,
    rms: fit.rms,
    maxResidual: fit.maxResidual,
    band: fit.band,
    check,
    appGamma: check.map((f) => pair(fit.evaluate(f))),
    appZ: check.map((f) => pair(load(f))),
    truthTolerance,
    ...(fit.passivity
      ? {
          passivity: {
            method: fit.passivity.method,
            maxBefore: fit.passivity.maxBefore,
            maxAfter: fit.passivity.maxAfter,
          },
        }
      : {}),
  };
  if (fano) {
    const fe = feasibility(load, sweepPoints(fano.lo, fano.hi, 21));
    if (!fe) throw new Error(`${name}: no floor`);
    out.fano = { ...fano, floor: fe.floor, method: fe.method, fromFit: fe.fromFit === true };
  }
  return out;
}

function fitCases() {
  // Two resonances: series 12 nH, shunt 2.2 pF, series 1.8 pF, shunt 9 nH on 40 ohm.
  const twoRes = [
    { kind: 'L', orientation: 'shunt', value: 9e-9 },
    { kind: 'C', orientation: 'series', value: 1.8e-12 },
    { kind: 'C', orientation: 'shunt', value: 2.2e-12 },
    { kind: 'L', orientation: 'series', value: 12e-9 },
  ];
  return [
    fitCase('fitted load: two resonances, clean', {
      z0: 50,
      termination: 40,
      elements: twoRes,
      lo: 0.4e9,
      hi: 2.4e9,
      points: 201,
      noise: 0,
      truthTolerance: 1e-8,
    }),
    fitCase('fitted load: two resonances, noise 1e-3 in Gamma', {
      z0: 50,
      termination: 40,
      elements: twoRes,
      lo: 0.4e9,
      hi: 2.4e9,
      points: 201,
      noise: 1e-3,
      truthTolerance: 1e-3,
    }),
    fitCase('fitted load: series RL, the Fano floor', {
      z0: 50,
      termination: 25,
      elements: [{ kind: 'L', orientation: 'series', value: 8e-9 }],
      lo: 0.5e9,
      hi: 1.5e9,
      points: 41,
      noise: 0,
      truthTolerance: 1e-8,
      fano: { kind: 'series RL', r: 25, l: 8e-9, lo: 0.6e9, hi: 1.4e9 },
    }),
    // A lossless series LC (on a short): |Gamma| = 1 everywhere, so noise puts the raw fit
    // above 1 and the app's passivity enforcement has to act.
    fitCase('fitted load: lossless series LC, noise 1e-3, made passive', {
      z0: 50,
      termination: 0,
      elements: [
        { kind: 'L', orientation: 'series', value: 10e-9 },
        { kind: 'C', orientation: 'series', value: 3e-12 },
      ],
      lo: 0.5e9,
      hi: 1.5e9,
      points: 201,
      noise: 1e-3,
      truthTolerance: 1e-3,
      nonPassive: true,
    }),
  ];
}

/* ------------------------------------------------- sensitivity and yield (D3) */

/**
 * Phase D3: the app's analytic derivatives of the input reflection
 * coefficient, its Monte Carlo yield, Wilson interval and worst corner of a
 * simple network, the spread shares of its smooth band VSWR, and its
 * correlated draws. check.py recomputes the derivatives as central
 * differences of scikit-rf networks, the yield by brute-force integration
 * over the tolerance box with numpy, the corner by evaluating every corner
 * and the worst case against the grid, the shares from central differences
 * of the power mean with numpy, and the correlation with numpy.
 */
function d3Cases() {
  const f0 = 1e9;
  const sensitivity = (name, z0, load, elements, frequencies) => {
    const parameters = ladderParameters(elements);
    return {
      name,
      z0,
      load: pair(load),
      elements,
      frequencies,
      parameters: parameters.map((p) => ({
        ...p,
        value: parameterValue(elements[p.index], p.parameter),
      })),
      dGamma: frequencies.map((f) =>
        sensitivityAt(elements, load, z0, f, { parameters }).dGamma.map(pair),
      ),
    };
  };
  const freqs = [0.8e9, 1e9, 1.25e9];
  const sensitivities = [
    sensitivity(
      'lumped with Q and packages',
      50,
      complex(18, -27),
      [
        { kind: 'R', orientation: 'series', value: 4.7 },
        {
          kind: 'L',
          orientation: 'series',
          value: 8.2e-9,
          q: 35,
          parasitics: { cp: 0.08e-12, esr: 0.3, pad: 0.03e-12 },
        },
        {
          kind: 'C',
          orientation: 'shunt',
          value: 1.5e-12,
          parasitics: { esl: 0.9e-9, pad: 0.1e-12 },
        },
        { kind: 'L', orientation: 'shunt', value: 22e-9, q: 50 },
        { kind: 'C', orientation: 'series', value: 4.7e-12, q: 250 },
      ],
      freqs,
    ),
    sensitivity(
      'RLC blocks in both orientations and connections',
      50,
      complex(35, 20),
      [
        { kind: 'RLC', orientation: 'shunt', connection: 'series', r: 5, l: 10e-9, c: 3e-12 },
        { kind: 'RLC', orientation: 'series', connection: 'parallel', r: 400, l: 20e-9, c: 1e-12 },
      ],
      freqs,
    ),
    sensitivity(
      'lossy line, stubs and a transformer',
      50,
      complex(70, -40),
      [
        { kind: 'line', z0: 35, length: 0.18, refFrequency: 0.8e9, er: 3.66, alphaDbPerM: 4 },
        { kind: 'openStub', z0: 60, length: 0.09, refFrequency: 1.1e9 },
        { kind: 'transformer', n: 1.4 },
        { kind: 'shortStub', z0: 45, length: 0.17, refFrequency: 1e9 },
        { kind: 'line', z0: 70, length: 0.11, refFrequency: 1e9 },
      ],
      freqs,
    ),
  ];

  // The yield of an L match of 100 - j50 to 50 ohm with 5 % parts, at f0 and over a band.
  const load = complex(100, -50);
  const sol = lMatch(load, complex(50), f0).find((x) => x.description === 'shunt C + series L');
  if (!sol) throw new Error('D3: no shunt C + series L match');
  const yieldCase = (name, options) => {
    const lad = { z0: 50, frequency: f0, load, elements: [...sol.elements] };
    const mc = monteCarlo(lad, { ...options, runs: 20000, seed: 3, tolerance: 0.05 });
    const corner = worstCorner(lad, { ...options, tolerance: 0.05 });
    // The spread ranking over the band: the shares of the variance of the smooth band VSWR (the
    // power mean of order 32 over f0 and the band), from its analytic derivatives.
    const band = options.band ?? [];
    let spread = null;
    if (band.length > 0) {
      const freqs = [f0, ...band.filter((f) => f !== f0)];
      const refs = lad.elements.map((_, index) => ({ index, parameter: 'value' }));
      const sens = bandSensitivity(lad.elements, load, 50, freqs, { parameters: refs });
      const shares = scalarSpread(
        sens.smooth.dValue,
        refs,
        refs.map((ref) => ({ ref, tolerance: 0.05 })),
        lad.elements,
        'uniform',
      ).shares.map((s) => s.share);
      spread = { order: sens.smooth.order, frequencies: freqs, shares };
    }
    return {
      name,
      z0: 50,
      frequency: f0,
      load: pair(load),
      elements: lad.elements,
      tolerance: 0.05,
      vswrLimit: options.vswrLimit,
      band: options.band ?? [],
      passed: mc.passed,
      runs: mc.runs,
      interval: [mc.interval.lo, mc.interval.hi],
      // The worst corner, and the worst case (the largest of the nominal network and the corners).
      corner: { vswr: corner.corner.vswr, signs: corner.corner.signs },
      worst: { vswr: corner.worst.vswr, source: corner.worst.source },
      ...(spread ? { spread } : {}),
    };
  };
  const yields = [
    yieldCase('L match at f0, VSWR 1.02', { vswrLimit: 1.02 }),
    yieldCase('L match over 900 MHz to 1.1 GHz, VSWR 1.26', {
      vswrLimit: 1.26,
      band: sweepPoints(0.9e9, 1.1e9, 5),
    }),
  ];

  const wilson = [
    [0, 10],
    [5, 10],
    [81, 263],
    [870, 1000],
    [1000, 1000],
  ].map(([passed, runs]) => {
    const i = wilsonInterval(passed, runs);
    return { passed, runs, interval: [i.lo, i.hi] };
  });

  const kinds = ['L', 'L', 'C', 'C', 'R'];
  const correlation = { L: 0.7, C: 0.3 };
  const draws = ['uniform', 'normal'].map((distribution) => {
    const next = toleranceSampler(kinds, { seed: 17, distribution, correlation });
    const rows = [];
    for (let r = 0; r < 10000; r++) rows.push(next().map((d) => Number(d.toFixed(7))));
    return { distribution, kinds, correlation, rows };
  });
  return { sensitivities, yields, wilson, draws };
}

/* --------------------------------------------- the board (phase D4) */

/** A laminate preset's stackup. */
function stackup(id) {
  const p = STACKUP_PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`no stackup preset ${id}`);
  return p.stackup;
}

/** Log-spaced frequencies from lo to hi. */
const logSweep = (lo, hi, n) =>
  Array.from({ length: n }, (_, i) => lo * (hi / lo) ** (i / (n - 1)));

/**
 * Microstrips over frequency (Z0, eeff, losses, beta as the app computes
 * them), via inductances and land capacitances, for d4_check.py.
 */
function d4Cases() {
  const microstrips = [];
  const frequencies = logSweep(1e6, 40e9, 15);
  for (const p of STACKUP_PRESETS) {
    for (const u of [0.25, 1, 2, 6]) {
      const width = u * p.stackup.h;
      microstrips.push(msCase(`${p.label}, W/h ${u}`, p.stackup, width, frequencies));
    }
  }
  const fr4 = stackup('fr4-1.6');
  microstrips.push(
    msCase(
      'FR-4 without copper thickness (no conductor loss)',
      { ...fr4, t: 0 },
      3e-3,
      frequencies,
    ),
  );
  microstrips.push(msCase('FR-4 lossless dielectric', { ...fr4, tanD: 0 }, 3e-3, frequencies));
  microstrips.push(msCase('FR-4 smooth copper', { ...fr4, roughness: 0 }, 3e-3, frequencies));
  microstrips.push(
    msCase(
      'alumina er 9.8, 0.635 mm, W/h 1',
      { h: 0.635e-3, er: 9.8, tanD: 1e-4, fRef: 10e9, t: 5e-6, roughness: 0.1e-6 },
      0.635e-3,
      frequencies,
    ),
  );
  const vias = [];
  for (const h of [0.2e-3, 0.508e-3, 0.8e-3, 1.6e-3]) {
    for (const drill of [0.2e-3, 0.3e-3, 0.5e-3])
      vias.push({ h, drill, L: viaInductance(h, drill) });
  }
  const lands = [];
  for (const p of STACKUP_PRESETS) {
    for (const id of ['0201', '0402', '0603', '1206']) {
      const pkg = packageById(DEFAULT_PACKAGES, id);
      const c = landCapacitance(p.stackup, pkg.padLength, pkg.padWidth);
      if (Math.abs(packagePadCapacitance(pkg, p.stackup) - 2 * c) > 1e-30) {
        throw new Error('land case: both pads are not twice one land');
      }
      lands.push({
        name: `${id} land on ${p.label}`,
        stackup: p.stackup,
        length: pkg.padLength,
        width: pkg.padWidth,
        C: c,
      });
    }
  }
  return { microstrips, vias, lands };
}

function msCase(name, st, width, frequencies) {
  const props = frequencies.map((f) => microstripProperties(st, width, f));
  return {
    name,
    stackup: st,
    width,
    frequencies,
    z0: props.map((p) => pair(p.z0)),
    eeff: props.map((p) => pair(p.eeff)),
    alphaC: props.map((p) => p.alphaConductor),
    alphaD: props.map((p) => p.alphaDielectric),
    beta: props.map((p) => p.beta),
  };
}

/* --------------------------------------------------------------- phase D5 */

const PART_DIR = 'packages/core/test/fixtures/parts';

/** The synthetic part files as the app reads them. */
function d5Parts() {
  const out = new Map();
  for (const name of SYNTHETIC_FILES) {
    const path = `${PART_DIR}/${name}.s2p`;
    const { part } = readPartFile(readFileSync(resolve(root, path), 'utf8'), `${name}.s2p`);
    out.set(name, { name, path, part });
  }
  return out;
}

/**
 * Cascades of library parts with the app's S-parameters and input impedance, the part values
 * the app extracts, and a frequency outside the data where the app must give no value.
 */
function d5Cases() {
  const parts = d5Parts();
  const el = (file, orientation, via) => ({
    kind: 'part',
    orientation,
    part: parts.get(file).part,
    ...(via ? { board: { via } } : {}),
  });
  const grid = parts.get('SYNTH-C0402-10P').part.data.f;
  const onGrid = grid.filter((_, i) => i % 10 === 0);
  const between = grid
    .slice(0, -1)
    .flatMap((f, i) => (i % 10 === 5 ? [(f + grid[i + 1]) / 2] : []));
  const cascade = (name, elements, frequencies, load = complex(20, -15), z0 = 50) => {
    const lad = { z0, frequency: frequencies[0], load, elements };
    return {
      name,
      z0,
      load: pair(load),
      frequencies,
      elements: elements.map((e) => ({
        file: SYNTHETIC_FILES.find((n) => parts.get(n).part === e.part),
        orientation: e.orientation,
        via: e.board?.via ?? 0,
      })),
      s: frequencies.map((f) => {
        const p = ladderSParameters(lad, f);
        return [pair(p.s11), pair(p.s12), pair(p.s21), pair(p.s22)];
      }),
      zin: frequencies.map((f) => pair(evaluateAt(lad, f, load, { arcSteps: 0 }).zin)),
    };
  };
  const mixed = [
    el('SYNTH-C0402-10P-SHUNT', 'shunt'),
    el('SYNTH-L0402-10N', 'series'),
    el('SYNTH-C0402-2P2', 'shunt'),
    el('SYNTH-L0402-4N7', 'series'),
    el('SYNTH-C0402-10P', 'series'),
  ];
  const cascades = [
    cascade('measured parts in and across their fixtures, at the file frequencies', mixed, onGrid),
    cascade('the same cascade between the file frequencies (interpolated)', mixed, between),
    cascade(
      'shunt parts with a 0.5 nH via, series parts across their fixture',
      [
        el('SYNTH-C0402-10P-SHUNT', 'shunt', 0.5e-9),
        el('SYNTH-C0402-10P-SHUNT', 'series'),
        el('SYNTH-L0402-10N', 'shunt', 0.3e-9),
      ],
      between,
      complex(75, 30),
    ),
  ];
  // A ladder realized from that library at 1 GHz: series L and shunt C matching 10 ohm to 50 ohm.
  const library = [...parts.values()].map((p) => p.part);
  const realized = realizeLadder(
    {
      z0: 50,
      frequency: 1e9,
      load: complex(10, 0),
      elements: [
        { kind: 'L', orientation: 'series', value: 3.18e-9 },
        { kind: 'C', orientation: 'shunt', value: 12.7e-12 },
      ],
    },
    { source: { kind: 'library', parts: library }, scope: 'all' },
  );
  if (!realized.ladder.elements.every((e) => e.kind === 'part')) {
    throw new Error('d5: the library realization left an ideal part');
  }
  cascades.push(
    cascade(
      'L match at 1 GHz realized from the library (10 ohm to 50 ohm)',
      realized.ladder.elements,
      sweepPoints(0.6e9, 1.4e9, 21),
      complex(10, 0),
    ),
  );
  const files = [...parts.values()].map(({ name, path, part }) => {
    const spec = SYNTHETIC_PARTS.find((p) => p.name === name);
    return {
      name,
      path,
      fixture: part.data.fixture,
      type: part.type,
      nominal: partNominal(part),
      srf: partSrf(part),
      circuitSrf: circuitSrf(spec.circuit),
    };
  });
  // Outside the data the app has no value (NaN), never an extrapolated one.
  const outside = cascade(
    'outside the data (20 GHz): no value',
    [el('SYNTH-C0402-10P', 'series')],
    [20e9],
  );
  if (!outside.zin.every((z) => Number.isNaN(z[0])))
    throw new Error('d5: a value outside the data');
  const refusals = [
    { name: outside.name, file: 'SYNTH-C0402-10P', frequency: 20e9, zinIsNaN: true },
  ];
  return { files, cascades, refusals };
}

/* ------------------------------------------------------- D6: measure, retune */

/**
 * The closed loop on the synthetic measurement of scripts/synth-board.mjs: the network as built
 * of the buildable board with no drift, with the drifts the app fitted to the file, and with the
 * suggested retune under the fitted and under the true drifts, each as plain elements (packages
 * and the board resolved) that check.py's ladder builder rebuilds in scikit-rf; the app's own
 * reflection coefficients and its numbers for d6_check.py to recompute.
 */
async function d6Cases() {
  const synth = await import(pathToFileURL(resolve(root, 'scripts/synth-board.mjs')).href);
  const { MODEL, DRIFTS, NOISE } = synth;
  const path = 'packages/core/test/fixtures/sparams/board-1g-synthetic.s1p';
  const data = readTouchstone(readFileSync(resolve(root, path), 'utf8'), 1);
  const measured = data.points.map((p) => ({ frequency: p.frequency, gamma: p.s[0] }));
  const fs = measured.map((p) => p.frequency);
  const out = core.fitBuild(MODEL, measured);
  if (!out.ok) throw new Error(`d6: the fit refused: ${out.reason}`);
  const fit = out.fit;
  const band = sweepPoints(0.9e9, 1.1e9, 11);
  const limit = 1.38;
  const retune = core.suggestRetune(MODEL, fit.drifts, {
    band,
    limit,
    candidates: core.retuneCandidates({ kind: 'series', series: 'E24' }, MODEL.frequency, band),
  });
  const changes = retune.suggestion?.changes ?? [];
  if (changes.length === 0 || !retune.suggestion?.inside) throw new Error('d6: no retune inside');
  const replaced = MODEL.base.map((el, i) => changes.find((c) => c.index === i)?.to ?? el);
  const retunedModel = { ...MODEL, base: replaced };
  const g = (model, drifts, freqs) => core.modelGammas(model, drifts, freqs).map(pair);
  const param = (id) => {
    const p = fit.parameters.find((q) => q.id === id);
    return { id, status: p.status, drift: p.drift, sigma: p.sigma };
  };
  return {
    z0: MODEL.z0,
    frequency: MODEL.frequency,
    load: pair(MODEL.load),
    measuredFile: path,
    noise: NOISE,
    truth: DRIFTS,
    frequencies: fs,
    designed: { elements: core.driftedElements(MODEL, {}), gamma: g(MODEL, {}, fs) },
    fitted: {
      elements: core.driftedElements(MODEL, fit.drifts),
      gamma: g(MODEL, fit.drifts, fs),
      rmsBefore: fit.rmsBefore,
      rmsAfter: fit.rmsAfter,
      parameters: fit.parameters.map((p) => param(p.id)),
      // What scipy re-fits on its own: the parameters the app fitted, as plain edits.
      free: fit.parameters
        .filter((p) => p.status === 'fitted')
        .map((p) => ({
          id: p.id,
          kind: p.kind,
          index: p.index,
          prior: p.prior,
          nominal: p.nominal,
        })),
    },
    retune: {
      band,
      limit,
      changes: changes.map((c) => ({ index: c.index, from: c.from.value, to: c.to.value })),
      worst: retune.suggestion.worst.vswr,
      fitted: {
        elements: core.driftedElements(retunedModel, fit.drifts),
        gamma: g(retunedModel, fit.drifts, band),
      },
      truth: {
        elements: core.driftedElements(retunedModel, DRIFTS),
        gamma: g(retunedModel, DRIFTS, band),
      },
    },
  };
}

/* ------------------------------------------------------------------ write */

const all = cases().map((c) => {
  const lad = { z0: c.z0, frequency: c.frequency, load: c.load, elements: c.elements };
  const s =
    c.sFromText ??
    c.frequencies.map((f) => {
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
    ...(c.tolerance ? { tolerance: c.tolerance } : {}),
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
    if (e.board?.via) seen.add('via');
    if (e.board?.trace) seen.add('trace');
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
  'microstrip',
  'via',
  'trace',
];
const missing = wanted.filter((k) => !seen.has(k));
if (missing.length) throw new Error(`no case covers: ${missing.join(', ')}`);

// The cases the oracle must also run through ngspice.
for (const name of [
  'line on a substrate (er 3.66) between stubs, netlisted',
  'realized L match with Q (E24)',
  'app path: default-Q loss model',
  'app path: realized (E12) and packaged (0402, 0603)',
]) {
  const c = all.find((x) => x.name === name);
  if (!c?.spice.netlist) throw new Error(`${name}: expected a SPICE netlist`);
}

const fits = fitCases();
const d3 = d3Cases();
const d4 = d4Cases();
const d5 = d5Cases();
const d6 = await d6Cases();
writeFileSync(
  out,
  JSON.stringify(
    { generator: 'tools/oracle/export.mjs', version: 1, cases: all, fits, d3, d4, d5, d6 },
    null,
    1,
  ) + '\n',
);
const withSpice = all.filter((c) => c.spice.netlist).length;
console.log(
  `Wrote ${all.length} cases (${withSpice} with a SPICE netlist), ${fits.length} fitted loads and ${d3.sensitivities.length + d3.yields.length + d3.wilson.length + d3.draws.length} D3 cases, ${d5.cascades.length} D5 part cascades and the D6 closed loop to ${out}`,
);
// The module runner may keep handles open; the work is done.
process.exit(0);
