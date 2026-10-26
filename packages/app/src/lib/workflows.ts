/**
 * The guided workflows of docs/09 section 3: what a senior RF engineer does
 * with a measured load, a robust match, a buildable board, an independent
 * check, an amplifier, the broadband limits and real parts. Each step points
 * at a real control (a `data-tour` anchor), opens what it needs and, where a
 * step waits for the user, moves on once it is done. Every number in the
 * text comes from the evaluation or from the last run, never typed in.
 */
import {
  complex,
  gammaToZ,
  multisectionTransformer,
  stability,
  type Element,
  type PackageId,
} from '@smithonline/core';
import { useBandLimit, type BandBest } from '../store/useBandLimit';
import { useDesignStore } from '../store/useDesignStore';
import { useMonteCarlo } from '../store/useMonteCarlo';
import { useShell } from '../store/useShell';
import { useSPlotStore } from '../store/useSPlotStore';
import { usePartLibrary } from '../store/usePartLibrary';
import { emptyDesign, withIdentity, type Design } from './design';
import { appendDistributed, atDesignFrequency } from './distributed';
import { primaryValue } from './elements';
import { setBoardEnabled, setPackageForAll } from './buildActions';
import { boardName, designBuild, keepAsDefaults } from './designBuild';
import { useCentreOutcome } from './centre';
import { fmtComplex, fmtInterval, fmtNum, fmtSig, fmtYield, fmtYieldInterval } from './format';
import { realizeOnMessage } from './realize';
import { designLoadInfo, hasMeasuredLoad, loadModelText } from './measuredLoad';
import { layoutForWidth } from './layout';
import { effectiveElements, realizeDesign } from './realize';
import { designToS2p } from './simexport';
import { sweepOverRows, useImported } from './importDialog';
import { quickTolerance } from './sensitivity';
import { loadSPlotText } from './splotActions';
import { DEFAULT_TOLERANCE, judgedRangeText, toleranceSettings } from './tolerance';
import { TOURS } from './tours';
import { findAnchor } from './tourAnchor';
import { emitTourEvent } from './tourEvents';
import type { TourSnapshot, Workflow } from './workflowKit';

/* ---------------------------------------------------------------- helpers */

/** Press the control an anchor names, as the user would (a doIt that runs a search). */
export function clickAnchor(id: string): void {
  if (typeof document === 'undefined') return;
  findAnchor(id)?.click();
}

/**
 * Pick the transformer row of `n` sections in the open Transformer tool, as the user would:
 * the first press selects the row, the second applies it.
 */
function pickTransformerRow(n: number): void {
  if (typeof document === 'undefined') return;
  const rows = findAnchor('match.transformer.list')?.querySelectorAll<HTMLElement>('.solution-row');
  const row = [...(rows ?? [])].find((r) => r.textContent?.includes(`N = ${n},`));
  const pick = (): void => row?.querySelector<HTMLElement>('.solution-pick')?.click();
  const before = useDesignStore.getState().design;
  pick();
  // Once the selection has rendered; a list that applies on the first press has applied.
  setTimeout(() => {
    if (useDesignStore.getState().design === before) pick();
  }, 0);
}

/**
 * The 2-section Chebyshev transformer the broadband workflow picks, put in directly when the
 * network is still empty at Optimize band (a path walked with Next alone), so that step has
 * lines to vary rather than "Nothing to vary". Only for an empty network on a real load.
 */
function ensureSomethingToVary(): void {
  const d = useDesignStore.getState().design;
  if (d.elements.some((el) => primaryValue(el) !== null)) return;
  if (d.elements.length > 0 || hasMeasuredLoad(d) || d.load.im !== 0 || !(d.load.re > 0)) return;
  const zs = d.target && d.target.re > 0 ? d.target.re : d.z0;
  if (Math.abs(Math.log(d.load.re / zs)) < 1e-6) return;
  const f = d.frequency;
  const t = multisectionTransformer(zs, d.load.re, 2, {
    type: 'chebyshev',
    frequency: f,
    gammaMax: 0.05,
  });
  appendDistributed(
    atDesignFrequency(t.elements, f),
    f * 0.25,
    f * 1.75,
    (sweep) =>
      `Added a 2-section Chebyshev transformer for Optimize band to vary: ${t.impedances.map((z) => fmtNum(z, 1)).join(', ')} Ω from the load${sweep}`,
  );
}

/** What a network is, for comparing two: the kinds, orientations and values, not ids or colours. */
const networkKey = (elements: Design['elements']): string =>
  JSON.stringify(
    elements.map((el) => {
      const { id, color, ...rest } = el;
      void id;
      void color;
      return rest;
    }),
  );

/**
 * The user changed the network since the step came on show, and it has parts. Values are
 * compared, so an Undo back to the network of the step's start does not count.
 */
const networkChanged = (s: TourSnapshot): boolean =>
  s.design.elements.length > 0 &&
  s.design.elements !== s.atEntry.elements &&
  networkKey(s.design.elements) !== networkKey(s.atEntry.elements);

/**
 * What the last Broadband search says about the part count, from its best per count: fewer
 * parts that come within 5 % of the best, the best near the limit (within 10 %), or far above
 * it. Empty before a search.
 */
export function pickAdvice(bests: readonly BandBest[], floor: number | null): string {
  const best = bests.reduce<BandBest | null>((m, b) => (m && m.vswr <= b.vswr ? m : b), null);
  if (!best) return '';
  const fewer = bests.find((b) => b.count < best.count && b.vswr <= best.vswr * 1.05);
  if (fewer) {
    return ` ${fewer.count} parts reach ${fmtNum(fewer.vswr, 3)}, close to ${fmtNum(best.vswr, 3)} with ${best.count}: fewer parts are easier to build and tune.`;
  }
  if (floor !== null && best.vswr <= floor * 1.1) {
    return ` The best, ${fmtNum(best.vswr, 3)} with ${best.count} parts, is near the limit: more parts buy little.`;
  }
  if (floor !== null) {
    return ` The best, ${fmtNum(best.vswr, 3)} with ${best.count} parts, is well above the limit: one part more may get closer.`;
  }
  return '';
}

