# Addendum 09b: settings architecture, the build with the design

Status: implemented 2026-10-26 for 0.6.0 (items 1 to 8 of section 6), with the deviations listed at the end of this document. Design review and implementable spec written 2026-10-26. Follows `docs/09` (implemented on master in 93f97cf, not released). Read from the code on master; no browser session was used for this addendum. The S-Plot clipping bug is handled by another agent and left out here.

Owner's point, which this review confirms: "the settings for the board are hidden in the UI settings ... there are simulation settings, and tolerances, and then there are ui and appearance settings ... apple would not do that."

## 0. Verdict

The Settings dialog mixes three kinds of thing: how the chart looks (colours, lines, labels, schematic direction), what new designs start with (f, Z0), and **how this design is built** (component package table, board stackup, vias, traces). The third kind is engineering data. Today it lives in the browser, not in the design. So the same design file or share link produces a different as-built locus, `.s2p` export, report and BOM layout notes on two machines, or on one machine after Settings changes. That breaks job 4 (verify against an independent tool) and blocks D6 (fitting the board parameters of one built board).

The network row already shows the inconsistency: `Realize | Losses | Board` look like three equal switches, but Realize and Losses are saved with the design and Board is saved in the browser (`RealizeControls.tsx`, tooltip "Kept for every design in this browser").

Decision, following Apple practice (document properties in an inspector next to the canvas, app preferences in Settings):

1. **The build goes with the design.** Board, stackup, vias, traces, package models and part ratings are saved in the design file and share link, are undoable, and are edited in a new **Build** inspector. Build is a tool in the right column, next to the chart, like Keynote's format inspector.
2. **One VSWR limit per design.** The usable bandwidth readout, Tolerance, the next steps and the tours all read the design's limit. Today there are two: a session-only limit in Numbers (`response.vswrLimit`) and the design's `tolerance.vswrLimit`.
3. **Libraries stay in the browser and are copied into a design when used**, the pattern D5 already uses for parts and D4 for a microstrip's stackup. This covers the part library, laminates and winding cores.
4. **Defaults for new designs** are a short section of Settings, filled from an open design with **Use as default for new designs**.
5. **Settings keeps app preferences only**: appearance, behaviour, libraries and data kept in this browser. Its subtitle "stored in this browser" becomes true for everything in it.

## 1. Inventory (master, 93f97cf)

Stored: **D** = design (`.json` file, share link, autosave, undo); **B** = browser (localStorage or IndexedDB, not in undo); **S** = session only (gone on reload). Jobs: 1 measured load over a band, 2 robust, 3 buildable, 4 verify, 5 amplifier and broadband, P real parts (D5), M measure and retune (D6), R real frequency technique (D7), A appearance only.

| Setting | UI home today | Stored | Job |
|---|---|---|---|
| Name, f, Z0 | header design strip | D | all |
| Source power P, unit | header design strip | D | 3 |
| Load, datapoints, measured rows, sweep range and points | load card, Numbers, import dialog | D | 1 |
| Target | target card | D | all |
| Elements: values, Q, lock, package id, part copy, microstrip with its own stackup copy | ladder cards | D | 1, 3, P |
| VSWR circles, Q contours, two-port, stability, gain and noise circles | Numbers | D | 5 |
| Limit areas | Response | D | 1, 5 |
| Realize on, series (E6 to E96, stock, library), stock list, scope | network row, inline options | D | 3, P |
| Losses on, default inductor and capacitor Q | network row, inline options | D | 3 |
| Stress limits per kind (V pk, I rms) | network panel (`StressControls`) | D | 3 |
| Tolerance: runs, seed, distribution, default %, VSWR limit, over band, per-part overrides, reel correlation | Tolerance panel | D | 2 |
| **Usable bandwidth VSWR limit** | Numbers, usable bandwidth | **S** (`response.vswrLimit`, 2) | 1, 2 |
| **Board on** | network row switch | **B** `smithonline.board.v1` | 3, 4, M |
| **Stackup**: preset, h, εr, tanδ at f, t, Rq | Settings, Board (Edit board… opens it) | **B** board.v1 | 3, 4, M |
| **Via drill, vias per shunt part, trace length, trace width** | Settings, Board | **B** board.v1 | 3, 4, M |
| **Package table**: ESL, Cp, ESR, Pads, Land l, Land w | Settings, Component packages | **B** `smithonline.packages.v1` | 3, 4, M |
| Dimensions dialog medium, coax εr and diameter | Dimensions dialog | B `smithonline.substrate.v1` | 3 |
| Winding cores (AL values) | Winding dialog | B `smithonline.cores.v1` | 3 |
| Part library | Realize, Part library… | B (IndexedDB) | P |
| Broadband band, max parts, line; Auto match topology, Q, rank; Optimize cost; distributed tool settings | tool panels | S | 1, 2, 5, R |
| Response log f, Load alone, markers; stored curves | Response | S; curves B `overlays.v1` | 1, 4 |
| Chart Z grid, Y grid, density, labels, measured load shown | chart toolbar, Numbers | S | A |
| Colours, element palette, line widths, label density, schematic direction | Settings | B `settings.v1` | A |
| Default f and Z0 for new designs | Settings, New designs | B settings.v1 | all |
| Suggest next steps | Settings, New designs | B settings.v1 | behaviour |
| Theme | header toggle | B | A |
| Strip height, report selection, start guide closed, workflow progress, autosave | in place | B | A, behaviour |

