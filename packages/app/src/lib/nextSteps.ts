/**
 * Contextual next steps (docs/09 section 4): after a match, a run, an export
 * or an import, the step a senior RF engineer takes next is offered once, on
 * the message (status bar, or the toast on a phone) and as a chip at the foot
 * of the network panel. One suggestion at a time; any other change to the
 * design withdraws it, as it does the Scale sweep offer. Nothing is offered
 * on an opened file or a share link before the first edit, nor while a
 * guided tour runs, and Settings > New designs turns it off.
 */
import { evaluateLadder, stability, vswrTowards } from '@smithonline/core';
import { create } from 'zustand';
import { useBoard } from '../store/useBoard';
import { useDesignStore } from '../store/useDesignStore';
import { usePartLibrary } from '../store/usePartLibrary';
import { useSettings } from '../store/useSettings';
import { useTourStore } from '../store/useTourStore';
import { targetOf, type Design } from './design';
import { fmtFrequency, fmtNum } from './format';
import { hasMeasuredLoad } from './measuredLoad';
import { designLadder, effectiveElements } from './realize';
import { addNetworkToSPlot } from './splotNetwork';
import { fileShortcuts } from './shortcuts';
import { tourUi } from './tourUi';
import { findAnchor } from './tourAnchor';
import { toleranceSettings } from './tolerance';

export interface NextStep {
  readonly id: string;
  /** The button: what it does, in a few words. */
  readonly label: string;
  /** The line of the chip: why this is the next step. */
  readonly text: string;
  readonly run: () => void;
  /** The workflow that covers it, for Show me. */
  readonly workflow?: { readonly id: string; readonly at?: string };
}

interface NextStepState {
  /** The suggestion on offer and the design it was made for; null when there is none. */
  readonly suggestion: (NextStep & { readonly for: Design }) | null;
}

export const useNextStep = create<NextStepState>()(() => ({ suggestion: null }));

/** The design has been edited since it was opened (a file, an example, a share link). */
let editedSinceLoad = false;
let loadsSeen = useDesignStore.getState().loads;

// Any change of the design withdraws the suggestion; a newly opened design starts unedited.
useDesignStore.subscribe((state, prev) => {
  // A replaced design (open, example, New), the start (a share link) or an Undo back to it.
  if (state.loads !== loadsSeen || state.past.length === 0) {
    loadsSeen = state.loads;
    editedSinceLoad = false;
  } else if (state.design !== prev.design) {
    editedSinceLoad = true;
  }
  const s = useNextStep.getState().suggestion;
  if (s && state.design !== s.for) useNextStep.setState({ suggestion: null });
});

/** Suggestions are on: the setting, no tour running, and a new design or one edited since it was opened. */
export function nextStepsAllowed(): boolean {
  if (!useSettings.getState().settings.suggestNextSteps) return false;
  if (useTourStore.getState().tour !== null) return false;
  const designs = useDesignStore.getState();
  return designs.fresh || editedSinceLoad;
}

/** Offer a next step: the chip, and the button on the message on show (or a message of its own). */
export function suggest(step: NextStep): void {
  if (!nextStepsAllowed()) return;
  const designs = useDesignStore.getState();
  useNextStep.setState({ suggestion: { ...step, for: designs.design } });
  const action = {
    label: step.label,
    run: () => {
      withdraw();
      step.run();
    },
  };
  const { message, messageExtras, messageError } = designs;
  if (message && !messageError) {
    designs.setMessage(message, { undo: messageExtras?.undo ?? false, action });
  } else {
    designs.setMessage(step.text, { action });
  }
}

/** Take the suggestion back (it was followed, or something else happened). */
export function withdraw(): void {
  if (useNextStep.getState().suggestion) useNextStep.setState({ suggestion: null });
}

/** The chip's close button: suggestions go off, with an Undo on the message. */
export function turnOffNextSteps(): void {
  withdraw();
  useSettings.getState().update({ suggestNextSteps: false });
  useDesignStore
    .getState()
    .setMessage('Next-step suggestions are off; Settings, New designs brings them back.', {
      action: {
        label: 'Undo',
        timed: true,
        run: () => useSettings.getState().update({ suggestNextSteps: true }),
      },
    });
}

/* ---------------------------------------------------------------- actions */

