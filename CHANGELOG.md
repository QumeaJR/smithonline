# Changelog

All notable changes to Smith Online. Versions follow semantic versioning; before 1.0 a minor version may change behaviour.

## 0.9.0 (2026-10-29)

### Local projects

#### Added

- **Projects** (docs/11): many named designs kept in this browser, with no account and no server. File, **Projects…** (More, Data, **Projects** on a phone; Settings, Data in this browser, **Manage…**) lists them with a thumbnail of the network's trace, the time each was modified and the open one marked; search by name, sort by modified or name, **Open**, and a menu with **Rename**, **Duplicate**, **Export .json** and **Delete** with Undo. **Export all** saves every project in one .json file, **Import .json…** adds design files or such a file (projects already in the list are skipped).
- **Save to projects** (File and the list) keeps the design on show as a project; from then on every change is written to it half a second after it is made. A chip beside the design name says **Saved**, **Unsaved** or **Not saved**. New, Open, examples, lessons, workflows and links start an unsaved design.
- Opening a project is one step of Undo: Undo brings back the previous design with its own project, and an unsaved design it replaced is also kept as a backup (Settings, Data in this browser).
- The first start with projects makes the autosaved design the first project, once.
- Usage counts: a `project` event (open, save, duplicate, delete, rename, import, export, export all, migrate; counts only, never names), and `error` gains `projects` (docs/10 section 1.3).

#### Safety

- Projects live in IndexedDB with a memory fallback; a private window or a refusing browser says the list lasts until the page closes, and a full one says Export all keeps them as a file. A refused write never touches the design on show or the autosave.
- Each stored record is checked field by field: a record that is not a project is skipped and left as it is, never shown or deleted; one whose design this version cannot open is listed as such and can be exported, and is never rewritten.
- A project another tab changed is never written over. At the start, the autosave is written back to its project only when that project is unchanged since; the open project's mark is removed before each autosave and written after it.
- Limits: 500 projects, 20 MB per project, 128 MB per imported file.

#### Fixed (QA round)

- Every write of a project goes through one checked write, one write at a time: it is made only when the stored record is still the version this tab wrote or read. Rename, Duplicate and Undo of a delete read the stored record first, so a tab whose list is older no longer writes its copy over another tab's newer edits.
- A project another tab changed is no longer left behind: the design on show is kept beside it as a new project, "name (from this tab)", and stays saved there. At the start the same holds for an autosave whose project changed since.
- The open-project mark is written only with the autosave it belongs to, never re-dated by a write-back, so a start never writes an older design from another tab over a newer one.
- A lean autosave (part data left out for room) never strips the part data from its project: the design takes the data back from the project, and the start says so.
- A write-back the browser refuses says so in the status line ("Not saved to project ...: browser storage is full"), the chip reads **Not saved**, and opening another project then keeps the design as a backup. Opening a project keeps a backup whenever no stored project holds the design on show, written from the design itself rather than from the autosave another tab may have written.
- Duplicate of a 200-character name no longer hangs: the name is cut to leave room for "(copy)".
- Export all writes numbered files when one would pass the import limit, and Import reads up to 128 MB, so every backup the app writes imports again.
- Delete keeps its **Undo** in the status line for 8 seconds after the list is closed; deleting the open project asks first. The header's chip says **Saved**, **Unsaved** or **Not saved** in words (the project's name in its tooltip), and the header stays one row at 1440 px; on a phone More carries a mark while the design is unsaved.
- Delete waits for a write-back on its way (no row coming back after a delete); a project deleted in another tab is said; two tabs starting together migrate once; a database closed by another tab's upgrade is opened again; Save to projects waits for the list and asks for a name for an untitled design, and offers the project that holds the same design; the first start says the autosave is now the first project.
- The list: the sort is remembered, names sort naturally ("copy" before "copy 2"), long names end in an ellipsis with the full name in the tooltip, a stale error goes with the next action, rename selects the name, the list opens with the focus on search, closing it from Settings returns to Manage, the status is announced once, the sort is a radio group, Open on an unreadable project says why, Export all names its files and the footer shows when it last ran.
- Import tells a damaged design file from one of a later version; names lose C1 controls and direction overrides; a modified time past the year 2286 reads as unknown. The backup of a replaced design is named "the design that was open before", and a link opened over a project points to Projects.

#### Fixed (QA round 2)

- Undo of a delete that the browser refuses no longer loses the project or says "Put back": the deleted project is kept in the page and in this browser (Settings, Data in this browser) until its Undo is over or it is back, the status line says it could not be put back and what to do (**Export it**, free space), and it goes back once the browser takes a write. Undo of a delete next to a newer project under the same id keeps both, and the second write is checked too.
- Export all and Export .json write what is stored now: the open project's last change, then the list read again, so a project or a change made in another tab is in the file.
- Tabs know of each other (BroadcastChannel, or the `storage` event): each says hello and bye and tells the others when it changes the list, so every list stays current. A tab keeps its own copy of a design no project holds while another tab is open, or after a refused write-back or a change or delete of its project in another tab; a reload of the tab opens it, and a closed tab's copy is listed in Settings, Data in this browser. The messages no longer say "the autosave keeps your design" when another tab may write the autosave: they say where it is kept, or to save it to a file or to projects before closing the tab, with **Save a copy**.
- The header's name field at 1440 px shows about 16 characters (with an ellipsis; the gaps and the action buttons are a little tighter there) and the header stays one 48 px row; the tab's title is the design's name, "name · Smith Online".
- A change typed while a write-back was on its way, then a closed page, no longer makes a "(from this tab)" copy at the next start; a tab that starts while another migrates waits for that project and links its design; deleting the open project no longer blames "another tab" at the next start; Save to projects under a name the list has adds a number ("name (2)").
- The list: a "(from this tab)" row says why it is there; Cancel or Escape on the delete question gives the focus back to the row's More actions, and closing the list gives it to the chip; the search's and the sort's names match what they show; the open project's line reads "Open now: name, saved as you work"; the status line's Undo is "Undo delete"; on a phone search does not take the focus (no keyboard over the list) and a tap on a long name shows all of it; only the list scrolls, not search, sort or Export all.

## 0.8.0 (2026-10-28)

### Feedback, analytics, plots and tool heads (docs/10)

#### Added

