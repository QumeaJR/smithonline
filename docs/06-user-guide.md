# Smith Online user guide

Current as of master on 2026-10-23. Smith Online runs in the browser from a static build (`packages/app/dist`). It is a clean-room rebuild inspired by Smith V4.1 by Fritz Dellsperger, extended with ideas from Tonne Software's Elsie and PIEL and from QuickSmith-Web.

## 1. Screen layout

- **Header**: view tabs (Smith chart, Response, S-Plot), design name, design frequency f, reference impedance Z0, source power (for stress), File menu, Undo and Redo, Auto match, Optimize band, Tolerance (Monte Carlo), Examples, Settings, Share link, theme toggle. On windows narrower than about 1500 px the header wraps to two rows; below 1000 px the side panels stack under the chart (narrower panels from 1250 px down).
- **Left panel** (chart and response views): element palette, Realize and Losses switches, the network from the load (DP1) to the source, and the target card at the end.
- **Centre**: the Smith chart with its toolbar (Z grid, Y grid, density, labels, Fit) and the schematic strip below it (drag the handle to resize; Settings can move it to a vertical column beside the chart).
- **Right panel**: datapoints table, selected datapoint detail, usable bandwidth, frequency sweep, circles and contours, two-port device and noise parameters.
- **Status bar**: cursor readout (z, Z, Y, Gamma) or the last message.

## 2. Starting a design

Press **New** in the File menu or Ctrl+N. New is an undoable step, so no confirmation is asked. An empty chart shows the three steps: set the load, set the target, add parts or run Auto match.

- **Load (DP1)**: enter it as R + jX, as G + jB in mS, or as |Gamma| with angle in degrees (selector on the load card), drag DP1 on the chart, or take it from a measured file (Open, then pick a row or send s11 from S-Plot).
- **More user datapoints**: the load card lists DP1..DPn. Add one by typing or with "datapoint input" mode (every chart click adds a point at the design frequency). One datapoint is the chain start; the others are drawn hollow. A datapoint sweep applies the network to all of them.
- **Target**: the dashed card at the source end. Z0 by default (chart centre); type R and X for any other impedance, for example a conjugate match. The target is drawn as a hollow diamond.

## 3. Building the network

- **Palette**: series and shunt L, C, R, line, open stub, short stub, transformer, series RLC, shunt RLC. Click a part, then click on the chart where it should lead; the dashed reach line shows what the part can reach. Clicking the palette again inserts the default value.
- **Right-click** a point on the chart to add the next part tuned to that point or to remove the part that produced it. **Double-click** a point for match suggestions towards it.
- **Drag** any datapoint: the load moves freely, other points re-solve the part that produced them along its locus.
- **Ladder cards**: value fields accept engineering notation (`3n9`, `2.2p`, `0.25`), sliders tune 0.2x to 5x with a Reset button, arrows reorder, drag the grip to reorder, Delete removes. Lines and stubs have Z0, electrical length, permittivity and loss per metre; the Dimensions button turns them into track width and physical length on a substrate or coax. Inductors have a winding helper (air-core solenoid or toroid with AL value) that writes a note on the card.
- **Realize**: snaps every value to an E series (E6 to E96) or to your own stock list, with scope (all, L, C, R, L-C pairs with preserved resonance) and a lock per part. The realized network is drawn dashed; the datapoints table toggles between ideal and realized; sliders step through realizable values.
- **Losses**: default Q for inductors and capacitors with a per-part override, evaluated like any other element.
- **Package**: each L and C card has a Pkg selector (0201 to 1206, wire-wound coil for inductors) and shows the part's self-resonant frequency once a package is chosen; see section 8.

## 4. Matching

**Auto match** (header) offers three methods towards the target:

- **Add parts**: closed-form L networks, or Pi and T at a chosen loaded Q, ranked by Q; hover previews, click appends. With Realize on, the list shows snapped values and the VSWR after snapping.
- **Tune existing parts**: keeps the network and solves the values of the ticked parts so Zin lands on the target; reports exact or the nearest reachable point.
- **Broadband**: searches ladder topologies up to a maximum element count over the sweep band, ranks them by worst VSWR over the band and element count, and shows the Bode-Fano floor when the load is a measured set of datapoints (a single R + jX load has no floor). Runs in a worker with progress; hover previews, click applies.

