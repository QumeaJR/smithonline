# Realization features, inspired by Tonne Software (Elsie, SVC, JJSmith, PIEL, RevLoad)

Source: https://tonnesoftware.com/index.html and the product pages, read 2026-10-14. Only the published feature descriptions were used; Tonne Software's programs are closed-source Windows tools and nothing is copied from them. The common thread: Elsie and its siblings are built for people who then **build** the circuit. Smith V4.1 stops at ideal values. Smith Online should close that gap, as an optional layer on top of the ideal design.

## 1. Standard value components (the main request)

**What Elsie and SVC do:** snap component values to the nearest 5 percent standard value, with scope options "all parts", "inductors only", "capacitors only", or "one type while preserving the resonant frequency of each L-C pair". SVC overlays the response of the rounded design on the ideal one. The method is not published; a nearest-value snap plus retuning of the free element is the natural reading.

**Design for Smith Online:**

- **Series selection:** E6 (20 percent), E12 (10 percent), E24 (5 percent, default, this is "nearest 5 percent"), E48 (2 percent), E96 (1 percent). E-series values are defined by IEC 60063 and are public. Optional **custom stock list**: the user pastes the inductor and capacitor values they actually have (separated by semicolons, tabs, line breaks or commas, with the rules for units, resistor codes and decimal commas given in the user guide), and snapping uses that list instead of a series. Stored per design and in a user library.
- **Scope:** all, L only, C only, R only, or L-C pairs with preserved resonance (snap one, solve the other, then snap it to the series too and report the residual detuning).
- **Per-element lock:** a lock icon on the ladder card keeps that element exact (for example a trimmer or a line section).
- **Display:** each ladder card shows the ideal value and the realized value side by side ("16.03 nH, E24: 16 nH, -0.2 percent"). The chart draws the realized locus as a second, dashed path. The datapoint table gets a "realized" toggle. A summary line reports the input impedance, |Gamma|, VSWR and return loss of the realized network at the design frequency, and the worst case across the sweep.
- **Which value to pick:** nearest in log distance (geometric), not nearest in linear distance, so 16.03 nH goes to 16 nH and not 18 nH. Tie-breaking and an option "prefer value that lowers VSWR at f0" (evaluate both neighbors, keep the better). This small search is cheap and gives a better result than blind rounding.
- **Combination mode (later):** allow two standard parts in series or parallel per element when a single part cannot get within a chosen tolerance, like 2 capacitors in parallel. Off by default.
- **Where it lives:** `packages/core/src/realize/` with `eSeries.ts` (generators and nearest lookup), `snap.ts` (scope rules, pair preservation, neighbor evaluation), tested against known tables (E24 has 24 values per decade starting 1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1).

## 2. Component losses and parasitics

Elsie exposes inductor Q and shows the effect while tuning. Smith Online adds a per-element **loss model**, off by default (ideal), with a global default and per-element override:

- Inductor: Q at a reference frequency, modeled as series R = wL / Q (Q constant or scaling with sqrt(f), selectable). Optional self-resonant frequency via parallel C.
- Capacitor: ESR or Q, modeled as series R = 1 / (w C Q). Optional ESL.
- Resistor: ideal.
- Transmission line: already lossy in the original (alpha).

Effect: datapoints move off the constant-r and constant-g circles slightly, insertion loss becomes non-zero, and the sweep plots show real-world behavior. The ideal and lossy loci can be shown together.

**Component packages (implemented 2026-10-23, feedback item 4).** Each inductor and capacitor can name the package it is built in: 0201, 0402, 0603, 0805, 1206, or a wire-wound coil (inductors only). A small parasitics table (`packages/core/src/realize/packages.ts`, `DEFAULT_PACKAGES`) holds typical values per package with a source note: series inductance (ESL) of a chip capacitor, parallel capacitance and series resistance of a chip inductor, and the capacitance of both pads to ground. The values are typical figures from manufacturer application notes and a parallel plate estimate for the pads, not data of any one part; the user edits them in Settings (stored in the browser, not in the design) and the row keeps its source note.

- **Model.** `packageEquivalent(element, package)` fills the element's `parasitics`; the element two-port then evaluates the parasitic equivalent exactly: a capacitor is C + ESL in series (plus the loss resistance from Q), an inductor is (L + ESR + loss) in parallel with Cp, and half the pad capacitance sits to ground at each pad (a shunt part has one pad at ground, so only half acts). The element locus of a series part walks pad, branch, pad. `packageSelfResonance` gives 1 / (2 pi sqrt(L C)) with the ESL or Cp, shown on the card.
- **Where it shows.** A third locus on the chart (dotted, element colours, diamond node markers, dotted sweep) with a legend entry; dotted curves in the Response view; a third datapoint table in the report naming the packages; a Package column in the BOM. The "as built" network is the realized one when Realize is on, else the ideal one with the loss model.
- **Files.** The `package` field travels in the `.json` file and the share link (unknown ids are refused); `.xmlsc`, netlist, SPICE and LTspice writers ignore it, as they ignore Q. Parasitics are derived at evaluation time and never stored.

