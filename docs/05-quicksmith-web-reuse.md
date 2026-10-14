# QuickSmith-Web: assessment and reuse plan

Repository: https://github.com/niyeradori/QuickSmith-Web, branch `modernize` (read 2026-10-14, last push 2026-10-05). Author Nathan Iyer, KJ6FOJ. **License: MIT** (LICENSE.md, copyright 2017 Nathan Iyer). MIT allows copying, modifying and redistributing as long as the copyright and permission notice travel with the copied code.

## What it is

A 1993 Windows 3.1 Visual Basic program, ported to the web in 2017 and rebuilt through 2026 as static files with no build step. The modern parts are well written, documented in long comments, and tested headlessly.

| Module | Lines | Quality | Content |
|---|---|---|---|
| `engine.js` | 945 | Modern, pure functions, tested | Complex arithmetic, ABCD cascade of a 12-slot ladder (even slots series, odd slots shunt), element models with finite Q for L and C, lossless line and stubs, insertion loss S21 from the ABCD matrix, element arcs for drawing, loaded Q, closed-form L, Pi and T matching, VSWR bandwidth search, drag tuning inverse, monotone cubic interpolation of measured loads, phase unwrap, sweep value generator with the fencepost fix. |
| `match.js` | 653 | Modern, tested | Band optimizer: Nelder-Mead over component values with worst-case VSWR cost, reactance-based bounds, Bode-Fano limit, feasibility hints. Runs in a Web Worker. |
| `line.js` | 119 | Modern, tested | Microstrip (Hammerstad) and coax analysis, synthesis by bisection for an exact round trip. Pinned against published FR-4, RO4350B, RT/duroid 5880 and alumina widths. |
| `touchstone.js` | ~400 | Modern, tested | Touchstone v1 reader and writer, 1 to 4 ports, option line defaults, noise block, lookup of noise parameters at a frequency. |
| `permalink.js` | 225 | Modern, tested | Design in the URL fragment: trimmed JSON, six significant figures, hand-rolled base64url so it runs in Node and browser. |
| `smith.js` | 1003 | Modern | SVG chart as a pure function of state, zoom and pan, two palettes from CSS variables, element arcs, VSWR, Q and gain overlays, hover readout, SVG and PNG export without the palette. |
| `plot.js`, `symbols.js`, `ui.js`, `history.js`, `tours.js` | | Modern | Response graph, vector component symbols, dialogs, undo and redo, guided examples. |
| `amp.js` | ~500 | Legacy style (global object, VB-era structure) | Stability circles with K and Delta, available and operating power gain circles, noise circles. Correct formulas, old code shape. |
| `sch.js`, `common.js`, `index.html` (215 kB) | | Legacy | Schematic slots, file I/O, the page itself. |
| `tests/` | 14 files | | Cases derived from the program's worked examples with expected values from an independent model, plus suites per module. |
| `research/` | | | Python prototypes of the broadband optimizer, antenna library `.s1p` files. |

## What it does not have (and Smith V4.1 does)

- Project file compatibility with `.xmlsc`; CITI and EZNEC import.
- Lossy transmission line with attenuation and permittivity; transformer; three-element RLC blocks.
- Free ladder topology: QuickSmith has 12 fixed alternating slots, Smith V4.1 has any sequence.
- Datapoint sweep (network applied to several measured points), multiple user datapoints as chain starts.
- S-Plot: s-parameter viewer with MAG, MSG, K, mu table and graphs, parameter conversions to Z, Y, H, ABCD, CITI to Touchstone export.
- The Dellsperger teaching vocabulary (DP, TP, SP), the tuning cockpit layout, netlist export.
- The planned realization layer (standard values, BOM, stress, LTspice), though QuickSmith already has component Q and microstrip synthesis.

## What it has that Smith V4.1 does not

