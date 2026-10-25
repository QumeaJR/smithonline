# Advanced features: discoverability, guided workflows and next steps

Status: design review and implementable spec, 2026-10-25. Reviewed against release 0.5.0 at https://smithchart.online (desktop 1440 x 900 and phone 375 x 812) and the working tree (D5 part library in progress). Fits `docs/07-interaction-redesign.md` (tokens, components, slots, Escape stack, sheet detents) and the principles of `docs/08-depth-plan.md` ("deeper, not bigger"). No new view is proposed.

What was observed live and what was read from code: the header, menus, Auto match, Tolerance, Realize, Settings, Response, S-Plot, the start guide, the broadband tour and the phone More sheet and Tools segment were driven in the browser. The import dialog (Sweep all), the part library (D5) and the two-port panel were read from code only, because the live app needs a local file for them and D5 is not released.

## 1. Findings, ranked

1. **The tours cannot point at anything, and opening a tool ends them.** A tour is a start design plus steps that swap designs and narrate (`lib/tourKit.ts` `TourStep { apply, narrate }`). No step can anchor to a control, open a panel or wait for the user. Worse, `App.tsx` `setTool` closes a running tour when any tool opens ("Closed the tour ... to open Auto match"). So the advanced features are explained in prose but never located: the broadband tour runs the search for you and never shows the Run button, the Bode-Fano readout or the result list. Why it matters: the owner's complaint is exactly this; the current engine cannot fix it without an extension.
2. **The app stops at the first match.** The start guide's last step is "Match"; when it ticks, the guide closes itself after 2 s (`GUIDE_DONE_MS`). Auto match closes after Add. The message ("Added Shunt C 922.8 fF + Series L 9.746 nH; Zin = 50.0 + j0.0 Ω (Q 1.22)") offers nothing further. Jobs 2 to 4 (robustness, build, verify) have no signpost at the moment the engineer needs them.
3. **The measured load, the central object of the depth plan, has no front door.** Path: File, Open, pick a file, then the import dialog's "Sweep all N". Nothing says that "Sweep all" turns the rows into the load for every band tool. A newcomer without a VNA file cannot try it at all: no sample file ships, and the only measured load in the app is the synthetic antenna inside the broadband tour. The start guide says "or open a measured file" with no button.
4. **The board (D4) and the package table live in Settings, which does not say so.** The Settings tooltip and the phone description read "colours, line widths, labels, defaults, schematic direction". Board is the seventh and last section of a long scroll, after colours. "Board in the network as built" is a design mode like Losses, but it is not where Realize and Losses are.
5. **Tolerance and yield (D3) are filed as a setting.** On the desktop, Tolerance sits in the Settings cluster beside the gear; on the phone it is listed under More, Settings (and again under Tools). An engineer looking for yield looks among the tools, next to Auto match and Optimize.
6. **Features appear only once something else is switched on, with no hint that they exist.** The BOM entry is missing from File until Realize is on. The part library (D5) is three levels deep: Realize on, Value series = Part library, then "Part library…". "Judge each run by its worst VSWR over the measured band" is off by default even when a measured load is loaded, so the first yield a newcomer gets is at one frequency. The Bode-Fano limit shows only with a measured load and is unexplained.
7. **Verification exports are a flat list of 16 entries.** .s2p (includes packages and the board), SPICE and LTspice (leave them out) and the CKT netlist sit between "Copy chart as image" and "Datapoints and circles (ASCII)". The difference that decides which file to send to an independent simulator is only in descriptions. "Add network to S-Plot" (the in-app comparison) is not connected to the export.
8. **Amplifier work is at the bottom of Numbers.** The two-port device ("Enter S-parameters"), stability, gain and noise circles are below datapoints, bandwidth, sweep and circles. K, mu and MAG/MSG are shown without explanation; only the LNA tour and Example 13 lead there.
9. **Tours hide under "Examples".** The tooltip says "Guided tours and the 22 Smith V4.1 example projects"; on the phone they are two levels deep (More, Examples). The tour panel's counter "5 of 10 tours" carries no meaning. The broadband tour's blurb says "over an octave" but its band is 70 to 130 MHz (60 %).
10. **Jargon without a tooltip in the places that matter**: Sweep all, Back to frequency sweep, Load alone, Store, Pkg, Click chart, Bode-Fano floor, Spread by part, VSWR per %, Reel correlation, Centre the design, Use 0.5 to 2 f, TPn markers (section 5).
11. **No stable anchors in the DOM.** There are no `data-tour` attributes; the open tool lives in `App.tsx` local state and Auto match's method in `AutoMatch.tsx` local state (`lastTool`), so nothing outside those components can open "Auto match, Broadband".

