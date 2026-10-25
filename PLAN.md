# Smith Online: implementation plan

Rebuild of Fritz Dellsperger's Smith V4.1 as a browser application. Background and decisions:

- `docs/01-original-analysis.md`: what the original does, the `.xmlsc` file format, the math, open questions.
- `docs/02-adr-001-technology-stack.md`: why TypeScript SPA, static hosting, optional PHP backend later.
- `docs/03-ui-design.md` and `docs/mockup/index.html`: layout and a working visual mockup.
- `docs/04-realization-features.md`: standard value components, losses, build support and synthesis helpers inspired by Tonne Software's Elsie family.

## Guiding rules

1. **Clean room.** No decompiling of the original. Sources are the public feature list, the example files, the help printout and textbooks. Credit the original author.
2. **Core before UI.** Every formula lives in `packages/core`, has a unit test with a hand-checked value, and is validated against the 23 example projects before any pixel is drawn for it.
3. **Compatibility is a feature.** Load every original example without error, re-save it, and reproduce the stored `Rend`/`Xend` within 1e-6 relative.
4. **Ship small, ship often.** Each phase ends with a deployable build on the user's domain.

## Status 2026-10-23 (master after the feature batch)

Everything in phases 1 to 5 of this plan is implemented except where noted, plus the feedback items of 2026-10-22. `docs/06-user-guide.md` describes the application as it is. Highlights since the previous status: file formats (Touchstone, CITI, EZNEC, `.xmlsc` writer, netlist, ASCII), Realize mode, the start workflow with New and a design target, tune-existing-parts and broadband matching, File menu, resizable schematic, report export, S-Plot view, load entry forms, several user datapoints, print and clipboard, Settings, vertical schematic, limit areas, overlays, stress, winding helper, SPICE and LTspice export, Monte Carlo, microstrip and coax dimensions, guided tours, PNG export, usable bandwidth.

Done 2026-10-23 after this status: component packages with parasitics (feedback item 4 below), as a third locus on the chart, dotted curves in the Response view, a Package column in the BOM and an as-built table in the report; the parasitics table is editable in Settings.

Done 2026-10-23, help: the user guide is built into the app (Help button, F1 or ?, table of contents, own small Markdown reader, no new dependency) the panel headings and chart toolbar carry one-line tooltips, and the guide has working links that load examples, tours and views.

Done 2026-10-23: distributed-element synthesis in `packages/core/src/distributed/` (binomial and Chebyshev quarter-wave transformers of 1 to 6 sections, the four Kuroda identities on commensurate lines, Butterworth and Chebyshev prototypes to N = 9, a Richards and Kuroda stub low-pass of shunt open stubs and an approximate stub high-pass of shunt shorted stubs), as the Transformer and Stub filter tabs of Auto match. Tests: `packages/core/test/distributed.test.ts`. Not done: a stub band-pass.

Done 2026-10-23: VNA CSV import (`packages/core/src/io/vna-csv.ts`): Keysight/Agilent ENA and PNA `BEGIN ... END` exports, generic comma, semicolon, tab or space separated tables with re/im, mag/angle, dB/angle or R and X columns, NanoVNA-Saver and LibreVNA style triples, decimal commas, stated Z0. S11 files go to the import dialog and the datapoint sweep, files with S21, S12 or S22 also to the S-Plot list, full two-ports to the two-port panel; Touchstone text under `.csv` or `.txt` is read as Touchstone; `.txt` falls back to the EZNEC reader. Three QA rounds (qa-validator, adversary, ui-expert) fixed, among others, S(i,j) and dB(S(2,1)) column names, admittance and transmission columns, misread impedance, Y and return loss columns, unsorted rows, commented headers, Keysight blocks refusing the whole file, overflow rows, the export of partial two-ports and the large-file polar plot. Hand-written fixtures in `packages/core/test/fixtures/vna/`; not checked against real instrument files.