function openTolerance(overBand: boolean): void {
  const store = useDesignStore.getState();
  const d = store.design;
  const t = toleranceSettings(d);
  if (overBand && !t.overBand && (d.sweep.enabled || hasMeasuredLoad(d))) {
    store.setTolerance({ overBand: true });
  }
  tourUi.openTool('montecarlo');
}

function vswrAtF(d: Design): number {
  const r = evaluateLadder(designLadder(d, effectiveElements(d)), { arcSteps: 0 });
  return vswrTowards(r.zin, targetOf(d));
}

/* ------------------------------------------------------------------ rules */

/** The rows of a measured file became the load (Use all rows as the load). */
export function noteMeasuredLoad(): void {
  suggest({
    id: 'match-over-band',
    label: 'Match over the band',
    text: 'The measured rows are the load: match over their band.',
    run: () => tourUi.openTool('match', 'broadband'),
    workflow: { id: 'measured-antenna', at: 'method' },
  });
}

/**
 * Auto match's Add parts, Tune or a double-click suggestion put a network in. Over a measured
 * load: optimize over the band. A match at f without a sweep range: check the band; with one:
 * check the tolerance.
 */
export function noteMatchAdded(method: 'add' | 'tune' | 'suggestion'): void {
  const designs = useDesignStore.getState();
  const d = designs.design;
  if (d.elements.length === 0) return;
  if (method === 'add' && hasMeasuredLoad(d)) {
    suggest({
      id: 'optimize-band',
      label: 'Optimize over the band',
      text: 'Over a measured load the match at f is a start: optimize the values over the band.',
      run: () => tourUi.openTool('optimize'),
      workflow: { id: 'broadband-limits', at: 'optimize' },
    });
    return;
  }
  const limit = designs.response.vswrLimit;
  if (!(vswrAtF(d) < limit)) return;
  if (!d.sweep.enabled && !hasMeasuredLoad(d)) {
    suggest({
      id: 'check-band',
      label: 'Check the band',
      text: `Matched at ${fmtFrequency(d.frequency)}: sweep 0.5 f to 2 f to see how wide the match is.`,
      run: () => {
        const f = useDesignStore.getState().design.frequency;
        useDesignStore
          .getState()
          .setSweep(
            { enabled: true, start: f / 2, stop: f * 2 },
            `Sweep range set to ${fmtFrequency(f / 2)} to ${fmtFrequency(f * 2)}`,
          );
        tourUi.setView('response');
      },
    });
    return;
  }
  suggest({
    id: 'check-tolerance',
    label: 'Check tolerance',
    text: 'Matched: check that it survives the part tolerances.',
    run: () => openTolerance(hasMeasuredLoad(d)),
    workflow: { id: 'robust', at: 'open' },
  });
}

/** A Broadband result went in. */
export function noteBroadbandApplied(): void {
  suggest({
    id: 'tolerance-over-band',
    label: 'Check tolerance over the band',
    text: 'A broadband match: check how many boards stay within the limit across the band.',
    run: () => openTolerance(true),
    workflow: { id: 'robust', at: 'open' },
  });
}

/** A Broadband search ended: its best far above the Bode-Fano limit asks for more parts. */
export function noteBroadbandResult(best: number, floor: number | null): void {
  if (floor === null || !Number.isFinite(best) || !(best > 1.5 * floor)) return;
  suggest({
    id: 'more-parts',
    label: 'Allow more parts',
    text: `The best found, ${fmtNum(best, 3)}, is far above the Bode-Fano limit of ${fmtNum(floor, 3)}: more parts can get closer.`,
    run: () => {
      tourUi.openTool('match', 'broadband');
      setTimeout(() => {
        findAnchor('match.broadband.maxParts')?.querySelector<HTMLElement>('select')?.focus();
      }, 0);
    },
    workflow: { id: 'measured-antenna', at: 'more-parts' },
  });
}