/** The phone layout, where some anchors live in a sheet. */
const onPhone = (): boolean =>
  typeof window !== 'undefined' && layoutForWidth(window.innerWidth) === 'phone';

/** The design has work of the user's in it: parts, a measured load or a load other than Z0. */
const hasWork = (d: Design): boolean =>
  d.elements.length > 0 || hasMeasuredLoad(d) || d.load.re !== d.z0 || d.load.im !== 0;

/** How many inductors and capacitors the network has: a reel correlation needs two of a kind. */
const kindCounts = (d: Design): { L: number; C: number } => ({
  L: d.elements.filter((el) => el.kind === 'L').length,
  C: d.elements.filter((el) => el.kind === 'C').length,
});

function withElements(d: Design, elements: readonly Element[]): Design {
  const out: Design['elements'][number][] = [];
  for (const el of elements) out.push(withIdentity(el, out));
  return { ...d, elements: out };
}

/** The design file name the File menu uses, for the stand-in of a simulator's file. */
const safeName = (d: Design): string => d.name.replace(/[^\w.-]+/g, '_') || 'design';

/** The reference L match of yield.test.ts: shunt L and series C on 100 - j50 Ω at 1 GHz. */
function robustDesign(shuntL: number, realize: boolean): Design {
  const base = emptyDesign();
  return withElements(
    {
      ...base,
      name: 'Workflow: robust match',
      frequency: 1e9,
      load: complex(100, -50),
      // The band of the reference case: 11 points over 900 MHz to 1.1 GHz.
      sweep: { ...base.sweep, enabled: true, start: 0.9e9, stop: 1.1e9, points: 11 },
      realize: { ...base.realize, enabled: realize, series: 'E24' },
      tolerance: { ...DEFAULT_TOLERANCE, vswrLimit: 1.38, overBand: true },
    },
    [
      { kind: 'L', orientation: 'shunt', value: shuntL },
      { kind: 'C', orientation: 'series', value: 2.7e-12 },
    ],
  );
}

/** The shunt L the 3.2 start design begins with: the E24 value of the ideal 11.5 nH. */
export const ROBUST_START_L = 11e-9;
/**
 * The shunt L design centring moves it to (Tolerance > Centre for yield on the 3.2 start
 * design, E24, 5 %, VSWR 1.38 over the band); workflows.test.ts derives it from the search.
 */
export const CENTRED_L = 12e-9;

export const robustStart = (): Design => robustDesign(ROBUST_START_L, true);
/** The design 3.3 starts from on its own: the result of 3.2, Realize off. */
export const buildableStart = (): Design => ({
  ...robustDesign(CENTRED_L, false),
  name: 'Workflow: make it buildable',
});

function withPackageAll(d: Design, pkg: PackageId): Design {
  return {
    ...d,
    elements: d.elements.map((el) =>
      el.kind === 'L' || el.kind === 'C' ? { ...el, package: pkg } : el,
    ),
  };
}

const lumped = (d: Design): Design['elements'] =>
  d.elements.filter((el) => el.kind === 'L' || el.kind === 'C');

/* --------------------------------------------- 3.1 measured antenna (job 1) */

const measuredAntenna: Workflow = {
  kind: 'workflow',
  id: 'measured-antenna',
  title: 'Match a measured antenna over its band',
  short: 'Measured antenna',
  blurb:
    'Use a measured load, search the best network over the band, and see the Bode-Fano limit (sample antenna included).',
  // Kept from a tool's Show me or a chip: the user's own load and network are what it is about.
  start: (current, keep) =>
    keep && hasWork(current)
      ? null
      : {
          ...emptyDesign({ frequency: 2.45e9, z0: 50 }),
          name: 'Workflow: measured antenna',
        },
  next: 'robust',
  steps: [
    {
      id: 'open',
      title: 'Open the measured file',
      anchor: 'header.file',
      text: 'Start from what you measured: a .s1p, .s2p, CITI or VNA CSV file. Here a synthetic 2.4 GHz antenna stands in for yours.',
      doIt: { label: 'Open the sample antenna', run: (ui) => ui.openSample('antenna') },
      advance: (s) => s.importOpen,
    },
    {
      id: 'use-rows',
      title: 'All rows as the load',
      anchor: 'import.useRows',
      place: 'dialog',
      where: 'the import dialog',
      text: 'Use all rows as the load. Every band tool then reads the antenna across frequency, not one R + jX.',
      doIt: {
        label: 'Use all rows',
        // With the dialog open it uses its rows; without, it opens the sample antenna first.
        run: (ui) => {
          const open = useImported.getState().imported;
          if (open && sweepOverRows(open.file)) return;
          ui.openSample('antenna');
        },
      },
      advance: (s) =>
        s.design.sweep.mode !== 'frequency' && (s.design.sweep.loads?.length ?? 0) >= 2,
    },
    {
      id: 'model',
      title: 'The fitted load model',
      anchor: 'numbers.loadModel',
      place: 'numbers',
      where: 'Numbers, sweep section',
      text: (d) => {
        const info = hasMeasuredLoad(d) ? designLoadInfo(d) : null;
        const fit = info
          ? `The rows are ${loadModelText(info)}. `
          : 'A smooth model is fitted to the rows. ';
        return `${fit}A residual under 0.01 in Γ means the tools follow the model between rows.`;
      },
      doIt: {
        label: 'Show it on the chart',
        run: (ui) => {
          useDesignStore.getState().setChart({ measuredLoad: true });
          ui.show('chart');
          useDesignStore
            .getState()
            .setMessage('The measured rows and their load model are on the chart, dots and dashes');
        },
      },
      advance: 'next',
    },
    {
      id: 'method',
      title: 'Auto match, Broadband',
      anchor: 'match.method.broadband',
      place: 'tool',
      prepare: (ui) => ui.openTool('match', 'broadband'),
      text: 'Broadband search tries ladders up to Max parts and scores each by its worst VSWR across the band.',
      advance: 'next',
    },
    {
      id: 'run',
      title: 'Run the search',
      anchor: 'match.broadband.run',
      place: 'tool',
      prepare: (ui) => ui.openTool('match', 'broadband'),
      text: 'Run it. The Bode-Fano limit is the best any lossless network can do over this band; it tells you when to stop adding parts.',
      doIt: { label: 'Run', run: () => clickAnchor('match.broadband.run') },
      advance: (s) => s.since('broadband-result') > 0,
    },
    {
      id: 'pick',
      title: 'Pick a network',
      anchor: 'match.broadband.results',
      place: 'tool',
      where: 'the Broadband results (run the search)',
      text: () => {
        const { limit, bests } = useBandLimit.getState();
        const here = limit ? ` (${fmtNum(limit.floor, 3)} here)` : '';
        return `Compare each worst VSWR with the limit${here}.${pickAdvice(bests, limit?.floor ?? null)} Click one to use it.`;
      },
      prepare: (ui) => ui.openTool('match', 'broadband'),
      advance: networkChanged,
    },
    {
      id: 'more-parts',
      title: 'One part more?',
      anchor: 'match.broadband.maxParts',
      place: 'tool',
      prepare: (ui) => ui.openTool('match', 'broadband'),
      text: 'Optional: try one part more and compare its best with the limit. Near the limit a part more buys little.',
      advance: 'next',
    },
    {
      id: 'response',
      title: 'What the match bought',
      anchor: 'response.loadAlone',
      place: 'page',
      prepare: (ui) => {
        ui.setView('response');
        useDesignStore.getState().setResponse({ loadAlone: true });
      },
      text: 'Curves follow the model, dots are the network on each measured row. Load without network shows what the match bought.',
      advance: 'next',
    },
    {
      id: 'done',
      title: 'Next: robust match',
      text: 'Next: check that the match survives part tolerances.',
      prepare: (ui) => ui.setView('chart'),
      advance: 'next',
    },
  ],
};

