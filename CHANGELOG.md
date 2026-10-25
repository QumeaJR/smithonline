# Changelog

All notable changes to Smith Online. Versions follow semantic versioning; before 1.0 a minor version may change behaviour.

## Unreleased

The interaction redesign is complete (`docs/07-interaction-redesign.md`, phases 3 to 7): the app now works on phones, tablets and desktops with every feature, and `docs/03-ui-design.md` describes it as built.

### Added

- Add network to S-Plot (File menu, and Add the network in the S-Plot file list): the network as built as a live two-port entry that follows tuning, with a Freeze control for before and after comparisons. A removed S-Plot entry can be brought back with the Undo in its message for 8 seconds.
- Overlays and dialogs (phase 3): menus and popovers that flip and clamp inside the window, and open as sheets on a touch screen; one Escape stack (top overlay, armed part, open tool, tour); dialogs with a sticky footer and one focus trap, full screen with Done on a phone; Dimensions, Winding, Report and Import draggable by their title bar; tap to preview with an Add button in solution lists; Undo and action buttons in messages (Scale sweep replaces the browser's confirm); progress bars for the three workers; one export range for the `.s2p` export and the S-Plot network.
- Responsive shell and tool column (phase 4): three columns on a desktop with the header in groups by purpose (one row from 1440 px), two columns on a tablet with a side column Network | Numbers, and on a phone a top bar with More, the chart pinned as a square with design, grid and readout chips, and a bottom sheet Network | Numbers | Tools with peek, half and full detents and a live Zin and VSWR strip. Auto match, Optimize band and Tolerance open beside the numbers at every width, never over the chart, keep running behind another segment with a dot on their button. A start guide card with the three steps of a match on a new design; mode banners for an armed part and datapoint input; a datapoint column chooser on the phone; schematic cells sized to their values.
- Chart touch (phase 5): pinch zoom about the midpoint, two-finger pan, one-finger pan, marker drags with a 22 px halo and the nearest centre picked, long press for the context menu with "Suggest a match to here" on empty chart, double tap on a marker for suggestions, press, aim and release to place an armed part, a readout band on the phone; touch cursor readouts on the Response and S-Plot plots; ladder reorder by dragging the card's grip (long press on touch) and drag out of the panel to remove with Undo; hints worded for the pointer in use.
- Feedback and motion (phase 6): empty states with the step that fixes them (the empty network, Response and Optimize band without a usable sweep with "Use 0.5 to 2 f", S-Plot without files with Open and Add the network, Tolerance without parts, the datapoints table with only the load); files dropped on the S-Plot view load as Open does; a note with Run again on a stale Broadband or Tolerance result; a Copied state on Share; popovers, dialogs and sheets that enter on the motion tokens, a 200 ms Fit, a cross-fade of the chrome on a theme switch, and no motion at all with reduced motion; Undo and Redo name every step, typed values and switches included; slider tunes, the optimizer, Broadband, Auto match tune, distributed synthesis, imports and S-Plot hand-overs are named steps, and opening a file, an example or a Broadband network that replaces the parts carries the inline Undo; Ctrl+S, Ctrl+O, Ctrl+E (the File menu at Export) and Ctrl+1 to Ctrl+3 (the views), listed in the File menu.
- Install to a home screen (phase 7): a web app manifest with 192 and 512 px icons and an apple-touch-icon rendered from the favicon (`scripts/icons.mjs`); no service worker.

### Changed

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
