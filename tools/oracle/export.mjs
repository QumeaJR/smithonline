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
  DEFAULT_PACKAGES,
  designStubFilter,
  evaluateAt,
  feasibility,
  interpolatedLoad,
  ladderFromXmlsc,
  measuredLoadInfo,
  ladderSParameters,
  ladderStages,
  ladderParameters,
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
function appBuilt(design) {
  const realization = appRealize.realizeDesign(design, appRealize.effectiveElements(design));
  const built = appExport.builtNetwork(design, DEFAULT_PACKAGES, realization);
  return { realization, built, frequencies: appExport.exportFrequencies(design) };
}

function appCase(name, design) {
  const { built, frequencies } = appBuilt(design);
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
 * simple network, and its correlated draws. check.py recomputes the
 * derivatives as central differences of scikit-rf networks, the yield by
 * brute-force integration over the tolerance box with numpy, the corner by
 * evaluating every corner and the grid, and the correlation with numpy.
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
      corner: { vswr: corner.worst.vswr, signs: corner.worst.signs },
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
writeFileSync(
  out,
  JSON.stringify(
    { generator: 'tools/oracle/export.mjs', version: 1, cases: all, fits, d3 },
    null,
    1,
  ) + '\n',
);
const withSpice = all.filter((c) => c.spice.netlist).length;
console.log(
  `Wrote ${all.length} cases (${withSpice} with a SPICE netlist), ${fits.length} fitted loads and ${d3.sensitivities.length + d3.yields.length + d3.wilson.length + d3.draws.length} D3 cases to ${out}`,
);
// The module runner may keep handles open; the work is done.
process.exit(0);