/* ------------------------------------------------------ 3.2 robust (job 2) */

/**
 * The nominal network's judged VSWR when it misses the Tolerance limit so that almost no board
 * can pass (under 2 % of a short run), else null. A nominal just over the limit with boards
 * passing either side of it (the reference design) is a case for centring, not for this.
 */
function nominalFails(d: Design): number | null {
  if (d.elements.length === 0) return null;
  try {
    const { nominal, yieldFraction } = quickTolerance(d);
    return nominal > toleranceSettings(d).vswrLimit && yieldFraction < 0.02 ? nominal : null;
  } catch {
    return null;
  }
}

/** Why there is no Apply under the centring, from its last result. */
function noApplyReason(): string {
  const { running, last } = useCentreOutcome.getState();
  if (running) return 'Centring still runs; Apply shows when it ends, if the gain is real.';
  if (!last) return 'No centring result yet: press Back and Centre for yield first.';
  const { result, limit, offered } = last;
  const go = ' Press Next to go on.';
  if (result.before.passed === 0 && result.after.passed === 0) {
    return `No Apply: no board passes VSWR ${fmtSig(limit)}, before or after centring, so there is nothing to centre on. Loosen the limit in Tolerance or improve the match, then centre again.${go}`;
  }
  if (!result.improved) {
    return `No Apply: no better centre found, the yield stays ${fmtYieldInterval(result.before)}.${go}`;
  }
  if (!offered) {
    return `No Apply: the best centre found gives ${fmtYieldInterval(result.after)}, within the noise of ${result.after.runs} runs.${go}`;
  }
  return `No Apply: the centre was applied already, or the design changed since; Centre again for a fresh result.${go}`;
}

/** A limit the nominal design meets with room for the tolerances: 10 % above it, to 0.1. */
const limitItMeets = (nominal: number): number =>
  Number.isFinite(nominal) ? Math.ceil(nominal * 1.1 * 10) / 10 : 3;

