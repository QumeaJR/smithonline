/**
 * Seven guided tours beyond the basics: bandwidth and the band optimizer,
 * broadband matching with an element cap, Realize mode and the BOM, losses
 * and component packages, a power amplifier output match over datapoints,
 * Pi and T networks at a chosen Q, and the quarter-wave transformer.
 *
 * Same contract as tours.ts: a step is a pure function of the design, and
 * every number narrated comes from the evaluation the chart uses. The two
 * search tours (optimizer, broadband) run the same core functions the app's
 * workers run, with a fixed seed so the story is the same every time.
 */
import {
  bomRows,
  broadbandMatch,
  complex,
  evaluateAt,
  evaluateLadder,
  feasibility,
  interpolatedLoad,
  lengthFromWavelengths,
  lMatch,
  optimizeBand,
  packageById,
  packageSelfResonance,
  piMatch,
  sweepPoints,
  teeMatch,
  vswrTowards,
  worstVswr,
  type Element,
  type LoadModel,
  type PackageId,
  type SweepLoad,
} from '@smithonline/core';
import { useDesignStore } from '../store/useDesignStore';
import { usePackages } from '../store/usePackages';
import { userDatapoints } from './datapoints';
import { identify, targetOf, type Design } from './design';
import { fmtNum } from './format';
import { minimumQ } from './match';
import { designLadder, effectiveElements, packagedElements, realizeDesign } from './realize';
import {
  addElement,
  bandwidthText,
  closingLPart,
  edited,
  evaluate,
  firstLPart,
  hz,
  ohm,
  partText,
  startDesign,
  val,
  type Tour,
} from './tourKit';

/* ------------------------------------------------------------- helpers */

/** The two-part L-network from the load to the target, shorter first move. */
function withLNetwork(d: Design): Design {
  const first = firstLPart(d, 'any');
  if (!first) return d;
  const d1 = addElement(d, first);
  const second = closingLPart(d1);
  return second ? addElement(d1, second) : d1;
}

function withSweep(d: Design, start: number, stop: number, points: number): Design {
  return { ...d, sweep: { ...d.sweep, enabled: true, start, stop, points } };
}

/** The frequencies of the design's sweep, the band every search in these tours works on. */
function bandOf(d: Design): number[] {
  return sweepPoints(d.sweep.start, d.sweep.stop, d.sweep.points);
}

/** The whole network replaced, with fresh identities and colours. */
function replaceElements(d: Design, elements: readonly Element[]): Design {
  return { ...d, elements: identify(elements) };
}

/** New values for the parts that are there, keeping their identities and colours. */
function withValues(d: Design, elements: readonly Element[]): Design {
  if (elements.length !== d.elements.length) return replaceElements(d, elements);
  return { ...d, elements: d.elements.map((el, i) => ({ ...el, ...elements[i] })) };
}

/** The load across the band: the sweep loads when the design has them, else the fixed load. */
function loadModelOf(d: Design): LoadModel {
  const loads = d.sweep.loads;
  return loads && loads.length >= 2 ? interpolatedLoad(loads) : d.load;
}

function worstOver(d: Design, elements: readonly Element[] = d.elements): number {
  return worstVswr(elements, loadModelOf(d), d.z0, bandOf(d), targetOf(d));
}

/** A VSWR as text; the test for an open circuit or a total reflection has no number. */
function vswr(v: number): string {
  return Number.isFinite(v) && v < 100 ? fmtNum(v, 2) : 'above 100';
}

function vswrAtDesign(d: Design): number {
  return vswrTowards(evaluate(d).zin, targetOf(d));
}

const list = (items: readonly string[]): string =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

function partsText(d: Design): string {
  return list(d.elements.map((el) => partText(el, d.frequency)));
}

function unitOf(part: 'R' | 'L' | 'C'): string {
  return part === 'L' ? 'H' : part === 'C' ? 'F' : 'Ω';
}

const pct = (x: number, digits = 1): string =>
  `${x < 0 ? '-' : '+'}${Math.abs(x).toFixed(digits)} %`;

/* ----------------------------------------------- tour 4: band optimizer */

const OPTIMIZER = { restarts: 4, iterations: 200, seed: 1 } as const;

function optimized(d: Design): Design {
  const ladder = designLadder(d, effectiveElements(d));
  const r = optimizeBand(ladder, bandOf(d), { ...OPTIMIZER, target: targetOf(d) });
  return r.after < r.before ? withValues(d, r.elements) : d;
}

/** The exact L-network for the design's load, to compare the optimized values against. */
function exactNetwork(d: Design): Design {
  return withLNetwork({ ...d, elements: [] });
}

