# Changelog

All notable changes to Smith Online. Versions follow semantic versioning; before 1.0 a minor version may change behaviour.

## 0.5.0 (2026-10-25)

- The licences now travel with the app: the build emits `licenses.txt` (the MIT license of Smith Online followed by the notices of QuickSmith-Web and scikit-rf), linked from the status bar and from the phone's More sheet.

Phase D4 of the depth plan (`docs/08-depth-plan.md`): the board in the network.

### Added

- Board stackup in Settings > Board, stored like the package table: dielectric height, εr and tanδ at a reference frequency carried over frequency by the causal Djordjevic-Sarkar model, copper thickness and RMS roughness, with presets for FR-4 1.6 mm and 0.8 mm (Isola 370HR), RO4003C 0.508 mm and RO4350B 0.762 mm (Rogers), their data sheet sources cited in the code.
- Microstrip model in the core: Hammerstad-Jensen 1980 static Z0 and εeff with the thickness correction, Kirschning-Jansen dispersion of εeff, Jansen-Kirschning dispersion of Z0, conductor loss with skin effect and Hammerstad-Jensen roughness, dielectric loss: a line-by-line port of scikit-rf 2.2.0's `MLine` (BSD 3-clause, credited in `THIRD_PARTY_NOTICES.md`), which agrees with it to 1e-10 or better (a faithful port) and with Keysight ADS's MLIN on scikit-rf's regression data within 0.014 dB and 0.26 degrees in S21 from 0.2 to 20 GHz (the independent check).
- A **Microstrip** element (track width and physical length on the stackup) whose two-port uses the frequency-dependent Z0 and propagation; the card shows Z0, εeff and the loss at the design frequency. The Dimensions dialog uses the same model at the line's frequency, shows Z0 and εeff with the dispersion and the loss, and can replace a line by a microstrip.
- The board in the network as built (Settings > Board): pad capacitance per package from the land size (new land columns in the package table) and the stackup, replacing the table value; a Goldfarb-Pucel via under every shunt part (vias per shunt part, default one); microstrip traces of one length between neighbouring parts. The as-built locus, the Response view's as-built curves, the `.s2p` export and the S-Plot entry include them; the BOM and the report list the layout assumptions.
- Oracle: microstrip lines and board-parasitic ladders recomputed with scikit-rf's `MLine` (`tools/oracle/d4_check.py`), via inductances and land capacitances.

### Changed