const robust: Workflow = {
  kind: 'workflow',
  id: 'robust',
  title: 'Check the match is robust',
  short: 'Robust match',
  blurb:
    'Yield under part tolerances, which part matters, the worst case, reel correlation and design centring.',
  start: (current, keep) => (keep && current.elements.length > 0 ? null : robustStart()),
  next: 'buildable',
  steps: [
    {
      id: 'open',
      title: 'Open Tolerance',
      anchor: 'header.tolerance',
      place: 'tool',
      prepare: (ui) => {
        const store = useDesignStore.getState();
        const d = store.design;
        // Over the band by default when there is one (a default, not a forced state).
        const t = toleranceSettings(d);
        if (!t.overBand && (d.sweep.enabled || hasMeasuredLoad(d))) {
          store.setTolerance({ ...t, overBand: true });
        }
        ui.openTool('montecarlo');
      },
      text: (d) => {
        const limit = toleranceSettings(d).vswrLimit;
        const intro = `Tolerance asks how many boards still pass when every part is off by its tolerance. The limit is the design's spec, the same number the usable bandwidth uses: VSWR ${fmtSig(limit)}${judgedRangeText(d)}.`;
        const nominal = nominalFails(d);
        return nominal === null
          ? intro
          : `${intro} The nominal design itself has VSWR ${fmtNum(nominal, 3)} there, above the limit, so few boards if any pass: judge at VSWR ${fmtSig(limitItMeets(nominal))} (Do it for me), or improve the match first.`;
      },
      doIt: {
        label: 'Use a limit it meets',
        when: (d) => nominalFails(d) !== null,
        run: () => {
          const store = useDesignStore.getState();
          const nominal = nominalFails(store.design);
          if (nominal !== null) store.setTolerance({ vswrLimit: limitItMeets(nominal) });
        },
      },
      advance: 'next',
    },
    {
      id: 'spread',
      title: 'Which part matters most',
      anchor: 'tolerance.spread',
      place: 'tool',
      prepare: (ui) => ui.openTool('montecarlo'),
      text: 'Which part matters most, live, without a run. A large share is where a tighter part or another topology pays.',
      advance: 'next',
    },
    {
      id: 'run',
      title: 'Run the boards',
      anchor: 'tolerance.run',
      place: 'tool',
      prepare: (ui) => ui.openTool('montecarlo'),
      text: (d) => `Run ${toleranceSettings(d).runs} boards.`,
      doIt: { label: 'Run', run: () => clickAnchor('tolerance.run') },
      advance: (s) => s.since('tolerance-result') > 0,
    },
    {
      id: 'yield',
      title: 'Yield and its interval',
      anchor: 'tolerance.yield',
      place: 'tool',
      where: 'the Tolerance result (run it)',
      prepare: (ui) => ui.openTool('montecarlo'),
      text: () => {
        const r = useMonteCarlo.getState().result;
        if (!r) {
          return 'Yield with its 95 % interval. With a thousand runs, differences of a few percent are noise.';
        }
        const half = Math.max(1, Math.round(((r.interval.hi - r.interval.lo) / 2) * 100));
        return `Yield ${fmtYield(r.passed, r.runs)} with its 95 % interval ${fmtInterval(r.interval)}. At ${r.runs} runs, differences under about ${half} % are noise.`;
      },
      advance: 'next',
    },
    {
      id: 'worst',
      title: 'The worst case',
      anchor: 'tolerance.worstCase',
      place: 'tool',
      where: 'the Tolerance result (run it)',
      prepare: (ui) => ui.openTool('montecarlo'),
      text: () => {
        const c = useMonteCarlo.getState().corner;
        const v =
          c && Number.isFinite(c.worst.vswr) ? ` (VSWR ${fmtNum(c.worst.vswr, 3)} here)` : '';
        return `The worst case${v} says whether all parts at a limit (a corner) or a draw inside the band is worst.`;
      },
      advance: 'next',
    },
    {
      id: 'correlation',
      title: 'Reel correlation',
      anchor: 'tolerance.correlation',
      place: 'tool',
      prepare: (ui) => ui.openTool('montecarlo'),
      text: (d) => {
        const { L, C } = kindCounts(d);
        const kinds = [C >= 2 ? 'C' : null, L >= 2 ? 'L' : null].filter(Boolean);
        return kinds.length === 0
          ? 'Parts from one reel drift together. With one part of each kind here there is nothing to correlate; it matters once two capacitors or two inductors share a reel.'
          : `Parts from one reel drift together. Try ${kinds[0] as string} 0.8 and run again to see whether it helps or hurts.`;
      },
      advance: 'next',
    },
    {
      id: 'centre',
      title: 'Centre for yield',
      anchor: 'tolerance.centre',
      place: 'tool',
      prepare: (ui) => ui.openTool('montecarlo'),
      text: (d) =>
        `Centre for yield moves the nominal values to where most boards pass${d.realize.enabled && d.realize.series !== 'library' ? `, then snaps them to ${d.realize.series === 'stock' ? 'your stock' : d.realize.series}` : ''}.`,
      doIt: { label: 'Centre for yield', run: () => clickAnchor('tolerance.centre') },
      advance: (s) => s.since('centre-result') > 0,
    },
    {
      id: 'apply',
      title: 'Apply the centre',
      anchor: 'tolerance.apply',
      place: 'tool',
      missingText: noApplyReason,
      prepare: (ui) => ui.openTool('montecarlo'),
      text: 'Apply is offered only when the gain is beyond the noise of the runs.',
      doIt: { label: 'Apply', run: () => clickAnchor('tolerance.apply') },
      // The Apply button itself, not any change of the values (an Undo is not an Apply).
      advance: (s) => s.since('centre-applied') > 0,
    },
    {
      id: 'rank',
      title: 'Rank Add parts by Yield',
      anchor: 'match.add.rankBy',
      place: 'tool',
      prepare: (ui) => ui.openTool('match', 'add'),
      text: 'Next time, rank Add parts by Yield to pick the robust network from the start.',
      advance: 'next',
    },
    {
      id: 'done',
      title: 'Next: make it buildable',
      text: 'Next: make it buildable.',
      advance: 'next',
    },
  ],
};

/* --------------------------------------------------- 3.3 buildable (job 3) */