## 3. Two-port analysis of the matching network (Elsie-style plots)

The original only sweeps the input impedance. Add a **Response** tab with uPlot graphs of the matching network treated as a two-port between the load and the source:

- S21 insertion loss (dB), S11 return loss (dB), VSWR, transmission phase, group delay, input impedance magnitude and angle.
- Up to 8 markers with a readout table, cursor readout, linear or log frequency axis.
- Stored plot overlays (ideal vs realized vs lossy, or before vs after a change), up to 10, persisted with the design.
- Limit areas (rectangles the response must avoid or stay in) as a visual aid first; they become the target for the optimizer in section 6.

## 4. Build support

- **Bill of materials export** (CSV): element, ideal value, realized value, series, tolerance, part count. Columns for manufacturer part number left blank for the user.
- **Voltage and current stress** (from PIEL): given source power, compute peak voltage across each capacitor and RMS current through each inductor at the design frequency; flag parts above a user-set limit. Needed for transmitter matching networks and antenna tuners.
- **Inductor winding helper** (from Elsie and PIEL inductor screens): air-core solenoid (Wheeler formula) and toroid with AL value (turns = sqrt(L / AL)) calculators, opened from an inductor card, writing the turns and core into the card's note field. Public formulas, no vendor data needed beyond a small built-in table of common Amidon-type cores that the user can extend.
- **Distributed equivalents** (from Elsie): convert a series L into a short high-impedance line or a shunt C into a short low-impedance line, with a microstrip width calculator (Hammerstad and Jensen) for a given substrate. Phase 5.

## 5. Synthesis helpers

- **Automatic L-network**: both solutions (low-pass and high-pass) for matching the load to Z0 at f0, inserted as elements the user can then edit. QuickSmith-Web has this; it is also in every textbook.
- **Pi and T networks with target Q**: from the virtual intermediate resistance method, as in PIEL (Pi with a Q input) and the constant-Q contours already in the original.
- **Reverse load** (from RevLoad): given the network and a measured input impedance, compute the load. Useful with an antenna analyzer at the far end of a matching network.
- **Tuning buttons** (from Elsie and PIEL): plus and minus 1 percent steps on any value, in addition to sliders, for fine work on a laptop trackpad.

## 6. Tolerance and optimization (Phase 5, optional)

- **Monte Carlo**: tolerance per element (from the chosen E-series by default, overridable), N runs, draws the cloud of input impedances on the chart and histograms of VSWR at f0; reports yield against a VSWR or return loss spec. Simple uniform or normal distributions.
- **Optimizer**: adjust unlocked element values to minimize an error against limit areas or a target VSWR over the band, starting from the current design. Nelder-Mead on a handful of variables is enough. Then snap to standard values and re-check.

This is where a Rust/WASM module would pay off if the JavaScript implementation turns out too slow for interactive Monte Carlo with thousands of runs. Keep it behind the `core` API as decided in ADR-001.

## 7. Export to simulators

- **LTspice schematic** (`.asc`, a documented plain-text format) of the matching network with the realized values, loss resistors and a source and load, so the user can run a transient or noise simulation. Elsie, PIEL and QuadNet all do this and users value it.
- **Generic SPICE netlist** (`.cir`) and **Qucs-S** netlist as cheap variants of the same writer.
- **Touchstone `.s2p`** of the matching network over the sweep range, so it can be dropped into other tools or cascaded.

## 8. What not to copy

Elsie's filter synthesis (Butterworth, Chebyshev, Cauer, Bessel) is a different product. Smith Online stays a matching and S-parameter tool; a filter designer would be a separate project that could reuse `packages/core`.

## Priority

| Feature | Value for "actually building it" | Effort | Phase |
|---|---|---|---|
| Standard values with scope, lock, realized locus | High | Low | 2 |
| Losses (Q, ESR) | High | Low | 2 |
| Component packages with parasitics | Medium | Low | done 2026-10-23 |
| BOM export | High | Very low | 2 |
| Two-port response plots and markers | High | Medium | 3 (shares uPlot work with S-Plot) |
| L, Pi, T synthesis and reverse load | Medium | Low | 3 |
| Voltage and current stress | Medium | Low | 3 |
| LTspice, SPICE, Touchstone export of the network | Medium | Low | 3 |
| Inductor winding helper | Medium | Low | 4 |
| Monte Carlo and optimizer | Medium | Medium | 5 |
| Distributed equivalents and microstrip | Low | Medium | 5 |