- Finite component Q, insertion loss, response plot, closed-form L, Pi, T matching, band optimizer with Bode-Fano check, drag tuning on the chart, share links, SVG and PNG export, microstrip and coax dimensions, guided examples, headless tests, dark theme.

## Options

### A. Fork QuickSmith-Web and extend it
Fastest first result. But: ES5 code without types, the fixed-slot ladder would have to be replaced to load `.xmlsc` designs (which breaks most of `sch.js`, `ui.js` and the tests), the 215 kB `index.html` is the UI, and the project is actively maintained by its author, so a fork diverges within weeks. The realization layer and S-Plot would be bolted onto a structure that was not built for them.

### B. Contribute Smith V4.1 features upstream
Good for the community, but it is Nathan's product with its own direction, and the Dellsperger workflow plus the Elsie layer is a different product. Worth doing for small, clearly separable pieces (for example a `.xmlsc` importer), not as the main plan.

### C. Keep ADR-001 and port the modern modules into `packages/core` (recommended)
Rewrite in TypeScript with types and the free-ladder data model, keeping Nathan's algorithms, comments and test values, with MIT attribution. Modules worth porting: `engine.js` (ABCD cascade, element models with Q, element arcs, L/Pi/T matching, bandwidth, tuning inverse, interpolation, sweep values), `match.js` (band optimizer), `line.js` (microstrip and coax), `touchstone.js` (reader and writer with noise block), `permalink.js` (share link design). Reuse `tests/cases.js` expected values as a second validation set next to the 23 Dellsperger examples. Study `smith.js` for the SVG approach (export without palette, hover, zoom), but write the chart component fresh in React.

Effort saved against writing from scratch: roughly the whole of phase 1 items 1, 3 (partly), 4, 8 (Touchstone), the synthesis helpers in phase 3, the optimizer and microstrip work in phase 5. Estimate: three to four weeks of part-time work.

## Decision

Option C, accepted by Jonas Reber on 2026-10-14. Rationale: the ADR's reasons for TypeScript, a typed core and React still hold; QuickSmith-Web's modern modules are small, pure and MIT licensed, so porting them is cheap and legally clean; the free-ladder model, `.xmlsc` compatibility, S-Plot and the realization layer need a data model QuickSmith does not have.

## Obligations and courtesy

1. Add `THIRD_PARTY_NOTICES.md` with the MIT text and "Portions derived from QuickSmith-Web, copyright 2017 Nathan Iyer" and mark each ported file with a header comment naming the source file and commit.
2. Write to Nathan Iyer before publishing: explain the project, offer to upstream the `.xmlsc` importer and any bug fixes found while porting, link the repository. His README gives niyer@sbcglobal.net.
3. Do not copy help text, blog posts, images or the worked examples' prose; those are content, not code, and are not needed.

## Porting notes (for phase 1)

- Units: QuickSmith works in MHz, nH, pF, inches and 12 slots. Smith Online core works in SI (Hz, H, F, m) and an ordered list of elements each with explicit series or shunt orientation. Convert at the boundary; do not carry the slot parity rule.
- Speed of light: QuickSmith uses 299 800 000 m/s "as used since 1993". Use 299 792 458 and expect last-digit differences against its test cases; document the tolerance.
- Element models: keep the Q convention (series R = X/Q for an inductor, series R = |X|/Q for a capacitor), add the lossy line from the Dellsperger model (ABCD of a lossy line with gamma = alpha + j beta), the ideal transformer and the two RLC blocks.
- Transmission: QuickSmith's `transmission()` gives S21 from a Z0 source into the actual load; keep it and add the full two-port S-matrix of the network for the `.s2p` export and the response tab.
- Matching: `matchToZ0`, `teeSolutions`, `piSolutions` port directly. Add the reverse-load solver.
- Optimizer: `match.js` Nelder-Mead and bounds port directly; cost function stays worst-case VSWR, with a second cost for limit areas later.
- Share links: adopt the trimmed JSON plus base64url approach; use `CompressionStream` where available for longer designs with sweeps.