const buildable: Workflow = {
  kind: 'workflow',
  id: 'buildable',
  title: 'Make it buildable',
  short: 'Make it buildable',
  blurb:
    'Snap to parts you can buy, set how it is built in Build (packages and the board), then export the BOM and the report.',
  start: (current, keep) => (keep && current.elements.length > 0 ? null : buildableStart()),
  next: 'verify',
  steps: [
    {
      id: 'realize',
      title: 'Turn Realize on',
      anchor: 'network.realize',
      place: 'network',
      text: 'Realize snaps each value to a series you can buy. The dashed locus is the realized network.',
      doIt: {
        label: 'Turn Realize on',
        run: () => {
          const store = useDesignStore.getState();
          store.setRealize({ enabled: true });
          store.setMessage(realizeOnMessage(useDesignStore.getState().design));
        },
      },
      advance: (s) => s.design.realize.enabled,
    },
    {
      id: 'series',
      title: 'Choose the series',
      anchor: 'network.series',
      place: 'network',
      where: 'Realize',
      text: 'E24 is 5 % parts. My stock takes a pasted list; Part library takes measured part files (see the parts workflow).',
      prepare: () => {
        const store = useDesignStore.getState();
        if (!store.design.realize.enabled) store.setRealize({ enabled: true });
      },
      advance: 'next',
    },
    {
      id: 'build-open',
      title: 'Open Build',
      anchor: 'header.build',
      place: 'tool',
      prepare: (ui) => ui.openBuild(),
      text: 'Build is how this network will be made: values, losses, packages and the board. It is saved with the design.',
      advance: 'next',
    },
    {
      id: 'package',
      title: 'Packages',
      anchor: 'build.packages.all',
      place: 'tool',
      prepare: (ui) => ui.openBuild('packages'),
      text: (d) =>
        lumped(d).length > 0
          ? 'A package adds its own L and C: the dotted locus is the network as built. Use 0402 for all parts gives every L and C one.'
          : 'A package adds its own L and C to an inductor or a capacitor; this network has neither, so there is no package to choose. Next goes on.',
      doIt: {
        label: 'Use 0402 for all parts',
        run: () => setPackageForAll('0402'),
        when: (d) => lumped(d).length > 0,
      },
      advance: (s) =>
        lumped(s.design).length > 0 &&
        lumped(s.design).every((el) => 'package' in el && el.package),
    },
    {
      id: 'packages',
      title: 'The package models',
      anchor: 'build.packages',
      place: 'tool',
      prepare: (ui) => ui.openBuild('packages'),
      text: 'Land sizes and parasitics of each package, for this design. Use as default keeps them for new designs.',
      advance: 'next',
    },
    {
      id: 'board',
      title: 'Include the board',
      anchor: 'build.board',
      place: 'tool',
      prepare: (ui) => ui.openBuild('board'),
      text: 'Board on: pads from the land sizes, a via under each shunt part, traces between parts.',
      doIt: { label: 'Include the board', run: () => setBoardEnabled(true) },
      advance: (s) => s.boardOn,
    },
    {
      id: 'stackup',
      title: 'The stackup',
      anchor: 'build.stackup',
      place: 'tool',
      prepare: (ui) => ui.openBuild('board'),
      text: (d) =>
        `Pick your laminate; the as-built locus follows as you type. Now: ${boardName(designBuild(d).board)}.`,
      advance: 'next',
    },
    {
      id: 'default',
      title: 'Default for new designs',
      anchor: 'build.default',
      place: 'tool',
      prepare: (ui) => ui.openBuild(),
      text: 'Optional: Use as default for new designs, so the next design starts on this board.',
      doIt: {
        label: 'Use as default',
        run: () => {
          keepAsDefaults(useDesignStore.getState().design);
          useDesignStore
            .getState()
            .setMessage('This build is now the default for new designs (Settings, New designs)');
        },
      },
      advance: 'next',
    },
    {
      id: 'legend',
      title: 'Ideal, realized, as built',
      anchor: 'chart.legend',
      place: 'chart',
      text: () =>
        `Ideal, realized and as built side by side${onPhone() ? ' (the legend is under the chart grid button)' : ''}: the gap is what the board costs.`,
      advance: 'next',
    },
    {
      id: 'response',
      title: 'The as-built curves',
      anchor: 'view.response',
      place: 'page',
      prepare: (ui) => ui.setView('response'),
      text: 'The as-built curves are dotted. If they leave the limit, retune or centre again.',
      advance: 'next',
    },
    {
      id: 'bom',
      title: 'Bill of materials',
      anchor: 'file.export.bom',
      place: 'menu',
      where: 'the File menu',
      prepare: (ui) => {
        ui.setView('chart');
        ui.openMenu('file', 'export');
      },
      text: 'The BOM lists ideal and realized values, packages and the layout assumptions.',
      doIt: { label: 'Open the File menu', run: (ui) => ui.openMenu('file', 'export') },
      advance: (s) => s.since('export-bom') > 0,
    },
    {
      id: 'report',
      title: 'The report',
      anchor: 'file.report',
      place: 'menu',
      where: 'the File menu',
      prepare: (ui) => ui.openMenu('file', 'export'),
      text: 'The report puts chart, schematic and datapoints on one page for review.',
      // Opening it is the step: its menu item goes with the menu.
      advance: (s) => s.since('report') > 0,
    },
    {
      id: 'done',
      title: 'Next: verify',
      text: 'Next: verify with an independent simulator.',
      advance: 'next',
    },
  ],
};

/* ------------------------------------------------------ 3.4 verify (job 4) */

const verify: Workflow = {
  kind: 'workflow',
  id: 'verify',
  title: 'Verify against an independent tool',
  short: 'Verify',
  blurb: 'Export the network as built for your simulator, and compare the two in S-Plot.',
  start: (current, keep) =>
    keep && current.elements.length > 0
      ? null
      : {
          ...withPackageAll(
            { ...buildableStart(), realize: { ...buildableStart().realize, enabled: true } },
            '0402',
          ),
          name: 'Workflow: verify',
        },
  next: 'real-parts',
  steps: [
    {
      id: 's2p',
      title: 'Export the .s2p',
      anchor: 'file.export.s2p',
      place: 'menu',
      where: 'the File menu',
      prepare: (ui) => {
        ui.setView('chart');
        ui.openMenu('file', 'export');
      },
      text: "The .s2p is the network as built, with this design's board and packages, the same on any machine. Load it in your simulator against the same load.",
      doIt: { label: 'Open the File menu', run: (ui) => ui.openMenu('file', 'export') },
      advance: (s) => s.since('export-s2p') > 0,
    },
    {
      id: 'spice',
      title: 'SPICE and LTspice',
      anchor: 'file.export.spice',
      place: 'menu',
      where: 'the File menu',
      prepare: (ui) => ui.openMenu('file', 'export'),
      text: 'SPICE and LTspice carry values and losses only, no packages or board. Use them to check the circuit, the .s2p to check the build.',
      advance: 'next',
    },
    {
      id: 'splot',
      title: 'This design in S-Plot',
      anchor: 'splot.addNetwork',
      place: 'page',
      prepare: (ui) => ui.setView('splot'),
      text: "S-Plot shows this design's network live. Freeze it to keep a snapshot.",
      doIt: { label: "Add this design's network", run: () => clickAnchor('splot.addNetwork') },
      advance: (s) => s.splotLive,
    },
    {
      id: 'compare',
      title: "Your simulator's file",
      anchor: 'splot.addFile',
      place: 'page',
      prepare: (ui) => {
        ui.setView('splot');
        hiddenForCompare = hideOthers(useDesignStore.getState().design);
      },
      text: () =>
        `Add your simulator's .s2p of the same network: the two traces should lie on top of each other.${hiddenForCompare > 0 ? ` ${hiddenForCompare === 1 ? 'One other entry is' : `${hiddenForCompare} other entries are`} hidden so the axes fit these two; their check boxes show them again.` : ''}`,
      doIt: {
        label: 'Add the exported file',
        run: () => {
          // A stand-in for the simulator's file: the same .s2p this design exports.
          const d = useDesignStore.getState().design;
          const { table, board } = designBuild(d);
          const text = designToS2p(d, realizeDesign(d, effectiveElements(d)), table, board);
          const name = `${safeName(d)}.s2p`;
          // Pressed again, it replaces its own entry rather than adding a second one.
          useSPlotStore.setState((sp) => ({
            files: sp.files.filter((f) => f.fileName !== name || f.network),
          }));
          useDesignStore.getState().setMessage(loadSPlotText(name, text));
        },
      },
      // A file added during this step: one in the list from before (a sample) does not count.
      advance: (s) => s.since('splot-file') > 0 && s.splotEntries >= 2,
    },
    {
      id: 'freeze',
      title: 'Freeze before you tune',
      anchor: 'splot.freeze',
      place: 'page',
      where: "the live network in S-Plot (add this design's network)",
      prepare: (ui) => ui.setView('splot'),
      text: 'Freeze before you tune, so before and after stay visible.',
      // Freezing is the step: its button goes with the live entry.
      advance: (s) => s.since('splot-freeze') > 0,
    },
    {
      id: 'measure',
      title: 'Measure and compare',
      requires: 'd6',
      text: 'When the board is built, measure S11 and compare it here (Measure, compare, retune).',
      advance: 'next',
    },
    {
      id: 'done',
      title: 'Next: real parts',
      text: 'Next: build with real parts, from the files their manufacturers publish.',
      prepare: (ui) => ui.setView('chart'),
      advance: 'next',
    },
  ],
};