Problems the inventory shows:
- The rows in bold: build data that decides the as-built network, the `.s2p`, the report and the BOM notes is kept in the browser, while the part choices that use it (package id per part) are kept in the design.
- Two VSWR limits. The next step "a match lands" (`nextSteps.ts`) and the tours judge against the session limit; Tolerance and Auto match's yield judge against the design's limit.
- Settings' "Reset all" resets the board and the package table together with the colours.
- Chart grid options are appearance, but they are forgotten on reload.

## 2. Target architecture

### 2.1 Five homes

| Home | What | Stored | Where in the UI |
|---|---|---|---|
| Design strip | name, f, P, Z0 | D | header (unchanged) |
| Network and tools | load, target, elements, sweep, circles, limit areas, tolerance and yield, **VSWR limit** | D | where they are today |
| **Build** inspector (new tool) | realization (series, stock list, scope, part library access), losses (default Q), **package models**, **board** (stackup, vias, traces), **part ratings** (stress limits) | **D** | right column tool `Build`; switches stay in the network row |
| Libraries | part library, laminates (presets plus your own), winding cores | B, copied into a design when used | opened from where they are used; managed in Settings, Libraries |
| Settings | Appearance; New designs (defaults); Behaviour; Libraries; Data in this browser | B | gear icon; phone More, Settings |

The Build inspector is a tool panel, not a dialog. The chart stays visible beside it (docs/07 section 2.2), so the as-built locus moves while the stackup or a land size is typed. That keeps the live loop the product is built on; a modal dialog breaks it.

### 2.2 Decision per setting

| Setting | Today | Target | Change |
|---|---|---|---|
| Board on, stackup, via drill and count, trace length and width | B | D, `design.build.board` | **storage change** (2.3 a) |
| Package models (ESL, Cp, ESR, Pads, Land l, Land w) | B | D, `design.build.packages`, only rows that differ from the built-in table | **storage change** (2.3 b) |
| Stress limits | D (network panel) | D, shown in Build, Part ratings | UI move only |
| Realize scope, stock list, part library access; default Q | D (inline options) | D, edited in Build; series select stays inline | UI move only |
| Usable bandwidth VSWR limit | S | D: the same field as `tolerance.vswrLimit` | **behaviour change** (2.3 c) |
| Laminate presets and your own laminates | code presets | B library `smithonline.laminates.v1`; the design keeps its copy | new, additive |
| Defaults for new designs: f, Z0, build, default tolerance, VSWR limit | B (f, Z0 only) | B; the build defaults are board.v1 and packages.v1 under their old keys | **meaning change** (2.3 d) |
| Chart grid options | S | B, settings.v1 `chart` | additive |
| Colours, palette, lines, labels, schematic direction, theme, suggestions, start guide, workflow progress | B | B, regrouped in Settings | UI only |
| Part library, winding cores, Dimensions coax | B | B (libraries and tool memory) | unchanged |
| Broadband band and max parts, rank, topology | S | S | unchanged (they describe a search, not the design) |

### 2.3 Compatibility and migration