function valueChanges(d: Design): string | null {
  const exact = exactNetwork(d);
  if (exact.elements.length !== d.elements.length) return null;
  const changes: string[] = [];
  for (let i = 0; i < d.elements.length; i++) {
    const was = exact.elements[i];
    const now = d.elements[i];
    if (!was || !now || was.kind !== now.kind || (now.kind !== 'L' && now.kind !== 'C')) {
      return null;
    }
    const unit = now.kind === 'L' ? 'H' : 'F';
    changes.push(
      `the ${now.orientation} ${now.kind === 'L' ? 'inductor' : 'capacitor'} from ${val((was as { value: number }).value, unit)} to ${val(now.value, unit)}`,
    );
  }
  return list(changes);
}

const bandOptimizer: Tour = {
  id: 'band-optimizer',
  title: 'Bandwidth and the band optimizer',
  blurb:
    'A load with Q = 6: give up the exact centre match for the lowest worst-case VSWR over a band.',
  start: () =>
    withSweep(
      withLNetwork(startDesign('band optimizer', { frequency: 150e6, load: complex(10, 60) })),
      130e6,
      170e6,
      61,
    ),
  steps: [
    {
      title: 'An exact match and its band',
      apply: (d) => d,
      narrate: (d) => {
        const r = evaluate(d);
        if (d.elements.length !== 2) return edited();
        const R = Math.max(d.load.re, 1e-9);
        const qFixed = Math.sqrt(Math.max(Math.max(d.z0, R) / Math.min(d.z0, R) - 1, 0));
        return [
          `An L-network as in the first tour, for a harder load: ${partsText(d)} take ZL = ${ohm(d.load)} to Zin = ${ohm(r.zin, 2)} at ${hz(d.frequency)}, exactly.`,
          bandwidthText(d),
          `The loaded Q of the path is ${fmtNum(r.loadedQ, 2)}, set by the load's own X / R = ${fmtNum(Math.abs(d.load.im) / R, 2)}. An L-network cannot lower it: its own Q between the two resistances is sqrt(${fmtNum(Math.max(d.z0, R), 1)} / ${fmtNum(Math.min(d.z0, R), 1)} - 1) = ${fmtNum(qFixed, 2)}, and it takes the point from where the load puts it. Over the sweep of ${hz(d.sweep.start)} to ${hz(d.sweep.stop)} the worst VSWR is ${vswr(worstOver(d))}, at one of the edges.`,
        ];
      },
    },
    {
      title: 'Optimize over the band',
      apply: optimized,
      narrate: (d) => {
        if (d.elements.length !== 2) return edited();
        const exact = exactNetwork(d);
        const before = worstOver(d, exact.elements);
        const after = worstOver(d);
        const changes = valueChanges(d);
        return [
          `The optimizer varied both values to minimize the worst VSWR over ${hz(d.sweep.start)} to ${hz(d.sweep.stop)}: it fell from ${vswr(before)} to ${vswr(after)}.${changes ? ` It moved ${changes}.` : ''}`,
          `The price is the centre: Zin at ${hz(d.frequency)} is now ${ohm(evaluate(d).zin, 1)}, VSWR ${vswr(vswrAtDesign(d))} instead of 1. A flat band and a perfect centre are two different goals, and the optimizer only knows the band.`,
          bandwidthText(d),
        ];
      },
    },
    {
      title: 'A wider band asks for more',
      apply: (d) => optimized(withSweep(d, 120e6, 180e6, 61)),
      narrate: (d) => {
        if (d.elements.length !== 2) return edited();
        const exact = exactNetwork(d);
        return [
          `With the sweep widened to ${hz(d.sweep.start)} to ${hz(d.sweep.stop)} and the optimizer run again, the worst VSWR over the band is ${vswr(worstOver(d))}; the exact network would show ${vswr(worstOver(d, exact.elements))} there. The wider the band, the higher the best worst case, and two parts have nothing more to give.`,
          'A fixed R + jX load has no bandwidth of its own, so no Bode-Fano floor is quoted for it: the formula would promise any band you like. A load measured over frequency does have one; the broadband tour uses such a load and gets the floor next to its results.',
          'More parts can do better than two over a wide band. That is the broadband search of the next tour, which also caps how many parts it may use.',
        ];
      },
    },
    {
      title: 'Where this lives',
      apply: (d) => d,
      narrate: (d) => [
        `Optimize band in the header runs this on the sweep range (here ${hz(d.sweep.start)} to ${hz(d.sweep.stop)}), in the background with progress, and shows the worst VSWR before and after. With limit areas drawn in the Response view it minimizes their violation instead of the worst VSWR.`,
        'Usable bandwidth in the right panel reports the span around the design frequency inside a VSWR limit you set; the Response view shades it. Undo takes the whole tour back out in one step.',
      ],
    },
  ],
};