/** How many entries the comparison step hid, for its text. */
let hiddenForCompare = 0;

/**
 * Hide the S-Plot entries other than the live network and this design's exported file, so the
 * comparison's axes fit the two; nothing is removed. Returns how many it hid.
 */
function hideOthers(d: Design): number {
  const sp = useSPlotStore.getState();
  const own = `${safeName(d)}.s2p`;
  let hidden = 0;
  for (const f of sp.files) {
    if (f.visible && f.network !== 'live' && f.fileName !== own) {
      sp.setVisible(f.id, false);
      hidden += 1;
    }
  }
  return hidden;
}

/* ---------------------------------------------- 3.5 amplifier (job 5, part A) */

const amplifierStart = (): Design => {
  const lna = TOURS.find((t) => t.id === 'lna-input');
  const base = lna ? lna.start() : emptyDesign({ frequency: 1.575e9 });
  return { ...base, name: 'Workflow: amplifier', twoPort: null };
};

/**
 * The target step is done when the whole target is set: Γopt exactly, or both R and X changed
 * from the step's start (a target typed as R, then X, does not move on after R alone).
 */
function targetSet(s: TourSnapshot): boolean {
  const t = s.design.target;
  if (!t) return false;
  const g = s.design.twoPort?.noise?.gammaOpt;
  if (g) {
    const opt = gammaToZ(g, s.design.z0);
    const near = (a: number, b: number): boolean =>
      Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
    if (near(t.re, opt.re) && near(t.im, opt.im)) return true;
  }
  const was = s.atEntry.target;
  return was ? t.re !== was.re && t.im !== was.im : t.im !== 0;
}

const amplifier: Workflow = {
  kind: 'workflow',
  id: 'amplifier',
  title: 'Amplifier: stability, gain and noise',
  short: 'Amplifier',
  blurb:
    'A device from its .s2p: stability, the stability, noise and gain circles, and a match to the noise optimum.',
  start: (current, keep) => (keep && current.twoPort ? null : amplifierStart()),
  next: 'broadband-limits',
  steps: [
    {
      id: 'device',
      title: 'The device',
      anchor: 'numbers.twoPort',
      place: 'numbers',
      text: "The device's S-parameters and noise data, read at the design frequency. From a .s2p file or typed.",
      doIt: { label: 'Use the sample amplifier', run: (ui) => ui.openSample('amplifier') },
      advance: (s) => s.design.twoPort !== null,
    },
    {
      id: 'stability',
      title: 'Stable or not',
      anchor: 'numbers.stability',
      place: 'numbers',
      where: 'Numbers, two-port device (load a device)',
      text: (d) => {
        const s = d.twoPort?.s;
        const here = s
          ? (() => {
              const st = stability(s);
              return ` Here K ${fmtNum(st.k, 2)} and mu ${fmtNum(st.mu, 2)}.`;
            })()
          : '';
        return `K above 1 and mu above 1: stable for any passive source and load. Below: draw the circles to see where not to go.${here}`;
      },
      advance: 'next',
    },
    {
      id: 'stability-circles',
      title: 'Stability circles',
      anchor: 'numbers.circles.stability',
      place: 'numbers',
      where: 'Numbers, two-port device (load a device)',
      text: 'The stability circles mark the source impedances that make the device oscillate.',
      doIt: {
        label: 'Draw them',
        run: () => {
          useDesignStore.getState().setShowStability(true);
          useDesignStore
            .getState()
            .setMessage('Stability circles drawn for the source and the load');
        },
      },
      advance: (s) => s.design.showStability,
    },
    {
      id: 'noise',
      title: 'Noise circles',
      anchor: 'numbers.circles.noise',
      place: 'numbers',
      where: 'Numbers, noise parameters (load a device with noise data)',
      text: 'Noise circles: each is one noise figure. The centre is Γopt, the lowest NF.',
      doIt: {
        label: 'Draw NFmin + 0.5 dB',
        run: () => {
          const store = useDesignStore.getState();
          const nf = store.design.twoPort?.noise?.nfMinDb;
          if (nf === undefined) return;
          const at = Math.round((nf + 0.5) * 100) / 100;
          store.setNoiseCircles([at]);
          store.setMessage(`Noise circle drawn at NF ${fmtNum(at, 2)} dB, 0.5 dB above NFmin`);
        },
      },
      advance: (s) => s.design.noiseCircles.length > 0,
    },
    {
      id: 'gain',
      title: 'A gain circle',
      anchor: 'numbers.circles.gain',
      place: 'numbers',
      where: 'Numbers, two-port device (load a device)',
      text: 'A gain circle shows what each source impedance costs in gain. Pick a point that trades the two.',
      advance: (s) => s.design.gainCircles.length > 0,
    },
    {
      id: 'target',
      title: 'Target the optimum',
      anchor: 'target.card',
      place: 'network',
      text: 'Set the target to Γopt (or your trade-off point) and match to it. Target = Γopt sets it exactly.',
      doIt: {
        label: 'Target = Γopt',
        run: () => {
          const store = useDesignStore.getState();
          const d = store.design;
          const g = d.twoPort?.noise?.gammaOpt;
          if (!g) return;
          const z = gammaToZ(g, d.z0);
          store.setTarget(z);
          store.setMessage(`Target set to Γopt: ${fmtComplex(z, 1)} Ω`);
        },
      },
      advance: targetSet,
    },
    {
      id: 'match',
      title: 'Match to it',
      anchor: 'header.automatch',
      // On the phone Auto match is a tool of the sheet: the place brings it up there.
      place: 'tool',
      // Auto match opens in the method used last: this step is about Add parts.
      prepare: () => useShell.getState().setMatchMode('add'),
      text: 'Add parts reaches the target; check it stays out of the unstable region.',
      doIt: { label: 'Open Auto match', run: (ui) => ui.openTool('match', 'add') },
      advance: networkChanged,
    },
    {
      id: 'done',
      title: 'Next: broadband',
      text: 'Next: broadband and multi-section matching.',
      advance: 'next',
    },
  ],
};