**Optimize band** improves the values of the existing parts for the lowest worst-case VSWR over the sweep range, or for the limit areas when any are set.

**Usable bandwidth** (right panel) reports the span around f over which VSWR stays below a limit; the Response view shades it.

## 5. Response view

Plots versus frequency: gain and return loss (S21, S11), VSWR, input impedance, phase and group delay, with up to 8 markers, a cursor readout and a linear or log axis. **Limit areas** are rectangles a curve must stay out of; breaches are flagged and the band optimizer can use them as its cost. **Overlays** store named snapshots of the curves (up to 10) for comparison.

## 6. S-Plot view

An s-parameter viewer for Touchstone, CITI and EZNEC files: file list with colours, graphs of s11, s12, s21, s22 in dB and phase, return loss, K and mu, MAG or MSG, a polar plot of s21 and s12, s11 and s22 on a Smith chart, and a gain table per frequency that highlights the selected row in every graph. Export converts to Z, Y, H or ABCD parameters (normalized or not) as Touchstone files or CITI to Touchstone. "To the Smith chart" sends s11 or s22 as the load or as a datapoint sweep, or uses the file as the two-port device for the circles.

## 7. Circles and contours

VSWR circles and constant-Q contours take a number each. With a two-port device (typed or from a file, read at the design frequency) the panel draws input and output stability circles, available, operating and unilateral gain circles, and noise figure circles from NFmin, Gamma opt and rn.

## 8. Analysis for building

- **Component packages**: choose a package per inductor or capacitor on its card (0201, 0402, 0603, 0805, 1206; wire-wound coil for inductors). The chart then draws a third, dotted locus with diamond markers for the network as built: a chip capacitor gets its series inductance, a chip inductor its parallel capacitance and series resistance, and every part the capacitance of its pads to ground. The legend under the chart toolbar names the three loci (ideal, realized, with packages); with Realize on, the packages are applied to the realized values. The card shows the part's self-resonant frequency, the Response view plots the as-built curves dotted, the report adds a datapoint table naming the packages, and the BOM gets a Package column. The parasitics table with its typical values and a source note per row is in Settings; edit it to match the parts you buy. Pick "none" on a card to leave a part ideal.
- **Stress**: with a source power set, each card shows peak voltage and RMS current; limits per part kind flag exceedances, and the BOM carries the same columns.
- **Tolerance (Monte Carlo)**: random part values within their tolerances (default from the active E series), N seeded runs in a worker; the cloud of input impedances on the chart, a VSWR histogram and the yield against a VSWR limit.

## 9. Files, export and sharing