/* ---------------------------------------------------- tour 5: broadband */

/** An illustrative antenna: 10 ohm in series with 50 nH, over 70 to 130 MHz. Not a measured part. */
const ANTENNA: readonly SweepLoad[] = sweepPoints(70e6, 130e6, 61).map((f) => ({
  frequency: f,
  z: complex(10, 2 * Math.PI * f * 50e-9),
}));

function searched(d: Design, maxElements: number): Design {
  const result = broadbandMatch(bandOf(d), {
    load: loadModelOf(d),
    z0: d.z0,
    target: targetOf(d),
    maxElements,
    limit: 1,
    seed: 11,
  });
  const best = result.candidates[0];
  return best ? replaceElements(d, best.elements) : d;
}

function floorText(d: Design): string {
  const floor = feasibility(loadModelOf(d), bandOf(d));
  if (!floor) {
    return 'The load has no bandwidth of its own here, so no Bode-Fano floor is quoted.';
  }
  return `The load Q at the band centre is ${fmtNum(floor.q, 2)} and the band is ${fmtNum(100 * floor.fractionalBandwidth, 0)} % wide, so Bode and Fano put the floor at VSWR ${vswr(floor.floor)}: no lossless network, however many parts, holds the whole band below it.`;
}

function searchedText(d: Design, cap: number): readonly string[] {
  if (d.elements.length === 0) return edited();
  const n = d.elements.length;
  return [
    `The best network of up to ${cap} parts has ${n}: ${partsText(d)}. Its worst VSWR over ${hz(d.sweep.start)} to ${hz(d.sweep.stop)} is ${vswr(worstOver(d))}; at ${hz(d.frequency)} alone it is ${vswr(vswrAtDesign(d))}, so the exact centre match is given up for the band.`,
  ];
}

const broadband: Tour = {
  id: 'broadband',
  title: 'Broadband match with an element cap',
  blurb: 'An antenna over an octave: how much each extra part buys against the Bode-Fano floor.',
  start: () =>
    startDesign('broadband match', {
      frequency: 100e6,
      load: ANTENNA[30]?.z ?? complex(10, 31.4),
      sweep: {
        enabled: true,
        start: 70e6,
        stop: 130e6,
        points: 61,
        loads: ANTENNA,
        loadsName: 'antenna (synthetic)',
        mode: 'datapoints',
      },
    }),
  steps: [
    {
      title: 'A load with a bandwidth of its own',
      apply: (d) => d,
      narrate: (d) => {
        const loads = d.sweep.loads ?? [];
        const lo = loads[0];
        const hi = loads[loads.length - 1];
        if (!lo || !hi) return edited();
        return [
          `This load is not one point but ${loads.length} of them, one per frequency: ${ohm(lo.z)} at ${hz(lo.frequency)}, ${ohm(d.load)} at ${hz(d.frequency)}, ${ohm(hi.z)} at ${hz(hi.frequency)}. It is an illustrative antenna, 10 Ω in series with 50 nH, whose reactance climbs across the band. The sweep draws it as a datapoint sweep.`,
          floorText(d),
          `Without any network the worst VSWR over the band is ${vswr(worstOver(d, []))}.`,
        ];
      },
    },
    {
      title: 'The L-network at the centre',
      apply: withLNetwork,
      narrate: (d) => {
        if (d.elements.length !== 2) return edited();
        return [
          `${partsText(d)} match the centre point exactly: VSWR ${vswr(vswrAtDesign(d))} at ${hz(d.frequency)}.`,
          `Over the whole band the worst VSWR is ${vswr(worstOver(d))}. ${floorText(d)}`,
          'The two values were chosen for one frequency. The search of the next steps chooses them for the band, then adds parts.',
        ];
      },
    },
    {
      title: 'Two parts, chosen for the band',
      apply: (d) => searched(d, 2),
      narrate: (d) => searchedText(d, 2),
    },
    {
      title: 'Up to three parts',
      apply: (d) => searched(d, 3),
      narrate: (d) => [
        ...searchedText(d, 3),
        'A third part adds a second resonance to the path, which is what lets the match follow the load as its reactance climbs.',
      ],
    },
    {
      title: 'Up to four parts, and the cap',
      apply: (d) => searched(d, 4),
      narrate: (d) => [
        ...searchedText(d, 4),
        floorText(d),
        'Each part beyond this buys less and costs loss, tolerance and board space, which is why the search takes a cap. Auto match, Broadband tab: the same search over the sweep band with the cap you set (up to 8), ranked by worst VSWR and then by part count, run in the background, the floor next to the list. Hover previews a candidate, click applies it. Undo takes the whole tour back out in one step.',
      ],
    },
  ],
};