- The static microstrip model (`microstripZ0`, `microstripEeff`, `microstripWidth`) is Hammerstad-Jensen 1980 instead of Hammerstad 1975 (QuickSmith): 50 ohm widths move by 0.50 to 0.67 % (closer to the published figures for FR-4, RO4350B and RT/duroid 5880, now within 1.11 % of them; alumina moves away from its published 0.61 mm to 0.617 mm, towards the 0.620 mm of Wheeler's synthesis), and the 0.6 % step at W/h = 1 is gone. The free-space impedance is the CODATA 2022 value.
- The Dimensions dialog's microstrip substrate is the board stackup (shared with Settings); the coax dielectric stays in the dialog.

### Fixed (QA round)

- A share link or `.json` file with a microstrip stackup carrying a non-string name blanked the app; bad resistivities, tiny widths or heights and very long names passed through. Links, files and the autosave now store the normalized stackup and refuse values it would change, bound the width, height and length and cut the name at 80 characters; an error boundary shows a recovery message (load the last saved design, or start a new one) instead of a blank page.
- The Djordjevic-Sarkar stackup could go unphysical with accepted inputs (a reference frequency of 10 Hz or above 1 THz, tanδ 0.5): the reference frequency must lie between 1 kHz and 1 THz, and an εr, tanδ and frequency whose permittivity falls below 1 by 110 GHz is refused with the reason, in the fields, files and links. No NaN reaches the chart or a readout; dragging such a line no longer writes a NaN length, and with the board on an unusable stackup leaves the whole board out.
- **Use board stackup** keeps Z0 and the electrical length (the width solved again, the length rescaled) instead of silently detuning the line; **Keep size** keeps the physical size; both messages state the Z0.
- Pads of lands smaller than the board is thick take the larger of the edge-fringing and the disc-with-ground-image estimates (an 0402 on 1.6 mm FR-4: 0.12 pF instead of 0.10 pF). The package table's pad note no longer claims a computation its value does not match, and the Pads cells are greyed while the land size is used.
- The report wraps the layout assumptions, one per line. Settings > Board states its limits with a help link; Reset all asks first and can be undone while Settings is open; refused Settings entries say why next to the field. The Tolerance panel says the packages and the board are not in the run. The strip's Zin says "as built", the Response cursor table has as-built rows, the SRF shows 4 digits and whether the via is in it, the legend's tooltip lists what is actually modelled, and the SPICE, LTspice and `.s2p` headers say what they contain. The card's dispersion range flag uses the narrower Jansen-Kirschning range (W/h 0.1 to 10).

## 0.4.0 (2026-10-25)

Phase D3 of the depth plan (`docs/08-depth-plan.md`): sensitivity and yield.

### Added

- Analytic sensitivities in the core (`packages/core/src/sensitivity.ts`): derivatives of the input reflection coefficient, its magnitude and the VSWR with respect to every part's value (and Q where set), every part of an RLC block, a transformer's ratio and a line's or stub's length and Z0, through the ABCD cascade, at one frequency and over a band (at the worst frequency, and the smooth power mean of order 32 of the VSWR); per-percent sensitivities. Checked against finite differences to 1e-6 for every element kind, packaged parts and lossy lines included.
- Spread by part: the Tolerance panel ranks the parts by their share of the spread ("Shunt L 1 contributes 58 % of the spread", with each part's VSWR per % and a share bar), live from the sensitivities of the network as analysed (realized values, the measured load model over the band); each ladder card shows its share while the panel is open.
- Reel correlation: a correlation coefficient per part kind (L, C, R) in the Tolerance panel; correlated normal or uniform draws with exactly that coefficient, seeded and deterministic (every coefficient 0 gives the old draws).
- The yield comes with its Wilson 95 % interval, and each run reports the worst-case corner (every part at a tolerance limit in the direction that hurts, from the sensitivities, checked by evaluation and, up to 10 parts, against every corner).
- Design centring: **Centre the design** in the Tolerance panel moves the nominal values to the centre of what passes (common random numbers, mean shifting, Nelder-Mead in log space) within each part's realizable range, in a worker with progress; with Realize on the centred values snap to the series or stock and are measured again. Before and after yields with intervals on fresh runs; **Apply** is one undo step named after the gain. On the reference L match (100 - j50 ohm, 20 % band, VSWR 1.38, E24 5 % parts) the yield goes from 46 % to 93 %.
- Auto match ranks Add parts by Q, yield or VSWR (**Rank by**), each solution with its estimated yield under the Realize tolerance (5 % with Realize off) and its dominant part, and says in one line how the list is ranked.
- Oracle: `tools/oracle/d3_check.py` checks the analytic derivatives against scikit-rf finite differences, a Monte Carlo yield against brute-force integration with numpy, the worst corner and the worst case, the spread shares over a band against numpy's differences of the power mean, the Wilson interval and the correlated draws.

### Fixed (QA round)

- The spread ranking ranked the variance of the complex Γ, whose phase part does not move the VSWR away from a match, so it could name a part that barely matters (broadband tour network at 100 MHz: Series C 1 first with 72 % at a VSWR slope of 8.5e-5). It now ranks the variance of the VSWR at the design frequency and of the smooth band VSWR (power mean) over a band, from their derivatives (Shunt C 2 67 %, Series C 1 0 %), falls back to the change of Γ at or near a perfect match and says so; the VSWR per % column over the band is the slope of the power mean, and a perfect match shows 0. A synthesized match (|Γ| about 1e-16) no longer gets an arbitrary |Γ| slope, which spoilt the band derivative by about 1 %.
- Auto match's yield ignored Losses and the Tolerance panel judged towards Z0 while Auto match judged towards the target. Both now build and judge the network the same way (loss model, realized values, target, measured load, one default tolerance), so they agree run for run on the same seed (lossy 15 - j40 ohm case: 58 of 200 in both, was 178 against 58); the spread ranking, the worst case and design centring judge towards the target too.
- The worst-case corner could be better than the nominal network and than Monte Carlo samples (lines, resonant traps, low-Q parts with a wide tolerance). The worst case is now the largest of the nominal network, the corners and the run's own samples, says which it is and that a corner is not a bound when the response is not monotonic; the part names come with the run.
- Design centring: Apply is offered only when the gain is beyond the two intervals, lists and writes only the parts whose shown value changes (with Realize on, an unchanged part keeps its own value), the result names the judged range, the nominal worst VSWR before and after and parts at the edge of their range, and goes stale with any change of the design, limit or band (also "no better centre found"); the progress bar moves at every evaluation and names the stage plainly.
- A part typed as 0 wiped the spread ranking, and one totally reflected band point zeroed it; such parts and points are left out.
- The Tolerance panel keeps its limit and tolerance fields with no parts (Auto match judges by them, and says "set in Tolerance"); the default tolerance shows as an empty field with the series as placeholder ("E24: 5 %"), 0 is an exact part; correlations outside 0 to 1 are refused with a message naming the field; stale notes sit above the dimmed old result; the reel correlation fields wrap together; the result scrolls into view whole on the phone.
- Auto match shows its 200-run yields in whole percent ("about 77 %", "≥ 99 %" when every run passed, the count in the tooltip) and says when every row ties; the ranking sentence says when the parts share the spread about equally.

## 0.3.0 (2026-10-25)

Phase D2 of the depth plan (`docs/08-depth-plan.md`): the measured load first.

### Added

- Vector fitting in the core (`packages/core/src/vectfit.ts`): a complex response at N points becomes a rational model (real and complex conjugate poles, residues, d and e) by pole relocation with the relaxed non-triviality constraint (Gustavsen and Semlyen 1999, Gustavsen 2006), in normalized frequency, with the order chosen a pole pair at a time until the residual meets the tolerance and then the noise of the data (at most 2N/3 and 30, N/3 below 20 points), unresolved poles dropped, the model checked between the points, and unstable poles flipped. A reflection model is made passive (|Γ| ≤ 1 from 10 % below to 10 % above the band, the crossings of 1 found exactly from the Hamiltonian eigenvalues) by iterative residue perturbation, with the original fit scaled down as the fallback. Pure TypeScript: Householder least squares and an EISPACK-style eigenvalue solver.
- The measured load (`packages/core/src/measured.ts`): `interpolatedLoad` fits a datapoint sweep of six or more points and uses the fitted model, followed 5 % past the data and held beyond it, with linear interpolation of R and X as the fallback when the fit misses a point by more than 0.01 in Γ or fails. The model says how it was made (`measuredLoadInfo`).
- Every band tool reads the measured load of a datapoint sweep: Broadband (its default band is the measured band), Optimize band and Tolerance over the band (both over the measured band, through their workers), the usable bandwidth (inside the data), and the Response view (the model's curve across the measured band with the network on each measured point as dots, and an optional **Load alone** trace of |S11| and VSWR before the network).
- The Bode-Fano floor from the fitted model: Fano's exact bound with element values read from the model when it is one reactance with a resistance, otherwise the Bode-Fano bound with the load Q from the model's exact slope at the band centre; the panels say "from the fitted model". No minimum number of band points for a fitted load.
- The fit's quality in the import dialog, the datapoint sweep section of Numbers and the band tools ("fitted, order 4, max residual 0.00061 in Γ" or "linear interpolation: the fit's residual was 0.04 in Γ"); a band that reaches past the data is flagged. **Show the measured load on the chart** draws the measured points and the model across the band.
- Oracle: four fitted loads in `tools/oracle/` (two resonances clean and with noise, a series RL, and a noisy lossless series LC that starts non-passive): scikit-rf recomputes the true load from the element values and numpy evaluates the app's poles and residues; the job checks the model against the truth, the reported residuals, stability, passivity on a dense grid and the series RL floor against Fano's closed form.

### Fixed (QA round)

- A fit of few or noisy rows could invent a sharp resonance between two rows and still be accepted (8 rows of a series RLC: 0.365 off the load in Γ, a Bode-Fano floor above the best listed match). Unresolved poles are dropped, the model is checked between the rows (and by leaving rows out below 30 rows) with a fallback to a lower order or to linear interpolation, and the order is capped at N/3 below 20 rows.
- The order search stopped after three orders without a 10 % gain, so loads with four resonances or behind a length of line fell back to linear interpolation. It now steps by pole pairs and goes on while no order follows the rows within 0.01 in Γ.
- Passivity enforcement could wreck a good fit and then scale the wrecked model; it now keeps the best passive model, stops when the residual passes the fallback's, and scales the original fit. Violations between grid points are found from the Hamiltonian eigenvalues.
- The fit runs in a Web Worker (10 001 rows took 4.4 s on the main thread; the fit itself is now 10 to 20 times faster).
- No floor estimate for a band whose centre lies past the data, and the printed fractional bandwidth is the one the floor used.
- Broadband used the measured rows after Back to frequency sweep, kept the previous file's band and ran against a held constant load for a band outside the data; it now follows the other band tools, resets its band on a new import and refuses such a band. Parts pinned where they do nothing are dropped from its candidates, each shape listed once.
- DP1 follows the design frequency over a measured load; the usable bandwidth is clamped to the measured data; the log frequency axis no longer rounds out to decades; the Response readout no longer covers the fourth plot and lists Load alone; Tolerance over the band names the band and shows the spread of the band worst case; Optimize band prints its worst VSWR on Broadband's grid; clearer fit wording ("joined by linear interpolation of R and X; ..."); the measured load has a chart legend entry and a tooltip.

## 0.2.2 (2026-10-25)

Phase D1 of the depth plan (`docs/08-depth-plan.md`): the verification foundation.

### Added

- Physics invariants as property tests (`packages/core/test/invariants.test.ts`): 10 000 seeded random networks of every element kind checked for reciprocity, losslessness, passivity, cascade associativity, parameter conversion round trips, Zin from S11 against the cascade, closed-form matches landing on their target, and broadband results against the exact Bode-Fano floor.
- Golden tests against published answers with their sources (`packages/core/test/golden.test.ts`): Pozar (Examples 5.1, 5.2, 5.5, 5.6, 5.7, section 5.9, tables 8.3 and 8.4), Matthaei, Young and Jones, HP AN 95-1, the Smith V4.1 example projects and Bowick's L and Pi procedures.
- An independent oracle in CI (`tools/oracle/`, job `oracle`): scikit-rf recomputes the S-parameters of 21 reference networks (1e-9) and ngspice runs the app's SPICE netlists (1e-6); see `tools/oracle/README.md`.

### Fixed

- The `.s2p` export and the S-Plot network entry gave a wrong S12 (above 1 in a cascade) for a ladder with more than about 160 dB of line loss: S12 came from the determinant of the ABCD matrix, which loses its digits there. S12 is now S21, which is exact for every ladder.

## 0.2.1 (2026-10-25)

Fixes from testing 0.2.0 on an iPhone.

- The schematic strip is pinned under the chart on a phone, always in view, and shows each part's actual value: the realized value when Realize is on (marked when snapped), Z0 and length for lines and stubs, the ratio for transformers, and the package next to the value. It ends with Zin and VSWR at the Zin terminal.
- The phone chart fills the screen width; the design chip and grid button sit on its corners, and the readout chip that covered the lower rim is gone (messages show as a toast).
- Denser phone sheet: Realize and Losses on one row with their options only when on, the load card and the new datapoint's f, R and X each on one row, a one-line section caption, 8 px card padding.
- The Response view's readout table follows the plots in the page instead of covering the next plot.
- The start guide closes itself about two seconds after its third step is done.

## 0.2.0 (2026-10-25)

The interaction redesign is complete (`docs/07-interaction-redesign.md`, phases 3 to 7): the app now works on phones, tablets and desktops with every feature, and `docs/03-ui-design.md` describes it as built.

### Added

- Add network to S-Plot (File menu, and Add the network in the S-Plot file list): the network as built as a live two-port entry that follows tuning, with a Freeze control for before and after comparisons. A removed S-Plot entry can be brought back with the Undo in its message for 8 seconds.
- Overlays and dialogs (phase 3): menus and popovers that flip and clamp inside the window, and open as sheets on a touch screen; one Escape stack (top overlay, armed part, open tool, tour); dialogs with a sticky footer and one focus trap, full screen with Done on a phone; Dimensions, Winding, Report and Import draggable by their title bar; tap to preview with an Add button in solution lists; Undo and action buttons in messages (Scale sweep replaces the browser's confirm); progress bars for the three workers; one export range for the `.s2p` export and the S-Plot network.
- Responsive shell and tool column (phase 4): three columns on a desktop with the header in groups by purpose (one row from 1440 px), two columns on a tablet with a side column Network | Numbers, and on a phone a top bar with More, the chart pinned as a square with design, grid and readout chips, and a bottom sheet Network | Numbers | Tools with peek, half and full detents and a live Zin and VSWR strip. Auto match, Optimize band and Tolerance open beside the numbers at every width, never over the chart, keep running behind another segment with a dot on their button. A start guide card with the three steps of a match on a new design; mode banners for an armed part and datapoint input; a datapoint column chooser on the phone; schematic cells sized to their values.
- Chart touch (phase 5): pinch zoom about the midpoint, two-finger pan, one-finger pan, marker drags with a 22 px halo and the nearest centre picked, long press for the context menu with "Suggest a match to here" on empty chart, double tap on a marker for suggestions, press, aim and release to place an armed part, a readout band on the phone; touch cursor readouts on the Response and S-Plot plots; ladder reorder by dragging the card's grip (long press on touch) and drag out of the panel to remove with Undo; hints worded for the pointer in use.
- Feedback and motion (phase 6): empty states with the step that fixes them (the empty network, Response and Optimize band without a usable sweep with "Use 0.5 to 2 f", S-Plot without files with Open and Add the network, Tolerance without parts, the datapoints table with only the load); files dropped on the S-Plot view load as Open does; a note with Run again on a stale Broadband or Tolerance result; a Copied state on Share; popovers, dialogs and sheets that enter on the motion tokens, a 200 ms Fit, a cross-fade of the chrome on a theme switch, and no motion at all with reduced motion; Undo and Redo name every step, typed values and switches included; slider tunes, the optimizer, Broadband, Auto match tune, distributed synthesis, imports and S-Plot hand-overs are named steps, and opening a file, an example or a Broadband network that replaces the parts carries the inline Undo; Ctrl+S, Ctrl+O, Ctrl+E (the File menu at Export) and Alt+1 to Alt+3 (the views), listed in the File menu.
- Install to a home screen (phase 7): a web app manifest with 192 and 512 px icons, a maskable icon with its own artwork inside the safe zone, and an apple-touch-icon rendered from the favicon (`scripts/icons.mjs`); its URLs are relative, so the app installs from any folder; no service worker.
- A job that finishes while its tool is behind another segment says its result ("Broadband search done: best worst-case VSWR 1.31") and leaves a check dot on the tool's segment or Tools entry; the button of a running job reads Stop, and stopping says so.
- On the phone a running job shows at peek as a thin bar along the top of the sheet's header with its line in place of the segments (a tap brings the tool up); errors stay as a banner under the top bar on the Response and S-Plot pages too.

### Changed

- The view shortcuts are Alt+1 to Alt+3 (they were Ctrl+1 to Ctrl+3, which Chrome on Windows keeps for its tabs; Ctrl+Alt, AltGr, is left to the keyboard layout); Ctrl+S, Ctrl+O and Ctrl+E act once for a held key and work by the key's place on a non-Latin layout.
- The design name commits on Enter or when the field is left, as one Undo step; Escape reverts it. Typing a long name no longer fills the 100-step history.
- An inverted sweep range is swapped when it is committed, with a message ("Swapped the sweep to 250 MHz to 1 GHz"); Response, Optimize band and Broadband read a range the same way, and the empty states say what a usable range is.
- **= Z0** on the target card sets an explicit target equal to Z0, and a value typed into the target fields counts even when it equals Z0, so the start guide ticks its second step.
- On a touch screen the close buttons of the tools, the tour and the start guide, the error dismiss button, the chart chips and the phone's sheet segments are 44 px; with a fine pointer small controls stay at 22 px.
- Dropping several files on the S-Plot view gives one message for all of them ("Added 2 files; broken.s2p could not be read: ..."); a `.txt` or `.csv` table above 20 MB is refused before it is read.
- A dialog dragged aside lightens its backdrop to 10 percent, so the chart behind stays readable.
- The old token aliases (`--bg`, `--panel`, `--border`, `--text`, `--muted`, `--font`, `--mono`) and `.btn.tiny` are removed in favour of the semantic tokens and `.btn.sm`; duplicated CSS rules are merged.

### Fixed

- Tap to preview in Add parts and Broadband on a touch screen keeps the tapped row with the default target, and a list that changes under a previewed row drops the preview.
- Delete, Ctrl+N and Ctrl+Z no longer act on the design behind an open dialog or menu.
- Tall menus (Examples, File) stay below or above their button and scroll inside instead of covering it; a moved dialog is pulled back inside when the window shrinks; focus no longer drops to the page when the opener of an overlay is gone.
- S-Plot on a phone: entries wrap and long names truncate; the selected gain table row follows its frequency across a refresh.
- Messages: the status message truncates beside its buttons, a repeated message shows its toast again, the phone shows a message once (as the toast), Undo names New and Scale sweep, the tour start message carries Undo, adding a part at its default value is announced; errors carry an explicit flag and stay as a banner on the phone.
- SPICE and LTspice exports note that component package parasitics are not included.
- Crossing 700 or 1100 px (a rotated phone, a resized window) no longer remounts a panel: a running search, typed values, the chart zoom and open dialogs survive it, and the focus stays where it was.
- Sheet holds are kept per mode, so an armed part, a marker drag and a previewed solution end in any order and the sheet comes back to where it was; a flick carries to the detent it is heading for.
- Tolerance runs 100000 networks without a stack overflow and reports a failure in a short message; the yield never rounds up to 100.0 % with a failed run.
- Marker and ladder drags follow their element by id: a Delete or Undo under a drag moves it or ends it without a change.
- Placement is refused where the armed part cannot reach (a dashed red ghost and a message); hollow user datapoints no longer take a press while a part is armed; a third finger no longer ends a pinch; a long press in the chart margin does nothing.
- The Markdown reader of the user guide keeps pipes in code spans and escaped pipes inside table cells.
- A tool opened during a guided tour ends the tour with Undo in its message.
- On the desktop the readout names a dragged point with its own impedance where it lands on its locus.
- The Tolerance VSWR limit is shown as typed.
- Escape during a ladder drag cancels only the drag.
- The Broadband progress counts its real total: ladders first, then the refinements, and the bar's value and maximum match its words.
- Winding and dimension writes are named steps for Undo and Redo.
- A view switch, a lost window focus or a hidden page during a marker drag ends the drag as its own step; before, the next slider tune merged into it. The store ends a transient run when its owner goes away.
- Undo names: the start datapoint step is named, setters that change nothing record nothing (the same package, a lock on a missing part, an unchanged sweep), the guide's example link says "Loaded Example 5", a guided tour's Back no longer renames the tour start, and a step that throws leaves no label behind.
- The Fit animation cancels only the frame it created.
- After Run again, and after Auto match from the empty network, the focus goes to the panel's first control; a stale result shows one Run again; a stale Tolerance cloud is dimmed with "stale" written over it; after a Tolerance run at half the histogram scrolls into view.
- The tour at half shows one Next, and its button row stays in view at the foot of the sheet.
- The Share button keeps its width while it shows Copied; the tablet's idle status text gives way to a touch readout.
- Units: a heading writes 450 MHz in upper case without shouting the unit, the pinned plot readout shows units ("|S11| -10.07 dB"), and a missing value shows a middle dot instead of a dash.
- Wording: the desktop chart hint says "double-click a point or empty chart"; the phone's File sheet leaves out the keyboard hints on a touch screen; the theme button is named for its state ("Theme: follows the system", "Theme: dark", "Theme: light").
- After Move up or Move down from a card's menu, the focus returns to the moved card's menu button.
- The user guide no longer lists two limitations that were out of date: the theme follows the operating system by default (the theme button cycles auto, dark and light), and keyboard steps on a tuning slider within 500 ms of each other are one undo step.

## 0.1.0 (2026-10-24)

First public release. A clean-room web rebuild of Smith V4.1 by Fritz Dellsperger, with the build-oriented features of Elsie and the modern parts of QuickSmith-Web. The user guide (`docs/06-user-guide.md`, also in the app under Help) describes every feature.

### Smith chart and network

- Z and Y grids, a free ladder of twelve element types evaluated live, draggable datapoints, element loci, VSWR circles, Q contours, stability, gain and noise circles.
- Several user datapoints, datapoint sweeps and frequency sweeps; the two-port device follows the design frequency.
- Response view (VSWR, return loss, transducer gain, phase, group delay) and S-Plot view for Touchstone, CITI and EZNEC files.

### Matching

- Auto match: closed-form L, Pi and T networks; tuning of existing parts; broadband topology search with an element cap and the Bode-Fano floor.
- Distributed synthesis: multi-section binomial and Chebyshev quarter-wave transformers, the four Kuroda identities, and a commensurate-line stub filter designer.
- Band optimizer, usable bandwidth, limit areas.

### Building

- Realize mode with E6 to E96 series or your own stock list, losses with Q, component packages with parasitics (0201 to 1206 and wire-wound coils), stress (peak voltage and RMS current), Monte Carlo tolerance analysis, microstrip and coax dimensions, a winding helper, BOM.
- Export: Smith V4.1 `.xmlsc`, Touchstone `.s2p`, SPICE and LTspice netlists, CSV and ASCII tables, PNG and SVG, a printable report, share links.
- Import: Smith V4.1 projects, Touchstone, CITI, EZNEC, ASCII tables, and VNA CSV exports (Keysight and Agilent, generic tables, NanoVNA-Saver and LibreVNA).

### Learning

- Ten guided tours, from the L-network to the quarter-wave transformer, with narration computed from the design.
- The 22 Smith V4.1 example projects, and the user guide in a Help dialog with links that load examples, tours and views.

### Interface

- Phases 1 and 2 of the interaction redesign (`docs/07-interaction-redesign.md`): a token system for colour, type, spacing and motion in light and dark mode; a focus ring on every control; 44 px touch targets on touch screens; new controls (fields with units inside, segmented controls, switches, sliders with one undo step per drag, inline icons); fields that refuse ambiguous or foreign units with a message naming the field and what was typed.
- Phone and tablet layouts are usable but not yet the final design; the remaining redesign phases (bottom sheet on the phone, tool column, chart touch gestures) follow.

### Quality

- Every feature went through review rounds by a QA validator, an adversarial tester and a UI reviewer; about 2900 unit and component tests.