/* ----------------------------------------- 3.6 broadband limits (job 5, part B) */

/** The name of the broadband workflow's own design: its first step says it runs on it. */
const BROADBAND_START_NAME = 'Workflow: broadband limits';

const broadbandLimits: Workflow = {
  kind: 'workflow',
  id: 'broadband-limits',
  title: 'Broadband limits and multi-section',
  short: 'Broadband limits',
  blurb:
    'Quarter-wave transformers for a real load, lumped ladders for a reactive one, and Optimize band.',
  // From Show me (Optimize band, Transformer) or a chip: the user's own design. Chained from
  // the amplifier, whose design is a device and its matches, it starts with its own load.
  start: (current, keep, chained) => {
    if (keep && hasWork(current) && !(chained && current.twoPort !== null)) return null;
    const base = emptyDesign({ frequency: 1e9, z0: 50 });
    return {
      ...base,
      name: BROADBAND_START_NAME,
      load: complex(25, 0),
      sweep: { ...base.sweep, enabled: true, start: 0.5e9, stop: 1.5e9, points: 101 },
    };
  },
  steps: [
    {
      id: 'transformer',
      title: 'Quarter-wave sections',
      anchor: 'match.method.transformer',
      place: 'tool',
      prepare: (ui) => ui.openTool('match', 'transformer'),
      // Chained from the amplifier (or opened on an empty design) it runs on its own design.
      text: (d) =>
        `${d.name === BROADBAND_START_NAME ? 'This workflow runs on its own design: a 25 Ω load to match to 50 Ω from 0.5 to 1.5 GHz (Undo brings back the design before it). ' : ''}For a real load, quarter-wave sections: binomial is flat, Chebyshev wider at a chosen ripple.`,
      advance: 'next',
    },
    {
      id: 'sections',
      title: 'More sections, more band',
      anchor: 'match.transformer.list',
      place: 'tool',
      prepare: (ui) => ui.openTool('match', 'transformer'),
      text: 'Each row gives the band under the limit. More sections, more band; pick 2 sections.',
      doIt: { label: 'Pick 2 sections', run: () => pickTransformerRow(2) },
      advance: networkChanged,
    },
    {
      id: 'broadband',
      title: 'Lumped ladders',
      anchor: 'match.method.broadband',
      place: 'tool',
      prepare: (ui) => ui.openTool('match', 'broadband'),
      text: (d) =>
        `${hasMeasuredLoad(d) || d.load.im !== 0 ? 'For a reactive load' : 'When the load is reactive (an antenna, a device)'}, lumped ladders: the search and its limit, as in the first workflow.`,
      advance: 'next',
    },
    {
      id: 'line',
      title: 'Allow one line',
      anchor: 'match.broadband.line',
      place: 'tool',
      prepare: (ui) => ui.openTool('match', 'broadband'),
      text: 'Allow one line in place of a series part when the layout needs length anyway.',
      advance: 'next',
    },
    {
      id: 'optimize',
      title: 'Optimize band',
      anchor: 'header.optimize',
      place: 'tool',
      prepare: (ui) => {
        ensureSomethingToVary();
        ui.openTool('optimize');
      },
      text: 'Optimize band refines the values you have for the worst VSWR, or for limit areas drawn in Response.',
      advance: (s) => s.since('optimize-result') > 0,
    },
    {
      id: 'rft',
      title: 'The real frequency technique',
      requires: 'd7',
      text: 'The real frequency technique computes the best gain shape for this load directly; compare it with the search.',
      advance: 'next',
    },
  ],
};

/* ---------------------------------------------------- 3.7 real parts (D5) */