/* ------------------------------------------------------ tour 6: realize */

const STOCK = '150 pF, 180 pF, 220 pF, 22 pF, 33 pF, 39 nH, 47 nH, 56 nH';

function realizedText(d: Design): readonly string[] {
  const realization = realizeDesign(d, effectiveElements(d));
  if (!realization || d.elements.length === 0) return edited();
  const parts = realization.elements.flatMap((re) =>
    re.parts.map(
      (p) =>
        `${val(p.ideal, unitOf(p.part))} became ${val(p.realized, unitOf(p.part))} (${p.source}, ${pct(100 * p.deviation)})`,
    ),
  );
  const zin = realization.result.zin;
  return [
    `${realization.sourceLabel}: ${list(parts)}.`,
    `The realized network presents Zin = ${ohm(zin, 1)}, VSWR ${vswr(vswrTowards(zin, targetOf(d)))} against ${vswr(vswrAtDesign(d))} for the ideal values. The chart draws the realized path as a second locus next to the ideal one, and each card shows both values.`,
  ];
}

const realize: Tour = {
  id: 'realize',
  title: 'Realize: standard values and the BOM',
  blurb: 'Snap the ideal parts to E24, E96 or your own stock, and read the bill of materials.',
  start: () =>
    withSweep(
      withLNetwork(startDesign('realize', { frequency: 150e6, load: complex(20, 30) })),
      100e6,
      200e6,
      101,
    ),
  steps: [
    {
      title: 'The ideal values',
      apply: (d) => d,
      narrate: (d) => {
        if (d.elements.length !== 2) return edited();
        return [
          `The L-network ${partsText(d)} is exact at ${hz(d.frequency)}: VSWR ${vswr(vswrAtDesign(d))}.`,
          'No catalogue has these values. A real part comes from a series of preferred numbers (E24 has 24 values per decade, 5 % apart; E96 has 96, 1 % apart), or from the reel you already own. Realize mode picks, for every part, the catalogue value that keeps the match closest.',
        ];
      },
    },
    {
      title: 'Snap to E24',
      apply: (d) => ({
        ...d,
        realize: { ...d.realize, enabled: true, series: 'E24', scope: 'all' },
      }),
      narrate: (d) => [
        ...realizedText(d),
        'Realize picks between the two bracketing catalogue values the one that gives the lower VSWR with all the other parts, not the nearer one by itself: a part that is a little high can be paid back by a neighbour that is a little low.',
      ],
    },
    {
      title: 'E96 instead',
      apply: (d) => ({ ...d, realize: { ...d.realize, enabled: true, series: 'E96' } }),
      narrate: (d) => [
        ...realizedText(d),
        'A finer series lands closer, at the price of 1 % parts. Whether that matters depends on the band: compare the Response view, where the realized curve is drawn next to the ideal one.',
      ],
    },
    {
      title: 'Your own stock',
      apply: (d) => ({
        ...d,
        realize: { ...d.realize, enabled: true, series: 'stock', stockText: STOCK },
      }),
      narrate: (d) => [
        ...realizedText(d),
        `The stock list is text pasted into the Realize panel, here "${STOCK}". A unit sorts a value to its part kind; a bare number is offered to every kind. This is the mode for a kit box or a reel list.`,
      ],
    },
    {
      title: 'The bill of materials',
      apply: (d) => d,
      narrate: (d) => {
        const realization = realizeDesign(d, effectiveElements(d));
        if (!realization || d.elements.length === 0) return edited();
        const rows = bomRows(realization).map(
          (row) =>
            `${row.element}: ${val(row.realized, row.unit)} (${row.source}${row.deviationPercent === null ? '' : `, ${pct(row.deviationPercent)}`})`,
        );
        return [
          `The BOM lists what to order: ${list(rows)}. The Realize panel exports it as CSV; with a source power set, each row also carries peak voltage and RMS current.`,
          'With Realize on, the tuning sliders step through catalogue values only, and Auto match returns snapped networks ranked by the VSWR after snapping. Undo takes the whole tour back out in one step.',
        ];
      },
    },
  ],
};

/* --------------------------------------------- tour 7: losses, packages */

function withPackage(d: Design, id: PackageId): Design {
  return {
    ...d,
    elements: d.elements.map((el) =>
      el.kind === 'L' || el.kind === 'C' ? { ...el, package: id } : el,
    ),
  };
}

