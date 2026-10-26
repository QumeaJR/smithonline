/**
 * Guided workflows (docs/09 section 3): the second kind of tour next to the
 * lessons. A lesson swaps designs and narrates; a workflow points at the real
 * controls (an anchor, a `data-tour` attribute), opens the tool, view, pane
 * or menu a step needs, offers to do the step for the user, and moves on by
 * itself once the user has done it. Workflows never end because a tool
 * opened; Escape, the close button or an Undo back to where they started end
 * them, and one Undo then brings back the design from before.
 */
import type { Design } from './design';
import type { View } from '../store/useDesignStore';
import type { BuildSection, Detent, MatchMode, Pane, SettingsSection } from '../store/useShell';
import type { ToolId } from './tools';
import type { TourEvent } from './tourEvents';

/** The phases a step or a workflow can wait for; hidden until the phase ships. */
export type Phase = 'd5' | 'd6' | 'd7';

/** The phases that have shipped: D5, the part library, landed with this release. */
export const SHIPPED: ReadonlySet<Phase> = new Set<Phase>(['d5']);

export type SampleId = 'antenna' | 'amplifier' | 'parts';

/** Where an anchor lives, for the phone's sheet and the tablet's side column. */
export type Place = 'network' | 'numbers' | 'tool' | 'chart' | 'menu' | 'dialog' | 'page';

/** What a step can do to the interface around the design. */
export interface TourUi {
  setView: (view: View) => void;
  /** Open a tool (Auto match at a method); it stays open when it is open already. */
  openTool: (id: ToolId, mode?: MatchMode) => void;
  closeTool: () => void;
  /** Open the Build tool, at a section. */
  openBuild: (section?: BuildSection) => void;
  /** Show the segment of the side column (tablet) or the phone's sheet. */
  setPane: (pane: Pane) => void;
  /** Phone: the sheet's detent. */
  setDetent: (detent: Detent) => void;
  /** Bring a place into view: the right segment, and on the phone a detent that shows it. */
  show: (place: Place) => void;
  openSettings: (section?: SettingsSection) => void;
  /** Open a sample file through the real import path, or load the sample parts. */
  openSample: (id: SampleId) => void;
  openMenu: (id: 'file' | 'learn', section?: string) => void;
  /** Close the header's menus: a step that opened one closes it when the workflow moves on. */
  closeMenu: () => void;
}

/** What a step's predicate and text read: the design and the state around it. */
export interface TourSnapshot {
  readonly design: Design;
  /** The design when the step came on show: a predicate asks what the user changed since. */
  readonly atEntry: Design;
  readonly tool: ToolId | null;
  readonly matchMode: MatchMode | null;
  readonly view: View;
  readonly importOpen: boolean;
  readonly libraryOpen: boolean;
  readonly libraryCount: number;
  readonly boardOn: boolean;
  readonly settingsOpen: boolean;
  /** S-Plot entries: all of them, and the live network among them. */
  readonly splotEntries: number;
  readonly splotLive: boolean;
  /** How often an event happened since the step came on show. */
  readonly since: (event: TourEvent) => number;
}

export interface WorkflowStep {
  readonly id: string;
  /** Two to five words. */
  readonly title: string;
  /** At most two sentences; numbers come from the evaluation, never typed in. */
  readonly text: string | ((d: Design, s: TourSnapshot) => string);
  /** The `data-tour` id the step points at. */
  readonly anchor?: string;
  /** Where the anchor lives: the segment and detent the step brings up, and the fallback's words. */
  readonly place?: Place;
  /** "Open {where} first" when the anchor is missing; the doIt button then does it. */
  readonly where?: string;
  /** The text when the anchor is missing for another reason than a closed place (the reason now). */
  readonly missingText?: string | (() => string);
  /** Open the tool, method, view, pane, detent or settings section the step needs. */
  readonly prepare?: (ui: TourUi) => void;
  /** A design change, lesson style, recorded as one step. */
  readonly apply?: (d: Design) => Design;
  /**
   * "Do it for me"; `when` hides it for a design it does not apply to. A step whose
   * predicate holds already moves on once its doIt ran (the effect is there).
   */
  readonly doIt?: {
    readonly label: string;
    readonly run: (ui: TourUi) => void;
    readonly when?: (d: Design) => boolean;
  };
  /** Next only, or also by itself once the predicate turns true (400 ms later). */
  readonly advance: 'next' | ((s: TourSnapshot) => boolean);
  readonly requires?: Phase;
}

export interface Workflow {
  readonly kind: 'workflow';
  readonly id: string;
  readonly title: string;
  /** The short name on the chaining button ("Next: Make it buildable"). */
  readonly short: string;
  readonly blurb: string;
  /**
   * The design it starts from (one history entry), or null to go on with the design on show.
   * `keep` asks to keep the user's own design where the workflow can work on it (started
   * from the start guide, a next-step chip or a tool's Show me, or chained from the one before).
   * `chained` says it follows the workflow before: a design that workflow left which this one's
   * steps cannot use (the amplifier's device for Broadband limits) is replaced by its own start.
   */
  readonly start: (current: Design, keep: boolean, chained?: boolean) => Design | null;
  readonly steps: readonly WorkflowStep[];
  /** The workflow its last step chains to. */
  readonly next?: string;
  readonly requires?: Phase;
}

/** The steps of a workflow that have shipped. */
export function shippedSteps(w: Workflow): readonly WorkflowStep[] {
  return w.steps.filter((s) => s.requires === undefined || SHIPPED.has(s.requires));
}

export function isShipped(w: { readonly requires?: Phase }): boolean {
  return w.requires === undefined || SHIPPED.has(w.requires);
}

/* ------------------------------------------------------------- completion */

export const WORKFLOWS_KEY = 'smithonline.workflows.v1';

/** The workflows completed in this browser; empty where storage throws. */
export function readCompleted(): ReadonlySet<string> {
  try {
    const raw = localStorage.getItem(WORKFLOWS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    const done =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as { done?: unknown }).done
        : undefined;
    return new Set(Array.isArray(done) ? done.filter((x) => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/**
 * Remember that a workflow was followed to its last step in this browser. The check mark in
 * Learn says "seen to the end": a workflow can be walked with Next alone.
 */
export function markCompleted(id: string): void {
  const done = new Set(readCompleted());
  done.add(id);
  try {
    localStorage.setItem(WORKFLOWS_KEY, JSON.stringify({ done: [...done] }));
  } catch {
    // Private mode or quota: the check mark lasts for this page only.
  }
}

/** The text of a step for the design and snapshot on show. */
export function stepText(step: WorkflowStep, d: Design, s: TourSnapshot): string {
  return typeof step.text === 'function' ? step.text(d, s) : step.text;
}

/** The text of a workflow step when its anchor is not on screen (docs/09 section 3.0). */
export function missingText(step: WorkflowStep): string {
  if (step.missingText) {
    return typeof step.missingText === 'function' ? step.missingText() : step.missingText;
  }
  return step.where ? `Open ${step.where} first.` : 'Open the place this step points at first.';
}