/** A Tolerance run ended: a low yield asks for centring, a dominant part for a tighter one. */
export function noteToleranceResult(
  yieldFraction: number,
  dominant: { readonly label: string; readonly share: number } | null,
): void {
  if (yieldFraction < 0.9) {
    suggest({
      id: 'centre',
      label: 'Centre for yield',
      text: `Yield ${fmtNum(yieldFraction * 100, 1)} %: centring moves the values to where most boards pass.`,
      run: () => {
        tourUi.openTool('montecarlo');
        setTimeout(() => findAnchor('tolerance.centre')?.click(), 0);
      },
      workflow: { id: 'robust', at: 'centre' },
    });
    return;
  }
  if (dominant && dominant.share > 0.5) {
    suggest({
      id: 'tighter-part',
      label: `Set ${dominant.label} to 2 %`,
      text: `${dominant.label} causes ${fmtNum(dominant.share * 100, 0)} % of the spread: a tighter part pays most there.`,
      run: () => {
        tourUi.openTool('montecarlo');
        setTimeout(() => findAnchor('tolerance.perPart')?.click(), 0);
      },
      workflow: { id: 'robust', at: 'spread' },
    });
  }
}

/** Design centring was applied. */
export function noteCentred(): void {
  const d = useDesignStore.getState().design;
  if (d.realize.enabled) return;
  const library = usePartLibrary.getState().parts.length > 0;
  suggest({
    id: 'realize',
    label: 'Realize to standard values',
    text: 'Centred: snap the values to parts you can buy.',
    run: () =>
      useDesignStore
        .getState()
        .setRealize(library ? { enabled: true, series: 'library' } : { enabled: true }),
    workflow: { id: 'buildable', at: 'realize' },
  });
}

/** Realize was turned on. */
export function noteRealizeOn(): void {
  const d = useDesignStore.getState().design;
  if (d.realize.series === 'library' && usePartLibrary.getState().parts.length === 0) {
    noteEmptyLibrary();
    return;
  }
  if (!d.elements.some((el) => el.kind === 'L' || el.kind === 'C')) return;
  suggest({
    id: 'packages',
    label: 'Add packages and the board',
    text: 'Realized: add the packages and the board to see the network as built.',
    run: () => {
      tourUi.show('network');
      setTimeout(() => {
        const field = findAnchor('card.pkg')?.querySelector<HTMLElement>('select');
        field?.scrollIntoView?.({ block: 'center' });
        field?.focus();
      }, 0);
    },
    workflow: { id: 'buildable', at: 'package' },
  });
}

/** The board went into the network. */
export function noteBoardOn(): void {
  if (!useBoard.getState().board.enabled) return;
  if (!useDesignStore.getState().design.realize.enabled) return;
  suggest({
    id: 'bom',
    label: 'Export the BOM',
    text: 'The board is in: export the bill of materials with its layout assumptions.',
    run: () => fileShortcuts.current?.exportMenu(),
    workflow: { id: 'buildable', at: 'bom' },
  });
}

/** The .s2p of the network was exported. */
export function noteS2pExported(): void {
  suggest({
    id: 'compare',
    label: 'Compare in S-Plot',
    text: "Exported: add this design's network to S-Plot to compare it with your simulator's file.",
    run: () => useDesignStore.getState().setMessage(addNetworkToSPlot()),
    workflow: { id: 'verify', at: 'splot' },
  });
}

/** A two-port device came from a file. */
export function noteDevice(): void {
  const tp = useDesignStore.getState().design.twoPort;
  if (!tp) return;
  const st = stability(tp.s);
  const showNumbers = (): void => {
    tourUi.show('numbers');
    setTimeout(() => findAnchor('numbers.stability')?.scrollIntoView?.({ block: 'center' }), 0);
  };
  if (!st.unconditionallyStable) {
    suggest({
      id: 'stability-circles',
      label: 'Draw stability circles',
      text: `Potentially unstable (K ${fmtNum(st.k, 2)}): the circles show where not to go.`,
      run: () => {
        useDesignStore.getState().setShowStability(true);
        showNumbers();
      },
      workflow: { id: 'amplifier', at: 'stability-circles' },
    });
    return;
  }
  suggest({
    id: 'stability',
    label: 'Check stability',
    text: 'A device is loaded: check its stability, then the noise and gain circles.',
    run: showNumbers,
    workflow: { id: 'amplifier', at: 'stability' },
  });
}

/** Part library chosen as the value series while the library is empty. */
export function noteEmptyLibrary(): void {
  if (usePartLibrary.getState().parts.length > 0) return;
  suggest({
    id: 'load-parts',
    label: 'Load part files',
    text: 'The part library is empty: load the S-parameter files of your parts.',
    run: () => usePartLibrary.getState().setOpen(true),
    workflow: { id: 'real-parts', at: 'load' },
  });
}