function packagedText(d: Design): readonly string[] {
  const table = usePackages.getState().table;
  const built = packagedElements(effectiveElements(d), table);
  if (!built || d.elements.length === 0) return edited();
  const notes: string[] = [];
  for (const el of d.elements) {
    if ((el.kind !== 'L' && el.kind !== 'C') || el.package === undefined) continue;
    const pkg = packageById(table, el.package);
    if (!pkg) continue;
    const srf = packageSelfResonance(el, pkg);
    const parasitic =
      el.kind === 'C'
        ? `${val(pkg.esl, 'H')} in series`
        : `${val(pkg.cp, 'F')} across it and ${val(pkg.esr, 'Ω')} in series`;
    notes.push(
      `the ${el.orientation} ${el.kind === 'L' ? 'inductor' : 'capacitor'} in ${pkg.label} gets ${parasitic} and ${val(pkg.pad, 'F')} of pad capacitance${srf ? `, self-resonant at ${hz(srf)}` : ''}`,
    );
  }
  const r = evaluateLadder(designLadder(d, built), { arcSteps: 0 });
  return [
    `As built: ${list(notes)}.`,
    `With the parasitics in the chain Zin = ${ohm(r.zin, 1)}, VSWR ${vswr(vswrTowards(r.zin, targetOf(d)))}. The chart draws this as a third, dotted locus with diamond markers, and the Response view plots it dotted.`,
  ];
}

const packages: Tour = {
  id: 'packages',
  title: 'Losses and component packages',
  blurb: 'Finite Q and chip parasitics at 2.45 GHz: what the network does once it is real.',
  start: () =>
    withSweep(
      withLNetwork(
        startDesign('losses and packages', { frequency: 2.45e9, load: complex(10, -20) }),
      ),
      2.0e9,
      2.9e9,
      91,
    ),
  steps: [
    {
      title: 'The ideal network',
      apply: (d) => d,
      narrate: (d) => {
        if (d.elements.length !== 2) return edited();
        return [
          `At ${hz(d.frequency)} the L-network ${partsText(d)} takes ZL = ${ohm(d.load)} to Zin = ${ohm(evaluate(d).zin, 2)}.`,
          'Parts of a few nH and a few pF are where the ideal model stops being enough: a chip inductor has resistance and a capacitance across it, a chip capacitor has inductance in its body and its pads, and both resonate on their own not far above this frequency.',
        ];
      },
    },
    {
      title: 'Finite Q',
      apply: (d) => ({ ...d, losses: { enabled: true, inductorQ: 30, capacitorQ: 200 } }),
      narrate: (d) => {
        const r = evaluate(d);
        if (d.elements.length !== 2 || !d.losses.enabled) return edited();
        return [
          `With the loss model on, every inductor without a Q of its own gets Q = ${fmtNum(d.losses.inductorQ, 0)} and every capacitor Q = ${fmtNum(d.losses.capacitorQ, 0)}. The chart now evaluates the lossy parts: Zin = ${ohm(r.zin, 2)}, VSWR ${vswr(vswrTowards(r.zin, targetOf(d)))}.`,
          `The transducer gain through the network is ${fmtNum(r.s21.db, 2)} dB. A lossless, matched network gives 0 dB; what is missing is dissipated in the parts, mostly in the inductor, whose Q is the lower one.`,
          'The loss model is in the Realize panel. A Q typed on a part card overrides the default for that part.',
        ];
      },
    },
    {
      title: 'Chip packages: 0402',
      apply: (d) => withPackage(d, '0402'),
      narrate: (d) => [
        ...packagedText(d),
        'A package is chosen per part on its card. The card shows the self-resonant frequency; a part used near it is a different part from the one on the schematic.',
      ],
    },
    {
      title: 'A bigger package: 0805',
      apply: (d) => withPackage(d, '0805'),
      narrate: (d) => [
        ...packagedText(d),
        'A bigger body has more series inductance and more pad capacitance, so the as-built locus moves further from the ideal one. The parasitics table with its typical values and the source of each row is in Settings; replace the numbers with the datasheet of the parts you buy. Undo takes the whole tour back out in one step.',
      ],
    },
  ],
};

/* --------------------------------------------------- tour 8: PA output */

/** Illustrative optimum load impedances of a power transistor over its band, not a datasheet. */
const PA_POINTS: readonly SweepLoad[] = [
  { frequency: 850e6, z: complex(8, 4) },
  { frequency: 900e6, z: complex(7, 6) },
  { frequency: 950e6, z: complex(6, 8) },
];

function datapointVswrs(d: Design): { label: string; vswr: number }[] {
  const ladder = designLadder(d, effectiveElements(d));
  const target = targetOf(d);
  return userDatapoints(d).map((dp, i) => ({
    label: `DP${i + 1} at ${hz(dp.frequency)}`,
    vswr: vswrTowards(evaluateAt(ladder, dp.frequency, dp.z, { arcSteps: 0 }).zin, target),
  }));
}