### Per job: entry, clicks, what is missed

| Job | Entry today | Clicks (desktop) | Never found by a newcomer | Jargon | Missing next step |
|---|---|---|---|---|---|
| 1 Measured load over a band | File, Open, Sweep all, Auto match, Broadband, Run, pick, Response, Load alone | 10 | that Sweep all makes the load; fit quality in Numbers, sweep section; Show the measured load on the chart; the limit appears only here | Sweep all, fitted order, residual in Γ, Bode-Fano floor | after import: "match over the band"; after a result: "check tolerance over the band" |
| 2 Robust | Tolerance (Settings cluster), tick over band, Run, Centre the design, Apply | 5 | Tolerance is a tool; Rank by Yield in Add parts; Tolerance per part; worst case only after a run | Spread by part, VSWR per %, Reel correlation, Wilson interval | after a match: "check tolerance"; after centring: "realize to stock" |
| 3 Buildable | Realize, series, Pkg per card, gear, scroll to Board, tick, fields, close, File, BOM, Report | 10 + 1 per part | Board in Settings; BOM absent while Realize is off; the as-built locus and its legend | Pkg, Land l/w, Rq, tanδ at f | after Realize: "add packages and the board"; after board: "export BOM and report" |
| 4 Verify | File, Export, .s2p or SPICE; S-Plot, Add the network, Freeze | 3 to 6 | which export carries the board; that S-Plot overlays an external .s2p on the live network | CKT, as built | after .s2p: "compare in S-Plot"; later (D6): "compare the built board" |
| 5 Amplifier, broadband | Open .s2p, Numbers, scroll to two-port and circles; Auto match, Transformer or Broadband | 5 to 7 | circles exist; noise data comes from the file; Transformer and Stub filter are inside Auto match | K, mu, MAG/MSG, Γopt, rn | after a device: "check stability, then noise and gain circles" |

## 2. Information architecture

Rule: surface and sequence what exists; every advanced feature gets one home, one signpost at the moment it becomes useful, and one workflow that walks it.

### Header (desktop) and More (phone)

- Clusters become: data (File, Share link), design tools (**Auto match, Optimize band, Tolerance**), settings (Settings icon), help (**Learn**, Help icon, Theme). Tolerance moves out of the settings cluster.
- **Examples is renamed Learn** and moves to the help cluster. Its menu sections: Workflows (section 3, a check mark once completed in this browser), Lessons (the ten existing tours, unchanged), Sample files (section 3.0), Smith V4.1 examples. Tooltip: "Guided workflows, lessons, sample files and the Smith V4.1 examples".
- Phone More: Data (File, Share link); Settings (Settings, Theme; Tolerance removed, it is in Tools); Help (**Learn**, Help, Show the start guide, Licences).
- Settings tooltip and phone description: "Colours, defaults, component packages and the board stackup".

### Network panel: one "as built" row

- The switch row "Realize | Losses" becomes "Realize | Losses | Board" (same Switch component, wraps on narrow widths). Board toggles the existing "Board in the network as built" flag; when on, a one-line summary appears like the Realize options ("FR-4 1.6 mm, 1 via per shunt part, traces 0 mm", button **Edit board…** opening Settings scrolled to its Board section). The flag stays in browser storage as today; the summary says "for every design in this browser" in its tooltip.
- Value series keeps "Part library" (D5); when chosen with an empty library the existing note gets two buttons: **Load part files…** and **Try sample parts**.
- With a measured load, the load card shows a header line "Measured load: antenna.s1p, 101 rows, 2.2 to 2.7 GHz, fitted (order 4)" with two quiet buttons **Match over the band** (opens Auto match, Broadband) and **Show on chart** (the existing switch). This is the front door for job 1.

### Tools

