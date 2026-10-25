# Changelog

All notable changes to Smith Online. Versions follow semantic versioning; before 1.0 a minor version may change behaviour.

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
