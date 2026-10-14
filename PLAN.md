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
