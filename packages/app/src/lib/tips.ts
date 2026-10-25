/**
 * Tooltips for the panel headings and the chart toolbar, one short sentence each,
 * worded after the user guide (docs/06-user-guide.md).
 */
export const TIPS = {
  datapoints:
    'Impedance, reflection, VSWR, return loss and Q at each point of the network, from the load DP1 to the source.',
  selected: 'The selected datapoint in full: Z, Y, Gamma, VSWR, return loss, mismatch loss and Q.',
  frequencySweep:
    'Sweeps the input impedance over a frequency range; the chart and the Response view draw it.',
  datapointSweep: 'Applies the network to all the datapoints, each at its own frequency.',
  circles: 'Type a VSWR or a Q value and press Add to draw its circle or contour.',
  twoPort:
    'A device, typed or read from a file at the design frequency, for the stability, gain and noise circles.',
  noise: 'NFmin, Gamma opt and rn give the noise figure circles.',
  zGrid: 'Show or hide the impedance grid (constant R and X).',
  yGrid: 'Show or hide the admittance grid (constant G and B).',
  density: 'How many grid circles the chart draws: coarse, normal or fine.',
  labels: 'Show or hide the labels on the grid circles.',
  fit: 'Reset zoom and pan.',
  tabChart: 'The Smith chart with the network built from the load to the source.',
  tabResponse: 'Gain, return loss, VSWR, impedance, phase and group delay against frequency.',
  tabSplot: 'An s-parameter viewer for Touchstone, CITI and EZNEC files.',
  examples: 'Guided tours and the 22 Smith V4.1 example projects.',
  share: 'Share link: puts the whole design in the address and copies the link',
  help: 'The user guide (F1 or ?)',
} as const;

/**
 * The hints that name a gesture, worded for the pointer in use (docs/07
 * section 6): a mouse hovers, clicks, right-clicks, double-clicks and turns
 * the wheel; a touch screen taps, long presses, double taps a point, pinches
 * and drags, and has no "left" or "right" panel on a phone.
 */
export interface PointerHints {
  /** The status line over the chart at rest. */
  readonly chart: string;
  /** The status line while a part is armed. */
  readonly armed: (label: string) => string;
  /** The status line of the Response view. */
  readonly response: string;
  /** The status line of the S-Plot view. */
  readonly splot: string;
  /** How a solution list previews and adds. */
  readonly preview: string;
  /** The Response toolbar: how a marker is set. */
  readonly responseMarker: string;
  /** The S-Plot toolbar: the readout and the markers. */
  readonly splotCursor: string;
  /** The label of the datapoint input switch. */
  readonly datapointSwitch: string;
  /** The hint under the datapoint switch while it is on. */
  readonly datapointInput: (next: number) => string;
  /** The empty ladder's hint. */
  readonly emptyLadder: string;
  /** The start guide's third step. */
  readonly startMatch: string;
  /** The verb of a hollow user datapoint, "click" or "tap" to start the network there. */
  readonly press: string;
}

const MOUSE_HINTS: PointerHints = {
  chart:
    'Hover for a readout. Drag a point to tune its element, right-click to add or remove, double-click a target for match suggestions. Wheel zooms, drag pans.',
  armed: (label) =>
    `${label} armed: the dashed line is where it can lead. Click on the chart to place it, or press and drag to aim and let go; click the palette again for the default value, Escape to cancel.`,
  response:
    'Hover the plots for a readout at the cursor, click to set a marker. The network panel still tunes the network.',
  splot:
    'S-Plot: hover the graphs for the cursor readout, click to set a marker and select a gain table row.',
  preview: 'Hover to preview, click to add.',
  responseMarker: 'Click a curve to set a marker',
  splotCursor: 'Hover the graphs for a readout, click to set a marker',
  datapointSwitch: 'Click chart',
  datapointInput: (next) =>
    `Datapoint input: click the chart to add DP${next}, press Escape to stop.`,
  emptyLadder:
    'Add elements from the palette above or right-click the chart. They are inserted at the source end, like in the original.',
  startMatch: 'Add parts from the palette, double-click the chart, or press Auto match.',
  press: 'click',
};

const TOUCH_HINTS: PointerHints = {
  chart:
    'Drag a point to tune its element, long press the chart to add or remove, double tap a point for match suggestions. Pinch zooms, drag pans.',
  armed: (label) =>
    `${label} armed: the dashed line is where it can lead. Tap the chart to place it, or press and drag to aim and let go; Default adds the default value, Cancel puts it back.`,
  response:
    'Drag on the plots for a readout at the finger, tap to set a marker. The network panel still tunes the network.',
  splot:
    'S-Plot: drag on the graphs for the cursor readout, tap to set a marker and select a gain table row.',
  preview: 'Tap a row to preview it, tap it again or press Add to add it.',
  responseMarker: 'Tap a curve to set a marker',
  splotCursor: 'Drag on the graphs for a readout, tap to set a marker',
  datapointSwitch: 'Tap chart',
  datapointInput: (next) => `Datapoint input: tap the chart to add DP${next}, press Done to stop.`,
  emptyLadder:
    'Add elements from the palette above or long press the chart. They are inserted at the source end, like in the original.',
  startMatch: 'Add parts from the palette, long press the chart, or press Auto match.',
  press: 'tap',
};

/** The hints for a coarse pointer (a touch screen) or a fine one (a mouse). */
export function pointerHints(coarse: boolean): PointerHints {
  return coarse ? TOUCH_HINTS : MOUSE_HINTS;
}