- Auto match method row gets one-line subtitles on hover and in the phone chooser (already there on the phone): Broadband "Best network over the band, with the Bode-Fano limit".
- Tolerance: "Judge over the measured band" defaults to on when a measured load exists (it is a default, not a forced state).
- Every tool head gets a quiet **Show me** link beside its ? link, starting the matching workflow at its first step for that tool.

### File menu, Export

Group the Export section with sub-headings (Menu `section` entries already exist):
- For a simulator: Touchstone S-parameters (.s2p) "as built: realized values, losses, packages, board"; SPICE netlist (.cir) and LTspice (.asc) "values and losses; no packages or board"; Netlist (.ckt).
- For the build: Bill of materials (CSV), Report…, Print. The BOM entry is always listed; with Realize off it is disabled with the title "Turn Realize on to list standard values".
- Compare in the app: Add network to S-Plot.
- Images and data: the rest, unchanged.

### Numbers

- Two-port device: when a device is loaded, a one-line readout "Stable at f (K 1.12, mu 1.05)" or "Potentially unstable at f: draw the stability circles" with a button that adds them; tooltips on K, mu, MAG/MSG (section 5).

### Response

- With a measured load and Broadband run, a dashed horizontal line on the VSWR plot at the Bode-Fano limit, legend "Bode-Fano limit". Load alone on by default the first time a measured load is shown.

### Start guide, extended rather than replaced

- After the three steps tick, the guide does not close itself. It collapses to one row: "Matched. Next: [Check tolerance] [Make it buildable] [More…]" (More opens Learn at Workflows). With a measured load the first button is "Optimize over the band". The close button and the "never again" behaviour stay as they are.
- Step 1 gets a second button **Open a measured file…** and a link **Try a sample antenna**.

## 3. Guided workflows

### 3.0 Engine changes (prerequisite)

Workflows are a second kind of tour next to the lessons. Same panel, same Escape layer, same one-Undo origin.

```ts
interface WorkflowStep {
  id: string;
  title: string;                         // 2 to 5 words
  text: string | ((d: Design) => string); // at most 2 sentences
  anchor?: string;                       // a data-tour id, highlighted
  prepare?: (ui: TourUi) => void;        // open tool and method, view, pane, detent, settings section
  apply?: (d: Design) => Design;         // optional design change, lesson style
  doIt?: { label: string; run: (ui: TourUi) => void }; // "Do it for me"
  advance: 'next' | ((s: TourSnapshot) => boolean);  // checked on every store change
  requires?: 'd5' | 'd6' | 'd7';         // hidden until the phase ships
}
interface TourUi { setView; openTool(id, mode?); setPane; setDetent; openSettings(section); openSample(id); openMenu(id) }
```