Open:
1. Three expected-fail tests in `packages/core/test/adv-bandwidth.test.ts` document the usable bandwidth fallbacks (a range excluding the centre is widened, a spike narrower than the coarse step is missed).
2. The LTspice `.asc` writer has not been opened in LTspice.
3. PWA and offline install (phase 4), accounts and cloud library (phase 6).

### Interaction redesign 2026-10-24

An interaction review of the running app at 375, 768 and 1440 px and a visual design proposal were reconciled into `docs/07-interaction-redesign.md`: phone layout as a pinned chart with a persistent bottom sheet (Network, Numbers, Tools), tool panels in the right column at every width, one overlay model with viewport positioning and sheets on touch, 44 px targets on coarse pointers, chart touch gestures (pinch, long press, halos with nearest-centre picking), tokens and motion. Seven implementation phases with acceptance checks; the final QA checklist is section 8 of that document.

Phases 1 and 2 (tokens and foundations, controls) are done and released as 0.1.0. Three QA rounds with the qa-validator, adversary and ui-expert agents: round 1 found 5 majors (slider drag as two undo steps, the chart toolbar overflowing at 390 px, the left column overflowing at 1024 px, unedited fields committing rounded values, Escape committing in the power field), round 2 found 4 (the Settings footer below the viewport, R-notation and decimal-comma stock lists, metres read as millimetres), round 3 found 3 (lower-case units after a prefix refused, a decimal comma in comma-only stock lists, k-notation resistors in the L and C stock); all fixed and verified, together with every minor. Open: two slider cases the adversary rated theoretical stay as expected failures (a same-task assistive step after a programmatic change, a blur during the slider's own drag); header height and wrapping and the schematic label collisions belong to phase 4. Phases 3 to 7 are done and released as 0.2.0 (2026-10-25), together with Add network to S-Plot: each phase had a QA round with the three agents and a fix pass, phase 3 to 5 fixes were verified in the browser, and a final round checked the whole section 8 checklist (approved once its majors were fixed: manifest paths, a view switch during a drag merging undo steps, the name field recording a step per keystroke, job progress below the screen at peek; all fixed and verified). Open: the iPhone home screen install needs a check on a real device; real touch hardware (iOS Safari, Android Chrome) was only emulated.

### Guided tours 2026-10-23

Seven tours added to the three basic ones (`packages/app/src/lib/toursAdvanced.ts`, shared helpers in `tourKit.ts`): bandwidth and the band optimizer, broadband matching with an element cap against the Bode-Fano floor, Realize (E24, E96, stock list, BOM), losses and component packages, a PA output match over three datapoints with a two-section widening, Pi and T at a chosen Q, and the quarter-wave transformer with its two-section binomial version. Every narrated number is computed from the design; the search tours call the core optimizer and broadband search with a fixed seed. Tests: `packages/app/test/toursAdvanced.test.ts`.

### QA 2026-10-23: three review rounds on the feature batch

Three rounds with the qa-validator, adversary and ui-expert agents (see `.claude/skills/qa-round`). Fixed: the device follows every frequency change and clamps with a message; the Touchstone reader refuses unknown options and a second R; limit areas and bandwidth guard non-finite input; match solutions are judged by their effect so a network that lands where it started is not offered; Auto match reports when Zin is on target; broadband matching drops do-nothing candidates and defaults its band around f0; datapoint entry refuses twins and reports what it added; the store refuses a non-positive frequency or Z0 and a non-finite load, keeps every status message on its own undo step, and undo and redo say so; share links cap sweep loads and names; `.xmlsc` projects with more than 63 loads keep them as sweep loads; the writers keep the file order of the loads; zero hertz rows are dropped on S-Plot import; design names are kept on one line in exported files; negative zero and tiny angles are formatted cleanly; the narrow layout starts at 1000 px. Round 3 came back without blocker or major finding.

Deferred with a reason (minor):
- Design frequency outside the sweep range is accepted silently: the Response view is the sweep, the chart is the frequency; a warning would fire on every intermediate value while typing.
- Slider keyboard nudges are one undo step each: the drag already coalesces, and a nudge is a deliberate step.
- Saving a project whose start is not among the sweep loads adds it to the loads: the `.xmlsc` format has no other place for it.
- Dark mode follows the toggle only; a system follow needs a third "auto" state in Settings.
- Status line stays silent on everyday edits; a description of every edit would drown the messages that matter.
- Monte Carlo cloud is cleared on Escape; redraw is one click.
- Accessible names on a few icon buttons, the "SP" label colliding with a nearby marker on small charts, Add buttons enabled with an empty field, `.txt` import error wording, and the band optimizer proposing values that Realize then snaps: cosmetic, listed for a polish pass.

## Feedback backlog (Jonas, 2026-10-22, after testing master 3851378)

1. Done 2026-10-23. **File menu.** Group New, Open, Save and Export in one menu so the header is less crowded; New sits next to Open and Save.
2. Done 2026-10-23. **Realize-aware matching and tuning.** When Realize is on, Auto match (both methods) should return standard or stocked values, and the tuning sliders should step through realizable values only.
3. Done 2026-10-23. **Schematic and report export.** The schematic strip under the chart should be resizable (drag handle, remembered). Export a report with chart, schematic and the datapoint table, with checkboxes for what to include, as SVG or a print page; this is the original's print dialog.
4. Done 2026-10-23. **Component packages.** Optional package per part (0201, 0402, 0603, 0805, 1206, wire-wound coil) with typical parasitics: series L of a chip capacitor, parallel C and ESR of a chip inductor, pad capacitance; evaluated like the loss model and shown as a third locus. The editable parasitics table with a source note per row is in Settings (`packages/core/src/realize/packages.ts`, `docs/04-realization-features.md` section 2).

## Phase 0: project setup (1 to 2 evenings)

- Install Node LTS and pnpm. Create a pnpm workspace with `packages/core` and `packages/app`.
- Tooling: TypeScript strict, Vitest, ESLint, Prettier, Playwright for a few end-to-end checks, GitHub Actions running tests on push.
- Copy the example `.xmlsc` files into `packages/core/test/fixtures/` (they are the author's examples; keep them as test fixtures with attribution, do not redistribute the installer).
- License: MIT for the new code. README with credits.
- Deliverable: `pnpm test` green with one trivial test, `pnpm build` produces `dist/`, deployed once by hand to the server to prove the hosting path (HTTPS, correct MIME types, `.htaccess` for SPA fallback).

## Phase 1: core math library (2 to 3 weeks part time)

Order matters; each item is tested before the next starts. Where `docs/05-quicksmith-web-reuse.md` names a QuickSmith-Web module, port it (TypeScript, SI units, free ladder) instead of writing from scratch, keep its test values, and add the MIT attribution header. Step 0: create `THIRD_PARTY_NOTICES.md` and email Nathan Iyer.

1. `Complex` type and operations (add, sub, mul, div, inv, abs, arg, exp, polar). Number formatting with SI prefixes and engineering-notation parsing (`3n9`, `2.2p`, `1k5`).
2. Impedance, admittance and reflection conversions with arbitrary Z0 (real Z0 first; complex Z0 only if the help shows the original supports it).
3. Elements as ABCD two-ports (port of `engine.js` models, extended): series and shunt R, L, C with optional finite Q; series RLC; parallel RLC; ideal transformer; lossless and lossy series line (alpha, epsilon r, physical length, Dellsperger model); open and shorted shunt stubs. Each element has `abcd(f)`, `apply(z, f)` and `arc(z, f, steps)` for drawing its locus.
4. Ladder evaluation (port of `engine.js` solve): datapoints from load to source at a single frequency, total ABCD and S21 into the load; sweep versus frequency; sweep versus datapoint (locus of each node over frequency); measured-load interpolation (monotone cubic) and phase unwrap.
5. Derived values per datapoint: Y, Gamma, VSWR, return loss, mismatch loss, Q.
6. Circles: VSWR, constant Q, input and output stability (with K, Delta, mu, which side is stable), operating power gain, available power gain, unilateral gain, noise figure. MAG, MSG, maximum unilateral gain.
7. Two-port conversions: S to Z, Y, H, ABCD and back, normalized and unnormalized.
8. File formats: Touchstone v1 reader and writer (1 and 2 ports first, n ports later, including the noise block), CITIfile reader, EZNEC `Lastz.txt` reader, `.xmlsc` reader and writer (byte-compatible element order and tag names, including the original's typos such as `ManualCyrcle`), Touchstone CKT netlist writer in the original's documented format, delimited ASCII export of datapoints and circles in the original's column layout, a JSON native format for URL sharing (compressed with `lz-string` or `CompressionStream`).
9. Validation suite: for every example file, rebuild the ladder from `CComponent` entries and compare computed datapoints with the stored `CDatapoint` values; for Example 16 and 17 compare sweep points.
10. Realization core (`src/realize/`): E-series generators (E6 to E96) and custom stock lists, geometric nearest-value snap with neighbor evaluation, scope rules (all, L, C, R, L-C pairs with preserved resonance), per-element lock, loss models (inductor Q, capacitor ESR) as extra series resistance in `apply`, two-port ABCD of the whole ladder for S21 and S11 versus frequency, BOM data. Tests: E24 table, snap of 16.03 nH to 16 nH, resonance preserved within the series granularity, lossless two-port S21 equals 0 dB at the match.

Deliverable: `@smithonline/core` on the workspace, 100 percent of public functions tested, a small CLI (`pnpm core eval Example5.xmlsc`) that prints the datapoint table.

## Phase 2: Smith chart application (4 to 6 weeks part time)

1. App shell: header, three-panel layout, responsive breakpoints, light and dark theme, settings store (colors, line widths, units) persisted in localStorage.
2. Chart component: SVG grid generator with adaptive density (coarse, normal, fine), Z, Y and both grids, labels, zoom and pan, fit, print stylesheet, SVG and PNG export.
3. Design store with Zustand: load, elements, frequency, Z0, circles; undo and redo via a history middleware; autosave to localStorage; multiple named designs in browser storage.
4. Element palette and ladder cards with value editing, unit parsing, delete, reorder, and inline tuning sliders. Live redraw.
5. Datapoints table, selected datapoint detail, CSV export.
6. Datapoint dragging on the chart that re-solves the producing element.
7. Circles panel: VSWR and Q first (no external data needed), then stability, gain and noise once a two-port file is loaded.
8. Import: Touchstone, CITI, EZNEC to pick the load impedance at the design frequency, or to plot a file's s11 or s22 locus on the chart.
9. Sweep panel: frequency range and step, sweep versus frequency and versus datapoints, locus drawn on the chart, markers with readout.
10. Open and save `.xmlsc`, share link (design encoded in the URL fragment), open link restores the design. Netlist export in the original's format once documented.
11. Printing: chart, schematic, datapoint table and circle info on one page.
12. Example gallery: the 23 original examples as one-click demos with a one-line description each (write new descriptions, do not copy the examples PDF).
13. **Realize panel (optional mode, off by default):** series selector (E24 default) or custom stock list, scope, lock per element, ideal and realized value side by side on each ladder card, realized locus as dashed path, realized readout (Z, |Gamma|, VSWR, RL at f0 and worst case over the sweep), losses toggle with global Q and ESR defaults and per-element override, BOM export as CSV. Plus and minus 1 percent tuning buttons next to each slider.

Deliverable: public beta at the user's domain. Milestone check: redo every example from the original "Examples V4.1" PDF in the new tool and get the same numbers.

## Phase 3: S-Plot (2 to 3 weeks part time)

1. File manager for loaded S-parameter files, frequency unit handling, multi-file overlay.
2. Graphs with uPlot: s11, s12, s21, s22 magnitude in dB and phase, return loss, k and mu, MAG and MSG; linear or log frequency axis; shared cursor with readout table.
3. Conversion and export to Z, Y, H, ABCD Touchstone files, normalized and unnormalized.
4. Send s11 or s22 at the cursor frequency to the Smith chart as load; send a file's locus to the chart.
5. Print and export of graphs.
6. **Response tab for the matching network** (reuses the same graph components): S21, S11, VSWR, phase, group delay and Zin versus frequency for the ideal, realized and lossy network; up to 8 markers; stored overlays; limit areas as visual aid.
7. **Synthesis helpers:** automatic L-network (both solutions), Pi and T with target Q (port of `engine.js` matchToZ0, teeSolutions, piSolutions), VSWR bandwidth readout (port of `bandwidth`), reverse load from a measured input impedance.
8. **Stress and export:** voltage and current per part at a given source power; LTspice `.asc`, SPICE `.cir` and Touchstone `.s2p` writers for the network.

## Phase 4: polish, PWA, release (1 to 2 weeks)

- Service worker for offline use, install prompt, app icon.
- Keyboard shortcuts, help overlay, tooltips with the formula behind each readout.
- Inductor winding helper (air-core solenoid, toroid with AL) opened from an inductor card; small editable core table.
- Cross-browser and tablet testing with Playwright.
- Documentation site section: getting started, element reference, file formats, credits.
- Announce: RF forums, amateur radio groups, the author's former university contacts if reachable.

## Phase 5 (optional): tolerance analysis, optimizer, distributed equivalents

- Monte Carlo with per-element tolerances, impedance cloud on the chart, yield against a VSWR spec.
- Optimizer (port of QuickSmith-Web `match.js`: Nelder-Mead, reactance bounds, worst-case VSWR cost, Bode-Fano feasibility) against a target VSWR over the band or limit areas, then snap to standard values. Runs in a Web Worker.
- Series L to high-impedance line and shunt C to low-impedance line conversion with the microstrip and coax calculator (port of `line.js`, pinned against published track widths).
- If interactive Monte Carlo is too slow in JavaScript, this is the first candidate for a Rust/WASM module behind the core API.

## Phase 6 (optional): accounts and cloud library

Only if users ask for it. PHP 8 + MySQL on the existing host: email login with magic links, saved designs, short share links, public gallery. Keep the frontend working without it. GDPR: minimal data, export and delete endpoints.

## Testing strategy

- Unit tests in core against hand-computed values and the stored example results.
- Property tests for conversions (S to Z to S round trip, Touchstone write then read).
- Component tests for value parsing and the ladder editor.
- Playwright smoke tests: open example, add element, drag slider, save, reload from link.
- Visual regression of the chart grid at three zoom levels.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Five element type codes still unknown in `.xmlsc` (R, transformer, RLC) | Reject unknown codes with a clear message; ask Jonas for one saved project from a licensed copy; until then these elements save in the native JSON format only. |
| Numerical corner cases (open, short, Gamma = 1, x = 0 arcs) | Guard divisions, clamp chart coordinates, test the edge points explicitly. |
| Scope creep from the original's long feature list | Phases are ordered by user value; the beta ships after phase 2 even if S-Plot is missing. |
| Competitor QuickSmith-Web already covers much of this | It is MIT licensed: port its solver, matching, optimizer, microstrip and Touchstone modules with attribution (`docs/05-quicksmith-web-reuse.md`), differentiate with `.xmlsc` compatibility, free ladder, lossy lines, S-Plot, CITI and EZNEC, datapoint sweeps and the realization layer; inform the author and offer the `.xmlsc` importer upstream. |
| Naming and goodwill | Name the project clearly as an independent rebuild; attempt to contact the author through the university or the published email once more before launch. |

## Immediate next steps

1. Done 2026-10-14: help printout, examples PDF, what's new, known issues and readme are in `original/` and folded into `docs/01-original-analysis.md`.
2. Jonas: if a licensed copy of Smith V4.1 is still available, save one project containing a series resistor, a shunt resistor, a transformer, both RLC elements, a lossless line with eps_r = 2.1, and one circle of each gain type. That closes the remaining format questions (section 8 of the analysis).
3. Done 2026-10-14: ADR-001 accepted, including the QuickSmith-Web port decision.
4. Phase 0 scaffold, including `THIRD_PARTY_NOTICES.md` and a reference copy of the QuickSmith-Web modules to port under `third_party/quicksmith-web/` with its LICENSE.md.