- **Response plots zoom, enlarge and export.** Drag a box to zoom: frequency zooms on all four Response plots together, the box's height sets this plot's range. Ctrl or ⌘ with the wheel zooms about the pointer (a plain wheel scrolls the page), Shift and a drag moves the range, a double click resets; a chip in the toolbar says "Zoomed to 2.3 to 2.55 GHz" with **Reset**. A click still sets a marker. Each plot is focusable with the keys + - arrows Enter 0 and E. **Enlarge** gives one plot the whole plot area (Escape returns); **Export** saves it as PNG (1600 x 900, light theme) or SVG, both as zoomed, or its data as CSV over the full range (`antenna_vswr.png`). On a phone an enlarged plot is a full-screen page with pinch and two-finger pan on frequency and a double tap to reset. The S-Plot graphs and the measured-board plot work the same way, each with its own zoom.
- **Send feedback** in Help's title bar, the status bar, More on a phone and the guide: what it is about, a message, an optional email and, if ticked, the open design as a share link (never library part data). Checked by Cloudflare Turnstile, whose script loads only when you press Send; the answer is a reference such as FB-7K3Q2M. When it cannot send (offline, blocked, not set up), the text stays and the dialog offers a GitHub issue.
- **Anonymous usage counts**, on unless switched off in Settings, Behaviour, **Share anonymous usage counts**, and off whenever the browser sends Global Privacy Control or Do Not Track: counts of feature use with closed values only (no design, value, file name, text, identifier or cookie), sent in batches of at most 60 per page load to the site's own `/api/e`. The Cloudflare Web Analytics beacon is loaded by the app only under the same conditions.
- `packages/worker`: the Worker behind `/api/e` and `/api/feedback` (POST only, same origin only, no CORS, size limits, rate limits per address held in memory, every value checked against the app's own schema), Analytics Engine for the counts, D1 for feedback with a daily cron that clears emails after 90 days and deletes messages after 12 months. Static assets are still served without running it (`run_worker_first: ["/api/*"]`).
- Help, **Feedback and privacy**: what is counted, what feedback stores and for how long, and how to have a message deleted (a GitHub issue with its reference). Its wording waits for a legal review before release (docs/10 section 8).

#### Changed

- **Tool heads.** The strip "Numbers | Auto match" is gone: an open tool shows its title and X at the top of its column on every layout (on a tablet in place of Network | Numbers, on a phone without the back chevron). X closes the tool and a running search keeps running: a row at the top of the column shows its progress with **Show** and **Stop**, then its result for 8 seconds, and the header button keeps a dot until the tool is shown. The open tool's header button closes it; a closed busy tool's button shows it again.
- The guide's "nothing leaves the browser" now reads "your designs and files never leave the browser unless you attach a design to feedback".
- `wrangler.jsonc` deploys a Worker with the static assets; README, Deployment lists the owner's dashboard steps (Web Analytics, Turnstile, D1, build variables, the secret, the deploy command, the query token).

#### Fixed (QA round)

- A box drawn on a Response, S-Plot or measured-board plot now zooms: the select box was read after uPlot had cleared it. A drag stays on the plot it is made on, so only that plot fixes its y range.
- The plots are usable in place: each Response plot keeps a plotting area of about 160 px at 1440 x 900, 1024 x 768 and on a phone (rows of 236 px, 280 px on a phone, and a slimmer frequency axis), and the view scrolls when four do not fit. The hint under the Response toolbar and in S-Plot says "Drag to zoom, double-click to reset, Ctrl or Cmd wheel, E to enlarge", and S-Plot graphs and the measured-board plot show the zoom chip with Reset in their head.
- A double click or double tap resets the zoom without adding or removing a marker.
- Exported PNG and SVG name every curve (the legend wraps), keep the unit in the title, take ticks for their own size, widen a flat range (no NaN for the group delay of an empty network) and drop control characters from names; a CSV column name that starts like a formula gets a leading apostrophe.
- Feedback with the open design attached works for every measured sweep the app keeps (up to 2001 rows, about 150 KB, under a cap of 256 KB); a design over the cap is flagged before Send with **Send without the design**; a refusal names its real cause, and a body refused for its size or a field no longer counts against the three sends a minute.
- Help, **Feedback and privacy** says exactly what is sent: the fields of each count (version, layout, pointer, theme, installed or browser), what Cloudflare Web Analytics records and keeps (7 days in full, then a sample, six months on show, nothing stored in the browser), that switching off stops Web Analytics from the next page load, the design attachment with the rows and names of your files, and Cloudflare Turnstile, which now loads only when you press Send, with a link to its privacy addendum. The Web Analytics beacon no longer follows address changes and is left out of pages opened from a share link.
- The Worker applies the per-load caps to each batch itself (one start, five identical events) and keeps a daily write budget; the app stops sending counts for the page when `/api` answers 404, so previews stay quiet.
- Show me and the ? link sit in the fixed tool head; the Response toolbar fits a tablet; the Optimize band text points at the sweep panel under Numbers; the Send feedback categories are a radio group of 44 px options on a phone, an invalid email says why, and the phone footer stays at the bottom; Feedback opened from Help returns to Help, and Help opened from Settings returns to Settings; the phone's "‹ Plots" button is 44 px.
- Leaving an enlarged plot brings every Response plot back to its own height: the drawing no longer sizes the grid row (it stayed at the enlarged height until a reload).
- Each Response plot's legend names the stored curves drawn on it, as the export does.
- The plot CSV writes every plotted value to 6 significant digits, live and stored curves alike.

### Depth phase D7: broadband matching from data

#### Added

- **Real frequency technique** in Auto match, Broadband, below the search. Choose the number of parts (1 to 8) and run: the simplified real frequency technique (Yarman and Carlin) optimizes the transducer gain of every lossless ladder of that size over the band at once, through the coefficients of h(p), the numerator of the equalizer's input reflection, for the flattest gain at the best level, and builds the ladder by continued fraction expansion (Darlington synthesis). Lowpass, highpass and bandpass ladders are all tried; a bandpass ladder is held to the source resistance without an ideal transformer. Runs in a Web Worker with progress and Stop, and shows in the tool's job row like the search.
- The panel puts side by side the gain shape found for that many parts (lowest gain in dB and the VSWR it implies), the Bode-Fano limit, the topology search's best ladder of the same size and the real frequency ladder, with a plot of the gain over the band. Hover previews the ladder; a click puts it in the design as one step of Undo, after the kept parts when they are kept, and Realize snaps it like any network.
- Workflow **Best possible match from data** (Learn): the sample antenna, the search, the real frequency run, its gain shape against the limit, its ladder against the search's, and using it. Broadband limits now chains to it, and its last step points at the panel.
- Next step **Try the real frequency technique** after a broadband search on a fitted measured load.
- Usage counts: `job` gains `rft`; a new `rft` event counts runs and applied ladders by prototype (docs/10 section 1.3).
- `packages/core/src/rft.ts`: `realFrequencyMatch`, `hurwitzFactor`, `belevitchGain`, `synthesizeLadder`, `ladderBelevitch`, `polynomialRoots`, `vswrOfGain`, `gainOfVswr`.
- Oracle: `tools/oracle/d7_check.py`, run by `check.py` in the CI job, recomputes g(p) from the app's h(p) with numpy's roots, the gain shape, and the synthesized and final ladders on the load with scikit-rf.

#### Verified

- Published: the Chebyshev matching equations of Matthaei, Young and Jones (1963, DTIC AD 402852, Sec. 4.10) reproduce their printed numbers, and on their load the technique reaches the published optimum (`qa-d7-published.test.ts`). Closed form: on Fano's RC load over a lowpass band, with the generator resistance free, the technique reaches the Chebyshev optimum at 1 to 8 parts, rises with the degree and stays under Bode's limit 1 - exp(-2 pi / (omega_c R C)); over a bandpass band it never passes Fano's exact floor.
- Reference loads (the broadband lesson's antenna, the sample antenna, the synthetic dipole; 1 to 4 parts, 33 band points): started from the search's ladders, as the panel runs it once the search has run, the real frequency ladder meets or beats the topology search at every part count, for example 2.209 against 2.431 for the lesson antenna and 1.529 against 1.561 for the sample antenna with 3 parts; on its own it meets or beats it in 10 of 12 cells (docs/08, D7).

#### Fixed (QA round)

- The Hurwitz factor g(p) is checked before use: g(p) g(-p) must give back h h* + f f* (to 1e-9 of its largest coefficient), an unconverged root search is never used, and failed roots are no longer kept as the start of the next call. A gain above 1 now counts as a loss in the optimizer, not as a perfect point. At 7 and 8 parts shapes no longer vanish.
- More parts are never worse: every part count runs on the same band points, starts exactly from the result with one part fewer (the added part at zero, carried through every stage), and keeps that result as a candidate; when the added part does not help, the answer is the smaller ladder and the table says so. The best ends of each prototype also go through a simplex on the worst point itself (the published Matthaei, Young and Jones case now within 1e-6 of the hand value). On the high-Q load of the review (2 ohm and 200 nH, 100 to 150 MHz, 33 points) the worst VSWR now falls with every part: 64.50, 59.38, 39.52, 31.43, 31.42, 27.26, 26.30 and 26.30 (the eighth part adds nothing, and the answer has 7 parts) for 1 to 8 parts.
- The comparison is like for like and honest: the ladder's parts are held to the search's part window (reactance Z0 / 25 to 10 Z0 at band centre; a part outside is brought to the edge, then polished inside it), the search's ladder is measured on the technique's grid (snapped too when Realize is on), the search's best of every size is used (no more "not run" at sizes it searched, through the new `bestBySize`), and when the search has run the technique starts from its best ladder of each size and keeps it as a candidate, so it is never worse than the search. Each row gives the worst VSWR and the worst mismatch loss in dB, and the ladder row says by how much it differs ("0.470 lower VSWR, 0.50 dB more worst-case gain than the search", or "the same as the search").
- The first row is "Gain shape found", not "best", and says that the ladder is built from it and then polished; the plot draws the ladder that Apply inserts (snapped when Realize is on) with the shape as a thinner line, and states the largest difference between the two.
- The Bode-Fano limit is never shown where it does not hold: none through kept parts with loss, and an estimate (marked "estimate from load Q, may be off either way", in the row and its tooltip) or an exact value that the ladder, the kept parts or the bare load beats is left out with "the estimate does not hold for this load". The guide no longer calls the technique the answer for those loads.
- Synthesis also expands from the admittance (a shunt part first), so ladders that start with a shunt part come back ending in R0.
- With Realize on and values that cannot build the ladder (snapped, it reflects all the power somewhere in the band), the real frequency panel and the search say so and offer no row, where they showed a VSWR of 1000000.
- `gainOfVswr(Infinity)` is 0, and a part count that is not a number is held to 1 to 8.
- Changing only Parts says "Parts changed since this run" with one Run again; Stop from the job row says "Stopped the real frequency run" as the panel's Stop does; "1 part" in the singular; the Broadband intro links to the real frequency section; the gain plot has its unit on the y axis, more ticks, the limit labelled with its value, tick text in the secondary text colour and visible axes; a band past the measured data shows its warning in the real frequency section too; on a touch screen the row's button reads Use where it replaces the network.
- Workflow "Best possible match from data": step 1 says the sample is synthetic; step 4 points at the plot; step 5 offers to run the search when it has not run, and no longer claims the technique reaches every ladder; step 6 says Tap and Use on a phone, and that one Undo takes the whole step back. The next step "Try the real frequency technique" also comes when the search is far above the limit on a fitted load, and goes once the technique runs.
- Oracle: `d7_check.py` now checks quality, not only consistency (a run with no optimization passed before): on Fano's RC load at 1 to 8 parts the synthesized ladder must reach the Chebyshev optimum of Matthaei, Young and Jones (Eqs. 4.10-3, 4.10-4, 4.10-17) and stay under Bode's limit, never falling as parts are added; every final part must lie in the part window; a six-part case is added.
- Docs: the rft.ts header (m up to 1024, ten starts), docs/06 (the workflow is listed, the run times as measured), docs/08 (the comparison table on 33 band points, with the technique alone and from the search's ladders, and the published check).

#### Fixed (QA round 2)

- Results survive closing Auto match: the search's and the real frequency result, the typed band, Max parts and Parts are kept (`useBroadbandMemory`) while the design is the same, so a run that finished in the background, or before the tool closed, is shown and applied after reopening (Parts no longer resets to 4). A finished real frequency run puts a check dot on Auto match like the search.
- The search's Bode-Fano row no longer states an estimate as a hard limit: only an exact floor says "no lossless network of any size does better", an estimate says it is one, and a floor that a ladder found (the search's or the real frequency ladder on the same band) or the load beats is left out with the reason, by the rule of the real frequency table (`shownBandLimit`). The Response view's dashed line follows the same rule and reads "Bode-Fano estimate" for an estimate.
- Oracle: quality on the path the app runs (no transformer, every k, polished): the lesson antenna and the sample antenna at 1 to 6 parts, rebuilt in scikit-rf and held to the docs/08 table (no worse than 0.2 %). A scratch copy with no optimization on that path, which passed every earlier check, fails 9 of these.
- `hurwitzFactor` no longer gives up on valid ladders: a cold root search that does not settle restarts on three other circles with more steps, and a root within 1e-9 of the axis (rounding) is moved into the left half plane before the factor is checked.
- Run times: one range in the panel and Help, measured in Node with 33 band points (up to 4 parts a few seconds, 5 to 8 parts about 10 seconds to a little over a minute).
- When the search's ladder is kept as the result, the ladder row says so and gives the technique's own value; without the search run first the panel says the technique can come out worse than the search.
- Workflow "Best possible match from data": step 5 updates once its own Run the search has finished (the result is announced after it is on show), and its text names the button as labelled; the search step no longer calls an estimate the best any network can do. On the phone, step 4 opens the sheet full, so the plot with its frequency labels and legend is in view, and with a tool open the sheet's head keeps Next at full height too.
- The gain plot's y ticks follow the data range (a 0.1 dB spread gets 0.05 dB ticks, not two ticks), with tick text of 10 px or more; the status line says "1 part reaches", "4 parts reach".
- With Realize on, ladders within 0.02 VSWR of the search read "about the same as the search", and the text says the threshold.
- "Shape" for the search is "network shape" or "topology"; "gain shape" stays for the real frequency technique (panel, Help, workflow).

## 0.7.0 (2026-10-28)

Depth phase D6 of `docs/08-depth-plan.md`: the closed loop. Measure the built board, compare it with the design, fit what moved and retune.

### Added

- **Compare with the design** in the import dialog: the measured S11 of the built board (Touchstone `.s1p` or `.s2p`, CITI, VNA CSV) is set against the network as built, apart from **Use all rows as the load**; the load stays. A two-port file is taken with port 2 on the VNA's reference. One step of Undo; **Stop comparing** removes it.
- The Response view's **Measured board** panel: |S11| measured and designed, the fitted model and the result expected after a retune, |ΔΓ| per frequency on the right axis, and the worst VSWR in the band measured against designed and the target. The chart draws the measured board (dots, start, stop and f marked, a readout per point) beside the designed, the fitted and the retuned input impedance, in the palette of the panel.
- **Build, Measured board**: **Fit what moved**, a least squares fit of part values, per-part pad capacitance, all pads, vias, trace length, εr and h, each scaled by its typical drift and lightly regularized, in a worker with progress and **Stop**. The drift table gives each drift with its standard uncertainty; parameters the data cannot tell apart (an effect like one other's, no effect, or an uncertainty of half the typical drift) are named and not fitted, correlated pairs are flagged, and more unknowns than 2N - 2 for N frequencies are refused.
- **Suggest retune**: the part values snapped to the design's series, stock or part library that bring the built board as fitted back inside the VSWR limit, the fewest changes first, with the expected worst VSWR and the part to change first; **Apply retune** is one step of Undo.
- The workflow **Measure, compare, retune** (open the sample, compare, read the overlay, fit, the drift table, suggest, apply), the next step "When it is built: compare" after a BOM export with Realize on, and the sample **Built board at 1 GHz (synthetic .s1p)**: the buildable board re-centred to a 10 nH shunt L (it meets the target as built), with +8 % on the shunt L, +0.3 pF on the series C's pads and noise 0.001, written by `scripts/synth-board.mjs`.
- Core: `closedloop.ts` (`driftParameters`, `driftedElements`, `compareMeasurement`, `fitBuild`, `suggestRetune`, `retuneCandidates`).
- Oracle: `tools/oracle/d6_check.py` rebuilds the network as built with no drift, fitted and retuned in scikit-rf, recomputes the fit residual from the file read by scikit-rf, refits the drifts with scipy, and checks the retune inside the limit under the fitted and the true drifts; part of the CI oracle job.

### Changed

- The measurement is saved with the design: in the `.json` file and the autosave whatever its size (up to 2001 points), in a share link up to 201 points (a larger one is left out and the Share message says so). Every reader checks it; one that cannot be read is left out and the design still opens.
- The workflow **Verify against an independent tool** ends with its measure and compare step; **Build with real parts** chains to **Measure, compare, retune**.

### Fixed (QA round)

- File, Save as Smith Online (.json) dropped a measurement over 201 points and kept only the rounded link copy; every `.json` writer now uses one function and keeps it at full precision.
- Fit and retune no longer give confident answers the data does not support: the residual is compared with the noise floor estimated from the point-to-point scatter (noise up to 3 floors, "explains most, not all" up to 10, "does not explain this board" above, the floor taken no lower than 0.002), drifts above 3 typical drifts or past the physical are flagged, and a design frequency or band outside the measurement is said; an untrusted fit is shown in warning style in Build, the Response panel and the status line, and its retune is refused.
- A **Reference plane** parameter (a port extension, typical ±20 ps, unticked) fits a calibration plane ahead of the board; the retune and the target figures leave it out.
- The retune is judged only at the band frequencies the board was measured at, and refused when any of the target band was not measured (a change judged on part of the band can make the rest worse; found in the final re-check: 1.29 to 1.42 outside a 0.9 to 1.0 GHz measurement of a 0.9 to 1.1 GHz target).
- The sample design met its own target only with ideal parts (worst VSWR 1.591 as built against 1.38): its shunt L is now 10 nH (1.298 as built), so the drift alone takes the board out (1.550) and the retune to 9.1 nH brings it back (1.362); the sample file is regenerated.
- Build flags a design that misses its target as built in warning style, and the retune says whether the design as built missed the target or the board drifted out of it.
- After Apply, Build and the workflow's last step say what the reworked board should measure (the expected worst VSWR), not "measured and designed agree"; the stale "fit again" note is not shown then.
- The chart and the Response panel share one palette of tokens for measured, designed, fitted and after retune, none an element colour or the dotted as-built style; the legend names all four, on the phone too; the fitted curve is drawn on the chart; start, stop and f are marked and each measured point has a readout; the panel draws measured on top, raises the designed line's contrast in dark mode and reads every curve at the cursor in dB.
- The next step after a BOM export no longer swaps the user's design for the sample: from the user's own design the workflow's open step asks for File, Open, and offers the sample only as "Use the sample board instead (replaces your design)", undoable.
- A two-port measurement: the retune and the designed and target figures use the design's load, not the VNA's termination (only the fit and the curves use it); the measured VSWR is not given for it.
- The retune is the fewest changes that reach the target: the result is pruned and, with more than two changes left, the pairs among those parts are searched over all their values (two changes where it gave four); a board inside the target gets no change, no part to change first without a change, and an empty band is refused.
- εr and h drifts reach every microstrip of the network (they are on the same laminate), and are offered only where something depends on them.
- Apply with Realize off and the part library chosen wrote effective values into ideal parts; Apply now places exactly what the retune evaluated (a library part as the library part element) or refuses with the reason.
- The comparison followed only the design object: a change of the part library left a stale designed curve; it is now kept per design and part library.
- An open row (|S11| = 1) and repeated frequencies were accepted by Compare and dropped on save; Compare and every reader take the points by one rule (an open kept, the last row at a repeated frequency kept, said in the message).
- Comparing a new file while a fit runs keeps the comparison message (it said "Fit stopped").
- A file of three or more ports is refused by Compare with the reason (it was called a two-port with only port 2 terminated).
- Suggest retune evaluates only the parts a combination changes (kept impedances and matrices of the network as built): sixteen parts over 201 frequencies take about 0.35 s instead of 6.6 to 10 s.
- `boardKey` serialized the library parts' data (7 MB, 30 ms a call); it now keys on part numbers and data hashes, a few kilobytes, kept per design.
- The fit's regularization is per parameter, relative to its own effect, so a weak but resolvable parameter is no longer shrunk (a 10 mΩ resistor by 1.6e-3 of its drift); docs/08 no longer claims "without visible bias" for the old weight.
- The stock retune test parsed an empty stock and checked nothing; its input is now a list that reads.
- Oracle: `d6_check.py` decides on its own which parameters the data resolves (scipy's pivoted QR on the scikit-rf Jacobian) and recomputes the standard uncertainties from its own Jacobian; a sigma scaled 1000 times or a split that differs fails.
- The drift table: digits from the uncertainty, correlations labelled ("correlation 0.97 with ..."), the reason of an unresolved parameter matching the rule that fixed it, drifts within 2σ marked not significant, unticked parameters listed as "not fitted (unticked)", typical drifts as "±10 %", no "All pads (all, ...)".
- Changing the ticks after a fit says the table is of the earlier choice.
- The Response view's plots follow their container after a resize (one grid column as wide as the view), and the measured board's plot keeps its height under the checks' notes.
- On the phone the sheet's head shows the step's text (one line, More for the rest) at peek and when a tool covers the narration, as the overlay head does; at Fit what moved the Fit button is in view once the Build sheet has settled (checked at 375 px).
- The import dialog says what Compare is ("the board you built, measured") next to Use all rows, and why Compare is off (one row, three or more ports); a two-port Compare goes back to the design before the file in one Undo and does not leave the device panel's stability chip.
- A share link the measurement makes long (over 4000 characters) says some mail and chat tools cut long links and suggests a `.json` file.

### Fixed (QA round 2)

- The reference plane is the bench's, not the board's: it is never called a "large" drift (only beyond ±1 ns, the range the fit takes), it starts from a scan of the plane alone and from the phase slope of the measurement against the design (each start screened, the best run on), and the advice to tick it is never given when it is ticked. On the 5 mm offset file ticked: the plane 30.8 ± 0.5 ps (truth 30.3), the series C's pads +0.284 pF, the residual at the floor (it gave 39.6 ps and blamed the shunt L's pads); an 80 ps plane is trusted (it was refused); a 300 ps plane is found (it ended at -137 ps).
- Before the fit only a parameter whose effect is like one other's (correlation above 0.9987) or a numerically exact combination is set aside; one near the span of several is fitted and judged by its uncertainty (the series C's pads were set aside at 0.91). A fitted pair correlated above 0.95 is reported as "X or Y: these two cannot be told apart" when one of them is not significant, else as moving together.
- With Reference plane unticked (the default), every fit runs again with the plane and an F-test compares the two: when the plane explains the data better (p below 0.001) by a tenth of the floor or more, the check names it ("a reference-plane offset of about +30.8 ps ... tick Reference plane") and the fit is not trusted. A 1 to 2 mm offset no longer passes as noise with a wrong drift table and a retune that misses on the true board.
- Suggest retune searches every pair over all options of all parts when no pair of the nearest values reaches the target, before more changes (the reviewer's 5 and 6 part cases: two changes inside the target, where it gave three, one case still outside); each combination is judged with a bound, so sixteen parts still take about 0.3 s.
- A retune is never worse than the board as it is: when no change in reach does better, there is no suggestion and no Apply (from the part library a change to 4.7 pF was offered at 1.879 against 1.783).
- Apply keeps the parts the retune did not change as the board has them: Realize could pick another value for them (E96: the series C from 2.74 to 2.67 pF, 1.365 promised, 1.345 built); such a part is set to its value as built, locked where needed, and named; Apply refuses when the network as built would still differ.
- Library parts in the fit: a value (a scale on the part's measured impedance, ±5 %, approximate) and, on the board, pad parameters; the measurement keeps what the board was built from, and after a change of source the check says "this measurement was taken on a board built from E24 values; the design now uses the part library" instead of blaming the plane.
- The floor the residual is held against is printed as used, with the scatter when it is below; **VNA class** (lab 0.002, hobby such as a NanoVNA 0.02, from the file when it is a NanoVNA or LibreVNA export) sets the instrument's accuracy, so a smooth calibration error of a hobby VNA is not called unexplained.
- A share link keeps the measurement's frequencies whole (six figures merged a 1 kHz step at 1 GHz).
- The measure and retune workflow follows its design: after Undo past Apply, New, an example or another file it moves back to the step that fits, with a note.
- A wrong design: one band frequency reads "at 450 MHz" (not "from 450 MHz to 450 MHz"), "the board was not measured there" replaces "measured not measured in the band", each reason is said once per place, three or more large drifts in one sentence, no "tick Reference plane" when the design frequency is outside the data, the retune refusal names its reason, and with the board off no pad parameter is listed.
- The chart's measured points show a readout (frequency, |S11| in dB, VSWR, Zin in Ω) on hover and on tap, drawn above the network; the legends draw each curve's own line (after retune dash-dot, designed long dashes), apart from Realized.
- The status line after Compare gives the band and the target; after Apply, the worst VSWR the reworked board should measure. "Use the sample board instead" keeps its message beside the import's.
- Phone: the overlay head's buttons wrap below the step title instead of cutting it to a few letters; the Response panel shows one hint; within the workflow Compare is the import dialog's primary button.
- Text: "1 impedance row"; the drift table keeps a value with its unit at 320 px; a retune with a small margin (1.362 against 1.38) says so, that it compensates this board's drift (named) and that a new batch needs the cause fixed.
- Oracle: `d6_check.py` decides the resolved parameters by the new rules on its own, checks the app's F-test p-value against scipy, works out the F-test from its own refits (no plane on the sample, the plane on the 5 mm file) and refits the 5 mm file with the plane ticked (the plane, pads and values within three sigma of the truth).

### Fixed (QA round 3)

- Fail safe throughout: a fit is trusted, and a retune offered, only when it is shown to be the best explanation the data supports; otherwise the app says it cannot tell and why. The rules and thresholds are in docs/08, D6, "Fail-safe rules (QA round 3)".
- The reference plane is searched globally: a profile over its whole range (1 ns, less with coarse frequency steps) with the other drifts refitted at every step, its best minima run to convergence. A band-only sweep with a 200 ps cable no longer lands at -685 ps and promises a retune that makes the board worse; a second minimum the data cannot reject makes the fit untrusted ("the measured band is too narrow to tell a reference-plane offset from part drift").
- Uncertainties are taken against the floor used (the scatter or the VNA class's accuracy), scaled for a residual correlated along frequency (an averaged trace); with the plane not ticked they include what the plane allows, and a plane that moves a drift by more than twice that uncertainty makes the fit untrusted. The plane F-test takes the same variance and the effective number of points: averaged traces no longer call for a plane.
- No hard clamp in the model: pads are linear in their drift, factors bounded smoothly. Every clean fit is exact again (16 of 100 clean boards set a pad aside and called a plane of -1.4e-8 ps). A drift within 2σ of a physical bound is physical: a board as designed is no longer refused for a pad of -0.0000074 pF, and no drift is shown as "-0.00".
- "X or Y": a parameter set aside for its uncertainty while one it correlates with above 0.95 is fitted is reported as a pair; that drift is their joint effect, not a finding. A pair is called "cannot be told apart" only when one is uncertain by more than a third of its typical drift; resolved pairs share one line ("X did not move and Y moved by ...").
- A laminate drift (εr, h) on a board with a microstrip is checked as the plane is, and named when it explains the data as well.
- A residual of 3 to 10 floors is no longer trusted (the drifts take part of a pattern the model misses); a fit with nothing resolved is not trusted.
- The retune is checked against every other explanation the data allows (the corners of the fit's 95 % region, the "X or Y" swaps, the fits with the plane or laminate added): it is offered only when it leaves the board no worse under each, and says so ("inside the target under every explanation the data allows"); otherwise "no change is safe" with what to do. A randomized acceptance test (60 cases by default, 600 in the long variant) finds no retune that makes the true board worse.
- A file is taken as from a hobby VNA only when it names one (file name, Touchstone comments, header); a headerless table is a "VNA table (frequency, re, im)" held to the lab floor. The Compare message names the class and where to change it, and changing the class fits again instead of discarding the fit.
- Chart: each measured dot's hover and tap target is a small filled circle sized in screen pixels (at most 10 px, never over another dot); the readout is of the dot under the pointer (it was a ring as wide as the chart); the labels and the target marker take no pointer, so all 121 dots of the sample read out their own point.
- Phone: the import dialog and other full-screen dialogs open below the workflow head at its real height, so their title and Done stay in reach; at peek the workflow head shows the first line of the step's text; "Open ... first" names the place.
- The retune's cause names each drift it compensates and whether it is within its part's tolerance, which decides the new-batch advice; "no change does better" offers next steps; the source-change note says to set Realize back.
- Workflow: a fit from Build's own button moves the workflow on; Suggest is not offered when a retune is on show; Undo after New lands on the step that fits the restored design, with a note; Undo and Redo labels say they bring back the design, not the workflow; Escape ends the workflow from the Response view too; values and units stay together in the step text; the drift step names the parameters not fitted; the comparison step says when the band or the design frequency lies outside the measurement.
- A Touchstone file with a bad number names its line.

## 0.6.0 (2026-10-26)

Guided workflows and discoverability of the advanced features (`docs/09-advanced-discoverability.md`, from a senior UI design review of 0.5.0).

### Added

- **Learn** (replaces Examples, in the help group): Workflows, Lessons (the ten tours), Sample files and the Smith V4.1 examples.
- Seven guided workflows for the jobs an RF engineer does: match a measured antenna over its band, check the match is robust, make it buildable, verify against an independent tool, amplifier stability, gain and noise, broadband limits and multi-section, build with real parts. Each step highlights the real control, opens what it needs, offers **Do it for me** and moves on when you have done it; opening a tool no longer ends a workflow (a lesson still ends). A workflow followed to its last step gets a check mark. Two more come with D6 and D7.
- Synthetic sample files: a 2.4 GHz antenna (`.s1p`), an amplifier (`.s2p` with noise data) and the 0402 demo parts, opened through the ordinary import dialog.
- Next-step suggestions after a result (check the band, check tolerance, centre for yield, realize, packages and board, export the BOM, compare in S-Plot, check stability, load part files), one at a time, withdrawn on any other change, off in Settings. The start guide collapses to "Matched. Next: ..." instead of closing.
- **Show me** links in the tool heads; `workflow:` links in the guide (**Try** at the end of each advanced section).
- The load card names a measured load with **Match over the band** and **Show on chart**; the network's switch row gains **Board** with **Edit board…**; the two-port panel says whether the device is stable at f and offers the stability circles; the Response VSWR plot draws the Bode-Fano limit after a Broadband run.

### Changed

- Tolerance moves to the design tools, next to Auto match and Optimize band (on the phone: the Tools segment only). Settings says it holds the component packages and the board stackup.
- The Export section of File is grouped: for a simulator, for the build, compare in the app, images and data. The bill of materials is always listed, greyed with the reason while Realize is off.
- Tolerance is judged over the measured band by default when the design has a measured load.
- Plainer labels: Use all N rows as the load (was Sweep all), Use the fixed load (Back to frequency sweep), Bode-Fano limit (floor), Which part matters most (Spread by part), Centre for yield (Centre the design), Load without network (Load alone), Store curves, Add this design's network, Package (Pkg), Add by clicking the chart, Sweep 0.5 f to 2 f; tooltips for K, mu, MAG and MSG, reel correlation and VSWR per %. The tour panel says Lesson or Workflow and the step. The broadband lesson's blurb names its 60 % band.

### Fixed (QA round)

- The **Try** links of the guide to a workflow showed as plain bold text: `workflow:` links are links now.
- The import dialog, Settings, the part library and the File menu covered the workflow panel's Back, Next and Do it for me (measured antenna step 2, amplifier, buildable steps 5 and 8 to 10, real parts steps 3 and 6, verify steps 1 and 2). On desktop and tablet the panel stays above dialogs and menus; a step that opened the File menu, Settings or the import dialog closes it when the workflow moves on; the File menu opened by a step leaves the focus where it was (no second highlight, Enter cannot export) and wraps its descriptions (it was 900 px wide); the SPICE step highlights SPICE and LTspice.
- A step whose condition held when it came on show (Realize already on, S-Plot entries already there, the stability circles a two-port import draws, parts already in the library) never moved on, and its Do it for me did nothing. It now says "Done already. Next goes on." and moves on after its Do it for me; the measured antenna's second Do it for me uses the rows of the open dialog instead of opening the file again.
- An Undo past the start of a workflow that kept your design (chained, Show me, a chip) left it running on the design from before; it ends there now. A workflow of more than 100 steps folds into one step again: one Undo brings back the design from before it.
- Show me in Optimize band and Auto match, and the "Optimize over the band" chip, replaced your design with the workflow's own: they keep your design and start at the tool's step.
- The start guide never folded to "Matched." on the common 50 Ω path, and folded with Zin off the target. It folds once a part is in and Zin at f is within the VSWR limit of the target (Z0 while none is typed).
- Chained from the measured antenna, the robust workflow judged a network whose nominal already missed VSWR 2 (0 % yield, "No better centre found", "within the noise"). Its first step says so and offers a limit the design meets; the Apply step gives the real reason when there is no Apply.
- Phone: workflow anchors in a tool scrolled under the sticky Tools head; the sheet head at half height had no Next or Do it for me; the buildable workflow's locus legend sat in the closed chart grid sheet (the grid button is highlighted now); the amplifier's "Match to it" found no anchor (the Tools segment comes up).
- "Set Shunt C 2 to 2 %" was offered at 100 % yield. A tighter part is suggested only below 90 % yield, after a centring has run, for a part above half the spread; the button opens Tolerance per part (it closed it when open) and focuses that part's field.
- Next steps about the board, the part library or the settings stayed after those changed ("Export the BOM" with the board off); a change there withdraws them.
- The check mark of a workflow was lost where storage refuses to write; it lasts for the page now. It means "seen to the end", as a workflow can be walked with Next alone.
- The robust Apply step counted an Undo as Apply, and steps that wait for a new network or a target counted an Undo or half a target: they wait for the Apply button, a network with other values and a whole target (Target = Γopt sets it exactly). The amplifier's match step opens Auto match at Add parts.
- Opening a sample twice added a second S-Plot entry and a second two-port step; once per sample now, and the verify workflow's stand-in file replaces its own entry.
- A step whose anchor went away because you did the step (Report, Freeze) said "Open the File menu first"; Report and Freeze now move the step on. Apply no longer offers Do it for me when there is no Apply.
- Status line: Show it on the chart, Realize on, the stability and noise circles, Target = Γopt and the end of design centring now say what happened instead of falling back to the credit line.
- Copy: the reel correlation step names a kind with two parts (or says there is nothing to correlate); "Pick a network" compares the part counts from the last search's numbers and highlights the limit line and the top rows (it highlighted the whole 1100 px list); no "For a reactive load" on the 25 Ω real load; Broadband no longer claims alternating ladders; the lessons say Bode-Fano limit, not floor.
- S-Plot: the live entry's name lost its space before "(network)"; a measured-load network (and the `.s2p`, SPICE and LTspice exports) went over 0.5 f to 2 f instead of the measured band; the verify comparison hides older entries (their check boxes bring them back) and says so.
- S-Plot in a short window (1221 x 691): the Smith chart and the polar plot of the right column showed only their top half. They scale to their panel at any window size.
- The sample antenna on a new design set f to the band edge, 2.2 GHz; with f outside the file it takes the row nearest the band centre.
- Optimize band said "failed" with no reason when its worker could not load; it gives the reason now.
- Accessibility: the Realize, Losses and Board switches were named "on", File and Learn took their tooltip as name; they take their visible labels.

### The build goes with the design; Settings holds preferences

Addendum `docs/09b-settings-architecture.md`: the board and the package models were kept in the browser, among the colours, so the same design file or link gave a different as-built network, `.s2p`, report and BOM on another machine. They are now part of the design and edited in a new Build tool beside the chart; Settings keeps the preferences of this browser.

#### Added

- **Build**, a design tool next to Tolerance (Tools on a phone): how the network is built, beside the chart so the as-built locus moves while you type. Realization (series, scope, stock list, **Part library…**), Losses (default Q), Packages (a card per package in use with ESL, Cp, ESR, land size and the pad capacitance, "changed for this design" with **Reset**, **Use 0402 for all parts**, **Show all packages**), Board (**Include the board**, laminate, stackup, vias, traces, **Save as my laminate**) and Part ratings (the stress limits). **Use as default for new designs** and **Reset to defaults** at its foot. Every change is one named step of Undo ("Undo: Changed the stackup to RO4350B, 0.762 mm").
- The design's `build` (board and the package rows that differ from the built-in table) in `.json` files, share links and the autosave, read with the same checks as every other field.
- Your own laminates, kept in this browser (`smithonline.laminates.v1`) and offered with the presets; a design keeps a copy of the stackup it uses.
- Settings: Theme, **Chart at start** (Z grid, Y grid, density, labels, now kept), New designs with series, part tolerance, VSWR limit and the build defaults (**Take from the open design**, **Reset**), Behaviour (start guide, workflow progress), Libraries and Data in this browser.
- Next steps: **Check the stackup** after Board on with the built-in FR-4 1.6 mm, **Use for new designs** after the third Build edit while the defaults are untouched (once per browser); after Realize the suggestion is **Open Build** at Packages.

#### Changed

- One VSWR limit per design: the usable bandwidth readout edits the design's limit, the one Tolerance, Auto match's yield, the next steps and the lessons use (it was a separate limit for the session). A design whose Tolerance limit is not 2 now shows its usable band at that limit.
- The network row keeps **Realize | Losses | Board**; each says what it uses in a line with **Edit…** to its Build section (Edit board… opened Settings). The default Q fields, the scope, the stock list and the stress limits moved to Build. The Board switch's tooltip says "Saved with this design".
- Settings is "for this browser" and holds app preferences only, in six sections; the package table and the board left it. **Reset all** resets appearance, schematic and behaviour; it no longer touches the build or the defaults for new designs.
- The microstrip card's **Use board stackup** is **Use the design's stackup**; the Dimensions dialog and new microstrips use the design's stackup, and a change there is a step of the design.
- Workflows: Make it buildable goes through Build (open Build, Use 0402 for all parts, the package models, Include the board, the stackup, optionally Use as default); its board step is an ordinary undoable design change and no longer switches a browser-wide flag. Real parts points at Build, Realization; Robust says the limit is the design's spec; Verify says the `.s2p` is the same on any machine.
- The Tolerance panel's default line names its source: "Default 5 % from E24, set in Build".

#### Compatibility

- A `.json` file, link or autosave from 0.5.0 or earlier has no build. It opens with this browser's defaults for new designs, the board and package table kept under their old keys (`smithonline.board.v1`, `smithonline.packages.v1`), which is what it evaluated against before, and keeps them from then on. When that default board is on, the status line says so once: "Saved before the board travelled with designs: using this browser's default board (...). Check it in Build."
- A link or file made now opens in 0.5.0, which ignores the build. The `.json` wrapper stays version 1. The build adds about 240 characters to a share link (about 360 with every board number changed); a laminate preset's name and the default board numbers are left out of the link.
- A build with a number the model cannot use (not finite, out of range, an unphysical εr and tanδ, an unknown or repeated package) refuses the link or file, as a bad microstrip stackup does, and the message names the field; an autosave this version cannot read is kept under `smithonline.design.backup` with a message and **Save a copy**, never written over. A long laminate name is cut to 80 characters.
- Package numbers keep one range everywhere (ESL up to 1 µH, Cp and pads up to 1 nF, ESR up to 1 kΩ, lands up to 10 cm). A default package table from 0.5.0 with a number outside it (0.5.0 had no upper limit, so "10" typed for 10 nH was kept as 10 H) has that number set back to the built-in one when it is read, once, and the start names it.
- A VSWR limit is above 1 everywhere; a limit of 1 saved before (Tolerance accepted it) opens as 2.
- `.xmlsc` cannot hold a build; the `.s2p`, SPICE and LTspice exports describe the design's own build.
- A microstrip may be up to 1 km long (it was 10 m in links, files and the autosave). A link or file with a microstrip longer than 10 m does not open in 0.5.0 or an earlier 0.6.0 build. Backups now come in two kinds, `smithonline.design.backup` (an autosave this version could not open) and `smithonline.design.replaced` (the design a link replaced), five of each.

### Fixed (QA round)

- A default package table left by 0.5.0 with a number out of range (`[{"id":"0805","esl":10}]`) made every autosave, link and `.json` file the app wrote refuse to open: the next start showed Example 5 and wrote over the design. The browser defaults, the Build fields and every reader now keep one range (core `PACKAGE_LIMITS`); the stored number goes back to the built-in one with a message naming it, the link writer never writes a number its reader refuses, and an autosave that cannot be read is kept under a backup key with a message and **Save a copy** (autosave pauses when there is no room for the copy).
- Designs without a build (examples, `.xmlsc` files, lessons, workflow starts, the first-run demo) followed the browser defaults, so Undo after **Use as default for new designs** did not bring back the network as built. Every design takes its own build when it comes on show, so nothing on show or in history moves with the defaults; Save .json, Share and the autosave write what is on screen.
- A `#d=` link stayed in the address bar and won over the autosave on reload, losing the work done since. The link leaves the address bar once it is read; opened over an autosaved design it is one step, so Undo brings that design back; the status line says what was opened; Share copies the link without putting it in the address bar (without a clipboard it does, and a reload of that tab still opens the autosave); a link that is not a design says so.
- Phone: the File sheet and the part library covered the workflow's head (Make it buildable steps 11 and 12, Verify steps 1 and 2, Build with real parts steps 3 and 5). The head stays on top of a sheet or a full-screen dialog, with its buttons, and an anchor inside a sheet is scrolled into the sheet's list.
- Tablet at 1024 x 768: the workflow panel covered the File menu (Verify step 1). While a workflow runs the File menu opens leftwards, clear of the panel.
- Chained from the amplifier, Broadband limits kept the amplifier's design (an empty transformer list, a band at the wrong frequency, worst VSWR 86211). It starts with its own 25 Ω load as one Undo step; the other chains keep the design, which their steps can use.
- Phone part library: the Undo of a removal was in the dialog's status line, scrolled far above; the toast offers Undo now, once.
- One VSWR limit rule: Tolerance and the link reader took 1 while the readout and Settings refused it. A limit is above 1 in every field and reader.
- The usable bandwidth judged VSWR against Z0 while the start guide, "a match lands" and Tolerance judged it against the target. It judges against the target when one is set and says so.
- A nameless stackup with a preset's numbers came back from a link with the preset's name; it reads back nameless.
- A laminate of your own whose stored numbers the model cannot use was kept with FR-4's numbers under its name; it is dropped.
- Verify step 4 said "Done already" when S-Plot held a file from before; it waits for a file added in the step.
- A step that is done (amplifier step 3) still offered its Do it for me; a done step offers Next only.
- "Use 0402 for all parts" did nothing on a network without L or C; the step says there is nothing to choose and offers no Do it for me.
- Phone: a highlighted control in Build sat under the sticky head of the pushed page (Build with real parts step 1); anchors scroll clear of it. An anchor in the sheet at its lowest height counted as on screen, so no Show me came (Make it buildable step 3).
- Measured antenna step 6 highlighted the Bode-Fano line; it highlights the top rows to click.
- Build edits put nothing in the status line; each says what changed, in the words Undo repeats.
- The old-design notice has **Open Build**.
- An empty `.json` file said "Unexpected end of JSON input" and a bad board "Not a Smith Online design file"; the messages give the plain reason and name the field ("the board in it is not usable: the height h is outside 1 µm to 100 mm").
- The message for a library part without data at f started with the element number and said "(and 1 more)"; it starts with the part number and names every part.
- At 1221 px the switches of the network row wrapped and the Realize line sat under the Board switch, with two Edit… links alike. Each line starts with its switch's name and the links say what they edit (Edit realization…, Edit losses…, Edit board…).
- S-Plot and Response cut off the last frequency label on the right ("1.1 GH"); the plots keep room for it.
- Phone Build: fields of 42 px and help icons of 28 px; the fields are 44 px and the help icons have a 44 px target. The Measured select of the part library had no border.
- Escape during "Remove all N parts?" in the part library, and during Settings' Reset all question, closed the whole dialog; it closes the question.
- Part library opened from Settings, Libraries, Manage… went back to the page; closing it returns to Settings at Libraries.
- "Changed for this design" in Build looked like a button; it reads as a label.
- QA round 3: the app made microstrips longer than the 10 m its readers took (Dimensions, Use microstrip at 3.5 MHz: 11.8 m; the tune slider at 5x; Optimize band at 7 MHz: 11.2 m), so the next start refused the autosave and a link or `.json` would not open. One rule now, 0 to 1 km (core `MICROSTRIP_LENGTH`), for a new microstrip, the field, the slider, a chart drag, Dimensions, a move to the design's stackup, Optimize band, centring and every reader; past it the slider and a drag stop, Dimensions and a placement say why, and an autosave the 10 m rule refused opens again.
- QA round 3: the design store refuses any change that would make an element its readers refuse (a negative value, a turns ratio or line Z0 of 0, a NaN), with the reason; a `.xmlsc` with such a component is refused on opening; a microstrip on a stackup on the edge of physical is written to a link at full precision, as the build is; Keep size is off where the width leaves W/h 0.001 to 1000 on the design's stackup.
- QA round 3: limits audit beyond the microstrip: the board numbers share one range with their fields (core `BOARD_LIMITS`); Use all rows and S-Plot's sweep to the chart refuse a file of more than 2001 rows, which links and files cut to 2001 before; a Smith V4.1 sweep record keeps at most 2001 points; a design name is cut at 200 characters as it is typed, as links and files cut it.
- QA round 3: with the autosave paused or storage full, a link Share left in the address bar (no clipboard) was skipped on reload and removed, losing the work. The link opens when the autosave does not hold that design or newer, and stays in the address bar until the autosave holds it.
- QA round 3: opening a link replaced the autosave, leaving the earlier design only in Undo. It is kept as a backup (Settings, Data in this browser, with Open, Save a copy and Clear), and the opening message says so.
- QA round 3: a link pasted into the address bar of the running app did nothing and opened over the autosave at the next reload. It opens as an undoable step, with the design it replaces kept as a backup.
- QA round 3: Save a copy wrote the raw autosave, which File, Open refused as "not a Smith Online design file". It writes a design file, and File, Open also reads a copy saved before this fix.
- QA round 3: a sixth unreadable autosave overwrote the fifth backup. No backup is overwritten: autosave pauses and the message says so until you save a copy or clear a backup.
- QA round 3: the autosave gave a nameless stackup with a preset's numbers the preset's name on reload; it stays nameless, as in links and files.
- QA round 3: on the phone the Import dialog sat under the panel sheet (its rows and "Use all 101 rows as the load" covered). It mounts at the application root, above every sheet, as Settings and the part library do.
- QA round 3: phone workflows: above a sheet, a dialog or a menu the overlay head shows the step's text (More for the rest) and Back; in the panel sheet the narration is shown whole or scrolled away, never cut to a Back and Next sliver under the Network, Numbers and Tools bar.
- QA round 3: Value series, Realize scope, the network row's series select, Default Q and the real-parts "Use the part library" changed the design without a status message; they say what changed ("Value series set to E12"), and Undo names it.
- QA round 3: with Realize on, "No value at f" listed library parts twice with element numbers the design does not have; each element once, by its own number.
- QA round 3: phone real-parts step 1 left the Series select half under the sticky Tools head while the sheet rose; the anchor is scrolled clear of it once the sheet settles.
- QA round 3: "Open the File menu" was offered while the File sheet was open (verify 1, buildable 11, real parts 5); it is not offered then.
- QA round 3: the phone's More sheet said Share link "puts the whole design in the address"; it copies a link that holds the whole design.
- QA round 3: part library focus: after Remove all… the focus goes to Cancel; closing the library opened from Settings returns to its Manage… button; the two Manage… buttons have distinct names.
- QA round 3: Done in Build with real parts left the part library its last step opened; Done closes it.
- QA round 3: the message for an autosave that could not be opened named the storage key and no reason; it gives the reason, as file errors do.
- QA round 3: a `.json` with a bad package or board number said "0805 ESL is out of range"; it states the range ("0805 ESL is outside 0 H to 1 µH").
- QA round 3: on the phone the toast covered the part library's head row and Done; over a full-screen dialog it sits below the dialog's head.
- QA round 3: the part library could wait forever on "Reading the stored parts…" when another tab held its storage. After 5 s it goes on in memory and says why; a tab lets go of the storage when another opens a newer version.
- QA round 3: the broadband limits workflow says when it runs on its own 25 Ω design; "More sections, more band" has Pick 2 sections; walked with Next alone, Optimize band gets a 2-section transformer to vary instead of "Nothing to vary".
- QA round 3: at 1221 px the S-Plot list cut the live entry's name to "Exa… (network)"; the name wraps, and its tooltip has it whole.

### Depth phase D5

Phase D5 of the depth plan (`docs/08-depth-plan.md`): real parts.

#### Added

- Part library (**File > Part library**, Data > Part library on the phone): load the S-parameter files (`.s2p`) that manufacturers publish for their parts, one or many at a time. The list shows manufacturer, part number, kind, nominal value, self-resonant frequency, the frequencies the data covers and how the part was measured (in series or to ground, detected from the data, changeable). The files stay in the browser (IndexedDB) and are never sent anywhere; the app bundles no vendor data and links each manufacturer's download page (Murata, Coilcraft, Johanson Technology, KEMET, TDK). Ten synthetic example parts, made from equivalent circuits and named SYNTH-, let you try it.
- Library parts in the network, in series or in shunt: a series part measured in series uses its measured two-port, every other placement the part impedance from the data; between the measured frequencies the S-parameters are interpolated linearly, outside them the part has no value and says so. The card shows the part number, the effective value and Q at the design frequency and the self-resonance, and flags a placement across the measurement fixture and a part known only by its fitted circuit. The chart, Response, S-Plot network, `.s2p` export, stress and the board's vias and traces all use the measured data.
- Realize from the part library: each L and C becomes the library part nearest by effective reactance at the design frequency (not by nominal value), the bracketing parts ranked by VSWR; locks and scopes apply. The BOM lists manufacturer and part number for library parts.
- A `.json` design file carries the measured data of its library parts; a share link carries each part's names and a fitted equivalent circuit, replaced by the recipient's library data when the part is there and flagged as approximate when it is not.
- Oracle: `tools/oracle/d5_check.py` rebuilds cascades of measured parts from the synthetic files with scikit-rf (in and across fixtures, between the measured frequencies, with vias, a ladder realized from the library) and checks the extracted nominal values and self-resonances.

#### Changed

- The SPICE and LTspice exports write a library part as its fitted equivalent circuit and say so; the CKT netlist writes it as an RLC statement with a comment; `.xmlsc` refuses a design with library parts with a message. Monte Carlo, the spread ranking and design centring do not vary library parts, and the panels say so.

#### Fixed (QA round)

- A part used outside its data (design frequency or sweep past the file) put NaN on screen: card, datapoint tables, schematic Zin, chart labels and sweep-end marker, and a NaN worst VSWR in the sweep summary. Readouts now say "no value at 20 GHz", the status line names the part and its data range, the chart and plots leave those points out, summaries ignore them (worst VSWR with 4 significant digits), the Response view notes the region without data and the datapoint CSV leaves those cells empty.
- A share link's part took the data of the recipient's library part of the same manufacturer and part number unchecked. It is now refused when the kind differs or the fitted value is more than 10 % off: the fitted circuit stays, and the card and the status line say why.
- Copying a share link with library parts (or Realize from the part library) says that the parts travel as fitted circuits and suggests the `.json` file; opening a link says how many parts arrived approximate, how many took the data from the library and how many L and C Realize finds no part for.
- The CKT netlist wrote a lossless inductor fit (r = 0) as a parallel RLC with R=0, a short; it now writes the open-circuit equivalent (R = 1e12 ohm). SPICE and LTspice already left the loss resistor out.
- Part library dialog: the table no longer runs past the dialog (wider dialog, the actions in a sticky last column; one card per part with 44 px buttons on a phone), and the phone's sheet title stays above the table header.
- A card flagged "Approximate" (or a part placed other than measured) while its realized line said "library part, as measured"; the realized line now matches ("fitted circuit (approximate)", "measured in series but placed to ground (approximate)").
- BOM: a library part has its catalogue value (the nominal value from the data, rounded to two significant digits) under Realized and its effective value at f0 in a new Effective at f0 column, for placed and chosen parts alike; an L or C the library has no part for reads "no library part" instead of "exact", and its card "no library part, stays ideal".
- Removing a part from the library: the dialog offers Undo, moves the focus to the next part, says when the realized network and the BOM change, and **Remove all…** asks first and can be undone.
- BOM CSV fields from a file or a link that start with =, +, -, @ (or a tab) are written with a leading apostrophe (CSV injection); stress cells of a part without a value are empty instead of NaN.
- **Add synthetic examples** respected no library limit; it now stops at 500 parts and says how many were left out.
- Reading an inductor file without a resonance in its data took seconds at 20 001 points (the Cp fit was quadratic); it is linear now.
- Data with a negative ESR (measurement noise on a high-Q part) showed as "lossless"; the card now says the data is not passive there.
- Stored parts (a `.json` file, the browser's store) whose data the reader would refuse (S21 = 0 throughout, a capacitor record with inductor data) are refused on restore as well.
- Smaller texts: the guide's part library has its own heading (Help opens at it) and says that ESR and Q between samples come from interpolated S; adding a part is confirmed in the dialog; the Realize note says the lower-VSWR part of the two wins; the legend reads "no library part fits" when Realize from the library changes nothing; the `.s2p` refusal states the 0.5 f to 2 f export range with the sweep off; the `.xmlsc` refusal names the element, and saving `.xmlsc` with parts Realize chose says it holds the ideal values; the SPICE and LTspice exports say in the status line that library parts are fitted circuits; Undo names a placement change; fixture messages use "in series" and "to ground" and name the part; a file that is not Touchstone says so; card warnings are spaced; manufacturer links are named by product line and say they open a new tab, and the dialog opens on Load .s2p files; the report lists library parts, measured or approximate; dragging the point of a library part says why it does not move.

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