function datapointsText(d: Design): string {
  return list(datapointVswrs(d).map((p) => `${p.label} VSWR ${vswr(p.vswr)}`));
}

function twoSection(d: Design): Design {
  const t = targetOf(d);
  const rMid = Math.sqrt(Math.max(d.load.re, 1e-9) * Math.max(t.re, 1e-9));
  const a = lMatch(d.load, complex(rMid, 0), d.frequency)[0];
  const b = lMatch(complex(rMid, 0), t, d.frequency)[0];
  if (!a || !b) return d;
  return replaceElements(d, [...a.elements, ...b.elements]);
}

const paOutput: Tour = {
  id: 'pa-output',
  title: 'PA output match over datapoints',
  blurb: 'A transistor wants 7 ohm at 900 MHz and something else at the band edges.',
  start: () =>
    startDesign('PA output match', {
      frequency: 900e6,
      load: PA_POINTS[1]?.z ?? complex(7, 6),
      datapoints: [PA_POINTS[0] as SweepLoad, PA_POINTS[2] as SweepLoad],
      startSlot: 1,
    }),
  steps: [
    {
      title: 'Three datapoints, one start',
      apply: (d) => d,
      narrate: (d) => {
        const points = userDatapoints(d);
        const info = evaluate(d).info[0];
        if (points.length < 2 || !info) return edited();
        return [
          `A power transistor delivers its rated power into one particular load, found by load pull, and that load changes with frequency. Here it is ${list(points.map((p) => `${ohm(p.z)} at ${hz(p.frequency)}`))}, illustrative values. Each is a user datapoint; the design frequency and the start of the chain sit on the one at ${hz(d.frequency)}.`,
          `The job of the output network is to turn the 50 Ω antenna side into these impedances. In this chart the chain runs from the datapoint towards 50 Ω, which is the same network seen from the other end. The start point has |Γ| = ${fmtNum(info.gammaMag, 3)}, VSWR ${vswr(info.vswr)}: a long way to go.`,
        ];
      },
    },
    {
      title: 'Match at the centre',
      apply: withLNetwork,
      narrate: (d) => {
        const r = evaluate(d);
        if (d.elements.length !== 2) return edited();
        return [
          `${partsText(d)} take the start point to Zin = ${ohm(r.zin, 2)} at ${hz(d.frequency)}.`,
          `The loaded Q is ${fmtNum(r.loadedQ, 2)}: a ${fmtNum(targetOf(d).re / Math.max(d.load.re, 1e-9), 1)}:1 resistance ratio in one step is a steep climb, and the band will be narrow.`,
        ];
      },
    },
    {
      title: 'The other datapoints',
      apply: (d) => ({ ...d, sweep: { ...d.sweep, enabled: true, mode: 'datapoints' } }),
      narrate: (d) => {
        if (d.elements.length === 0 || !d.sweep.enabled) return edited();
        return [
          `The datapoint sweep evaluates the network at every datapoint with its own frequency and its own load: ${datapointsText(d)}.`,
          'A frequency sweep would hold the load fixed at the start value, which is not what this transistor does; the datapoint sweep is the one to read here. Each datapoint can be made the start from the right panel, and Auto match then works from that one.',
        ];
      },
    },
    {
      title: 'Two sections for a lower Q',
      apply: twoSection,
      narrate: (d) => {
        const r = evaluate(d);
        if (d.elements.length !== 4) return edited();
        const t = targetOf(d);
        const rMid = Math.sqrt(Math.max(d.load.re, 1e-9) * Math.max(t.re, 1e-9));
        const single = withLNetwork({ ...d, elements: [] });
        const before = datapointVswrs(single);
        return [
          `The network is now two L-sections through an intermediate resistance of sqrt(${fmtNum(d.load.re, 1)} x ${fmtNum(t.re, 1)}) = ${fmtNum(rMid, 1)} Ω: ${partsText(d)}. The loaded Q drops to ${fmtNum(r.loadedQ, 2)}.`,
          `At the datapoints: ${datapointsText(d)}, against ${list(before.map((p) => vswr(p.vswr)))} with the single section.`,
          'Splitting the ratio over two sections is the standard way to widen a high-ratio match; three sections widen it further. Undo takes the whole tour back out in one step.',
        ];
      },
    },
  ],
};

/* ------------------------------------------------------- tour 9: Pi, T */

function withTopology(d: Design, topology: 'Pi' | 'T', q: number): Design {
  const t = targetOf(d);
  const sol = (topology === 'Pi' ? piMatch : teeMatch)(d.load, t, d.frequency, q)[0];
  return sol ? replaceElements(d, sol.elements) : d;
}

