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
  circles: 'VSWR circles and constant-Q contours take a number each.',
  twoPort:
    'A transistor or other device, typed or read from a file at the design frequency, for the stability and gain circles.',
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
  share: 'Puts the whole design in the address and copies the link.',
  help: 'The user guide (F1 or ?)',
} as const;