const realParts: Workflow = {
  kind: 'workflow',
  id: 'real-parts',
  title: 'Build with real parts',
  short: 'Real parts',
  // The last step opened the part library: Done closes it.
  done: () => usePartLibrary.getState().setOpen(false),
  blurb:
    'Realize from the part library: parts as their measured S-parameters, with manufacturer part numbers in the BOM.',
  requires: 'd5',
  start: (current, keep) =>
    keep && current.elements.length > 0
      ? null
      : {
          ...buildableStart(),
          name: 'Workflow: real parts',
          realize: { ...buildableStart().realize, enabled: true },
        },
  steps: [
    {
      id: 'series',
      title: 'Value series: Part library',
      anchor: 'build.realization.series',
      place: 'tool',
      where: 'Build',
      prepare: (ui) => {
        const store = useDesignStore.getState();
        if (!store.design.realize.enabled) store.setRealize({ enabled: true });
        ui.openBuild('realization');
      },
      text: 'Part library snaps to parts whose measured S-parameters you loaded, not to a value series.',
      doIt: {
        label: 'Use the part library',
        run: () => useDesignStore.getState().setRealize({ enabled: true, series: 'library' }),
      },
      advance: (s) => s.design.realize.series === 'library',
    },
    {
      id: 'open-library',
      title: 'Open the library',
      anchor: 'build.partLibrary',
      place: 'tool',
      where: 'Build',
      prepare: (ui) => ui.openBuild('realization'),
      text: 'Your library stays in this browser. Manufacturers publish files per part number; links are inside.',
      doIt: { label: 'Open the part library', run: () => usePartLibrary.getState().setOpen(true) },
      advance: (s) => s.libraryOpen,
    },
    {
      id: 'load',
      title: 'Load part files',
      anchor: 'partLibrary.load',
      place: 'dialog',
      where: 'the part library',
      prepare: () => usePartLibrary.getState().setOpen(true),
      text: 'Load the files. Here synthetic 0402 parts stand in for vendor files, which the app may not bundle.',
      doIt: { label: 'Load sample parts', run: (ui) => ui.openSample('parts') },
      advance: (s) => s.libraryCount > 0,
    },
    {
      id: 'card',
      title: 'Parts as measured',
      anchor: 'card.part',
      place: 'network',
      where: 'the network with library parts (load part files)',
      prepare: () => usePartLibrary.getState().setOpen(false),
      text: 'Each part is now its measured two-port: self resonance, ESR and pads included.',
      advance: 'next',
    },
    {
      id: 'bom',
      title: 'Part numbers in the BOM',
      anchor: 'file.export.bom',
      place: 'menu',
      where: 'the File menu',
      prepare: (ui) => ui.openMenu('file', 'export'),
      text: 'The BOM lists manufacturer part numbers.',
      doIt: { label: 'Open the File menu', run: (ui) => ui.openMenu('file', 'export') },
      advance: (s) => s.since('export-bom') > 0,
    },
    {
      id: 'links',
      title: 'Real files',
      anchor: 'partLibrary.links',
      place: 'dialog',
      where: 'the part library',
      prepare: () => usePartLibrary.getState().setOpen(true),
      text: 'Get real files: Murata, Coilcraft, Johanson. They stay in your browser and are never uploaded.',
      advance: 'next',
    },
  ],
};

/* ------------------------------------------- 3.8 placeholders for D6 and D7 */

const measureRetune: Workflow = {
  kind: 'workflow',
  id: 'measure-retune',
  title: 'Measure, compare, retune',
  short: 'Measure and retune',
  blurb: 'Compare the measured board with the design, fit what moved and retune.',
  requires: 'd6',
  start: (current) => (current.elements.length > 0 ? null : buildableStart()),
  steps: [
    {
      id: 'open',
      title: 'Open the measured board',
      text: 'Open the measured S11 of the built board with Compare with the design in the import dialog.',
      advance: 'next',
    },
    {
      id: 'overlay',
      title: 'Measured and designed',
      text: 'Response overlays the measured and the designed curves.',
      advance: 'next',
    },
    {
      id: 'fit',
      title: 'Fit what moved',
      text: 'Fit what moved: the parts and the board parameters, guided by the sensitivities.',
      advance: 'next',
    },
    {
      id: 'drift',
      title: 'The drift table',
      text: 'The drift table lists what moved and by how much.',
      advance: 'next',
    },
    {
      id: 'retune',
      title: 'Suggest retune',
      text: 'Suggest retune snaps the new values to the series or the library.',
      advance: 'next',
    },
    {
      id: 'apply',
      title: 'Apply the fitted build',
      anchor: 'build.apply-fit',
      place: 'tool',
      text: 'Apply the fitted build: the parts and the board parameters of this design, as one step.',
      advance: 'next',
    },
  ],
};

const realFrequency: Workflow = {
  kind: 'workflow',
  id: 'real-frequency',
  title: 'Best possible match from data',
  short: 'Best possible match',
  blurb: 'The real frequency technique on a measured load, against the topology search.',
  requires: 'd7',
  start: (current) => (hasMeasuredLoad(current) ? null : measuredAntenna.start(current, false)),
  steps: [
    {
      id: 'load',
      title: 'The measured antenna',
      text: 'The antenna of the first workflow.',
      advance: 'next',
    },
    {
      id: 'method',
      title: 'Real frequency technique',
      text: 'The Broadband panel offers the real frequency technique beside the topology search.',
      advance: 'next',
    },
    {
      id: 'shape',
      title: 'Its gain shape',
      text: 'Its gain shape against the Bode-Fano limit.',
      advance: 'next',
    },
    {
      id: 'compare',
      title: 'Against the search',
      text: 'The realized ladder against the best searched one at the same part count.',
      advance: 'next',
    },
    { id: 'use', title: 'Use it', text: 'Use it.', advance: 'next' },
  ],
};

/**
 * A step's own "Do it for me" also counts as an event: a step whose predicate held when it came
 * on show (the effect was there already) moves on once its doIt ran.
 */
function counted(w: Workflow): Workflow {
  return {
    ...w,
    steps: w.steps.map((step) => {
      const doIt = step.doIt;
      if (!doIt) return step;
      return {
        ...step,
        doIt: {
          ...doIt,
          run: (ui) => {
            doIt.run(ui);
            emitTourEvent('do-it');
          },
        },
      };
    }),
  };
}

/** Every workflow, in the order of the Learn menu; the unshipped ones are hidden there. */
export const WORKFLOWS: readonly Workflow[] = [
  measuredAntenna,
  robust,
  buildable,
  verify,
  amplifier,
  broadbandLimits,
  realParts,
  measureRetune,
  realFrequency,
].map(counted);