function topologyText(d: Design, topology: 'Pi' | 'T', q: number): readonly string[] {
  const r = evaluate(d);
  if (d.elements.length !== 3) return edited();
  const t = targetOf(d);
  const high = Math.max(d.load.re, t.re);
  const low = Math.min(d.load.re, t.re);
  const virtual = topology === 'Pi' ? high / (1 + q * q) : low * (1 + q * q);
  return [
    `A ${topology} network for Q = ${fmtNum(q, 1)}: ${partsText(d)}. The chart reaches Zin = ${ohm(r.zin, 2)} with a loaded Q of ${fmtNum(r.loadedQ, 2)}.`,
    topology === 'Pi'
      ? `A Pi is two L-networks back to back through a virtual resistance Rv = Rhigh / (1 + Q²) = ${fmtNum(virtual, 1)} Ω, lower than both ends: the point dips through it on the way.`
      : `A T is two L-networks back to back through a virtual resistance Rv = Rlow x (1 + Q²) = ${fmtNum(virtual, 0)} Ω, higher than both ends: the point climbs through it on the way.`,
    bandwidthText(d),
  ];
}

const piT: Tour = {
  id: 'pi-t',
  title: 'Pi and T networks at a chosen Q',
  blurb: 'A third part lets you choose the Q: selectivity for a transmitter, or bandwidth.',
  start: () =>
    withSweep(startDesign('Pi and T', { frequency: 7e6, load: complex(200, 0) }), 5e6, 9e6, 81),
  steps: [
    {
      title: 'The minimum Q',
      apply: (d) => d,
      narrate: (d) => {
        const info = evaluate(d).info[0];
        if (!info) return edited();
        const qmin = minimumQ('Pi', d.load, targetOf(d));
        return [
          `The load ZL = ${ohm(d.load)} at ${hz(d.frequency)} has VSWR ${vswr(info.vswr)} in a ${d.z0} Ω system.`,
          `An L-network fixes its own Q at sqrt(Rhigh / Rlow - 1) = ${fmtNum(qmin, 2)}, the lowest any network between these two resistances can have. A third part lets you choose a higher Q, which narrows the band but makes the network a filter: a transmitter's output stage uses that to suppress harmonics.`,
        ];
      },
    },
    {
      title: 'The L-network for reference',
      apply: withLNetwork,
      narrate: (d) => {
        const r = evaluate(d);
        if (d.elements.length !== 2) return edited();
        return [
          `${partsText(d)}: Zin = ${ohm(r.zin, 2)}, loaded Q ${fmtNum(r.loadedQ, 2)}.`,
          bandwidthText(d),
        ];
      },
    },
    {
      title: 'Pi at Q = 4',
      apply: (d) => withTopology(d, 'Pi', 4),
      narrate: (d) => topologyText(d, 'Pi', 4),
    },
    {
      title: 'Pi at Q = 8',
      apply: (d) => withTopology(d, 'Pi', 8),
      narrate: (d) => [
        ...topologyText(d, 'Pi', 8),
        'Twice the Q, roughly half the band, and steeper skirts for the harmonics. The parts also carry more current and voltage: with a source power set, the cards and the BOM show the stress on each.',
      ],
    },
    {
      title: 'T at Q = 4',
      apply: (d) => withTopology(d, 'T', 4),
      narrate: (d) => [
        ...topologyText(d, 'T', 4),
        'The T does the same job with series parts at both ends, which suits a low-impedance side where a shunt part would need an awkward value. Auto match, Add parts, offers Pi and T with a Q field; below the minimum Q nothing is offered, because there is no virtual resistance to pass through. Undo takes the whole tour back out in one step.',
      ],
    },
  ],
};

/* ------------------------------------------- tour 10: quarter wave */

function line(z0: number, length: number, f: number): Element {
  return { kind: 'line', z0, length, refFrequency: f, er: 1, alphaDbPerM: 0 };
}

/**
 * Fractional bandwidth of a single quarter-wave section for a reflection
 * magnitude limit, the textbook result for a real load: 2 - (4 / pi) acos of
 * the argument below. Null when the whole band stays inside the limit.
 */
export function quarterWaveBandwidth(z0: number, zl: number, vswrLimit: number): number | null {
  const gm = (vswrLimit - 1) / (vswrLimit + 1);
  if (!(gm > 0) || !(gm < 1) || !(z0 > 0) || !(zl > 0) || zl === z0) return null;
  const arg = ((gm / Math.sqrt(1 - gm * gm)) * 2 * Math.sqrt(z0 * zl)) / Math.abs(zl - z0);
  if (!(arg < 1)) return null;
  return 2 - (4 / Math.PI) * Math.acos(arg);
}

