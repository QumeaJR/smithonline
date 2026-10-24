# Smith Online user guide

Current as of 2026-10-23. Smith Online runs in the browser from a static build. It is a clean-room rebuild inspired by Smith V4.1 by Fritz Dellsperger, extended with ideas from Tonne Software's Elsie and PIEL and from QuickSmith-Web.

Links marked **Try** load a working example, a guided tour or a view into the application when you read this guide in its Help dialog (a table at the end lists all of them). In a plain Markdown viewer they do nothing.

## 1. Screen layout

- **Header**: view tabs (Smith chart, Response, S-Plot), design name, design frequency f, reference impedance Z0, source power (for stress), File menu, Undo and Redo, Auto match, Optimize band, Tolerance (Monte Carlo), Examples, Share link, Settings, Help, theme toggle. On windows narrower than about 1500 px the header wraps to two rows; below 1000 px the side panels stack under the chart (narrower panels from 1250 px down).
- **Left panel** (chart and response views): element palette, Realize and Losses switches, the network from the load (DP1) to the source, and the target card at the end.
- **Centre**: the Smith chart with its toolbar (Z grid, Y grid, density, labels, Fit) and the schematic strip below it (drag the handle to resize; Settings can move it to a vertical column beside the chart). A datapoint sweep marks every point; beyond 12 points only the first, the last, the point the chain starts from and evenly spread points in between carry an SPn label (a label that would sit on another is skipped, the starting point's label last of all), hovering any marker names it, and the sweep table lists all of them.
- **Right panel**: datapoints table, selected datapoint detail, usable bandwidth, frequency sweep, circles and contours, two-port device and noise parameters.
- **Status bar**: cursor readout (z, Z, Y, Gamma) or the last message, and a quiet link to the source on GitHub at the right end (the project is open source under the MIT license).

**Try**: [Example 5](example:Example5.xmlsc) is a five-element match with a Q contour; switch between the views with [Smith chart](view:chart), [Response](view:response) and [S-Plot](view:splot).

## 2. Starting a design

Press **New** in the File menu or Ctrl+N. New is an undoable step, so no confirmation is asked. An empty chart shows the three steps: set the load, set the target, add parts or run Auto match.

- **Load (DP1)**: enter it as R + jX, as G + jB in mS, or as |Gamma| with angle in degrees (selector on the load card), drag DP1 on the chart, or take it from a measured file (Open, then pick a row or send s11 from S-Plot).
- **More user datapoints**: the load card lists DP1..DPn. Add one by typing or with "datapoint input" mode (every chart click adds a point at the design frequency). One datapoint is the chain start; the others are drawn hollow. A datapoint sweep applies the network to all of them.
- **Target**: the dashed card at the source end. Z0 by default (chart centre); type R and X for any other impedance, for example a conjugate match. The target is drawn as a hollow diamond.

**Try**: [Example 17](example:Example17.xmlsc) applies a four-element network to three datapoints; [Example 5](example:Example5.xmlsc) has a load of 20 - j12 ohm.

## 3. Building the network

- **Palette**: series and shunt L, C, R, line, open stub, short stub, transformer, series RLC, shunt RLC. Click a part, then click on the chart where it should lead; the dashed reach line shows what the part can reach. Clicking the palette again inserts the default value.
- **Right-click** a point on the chart to add the next part tuned to that point or to remove the part that produced it. **Double-click** a point for match suggestions towards it.
- **Drag** any datapoint: the load moves freely, other points re-solve the part that produced them along its locus.
- **Ladder cards**: value fields accept engineering notation (`3n9`, `2.2p`, `0.25`), sliders tune 0.2x to 5x with a Reset button, arrows reorder, drag the grip to reorder, Delete removes. Lines and stubs have Z0, electrical length, permittivity and loss per metre; the Dimensions button turns them into track width and physical length on a substrate or coax. Inductors have a winding helper (air-core solenoid or toroid with AL value) that writes a note on the card.
- **Realize**: snaps every value to an E series (E6 to E96) or to your own stock list, with scope (all, L, C, R, L-C pairs with preserved resonance) and a lock per part. The realized network is drawn dashed; the datapoints table toggles between ideal and realized; sliders step through realizable values.
- **Losses**: default Q for inductors and capacitors with a per-part override, evaluated like any other element.
- **Package**: each L and C card has a Pkg selector (0201 to 1206, wire-wound coil for inductors) and shows the part's self-resonant frequency once a package is chosen; see section 8.

**Try**: [Example 1](example:Example1.xmlsc) is a two-element L-network to edit; the tour [Realize: standard values and the BOM](tour:realize) snaps a similar one to E series values; [Losses and component packages](tour:packages) shows the parasitics.

## 4. Matching

**Auto match** (header) opens a panel beside the chart (over it on a window narrower than 1250 px) and offers three methods towards the target and two distributed designers:

- **Add parts**: closed-form L networks, or Pi and T at a chosen loaded Q, ranked by Q; hover previews, click appends. With Realize on, the list shows snapped values and the VSWR after snapping.
- **Tune existing parts**: keeps the network and solves the values of the ticked parts so Zin lands on the target; reports exact or the nearest reachable point.
- **Broadband**: searches ladder topologies up to a maximum element count over the sweep band, ranks them by worst VSWR over the band and element count, and shows the Bode-Fano floor when the load is a measured set of datapoints (a single R + jX load has no floor). Runs in a worker with progress; hover previews, click applies.
- **Transformer**: multi-section quarter-wave transformers from the resistance of Zin to the target resistance, binomial (maximally flat) or Chebyshev (equal ripple at the chosen maximum |Γ|), by the small-reflection theory. The list offers 1 to 6 sections, each with the fractional bandwidth over which |Γ| of the built lines stays under the limit; every section is a quarter wave at f0. The theory is first order, so for a step above about 2:1 the textbook Chebyshev design ripples above the limit; the tool then synthesizes the sections for a lower ripple so the built lines stay under the limit across the band, and says so. A reactance in Zin is not removed; cancel it first. An even-order Chebyshev transformer ripples at f0 instead of landing exactly on the target.
- **Stub filter**: a Butterworth or Chebyshev (ripple in dB) filter of order 1 to 9 at a cutoff frequency, in the design's Z0. The low-pass is exact: Richards' transform of the lumped prototype and the Kuroda identities give shunt open stubs separated by lines. Every stub and line is an eighth wave at the cutoff (a quarter wave at twice the cutoff, where the response has its infinite-attenuation pole), so the response repeats from three times the cutoff on. The high-pass uses shunt shorted stubs joined by Z0 lines of the same length; its cutoff is exact but its passband shape is the classic approximation, and it passes up to three times the cutoff. The table lists every impedance from the load and marks those outside 15 to 150 Ω as hard to build. An even-order Chebyshev low-pass ends in a load other than Z0, which the tool states. Clicking adds the filter in one undo step and, when the sweep is off, switches it on over a range around the cutoff so the Response view shows the curve.
- Both tools give the line and stub lengths in wavelengths at the design frequency, like every other line, so a cutoff or f0 away from f shows as a shorter or longer length. Changing the design frequency afterwards keeps the electrical lengths, as for any line, so the cutoff or f0 moves with it. Both tools keep their settings for the session.

**Optimize band** improves the values of the existing parts for the lowest worst-case VSWR over the sweep range, or for the limit areas when any are set.

**Usable bandwidth** (right panel) reports the span around f over which VSWR stays below a limit; the Response view shades it.

**Try**: the tours [L-network match](tour:l-network), [Single stub match](tour:single-stub), [Pi and T networks at a chosen Q](tour:pi-t), [Broadband match with an element cap](tour:broadband) and [Bandwidth and the band optimizer](tour:band-optimizer); [Example 7](example:Example7.xmlsc) is a Pi match.

## 5. Response view

Plots versus frequency: gain and return loss (S21, S11), VSWR, input impedance, phase and group delay, with up to 8 markers, a cursor readout and a linear or log axis. **Limit areas** are rectangles a curve must stay out of; breaches are flagged and the band optimizer can use them as its cost. **Overlays** store named snapshots of the curves (up to 10) for comparison.

**Try**: [Example 16](example:Example16.xmlsc?view=response) opens a network with a 10 to 450 MHz sweep in the Response view.

## 6. S-Plot view

An s-parameter viewer for Touchstone, CITI and EZNEC files: file list with colours, graphs of s11, s12, s21, s22 in dB and phase, return loss, K and mu, MAG or MSG, a polar plot of s21 and s12, s11 and s22 on a Smith chart, and a gain table per frequency that highlights the selected row in every graph. Export converts to Z, Y, H or ABCD parameters (normalized or not) as Touchstone files or CITI to Touchstone. "To the Smith chart" sends s11 or s22 as the load or as a datapoint sweep, or uses the file as the two-port device for the circles.

**Try**: [open the S-Plot view](view:splot) and drop a Touchstone file on it, or use Open in the File menu.

## 7. Circles and contours

VSWR circles and constant-Q contours take a number each. With a two-port device (typed or from a file, read at the design frequency) the panel draws input and output stability circles, available, operating and unilateral gain circles, and noise figure circles from NFmin, Gamma opt and rn.

**Try**: [Example 13 input](example:Example13-input.xmlsc) draws stability, gain and noise circles for an amplifier; the tour [LNA input match with circles](tour:lna-input) builds one step by step.

## 8. Analysis for building

- **Component packages**: choose a package per inductor or capacitor on its card (0201, 0402, 0603, 0805, 1206; wire-wound coil for inductors). The chart then draws a third, dotted locus with diamond markers for the network as built: a chip capacitor gets its series inductance, a chip inductor its parallel capacitance and series resistance, and every part the capacitance of its pads to ground. The legend under the chart toolbar names the three loci (ideal, realized, with packages); with Realize on, the packages are applied to the realized values. The card shows the part's self-resonant frequency, the Response view plots the as-built curves dotted, the report adds a datapoint table naming the packages, and the BOM gets a Package column. The parasitics table with its typical values and a source note per row is in Settings; edit it to match the parts you buy. Pick "none" on a card to leave a part ideal.
- **Stress**: with a source power set, each card shows peak voltage and RMS current; limits per part kind flag exceedances, and the BOM carries the same columns.
- **Tolerance (Monte Carlo)**: random part values within their tolerances (default from the active E series), N seeded runs in a worker; the cloud of input impedances on the chart, a VSWR histogram and the yield against a VSWR limit.

**Try**: the tour [Losses and component packages](tour:packages) turns the package locus on; [Example 15](example:Example15.xmlsc) has a lossy line.

## 9. Files, export and sharing

- **Open**: `.xmlsc` (Smith V4.1 projects, all 22 original examples are also in the Examples menu), Smith Online `.json`, Touchstone `.s1p` to `.s4p`, CITI `.citi` or `.cti`, EZNEC `Lastz.txt`, VNA CSV exports (`.csv`, `.txt`, see below).
- **VNA CSV and tables** (`.csv` and `.txt`, in Open and in the S-Plot view's Add file):
  - Keysight/Agilent ENA and PNA exports: `!` header lines, then `BEGIN CH1_DATA` ... `END` blocks with a column header such as `Freq(Hz),S11(REAL),S11(IMAG)`; several traces per block and several blocks of the same sweep are merged (a row dropped in one block is dropped in all), and a block the reader cannot use, or one at other frequencies, is skipped with a note.
  - Any comma, semicolon, tab or space separated table with a header row: a frequency column (`Freq`, `Frequency`, `f`, with the unit in the header such as `Freq [MHz]` or on the numbers such as `1.5 GHz`; Hz when neither says) and S11 to S22 as re/im, mag/angle or dB/angle pairs (`S11 dB`, `S11 Phase (deg)`, `S21_real`, `S(2,1)`, `dB(S(2,1))` as HFSS and ADS write it; angles in degrees unless the header says rad), or `R` and `X` (also `Impedance Real`, `Zin Re`) columns for an impedance in ohm. A header written as a `#` comment above the rows, as numpy writes it, is used. Y, Z, H and G parameter columns, admittance, transmission, return loss, SWR and delay columns are skipped with a note; the import dialog lists the notes, the S-Plot file tooltip carries them, and a refusal names them.
  - NanoVNA-Saver and LibreVNA style tables: frequency, re, im triples per trace, value columns named only Re and Im, Mag and Phase or Gamma Real and Gamma Imag (a column such as `Phase` joins the parameter before it, else it is taken as S11, then S21; the same parameter given as re/im and as magnitude and angle is read once, from re/im, with a note), and headerless `f re im` rows.
  - Lines starting with `!` or `#` are comments. With semicolons, tabs or spaces a comma inside a number is a decimal comma; in a comma separated file a quoted cell such as `"0,5"` may hold one, `"1,000,000"` is read with thousands separators, and an ambiguous `"1,400"` is not read (the row is dropped). The reference impedance is read from a line such as `Reference impedance: 75 Ohm`, `Z0 = 75` or `# Hz S RI R 75`, else 50 Ω is assumed and the description says so. Rows are sorted by frequency. Rows at zero, negative or non-finite frequency, rows repeating a frequency and rows with a value that is not a number (or one too large to convert) are dropped, and the description says how many and why. A file without a frequency column, without S-parameter or R and X columns, or with fewer than two usable rows is refused with a message that names what is missing.
  - Touchstone text saved as `.csv` or `.txt` (an option line such as `# MHz S MA R 50` or a bare `#` above plain rows, or a Touchstone 2 `[Version]` keyword) is read as Touchstone, with its unit and format; a faulty option line such as `# GHz S MA R 50 Ohm` is reported by the Touchstone reader. A `#` line that is a column header makes the file a table.
  - A file with S11 only goes to the import dialog: the row nearest the design frequency is highlighted, a click makes a row the load, Sweep all makes a datapoint sweep. A file with S21, S12 or S22 as well also goes to the S-Plot list (Show in S-Plot in the dialog); the parameters it lacks show as gaps, the file card and the gain table name them, and Use as device and Save Touchstone need all four. A file with S11, S21, S12 and S22 fills the two-port panel as a Touchstone file does. A file without S11 goes to the S-Plot list only, and the status line says so.
  - A `.txt` file is tried as a VNA table first and as an EZNEC `Lastz.txt` second (an EZNEC table, recognized by its `Src #` column, goes to the EZNEC reader); when neither reads it the message gives both reasons.
- **Save**: Smith Online `.json` (everything), Smith V4.1 `.xmlsc` (L, C, lines and stubs, user datapoints; opens in the original).
- **Export**: chart as SVG or PNG, datapoints as CSV, Touchstone CKT netlist, ASCII datapoints and circles in the original's layout, bill of materials (Realize on; a Package column when parts name one), SPICE `.cir`, LTspice `.asc`, the network as `.s2p`, and a Report (chart, schematic, datapoints, circles as one SVG or a print page). Print prints the last report selection; when the browser blocks pop-ups it falls back to the native print dialog of the page and says so. Copy chart as image and copy datapoints as text go to the clipboard.
- **Share link** puts the whole design in the URL.

## 10. Settings, keyboard and examples

- **Help**: the question mark button in the header (or F1, or ? when no text field has the focus) opens this guide in a dialog with a table of contents; the arrow and page keys scroll it, Escape or a click outside closes it. The small ? next to a panel heading or the Auto match title opens the guide at that section. Hovering a panel heading or a chart toolbar button shows a one-line tip. Links marked **Try** in the guide, and the index at its end, load a working example, a guided tour or a view.
- **Settings**: colours for grids, datapoints, sweep, circles and the element palette, line widths, label density, default frequency and Z0 for new designs, schematic direction, and the component package table (ESL, Cp, ESR and pad capacitance per package, with a reset per row). Stored in the browser.
- **Keyboard**: F1 or ? help, Ctrl+N new, Ctrl+Z undo, Ctrl+Y or Shift+Ctrl+Z redo (the status line repeats what the step did, for example "Undo: Added DP2"), Delete removes the selected part, Escape cancels an armed part, a menu or a tool panel.
- **Examples**: the 22 Smith V4.1 example projects. **Guided tours** build a design step by step with a narration computed from the design, so edited values change the story; each tour is one undo. Ten tours: [L-network match](tour:l-network), [single stub match](tour:single-stub), [LNA input match with circles](tour:lna-input), [bandwidth and the band optimizer](tour:band-optimizer), [broadband match with an element cap](tour:broadband), [Realize with standard values and the BOM](tour:realize), [losses and component packages](tour:packages), [PA output match over datapoints](tour:pa-output), [Pi and T networks at a chosen Q](tour:pi-t), and the [quarter-wave transformer](tour:quarter-wave). The two search tours run the same optimizer and broadband search as the header tools, with a fixed seed.

## 11. Known limitations

- The package parasitics are typical values per package size, not the data of a particular part; the table in Settings is the place to enter datasheet figures. The SPICE, LTspice, netlist and `.xmlsc` exports carry the values and losses but not the parasitics, and Monte Carlo, stress and the matching tools work on the network without them.
- The LTspice `.asc` writer has not been opened in LTspice; the SPICE netlist and the `.s2p` writer are covered by parse-back tests.
- The usable bandwidth search keeps its documented fallback (a search range that excludes the centre frequency is widened, not refused) and may miss a spike narrower than its coarse step.
- Changing the design frequency to a value outside the sweep range is accepted silently; the Response view keeps its own range.
- Keyboard nudges on a tuning slider are recorded as one undo step each.
- When a project whose start datapoint is not among the sweep loads is saved as `.xmlsc`, the start is added to the loads of the file.
- Dark mode is a manual toggle; it does not follow the operating system setting.
- The status line reports matching, import, undo and redo; everyday edits clear it instead of describing themselves.
- Pressing Escape in the Monte Carlo panel clears the cloud; run it again to redraw.