- **a. Board into the design.** Add an optional `build.board` to `Design`, with decoders in `share.ts` (link and file) and autosave, using the same checks as today (`normalizeBoard`, `normalizeStackup`, the stackup refusals). Rule for an absent field: **the design takes this browser's defaults for new designs** (board.v1). That is exactly what an old file, link or autosave evaluated against before, so opening one changes nothing on the machine that made it. The first change in Build writes `build.board` into the design. If the default board is on, an opened old design gets a one-time message: "Saved before the board travelled with designs: using this browser's default board (FR-4 1.6 mm). Check it in Build." Risk: an old link opened in two browsers still differs, as it does today; only new links are fixed. Link size grows by about 150 characters with the board, and nothing when it is absent.
- **b. Package models into the design.** `build.packages` holds only the rows and fields that differ from the built-in `DEFAULT_PACKAGES`. For an absent field the same rule applies: this browser's packages.v1, so nothing changes on opening. Old builds that cannot read `build` ignore it (the decoders drop unknown fields), so a newer link opened in an older build evaluates as before. The `.json` wrapper version stays 1, because the field is optional and additive.
- **c. One VSWR limit.** Keep the stored field where it is (`tolerance.vswrLimit`, default 2) to avoid a format change. The usable bandwidth readout reads and edits it; `response.vswrLimit` is removed (it was session state, so no data migrates). Behaviour change: a design whose Tolerance limit is not 2 now shows its usable bandwidth at that limit. The readout names the limit, so this is visible. Tours that quote the readout (`tourKit.ts bandwidthText`, `toursAdvanced.ts` quarter-wave) read the design's limit and stay consistent with what they show.
- **d. board.v1 and packages.v1 become the defaults for new designs.** The data and keys stay the same; only the meaning changes. Settings no longer edits them field by field. New designs copy them; **Use as default for new designs** in Build writes them. A user who changed the board in Settings before the upgrade keeps that board as the default for every new design and every old design opened, which is what they saw before.
- **e. Undo.** Build edits become design steps with names ("Changed the stackup to RO4350B 0.762 mm", "Changed 0402: ESL to 0.45 nH", "Board on"). Settings "Reset all" no longer touches the build; Build has its own **Reset to defaults** as one step.
- **f. Microstrip elements** keep their own stackup copy (format unchanged). "Use board stackup" is relabelled **Use the design's stackup** and compares against `build.board.stackup`.
- **g. Workers and exports** read `designBuild(design)` (the design's own build, or the browser defaults when absent) instead of `useBoard.getState()` and `usePackages.getState()`. About 13 modules read the stores today (App, Header exports, Ladder, DimensionsDialog, StackupFields, elements.ts, splotNetwork, nextSteps, tours, tourSnapshot, workflows); 13 test files mock them.
- **h. Files of other formats.** `.xmlsc` cannot hold a build and stays as lossy as today. The `.s2p`, SPICE and LTspice headers keep their text and now describe the design's own build.

## 3. User stories and click paths

Click counts are on the desktop, from a design with a match.

1. **Measured load over a band (1).** "I import the antenna and want to know the band I get within VSWR 2, then match it." Settings met: the VSWR limit. Before: the bandwidth readout used its own session limit, and Tolerance and the next steps used another, so the "matched" next step could disagree with the yield. After: one limit, edited in the usable bandwidth readout or in Tolerance, saved with the design. Same click path, one number.
2. **Robust (2).** "I want the yield of 5 % parts within my spec over the band." Settings met: tolerance %, distribution, runs, correlation, per-part tolerances, limit. All of these stay in the Tolerance panel (D). New: the panel's default line names its source and links to it: "Default 5 % from E24, set in Build". Path unchanged (Tolerance, Run: 2 clicks).
3. **Buildable (3).** "I build on 0.762 mm RO4350B with 0402 parts, one via per shunt part and 1 mm traces, and I want the as-built response."
   - Before: Board switch (1); Edit board… (2) opens Settings over the chart; preset (3); vias, traces (4 to 6); close (7); the Pkg selector on each card (+1 per part); package table: gear (8), scroll past colours to Component packages, edit, close (9). The chart is hidden while editing, and the result is not saved with the design.
   - After: **Build** (1) opens beside the chart; Board on (2); preset (3); vias, traces (4 to 5); **Use 0402 for all parts** (6); a land size changed in Packages (7). The as-built locus moves with every entry, every change is undoable and saved with the design.
4. **Verify (4).** "I send the design to a colleague, who exports the .s2p and runs it in ADS." Before: the colleague's export used the colleague's own board and package table, so the file did not match mine. After: the link carries the build and the `.s2p` is the same on both machines. Path unchanged (File, Export, .s2p: 3 clicks).
5. **Amplifier and broadband (5).** No build settings in the loop. Circle colours are appearance, in Settings. Unchanged.
6. **Real parts (P).** "I load Murata files once and use them in every design." The library stays in the browser (B); a design keeps a copy of each part it uses (D5 behaviour). Before: Realize, series Part library, Part library… (3). After: the same inline, plus Build, Realization, **Part library…**, and Settings, Libraries shows the count, Manage… and Clear. The manufacturer links stay in the library dialog.
7. **Measure and retune (M, D6).** "My built board is off; fit which parts and parasitics moved." The fit adjusts the parts and the board parameters of this design (via inductance, pad capacitance, trace length), so they must belong to the design; the board in the browser could not be fitted per board. After: the D6 result offers **Apply the fitted build** as one undo step, written to `build`.
8. **Real frequency technique (R, D7).** "Best possible gain shape for this load within my spec." It uses the design's band and VSWR limit (the spec), and adds no new setting.

## 4. Workflows and next steps

Workflows (`lib/workflows.ts`):
- **Buildable**: the steps `board` and `board-edit` (anchors `network.board`, `network.boardEdit` to Settings) become:
  1. `build.open`: "Build is how this network will be made: values, losses, packages and the board. It is saved with the design."
  2. `build.board`: "Board on: pads from the land sizes, a via under each shunt part, traces between parts."
  3. `build.stackup`: "Pick your laminate; the as-built locus follows as you type."
  4. `build.packages`: "Land sizes and parasitics of each package, for this design. Use as default keeps them for new designs."
  5. `build.default` (optional): "Use as default for new designs."

  The `package` step uses **Use 0402 for all parts** in Build, not the card.
- **Robust**: step 1 adds: "The VSWR limit is the design's spec; the usable bandwidth uses the same number." Anchor `tolerance.limit`.
- **Verify**: step 1 copy: "The .s2p is the network as built, with this design's board and packages, the same on any machine."
- **Real parts**: steps 1 and 2 anchor `build.realization.series` and `build.partLibrary`; the inline series select keeps its anchor as a fallback.
- **D6 placeholder**: the last step anchors `build.apply-fit`.

Next steps (`lib/nextSteps.ts`):
- Every limit check reads `tolerance.vswrLimit`.
- `packages` (after Realize on): label **Open Build**; it opens Build at Packages.
- New `check-stackup`: after Board on in a design whose stackup is the built-in FR-4 default: "Check the stackup" opens Build at Board.
- New `build-default`: after the third Build edit in a session while the defaults are untouched: "Use this build for new designs?" (offered once per browser).
- New one-time message for an old design opened with a default board that is on (2.3 a).

## 5. Layouts and copy

### Header and tools

- Design tools cluster: **Auto match, Optimize band, Tolerance, Build**. Build's tooltip: "How this network is built: standard values or real parts, losses, package models and the board. Saved with the design." Check that the header still fits one row at 1440 px; if not, the actions wrap to the second row as docs/07 already allows below 1440 px.
- Right column strip: "Numbers | Build" like the other tools; a tablet gets the third segment and a phone the Tools segment row "Build" with the same description.

### Network row

`Realize | Losses | Board` stays (modes in the live loop), each with one summary line and an **Edit…** link to its Build section:
- Realize on: series select inline (unchanged), then "All parts · Edit…".
- Losses on: "Q 50 (L), 500 (C) · Edit…".
- Board on: "RO4350B 0.762 mm, 1 via per shunt part, traces 1 mm · Edit…". Its tooltip changes to "Include the board in the network as built: pads, a via under each shunt part, traces between parts. Saved with this design."
- Stress limits leave the network panel; with P set, the cards keep their V and I readouts and the red mark.

### Build inspector (desktop and tablet, right column)

Caption headings (11/14 uppercase, docs/07 type scale), in this order:

1. **Realization**: Series (E6 to E96, My stock, Part library); Scope; the stock list text area when My stock; **Part library…** with "12 parts in this browser".
2. **Losses**: Default Q, inductors; Default Q, capacitors. "Per-part Q on the cards overrides these."
3. **Packages**: one row per package used in this design ("0402, 3 parts"), each with ESL, Cp, ESR, Land l × w and the pad capacitance (computed when Board is on, greyed table value otherwise); a tag "Changed for this design" with **Reset**; **Use 0402 for all parts**; **Show all packages**. The source note per row stays in its tooltip.
4. **Board**: Include the board (switch, mirrors the network row); Laminate (presets and your own, **Save as my laminate**); h, εr, tanδ at f, t, Rq (the existing `StackupFields full`); Via drill, Vias per shunt part, Trace between parts, Trace width; the limits line and the help link (moved from Settings unchanged).
5. **Part ratings**: V pk and I rms per kind (the existing `StressControls`), with "Needs a source power P in the design strip" when P is off.

Footer: "Saved with this design." **Use as default for new designs** · **Reset to defaults**. Escape and the strip close it like any tool.

### Phone

Tools segment row: Build. It pushes into the sheet with a back chevron. Sections as above, as stacked cards. Packages render as one disclosure card per package (no wide table): header "0402 · 3 parts · changed", body with 2 fields per row. Fields at 44 px on touch. **Use as default for new designs** sits at the foot.

### Settings (app preferences)

Title "Settings", subtitle "for this browser". Sections:

1. **Appearance**: Theme (Auto, Light, Dark segmented; the header toggle stays); Colours; Element colours; Lines and labels; **Chart at start**: Z grid, Y grid, density, labels (new, persisted).
2. **Schematic**: direction.
3. **New designs**: Frequency, Z0; "Build: FR-4 1.6 mm, board off, default packages, Q 50 and 500, E24" with **Take from the open design** and **Reset**; Default part tolerance and VSWR limit.
4. **Behaviour**: Suggest next steps; Show the start guide on new designs; Workflow progress, **Reset**.
5. **Libraries**: Part library "12 parts", **Manage…**; Laminates "2 of your own", **Manage…**; Winding cores "5", **Manage…**.
6. **Data in this browser**: what is kept (autosaved design, stored curves, libraries) with **Clear…** each; the existing note that nothing leaves the browser.

"Reset all" covers Appearance, Schematic and Behaviour only and keeps its Undo. Settings tooltip and phone description: "Appearance, defaults for new designs, behaviour and your libraries."

### Copy

| Where | Old | New |
|---|---|---|
| Network row | Edit board… | Edit… (opens Build, Board) |
| Board switch tooltip | ... Kept for every design in this browser | ... Saved with this design |
| Microstrip card | Use board stackup | Use the design's stackup |
| Tolerance default line | Default tolerance: 5 % from E24 (the series chosen in Realize ...) | Default 5 % from E24, set in Build |
| Usable bandwidth | VSWR ≤ (own field) | VSWR ≤ (the design's limit; tooltip: "Also the limit of Tolerance and the next steps") |
| Settings subtitle | stored in this browser | for this browser |

## 6. Implementation order and QA

| # | Item | Size | Main files |
|---|---|---|---|
| 1 | One VSWR limit: remove `response.vswrLimit`; readout, next steps and tours read `tolerance.vswrLimit` | S | `BandwidthReadout.tsx`, `nextSteps.ts`, `tourKit.ts`, `toursAdvanced.ts`, `TourPanel.tsx`, `useDesignStore.ts` |
| 2 | `Design.build` (board, package diff), decoders in share, file and autosave, `designBuild(design)` with the absent-field rule | M | `design.ts`, `share.ts`, `autosave.ts`, new `lib/designBuild.ts` |
| 3 | Every reader moves from `useBoard` and `usePackages` to `designBuild` (exports, workers, report, S-Plot live network, Ladder, Dimensions, tours, workflows) | M | the 13 modules in 2.3 g, their tests |
| 4 | Build tool panel with sections, undo names, `data-tour` anchors; network row summaries and Edit…; stress limits moved | M | new `components/BuildPanel.tsx`, `tools.ts`, `RealizeControls.tsx`, `StressControls.tsx`, `App.tsx` |
| 5 | Settings regroup; board and package sections removed; New designs with Take from the open design; Libraries and Data sections; chart options persisted | M | `SettingsDialog.tsx`, `settings.ts`, `useBoard.ts`, `usePackages.ts` (defaults) |
| 6 | Laminate library (Save as my laminate) | S | `useBoard.ts` or new store |
| 7 | Workflows and next steps (section 4) | S | `workflows.ts`, `nextSteps.ts` |
| 8 | Guide sections 8 and 10, docs/07 tool list, changelog with the compatibility notes | S | docs |

Items 1 and 2 to 3 are independent. Item 4 needs 2. Ship 1 to 5 as one release, because a half-moved board (the panel in Build, storage in the browser) would repeat the inconsistency in a new place.

QA:
- Same design, two browsers with different default boards and package tables: a new link and a new `.json` give identical as-built locus, `.s2p` bytes (apart from the date), report and BOM layout notes.
- Old file, old link and old autosave (made on 0.5.0 with a board on and a changed 0402 row) open with the same as-built result as on 0.5.0 in the same browser, and the one-time message appears only when the default board is on.
- A link made by the new build opens in a 0.5.0 build without error (the unknown field is ignored).
- Every Build edit is one named undo step; Undo of Board on, a preset, a land size and Reset to defaults restores the as-built locus exactly.
- Use as default for new designs, then New: the new design has that build; Settings, New designs shows it; Take from the open design does the same.
- Settings Reset all leaves the build and the libraries untouched.
- The usable bandwidth, Tolerance yield, Auto match yield line and the next step "a match lands" all name and use the same limit; changing it in one place updates the others.
- Microstrip "Use the design's stackup" and Keep size behave as before against the design's stackup.
- Phone: Build in Tools, package disclosure cards, 44 px targets, no horizontal scroll at 375 px; tablet third segment; desktop header still one row at 1440 px, or wraps cleanly.
- Workflows Buildable, Robust, Verify and Real parts run end to end with the new anchors; the jsdom anchor test covers every `build.*` anchor.
- Share link length with a full build and a changed package row is measured and stays within about 200 extra characters (there is no length guard in `share.ts` today); malformed `build` fields (non-finite, out of range, a 1 MB name) are refused as the stackup checks already refuse them.

## 7. Implementation notes and deviations (2026-10-26)

Implemented as specified, with these deviations:

- **When an old design gets its build.** A design without a build is given this browser's defaults when it is opened from a `.json` file, a link or the autosave (not only at its first Build edit), and every `.json` file, link and autosave is written with the build the design evaluates with. So the one-time notice shows once per opening, and an opened design no longer moves when the defaults change later. Examples, lessons and `.xmlsc` files follow the defaults until they are saved, shared or edited in Build.
- **Link size.** Measured: a board on a preset laminate with one changed package row adds 238 characters to a link, every board number changed as well 364 (base64 of about 180 and 270 characters of JSON), against "about 200" in section 6. To get there the link leaves out a preset's name and the board numbers that are the built-in defaults; the reader puts them back.
- **Defaults for new designs** also hold the default Q, the series, the part tolerance and the VSWR limit (in `smithonline.settings.v1`), as the summary line of section 5 shows; the board and package table stay under their old keys. Use as default and Reset to defaults in Build cover the board, the package models, the default Q and the series.
- **Packages** render as one card per package on every width (open on desktop and tablet, closed on a phone), not as table rows. With the board on, the pad capacitance computed from the lands replaces the Pads field; with it off, Pads is an ordinary field.
- **The network row** keeps the part library note with Part library… inline under the series (the fallback anchor of the real parts workflow); the scope, the stock list and the default Q fields moved to Build.
- **Settings, Libraries**: the laminates are managed in a list inside Settings (no separate dialog); the winding cores show their count with Reset to the built-in table, since they are edited in the Winding dialog. **Data in this browser** has no Clear for the autosaved design, which is rewritten on every change.
- **Reset all** also sets the theme back to Auto (part of Appearance), with the rest of its Undo.
- **Invalid build fields** refuse the whole link, file or autosave, as a bad microstrip stackup does; a laminate name longer than 80 characters is cut, as before.
- **D6**: Apply the fitted build is an anchor of the hidden D6 workflow step only; the fit itself comes with D6.