const quarterWave: Tour = {
  id: 'quarter-wave',
  title: 'Quarter-wave transformer',
  blurb: 'One line of the right impedance matches a real load; two lines match it wider.',
  start: () =>
    withSweep(
      startDesign('quarter wave', { frequency: 2e9, load: complex(200, 0) }),
      1e9,
      3e9,
      201,
    ),
  steps: [
    {
      title: 'A real load',
      apply: (d) => d,
      narrate: (d) => {
        const info = evaluate(d).info[0];
        if (!info) return edited();
        return [
          `The load ZL = ${ohm(d.load)} at ${hz(d.frequency)} is real, so it sits on the horizontal axis of the chart: |Γ| = ${fmtNum(info.gammaMag, 3)}, VSWR ${vswr(info.vswr)}.`,
          `A quarter-wave line inverts a normalized impedance: Zin = Z1² / ZL. Choose Z1 = sqrt(Z0 x ZL) = ${fmtNum(Math.sqrt(d.z0 * Math.max(d.load.re, 0)), 1)} Ω and Zin is Z0. No lumped part needed.`,
        ];
      },
    },
    {
      title: 'One section',
      apply: (d) =>
        addElement(d, line(Math.sqrt(d.z0 * Math.max(d.load.re, 1e-9)), 0.25, d.frequency)),
      narrate: (d) => {
        const r = evaluate(d);
        const e0 = d.elements[0];
        if (d.elements.length !== 1 || !e0 || e0.kind !== 'line') return edited();
        return [
          `Added ${partText(e0, d.frequency)}: the point swings half way round the chart, at constant |Γ| about the line's own Z0, and lands at Zin = ${ohm(r.zin, 2)}.`,
          `In air a quarter wave at ${hz(d.frequency)} is ${val(lengthFromWavelengths(e0.length, d.frequency, 1), 'm')}; on a board it is shorter by the square root of the effective permittivity. The Dimensions button on the line card gives track width and length for your substrate.`,
        ];
      },
    },
    {
      title: 'How wide is it?',
      apply: (d) => ({
        ...d,
        vswrCircles: [useDesignStore.getState().response.vswrLimit],
      }),
      narrate: (d) => {
        if (d.elements.length !== 1) return edited();
        const limit = useDesignStore.getState().response.vswrLimit;
        const theory = quarterWaveBandwidth(d.z0, d.load.re, limit);
        return [
          `The VSWR circle at ${fmtNum(limit, 2)} is drawn, so the chart shows where the sweep locus (${hz(d.sweep.start)} to ${hz(d.sweep.stop)}) leaves it. ${bandwidthText(d)}`,
          theory === null
            ? 'For this load and limit the textbook formula gives no band edge: the whole sweep stays inside the circle.'
            : `The textbook result for one section with a real load gives a fractional bandwidth of ${fmtNum(100 * theory, 1)} % for this limit, 2 - (4 / π) acos of a term in Γmax and the two resistances; the readout above is the same number, found by searching the sweep.`,
          'The band is set by the ratio ZL / Z0 alone: the larger the step, the narrower the band.',
        ];
      },
    },
    {
      title: 'Two sections, maximally flat',
      apply: (d) => {
        const zl = Math.max(d.load.re, 1e-9);
        const ratio = zl / d.z0;
        // Binomial transformer, N = 2: the section next to the load takes three quarters of the log step.
        const nearLoad = d.z0 * ratio ** 0.75;
        const nearSource = d.z0 * ratio ** 0.25;
        return replaceElements(d, [
          line(nearLoad, 0.25, d.frequency),
          line(nearSource, 0.25, d.frequency),
        ]);
      },
      narrate: (d) => {
        const r = evaluate(d);
        const [a, b] = d.elements;
        if (d.elements.length !== 2 || a?.kind !== 'line' || b?.kind !== 'line') return edited();
        return [
          `Two quarter-wave sections, ${fmtNum(a.z0, 1)} Ω next to the load and ${fmtNum(b.z0, 1)} Ω next to the source: the binomial (maximally flat) split of the impedance step, Z0 x (ZL / Z0) to the power 3/4 and 1/4. Zin = ${ohm(r.zin, 2)} at ${hz(d.frequency)}.`,
          bandwidthText(d),
          'Each section takes a smaller step, so each reflection is smaller and they cancel over a wider band. A Chebyshev split would trade a ripple inside the band for an even wider one. The Transformer tab in Auto match designs these for you: binomial or Chebyshev, one to six sections, with the bandwidth of each at your |Γ| limit. Undo takes the whole tour back out in one step.',
        ];
      },
    },
  ],
};

export const ADVANCED_TOURS: readonly Tour[] = [
  bandOptimizer,
  broadband,
  realize,
  packages,
  paOutput,
  piT,
  quarterWave,
];