- **Open**: `.xmlsc` (Smith V4.1 projects, all 22 original examples are also in the Examples menu), Smith Online `.json`, Touchstone `.s1p` to `.s4p`, CITI `.citi` or `.cti`, EZNEC `Lastz.txt`, VNA CSV exports (`.csv`, `.txt`, see below).
- **VNA CSV and tables** (`.csv` and `.txt`, in Open and in the S-Plot view's Add file):
  - Keysight/Agilent ENA and PNA exports: `!` header lines, then `BEGIN CH1_DATA` ... `END` blocks with a column header such as `Freq(Hz),S11(REAL),S11(IMAG)`; several traces per block and several blocks with the same frequencies are merged.
  - Any comma, semicolon or tab separated table with a header row: a frequency column (`Freq`, `Frequency`, `f`, with the unit in the header such as `Freq [MHz]` or on the numbers such as `1.5 GHz`; Hz when neither says) and S11 to S22 as re/im, mag/angle or dB/angle pairs (`S11 dB`, `S11 Phase (deg)`, `S21_real`; angles in degrees unless the header says rad), or `R` and `X` columns for an impedance in ohm.
  - NanoVNA-Saver and LibreVNA style tables: frequency, re, im triples per trace, value columns named only Re and Im (taken as S11, then S21), and headerless `f re im` rows.
  - Lines starting with `!` or `#` are comments. With semicolons or tabs a comma inside a number is a decimal comma. The reference impedance is read from a line such as `Reference impedance: 75 Ohm` or `# Hz S RI R 75`, else 50 Ω is assumed and the description says so. Rows at zero or non-finite frequency, or with a value that is not a number, are dropped and counted. A file without a frequency column, without S-parameter or R and X columns, or with fewer than two usable rows is refused with a message that names what is missing.
  - A file with S11 only goes to the import dialog: the row nearest the design frequency is highlighted, a click makes a row the load, Sweep all makes a datapoint sweep. A file with S21 as well also goes to the S-Plot list (Show in S-Plot in the dialog); the parameters it lacks show as gaps, and Use as device needs all four. A file with S11, S21, S12 and S22 fills the two-port panel as a Touchstone file does. A file without S11 opens in the S-Plot view only.
  - A `.txt` file is tried as a VNA table first and as an EZNEC `Lastz.txt` second (an EZNEC table, recognized by its `Src #` column, goes to the EZNEC reader); when neither reads it the message gives both reasons.
- **Save**: Smith Online `.json` (everything), Smith V4.1 `.xmlsc` (L, C, lines and stubs, user datapoints; opens in the original).
- **Export**: chart as SVG or PNG, datapoints as CSV, Touchstone CKT netlist, ASCII datapoints and circles in the original's layout, bill of materials (Realize on; a Package column when parts name one), SPICE `.cir`, LTspice `.asc`, the network as `.s2p`, and a Report (chart, schematic, datapoints, circles as one SVG or a print page). Print prints the last report selection; when the browser blocks pop-ups it falls back to the native print dialog of the page and says so. Copy chart as image and copy datapoints as text go to the clipboard.
- **Share link** puts the whole design in the URL.

## 10. Settings, keyboard and examples

- **Settings**: colours for grids, datapoints, sweep, circles and the element palette, line widths, label density, default frequency and Z0 for new designs, schematic direction, and the component package table (ESL, Cp, ESR and pad capacitance per package, with a reset per row). Stored in the browser.
- **Keyboard**: Ctrl+N new, Ctrl+Z undo, Ctrl+Y or Shift+Ctrl+Z redo, Delete removes the selected part, Escape cancels an armed part, a menu or a tool panel.
- **Examples**: the 22 Smith V4.1 example projects. **Guided tours** build a design step by step with a narration computed from the design, so edited values change the story; each tour is one undo. Ten tours: L-network match, single stub match, LNA input match with circles, bandwidth and the band optimizer, broadband match with an element cap, Realize with standard values and the BOM, losses and component packages, PA output match over datapoints, Pi and T networks at a chosen Q, and the quarter-wave transformer. The two search tours run the same optimizer and broadband search as the header tools, with a fixed seed.

## 11. Known limitations

- The package parasitics are typical values per package size, not the data of a particular part; the table in Settings is the place to enter datasheet figures. The SPICE, LTspice, netlist and `.xmlsc` exports carry the values and losses but not the parasitics, and Monte Carlo, stress and the matching tools work on the network without them.
- The LTspice `.asc` writer has not been opened in LTspice; the SPICE netlist and the `.s2p` writer are covered by parse-back tests.
- The usable bandwidth search keeps its documented fallback (a search range that excludes the centre frequency is widened, not refused) and may miss a spike narrower than its coarse step; both are recorded as expected-fail tests in `packages/core/test/adv-bandwidth.test.ts`.
- Changing the design frequency to a value outside the sweep range is accepted silently; the Response view keeps its own range.
- Keyboard nudges on a tuning slider are recorded as one undo step each.
- When a project whose start datapoint is not among the sweep loads is saved as `.xmlsc`, the start is added to the loads of the file.
- Dark mode is a manual toggle; it does not follow the operating system setting.
- The status line reports matching, import, undo and redo; everyday edits clear it instead of describing themselves.
- Pressing Escape in the Monte Carlo panel clears the cloud; run it again to redraw.