- **Tool state moves to a store** (`useShell` gets `tool` and `setTool`; Auto match's `mode` gets a store setter in place of the module `lastTool`). `setTool` ends a running **lesson** only; a workflow never ends because a tool opened.
- **Anchors**: add `data-tour="..."` to the elements in the step tables below. The highlight is a class `.tour-anchor`: 2 px `--accent` outline with a 4 px `--accent-soft` halo, `--radius-sm`, one 600 ms pulse (none under reduced motion), `scrollIntoView({ block: 'nearest' })`. No backdrop, nothing blocked: the user can click anything (HIG non-modal coach mark). If the anchor is missing 300 ms after `prepare`, the text gets "Open {place} first" and the doIt button does it.
- **Advance**: when `advance` is a predicate, the Next button reads "Next" but the step also advances by itself when the predicate turns true, with a 400 ms delay so the user sees the result. Back works as today.
- **Phone**: `prepare` also sets the sheet segment and the detent (half when the anchor is in the sheet, peek when it is on the chart). The tour header at peek shows title, "step n of m" and the doIt button when there is one, else Next.
- **Panel copy**: drop "n of 10 tours"; show "Workflow · step n of m". On the last step a primary button chains to the next workflow ("Next: Make it buildable").
- **Samples** (Learn, Sample files, and `openSample` for the workflows): (a) `antenna-2g4-synthetic.s1p`, 101 rows 2.2 to 2.7 GHz, generated from a series RLC with a shunt C (so the fit is order 2 to 4 and the floor is an estimate); (b) `amp-synthetic.s2p` with its noise block (exists in `packages/core/test/fixtures/sparams/`); (c) the D5 `SYNTH-*.s2p` part files. All named synthetic, per the D5 licence decision. Opening a sample goes through the real import path (the import dialog opens with the file), so the user learns the real flow.
- Help links: `workflow:<id>` added to `helpActions.parseTarget`, and every guide section of an advanced feature ends with a Try link to its workflow.
- **Finding and dismissing**: Learn menu; the extended start guide; **Show me** in tool heads; next-step chips (section 4); Help Try links. Workflows never start on their own. Escape or the close button ends one (one Undo brings back the design before it). Completion is stored per workflow in localStorage (`smithonline.workflows.v1`) and shown as a check in Learn.

### 3.1 Workflow "Match a measured antenna over its band" (job 1)

Start: empty design, f 2.45 GHz, Z0 50 Ω. Sample (a).

| # | Anchor | Copy | User does | Advances when |
|---|---|---|---|---|
| 1 | `header.file` (File button) | "Start from what you measured: a .s1p, .s2p, CITI or VNA CSV file. Here a synthetic 2.4 GHz antenna stands in for yours." | doIt **Open the sample antenna** (or File, Open) | import dialog open |
| 2 | `import.useRows` (ImportDialog "Sweep all N") | "Use all rows as the load. Every band tool then reads the antenna across frequency, not one R + jX." | presses it | `design.sweep.mode === 'datapoints'` with loads |
| 3 | `numbers.loadModel` (`[data-testid="load-model"]`) | "A smooth model is fitted to the rows. A residual under 0.01 in Γ means the tools follow the model between rows." | doIt **Show it on the chart** | Next |
| 4 | `match.method.broadband` | "Broadband search tries ladders up to Max parts and scores each by its worst VSWR across the band." | prepare opens Auto match, Broadband | Next |
| 5 | `match.broadband.run` | "Run it. The Bode-Fano limit is the best any lossless network can do over this band; it tells you when to stop adding parts." | Run | a Broadband result exists |
| 6 | `match.broadband.results` | "Compare each worst VSWR with the limit. Two parts near the limit beat four parts a little nearer. Click one to use it." | picks a row | `design.elements.length > 0` |
| 7 | `match.broadband.maxParts` (aria "Maximum number of parts") | "Optional: try one part more and see how little it buys near the limit." | changes it, runs again, or skips | Next |
| 8 | `view.response` then `response.loadAlone` | "Curves follow the model, dots are the network on each measured row. Load alone shows what the match bought." | prepare switches to Response, Load alone on | Next |
| 9 | none | "Next: check that the match survives part tolerances." | **Next: Robust match** | chains |

### 3.2 Workflow "Check the match is robust" (job 2)

Start: load 100 - j50 Ω, f 1 GHz, sweep 900 MHz to 1.1 GHz, Realize E24, shunt L 11 nH + series C 2.7 pF (the reference case of `yield.test.ts`: about 46 % to 93 %). Tolerance limit VSWR 1.38.

| # | Anchor | Copy | User does | Advances when |
|---|---|---|---|---|
| 1 | `header.tolerance` | "Tolerance asks how many boards still pass when every part is off by its tolerance. Limit here: VSWR 1.38 over 900 MHz to 1.1 GHz." | prepare opens Tolerance, over band on | Next |
| 2 | `tolerance.spread` | "Which part matters most, live, without a run. A large share is where a tighter part or another topology pays." | reads | Next |
| 3 | `tolerance.run` | "Run 1000 boards." | Run | a Monte Carlo result exists |
| 4 | `tolerance.yield` | "Yield with its 95 % interval. At 1000 runs, differences under about 3 % are noise." | reads | Next |
| 5 | `tolerance.worstCase` | "The worst case says whether all parts at a limit (a corner) or a draw inside the band is worst." | reads | Next |
| 6 | `tolerance.correlation` (Reel correlation fields) | "Parts from one reel drift together. Try C 0.8 and run again to see whether it helps or hurts." | optional | Next |
| 7 | `tolerance.centre` | "Centre for yield moves the nominal values to where most boards pass, then snaps them to E24." | doIt or press | a centring result exists |
| 8 | `tolerance.apply` | "Apply is offered only when the gain is beyond the noise of the runs." | Apply | elements changed, or Next |
| 9 | `match.add.rankBy` | "Next time, rank Add parts by Yield to pick the robust network from the start." | prepare opens Auto match, Add parts | Next |
| 10 | none | "Next: make it buildable." | **Next: Buildable** | chains |

### 3.3 Workflow "Make it buildable" (job 3)

Start: the result of 3.2 (12 nH, 2.7 pF at 1 GHz, Realize off).

| # | Anchor | Copy | User does | Advances when |
|---|---|---|---|---|
| 1 | `network.realize` | "Realize snaps each value to a series you can buy. The dashed locus is the realized network." | turns Realize on | realization on |
| 2 | `network.series` (aria "Value series") | "E24 is 5 % parts. My stock takes a pasted list; Part library takes measured part files (see the parts workflow)." | picks E24 | Next |
| 3 | `card.pkg` (aria "Package of element 1") | "A package adds its own L and C: the dotted locus is the network as built." | doIt **Use 0402 for all** | every L and C has a package |
| 4 | `network.board` (new switch) | "Include the board: pads from the land size, a via under each shunt part, traces between parts." | turns Board on | board flag on |
| 5 | `network.boardEdit` (Edit board…) | "The stackup is set once per browser. FR-4 1.6 mm here; pick your laminate." | opens Settings at Board, or Next | Next |
| 6 | `chart.legend` | "Ideal, realized and as built side by side: the gap is what the board costs." | reads | Next |
| 7 | `view.response` | "The as-built curves are dotted. If they leave the limit, retune or centre again." | prepare Response | Next |
| 8 | `file.export.bom` | "The BOM lists ideal and realized values, packages and the layout assumptions." | File, Bill of materials | BOM exported |
| 9 | `file.report` | "The report puts chart, schematic and datapoints on one page for review." | optional | Next |
| 10 | none | "Next: verify with an independent simulator." | **Next: Verify** | chains |

### 3.4 Workflow "Verify against an independent tool" (job 4)

Start: the result of 3.3 (as built, board on).

| # | Anchor | Copy | User does | Advances when |
|---|---|---|---|---|
| 1 | `file.export.s2p` | "The .s2p is the network as built: realized values, losses, packages and the board. Load it in your simulator against the same load." | exports | .s2p exported |
| 2 | `file.export.spice` | "SPICE and LTspice carry values and losses only, no packages or board. Use them to check the circuit, the .s2p to check the build." | optional | Next |
| 3 | `view.splot` then `splot.addNetwork` | "S-Plot shows this design's network live. Freeze it to keep a snapshot." | Add the network | live entry present |
| 4 | `splot.addFile` | "Add your simulator's .s2p of the same network: the two traces should lie on top of each other." | doIt **Add the exported file** (re-opens the export as a stand-in) | two entries |
| 5 | `splot.freeze` | "Freeze before you tune, so before and after stay visible." | Freeze | Next |
| 6 | none (requires d6) | "When the board is built, measure S11 and compare it here (Measure, compare, retune)." | | chains to 3.7 |

### 3.5 Workflow "Amplifier: stability, gain and noise" (job 5, part A)

Start: the LNA tour's start design (`lna-input`), device from sample (b).

| # | Anchor | Copy | User does | Advances when |
|---|---|---|---|---|
| 1 | `numbers.twoPort` | "The device's S-parameters and noise data, read at the design frequency. From a .s2p file or typed." | doIt **Use the sample amplifier** | device present |
| 2 | `numbers.stability` (new readout) | "K above 1 and mu above 1: stable for any passive source and load. Below: draw the circles to see where not to go." | reads | Next |
| 3 | `numbers.circles.stability` | "The stability circles mark the source impedances that make the device oscillate." | adds them | stability circles drawn |
| 4 | `numbers.circles.noise` | "Noise circles: each is one noise figure. The centre is Γopt, the lowest NF." | adds NF circles | drawn |
| 5 | `numbers.circles.gain` | "A gain circle shows what each source impedance costs in gain. Pick a point that trades the two." | adds one | drawn |
| 6 | `target.card` | "Set the target to Γopt (or your trade-off point) and match to it." | doIt **Target = Γopt** | target set |
| 7 | `header.automatch` | "Add parts reaches the target; check it stays out of the unstable region." | adds a network | elements > 0 |
| 8 | none | "Next: broadband and multi-section matching." | **Next** | chains |

### 3.6 Workflow "Broadband limits and multi-section" (job 5, part B)

Start: the 3.1 antenna, or a real load 25 Ω for the transformer steps.

| # | Anchor | Copy | User does | Advances when |
|---|---|---|---|---|
| 1 | `match.method.transformer` | "For a real load, quarter-wave sections: binomial is flat, Chebyshev wider at a chosen ripple." | prepare Auto match, Transformer | Next |
| 2 | `match.transformer.list` | "Each row gives the band under the limit. More sections, more band." | picks 2 sections | elements > 0 |
| 3 | `match.method.broadband` | "For a reactive load, lumped ladders: the search and its limit, as in the first workflow." | | Next |
| 4 | `match.broadband.line` ("Allow one series line") | "Allow one line in place of a series part when the layout needs length anyway." | optional | Next |
| 5 | `header.optimize` | "Optimize band refines the values you have for the worst VSWR, or for limit areas drawn in Response." | Run | optimizer result |
| 6 | none (requires d7) | "The real frequency technique computes the best gain shape for this load directly; compare it with the search." | | chains to 3.8 |

### 3.7 Workflow "Build with real parts" (D5)

Start: the 3.3 design. Samples (c).

| # | Anchor | Copy | User does | Advances when |
|---|---|---|---|---|
| 1 | `network.series` | "Part library snaps to parts whose measured S-parameters you loaded, not to a value series." | picks Part library | series = library |
| 2 | `network.partLibrary` (button "Part library…") | "Your library stays in this browser. Manufacturers publish files per part number; links are inside." | opens it | dialog open |
| 3 | `partLibrary.load` | "Load the files. Here synthetic 0402 parts stand in for vendor files, which the app may not bundle." | doIt **Load sample parts** | library count > 0 |
| 4 | `card.part` (part number on a card) | "Each part is now its measured two-port: self resonance, ESR and pads included." | reads | Next |
| 5 | `file.export.bom` | "The BOM lists manufacturer part numbers." | exports | exported |
| 6 | `partLibrary.links` | "Get real files: Murata, Coilcraft, Johanson. They stay in your browser and are never uploaded." | | done |

### 3.8 Placeholders, D6 and D7

Shipped with `requires`, hidden until the phase lands. Anchors to be fixed by those phases.

- **Measure, compare, retune (D6)**: 1 open the measured S11 of the built board with "Compare with the design" in the import dialog; 2 Response overlays measured and designed; 3 "Fit what moved" (parts and board parameters, with D3 sensitivities); 4 the drift table; 5 "Suggest retune" snapped to series or library; 6 apply and see the expected result. Sample: a synthetic measurement of the 3.3 design with known drifts (+8 % on the shunt L, +0.3 pF on one pad), so the fit has a known answer.
- **Best possible match from data (D7)**: 1 the 3.1 antenna; 2 Broadband panel, real frequency technique beside the topology search; 3 its gain shape against the Bode-Fano limit; 4 the realized ladder against the best searched one at the same part count; 5 use it.

### Coverage

| Feature (phase) | Home | Signpost | Workflow |
|---|---|---|---|
| Measured load, fit, show on chart (D2) | load card header, Numbers sweep | start guide step 1, after import | 3.1 |
| Broadband, Bode-Fano limit (D2) | Auto match, Broadband | load card "Match over the band" | 3.1, 3.6 |
| Spread, yield, worst case, correlation, centring, Rank by Yield (D3) | Tolerance, Auto match | after a match, after Broadband | 3.2 |
| Realize, packages, board, microstrip (D4) | network as-built row | after centring, after Realize | 3.3 |
| Exports, S-Plot network (D1, D4) | File, Export groups; S-Plot | after BOM, after board | 3.4 |
| Two-port, circles | Numbers | after loading an .s2p with S21 | 3.5 |
| Transformer, stub filter, Optimize band | Auto match, header | Broadband result | 3.6 |
| Part library (D5) | Value series, Part library… | empty library note | 3.7 |
| Measure and retune (D6), RFT (D7) | to come | 3.4 last step, 3.6 last step | 3.8 |

## 4. Contextual next steps

One mechanism, two surfaces: the existing message action (status bar on desktop and tablet, toast on the phone) when the event happens, and a persistent **next-step chip** at the foot of the network panel after the target card (the collapsed start guide on new designs, section 2). At most one suggestion at a time; a suggestion is withdrawn by any other change, like Scale sweep today. Settings, New designs gets "Suggest next steps" (on by default); the chip's close button turns it off with an Undo.

| After | Suggest (button label) | Does |
|---|---|---|
| Sweep all on a measured file | Match over the band | opens Auto match, Broadband, band = measured band |
| A match lands (VSWR at f below the limit), no sweep range | Check the band | sets 0.5 to 2 f, switches to Response |
| A match lands, sweep or measured load present | Check tolerance | opens Tolerance, over band on when measured |
| Add parts with a measured load | Optimize over the band | opens Optimize band |
| Broadband result applied | Check tolerance over the band | opens Tolerance, over band on |
| Broadband best is far above the limit (over 1.5 times) | Allow more parts | focuses Max parts |
| Tolerance run, yield below 90 % | Centre for yield | runs centring |
| Tolerance run, one part above 50 % of the spread | Set Shunt L 1 to 2 % | opens Tolerance per part at that part |
| Centring applied | Realize to standard values | Realize on (or Part library when loaded) |
| Realize turned on | Add packages and the board | scrolls to the first Package field |
| Board turned on | Export the BOM | File, Export, BOM |
| .s2p exported | Compare in S-Plot | Add the network, switch to S-Plot |
| .s2p with S21 opened | Check stability | scrolls Numbers to the two-port readout |
| Device potentially unstable | Draw stability circles | adds them |
| Part library chosen and empty (D5) | Load part files | opens the library |
| BOM exported with Realize on (D6) | When it is built: compare | starts the D6 workflow |
| Broadband run with a fitted load (D7) | Try the real frequency technique | opens the D7 method |

Each suggestion also offers "Show me" in its tooltip when a workflow covers it (starts the workflow at the matching step).

## 5. Copy fixes

| Where | Old | New label | Tooltip or note |
|---|---|---|---|
| Header | Examples | Learn | Guided workflows, lessons, sample files and the Smith V4.1 examples |
| Header, More | Settings tooltip | (unchanged label) | Colours, defaults, component packages and the board stackup |
| Header | Tolerance | Tolerance | Tolerance and yield: how many boards pass, which part matters, worst case, design centring |
| Header | Optimize (Optimize band) | Optimize band | Refine the values you have for the lowest worst VSWR over the sweep range |
| Import dialog | Sweep all N | Use all N rows as the load | Every band tool reads the load across frequency from these rows |
| Numbers, sweep | Back to frequency sweep | Use the fixed load | Keeps the rows; band tools return to DP1 alone |
| Numbers, sweep | Apply the network to the N points of X | Apply the network to the N measured rows of X | |
| Load card | Click chart | Add by clicking the chart | |
| Card | Pkg | Package | |
| Network row | Realize | Realize | Snap values to a series, your stock or your part library |
| Network row | Losses | Losses | Finite Q for inductors and capacitors |
| Settings, Board | Board in the network as built | Include the board (pads, vias, traces) | |
| Auto match | Broadband | Broadband | Best ladder over the band, with the Bode-Fano limit |
| Broadband, Optimize | Bode-Fano floor | Bode-Fano limit | The lowest worst VSWR any lossless network can reach over this band, for this load |
| Tolerance | Judge each run by its worst VSWR over the measured band, with the measured load | Judge over the measured band | Each run is scored by its worst VSWR across the band, not at f alone |
| Tolerance | Spread by part | Which part matters most | Share of the VSWR spread each part causes under its tolerance |
| Tolerance | VSWR per % | VSWR per % | Change of the VSWR for a 1 % change of this part |
| Tolerance | Reel correlation | Reel correlation | Parts from one reel drift together: 0 independent, 1 all alike |
| Tolerance | Centre the design | Centre for yield | Moves nominal values to where most boards pass |
| Response | Load alone | Load without network | |
| Response | Store | Store curves | Keep a dashed copy to compare against |
| S-Plot | Add the network | Add this design's network | |
| Empty states | Use 0.5 to 2 f | Sweep 0.5 f to 2 f | |
| Chart markers | TPn | (unchanged) | Hover title: "TP3: the impedance after part 2" |
| Two-port | K, mu, MAG or MSG | (unchanged) | K, mu: stability tests (above 1: stable); MAG: maximum available gain; MSG: maximum stable gain when K is below 1 |
| Broadband tour | "An antenna over an octave" | "An antenna over a 60 % band" | the band is 70 to 130 MHz |
| Tour panel | "5 of 10 tours" | "Lesson" or "Workflow", step n of m | |

## 6. Implementation order

| # | Item | Size | Files (main) |
|---|---|---|---|
| 1 | Copy fixes (section 5), Settings tooltip, BOM disabled with reason, broadband blurb | S | `tips.ts`, `tools.ts`, `Header.tsx`, `PhoneTopBar.tsx`, `ImportDialog.tsx`, `RightPanel.tsx`, `MonteCarloPanel.tsx`, `ResponseView`, `toursAdvanced.ts` |
| 2 | Header regroup: Tolerance to design tools, Examples to Learn in the help cluster; phone More regroup | S | `DesktopHeader.tsx`, `PhoneTopBar.tsx`, `Header.tsx` |
| 3 | Lift tool and Auto match mode into `useShell`; workflows survive a tool opening | M | `App.tsx`, `AutoMatch.tsx`, `useShell.ts`, `ToolStrip.tsx` |
| 4 | `data-tour` attributes on every anchor in section 3 | S | components above |
| 5 | Workflow engine: step model, highlight, predicates, doIt, phone detents, chaining, completion store, `workflow:` links | M to L | `tourKit.ts`, `useTourStore.ts`, `TourPanel.tsx`, `helpActions.ts`, `index.css` |
| 6 | Sample files and `openSample` through the import dialog | S | new `lib/samples.ts`, `scripts/` generator for the antenna |
| 7 | Workflows 3.1 to 3.6 | M (S each) | new `lib/workflows.ts` |
| 8 | Network "as built" row with Board switch and Edit board…; load card measured header with Match over the band | M | `RealizeControls.tsx`, `LoadFields.tsx`, `SettingsDialog.tsx` (scroll to section) |
| 9 | Next-step rules and chip; start guide collapse instead of auto close | M | new `lib/nextSteps.ts`, `StartGuide.tsx`, store message actions |
| 10 | Export groups in File; stability readout in Numbers; Bode-Fano line in Response | S each | `Header.tsx`, `TwoPortPanel.tsx`, `ResponseView` |
| 11 | Workflow 3.7 (with D5), 3.8 stubs (D6, D7) | S now, then with each phase | `workflows.ts` |
| 12 | Guide: a "Workflows" section in `docs/06-user-guide.md`, Try links per advanced section; changelog | S | docs |

Items 1, 2 and 4 can ship first as one small release; 3 and 5 are the core and carry the risk; 9 depends on 3.

### QA

- Every workflow runs end to end from the Learn menu with no file of the user's, at 1440, 1024, 768 and 390 px, light and dark, by pressing only Next and doIt, and again by doing each step by hand (predicates advance it).
- No anchor missing: a test walks every step's `prepare` in jsdom and asserts `document.querySelector('[data-tour="..."]')` exists (or the step's fallback text shows).
- Opening a tool, changing the view or editing a value never ends a workflow; Escape and close end it; one Undo restores the design from before it; a lesson still ends when a tool opens.
- Highlight never covers the chart or blocks input; reduced motion: no pulse; focus is not stolen from a field being typed in.
- Phone: the anchor is visible after `prepare` (sheet segment and detent), the doIt button reachable at peek, 44 px targets.
- Next-step chip: one at a time, withdrawn by an unrelated change, never shown on an opened file or share link until the first edit, off with one click and back from Settings.
- BOM entry visible but disabled with Realize off; Tolerance in the tools cluster; Learn reachable in at most one click on desktop and two on the phone.
- Samples are labelled synthetic in the file name, the import dialog and the load card; no vendor data in the bundle (D5 licence decision).
- Copy: no em or en dashes; every label in section 5 changed in tests and the guide (the help tests read the guide).
- Numbers in workflow text come from the evaluation, as in the lessons (no typed results), and the 3.2 yields match `yield.test.ts` within its intervals.
