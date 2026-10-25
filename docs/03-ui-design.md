# UI design

The interface as it is built (2026-10-25), after the seven phases of the interaction redesign (`docs/07-interaction-redesign.md`, which keeps the decisions and their reasons). `docs/06-user-guide.md` is the authoritative description of the behaviour; this document is the design reference: the layout model, the tokens, the components and the interaction rules. The early static mockup in `docs/mockup/index.html` is kept for its history only.

## Design goals

1. **The chart is the hero.** It gets the largest area, square, crisp at any zoom, printable. It never changes size when a tool opens and nothing is drawn over it except the mode banner in its margin and the chips on a phone.
2. **Everything is live.** A typed value, a slider or a dragged datapoint updates the chart, the tables and the schematic in the same frame. No "calculate" button; nothing that is data animates.
3. **The same panels at every width.** Network (build), chart (see) and Numbers (read), with the tools beside the numbers. The layout moves the panels; it never drops a feature. Every option of the desktop is on the phone.
4. **Keyboard and pointer, mouse and touch.** Engineering notation in every value field, Tab through the ladder, Undo for every step; each gesture of the mouse has a touch equivalent (section "Gestures").
5. **Teaching friendly.** Z grid, Y grid, element loci in a colour per element, and the original's vocabulary: `DPn` for user datapoints, `TPm` for transformed points, `SPp` for sweep points.
6. **Restraint.** In the spirit of Apple's Human Interface Guidelines: density stays, confusion goes; one accent colour, one primary button per surface, quiet chrome.

## Responsive model

Four widths, from `src/lib/layout.ts` (`useLayout()`), with the class `layout-phone`, `layout-tablet`, `layout-desktop` or `layout-wide` on the shell:

| Width | Layout |
|---|---|
| Phone, below 700 px | Top bar (44 px plus the safe area), the chart pinned under it as a square hero with three chips, the main sheet below with Network, Numbers and Tools. The page never scrolls in the chart view; Response and S-Plot are pages that scroll under the top bar with the sheet at peek. |
| Tablet, 700 to 1099 px | Header (wraps to two rows), the chart at 60 percent (at least 400 px) with the schematic strip under it, one side column (at least 280 px) with the segments Network and Numbers and, when a tool is open, a third segment with its close button. The status bar stays. |
| Desktop, 1100 to 1439 px | Header, three columns: Network 248 px, the chart, Numbers 288 px; the status bar under them. The header actions wrap to a second row. |
| Wide, 1440 px and up | The same with 300 and 360 px columns and the header in one 48 px row (short labels where the meaning stays clear: Optimize, Share). |

`layout/Shell.tsx` renders every slot once at a fixed place in the tree: the chart in the one `main` element, the dialogs after it, and the network, numbers, tool and tour through portals into host nodes (`layout/slots.ts`) that the columns of the current layout adopt. Crossing a breakpoint (a phone rotated, a window resized) only moves those nodes, so a running job, typed values, the chart's zoom and open dialogs survive it, and the focus goes back to the element it was on.

**Header** (`layout/DesktopHeader.tsx`), in groups by purpose, each a bordered cluster with a hairline between neighbours: brand and the view segmented control (Smith chart, Response, S-Plot); the design strip (name, f, source power, Z0) with Undo and Redo; data (File, Examples, Share), design tools (Auto match, Optimize band), settings (Tolerance and Settings as an icon button); Help and Theme as icon buttons. The File and Examples menus are popovers placed by `positionOverlay`.

**Tool column**: Auto match, Optimize band and Tolerance open behind the strip "Numbers | tool" at the top of the right column (`layout/ToolStrip.tsx`), as the third segment of the tablet's side column, or in the phone's Tools segment. The panel stays mounted while another segment shows, so a search runs on; its progress shows in the strip or the sheet header and a dot sits on its header button (`store/useJobs.ts`). A job that finishes behind another segment says its result in a message and leaves a check dot on the tool's segment or Tools entry until its panel shows; the running job's button reads Stop, and stopping says so. The Broadband bar counts what its words count (ladders, then refinements).

**Status bar** (tablet and wider, 28 px plus the safe area): the live readout (z, Z, Y, Gamma) or the hint for the pointer in use, the last message with its Undo or action button, and the link to the source.

## Phone model

- **Top bar** (`layout/PhoneTopBar.tsx`): More (a sheet with the header's groups: Data, Settings, Help), the view segmented control with short labels, Undo and Redo.
- **Chart hero**: full width and square, pinned. Three chips (`layout/ChartChips.tsx`): the design chip at the top left (f and Z0, the power when set; tap opens a sheet with the design fields), the grid button at the top right (Z, Y, density, labels, Fit), the readout chip at the bottom left (the last message or the readout a finger left; tap expands it). While a finger is on the chart, a readout band across its top replaces the two upper chips.
- **Main sheet** (`layout/PanelSheet.tsx`): grabber, segmented control Network | Numbers | Tools, three detents: peek (64 px plus the safe area: the 16 px grabber and one 44 px row, the segments without inset or border), half (in pixels, just below the chart hero, so the chart and two ladder cards are in view together) and full, with a 36 px live strip (Zin, VSWR) at full. The sheet never closes. A flick settles at the detent nearest where it would carry on to. Modes hold it low under their own names (`store/useShell.ts`): an armed part, datapoint input and a marker press at peek, a previewed solution at half (or peek where half would cover the ghost), the Response and S-Plot pages at peek; the detent before the first hold comes back when the last one ends; moving the sheet or opening a tool ends every hold. A job running behind another segment draws a 3 px bar along the top edge of the header; at peek its one-line label replaces the segment row (a tap brings the tool up at half), from half up the label sits under the segments.
- **Network segment**: the start guide on a new design, the schematic strip at 84 px (its drawing at 1:1, scrolling sideways), the palette as the disclosure "Add part" (two rows of six 52 px tiles, open while the ladder is empty), the Realize and Losses switches, the ladder.
- **Tools segment**: a list with one-line descriptions; a tool pushes its panel into the sheet with a back chevron that does not stop a running job.
- **Messages**: a toast of at most two lines under the chips for 4 s (8 s with Undo or an action); errors and refusals stay as a banner over the top of the chart until dismissed, and under the top bar on the Response and S-Plot pages (`layout/ErrorBanner.tsx`; a dismissal holds across the views).
- **Tour**: the sheet header at peek (title, step, Next), the narration from half up.

## Tokens

CSS custom properties at the top of `packages/app/src/index.css`. Light values on `:root`; dark values under `prefers-color-scheme: dark` (unless `data-theme="light"`) and under `data-theme="dark"`. The aliases of phase 1 (`--bg`, `--panel`, `--border`, `--text`, `--muted`, `--font`, `--mono`) were removed in phase 7; a test keeps them out of `src/`.

| Group | Tokens | Light | Dark or coarse pointer |
|---|---|---|---|
| Surfaces | `--canvas`, `--surface`, `--inset`, `--raised` | #f2f3f5, #ffffff, #f6f7f9, #ffffff | #0e1217, #161b22, #11161c, #1c232c |
| Borders | `--border-subtle`, `--border-strong` | #e6e9ed, #cfd5dc | #232c38, #36414f |
| Text | `--text-primary`, `--text-secondary`, `--text-tertiary` | #1b1f24, #5a6472, #8a94a1 | #e6edf3, #9aa7b5, #6b7786 |
| Accent | `--accent`, `--accent-hover`, `--accent-soft`, `--on-accent` | #0b6bcb, #0959a8, #e3f0fd, #ffffff | #58a6ff, #79b8ff, #15283d, #0b1220 |
| State | `--danger`, `--danger-soft`, `--warning`, `--success` | #c92a2a, #fdeaea, #e8590c, #2f9e44 | #ff6b6b, #3a1d1d, #ffa94d, #51cf66 |
| Focus | `--focus-ring` | the accent, a 2 px ring 2 px off the control (`:focus-visible`) | same |
| Chart (names fixed) | `--grid-z`, `--grid-y`, `--marker`, `--dp-user`, `--sweep`, `--vswr`, `--q`, `--stab`, `--gain`, `--noise`, `--mc-cloud` | hex primitives; Settings writes them inline on the root and reads them back by name, so they keep their names | grid and marker colours and the cloud lighter in dark |
| Type | `--font-ui`, `--font-mono`; `--type-caption` 11/14 500, `--type-small` 12/16, `--type-body` 13/18, `--type-emph` 13/18 600, `--type-title` 15/20 600, `--type-display` 20/24 600; `--type-mono-table` 11.5/16, `--type-mono-field` 12/16, `--type-mono-readout` 13/18 500, `--type-mono-big` 15/20 600 | as listed | fields 16/20 on a coarse pointer, so iOS does not zoom on focus |
| Spacing | `--space-0` to `--space-8`: 2, 4, 8, 12, 16, 20, 24, 32, 40 px; `--gutter-phone` 16, `--gutter-panel` 12 | | |
| Control heights | `--control-h`, `--control-h-sm`, `--control-h-lg` | 28, 22, 36 px | 44, 36, 50 px under `(pointer: coarse)` |
| Radii | `--radius-xs` to `--radius-xl`, `--radius-full` | 4, 6, 8, 12, 16 px, 999 px | |
| Elevation | `--shadow-1` (segmented thumb), `--shadow-2` (popovers, menus), `--shadow-3` (dialogs, sheets), `--backdrop` | backdrop rgba(0,0,0,.25) | dark raises surfaces one tone; backdrop .5 |
| Motion | `--dur-fast` 120 ms, `--dur-base` 160 ms, `--dur-slow` 280 ms; `--ease-out` cubic-bezier(0.2, 0, 0, 1), `--ease-std` cubic-bezier(0.2, 0, 0.2, 1) | | every duration 0 under `prefers-reduced-motion: reduce` |

Foundations: `font-variant-numeric: tabular-nums` on readouts, tables and fields; `-webkit-text-size-adjust: 100%`; `100dvh` for the layout; `env(safe-area-inset-*)` on the top bar, the status bar, the sheets and the tour; `viewport-fit=cover` and two `theme-color` metas (the theme toggle rewrites them when the theme is forced). The PNG export, the clipboard image and the report read the chart's colours under the light theme and draw on white, whatever the theme on screen.

**Theme**: follows the system by default (`auto`); the toggle cycles auto, dark and light and is stored in the browser. A switch cross-fades the chrome for `--dur-base` (the class `theme-switching` on the root, the SVG and canvases left out), so the chart changes at once.

**Install**: `public/manifest.webmanifest` (Smith Online, short name Smith, standalone, the light canvas colour) with 192 and 512 px icons and a 180 px `apple-touch-icon` rendered from `favicon.svg` by `scripts/icons.mjs`; `index.html` carries the manifest link and the `apple-mobile-web-app-*` metas. There is no service worker: the app needs the network to load.

## Components

Each has a class in `index.css` and, where it has behaviour, a component under `src/components/ui/`. Component tests run in jsdom (`// @vitest-environment jsdom`).

- **Button** (`Button.tsx`): primary (one per surface), secondary (default), quiet (menu rows, help links), icon (`IconButton`, square, the label as accessible name and tooltip), destructive (quiet with danger text), `size="sm"` (`.btn.sm`), `pressed` for a toggle with `aria-pressed`. The Share button (`ShareButton.tsx`) shows a check and "Copied" for 1.5 s and keeps the width of that state throughout.
- **Icons** (`icons.tsx`): inline SVG on a 16 unit grid in the current text colour; no Unicode glyph buttons and no emoji.
- **Field** (`Field.tsx`, `ValueInput.tsx`): label, value and unit in one box, width from `digits`, engineering notation, Enter commits and keeps the focus, Escape reverts, a refusal names the field and the reason; the field's own unit wins over a prefix reading and an ambiguous letter is refused with both readings. On a coarse pointer 16 px text, 44 px tall, `inputMode="text"`, `enterKeyHint="done"`, no autocomplete, autocorrect or autocapitalize.
- **Segmented control** (`Segmented.tsx`): role tablist, arrow keys, Home and End, one tab stop, a thumb that slides in `--dur-base`; `wrap` takes two rows. The view tabs, Ideal or Realized, the Dimensions medium, the Response axis, the sheet and side column segments, the Auto match methods on a fine pointer (a chooser row with a sheet of the five methods on a coarse one).
- **Switch** (`Switch.tsx`): `<input type="checkbox" role="switch">`, 28 x 16 px on a fine pointer, 44 x 26 px on a coarse one, a 44 px hit area, the knob sliding in `--dur-base`. For modes; lists keep checkboxes.
- **Slider** (`Slider.tsx`): 4 px track, 16 px knob (28 px on a coarse pointer), `touch-action: pan-y`; one undo step per drag and per run of key presses less than 500 ms apart, named after the part ("Tuned Series L 2 to 12.0 nH"); series ticks and snapping in Realize mode.
- **Badge** (`Badge.tsx`): element numbers and counts.
- **Popover and menu** (`Popover.tsx`, `Menu.tsx`, `lib/overlay.ts`): anchored, placed by the pure `positionOverlay(anchorRect, size, viewport)` that prefers the anchor's alignment, flips and clamps to the gutter; Up, Down, Home, End, Enter, Escape and typeahead; focus returns to the opener; `focusSection` opens a menu at a section (Ctrl+E opens File at Export). On a coarse pointer the same component is a sheet with 44 px rows and the descriptions kept. The overflow menu of a ladder card (`OverflowMenu.tsx`) collapses its small buttons on a coarse pointer.
- **Sheet** (`Sheet.tsx`): grabber (a 36 px target), header, scrolling body with `overscroll-behavior: contain`, safe-area padding, top corners `--radius-xl`; half and full detents and a low detent while a row of its list is previewed; a fast downward flick closes it.
- **Dialog** (`Dialog.tsx`): scrolling body and sticky footer at every width, one focus trap and focus return, Escape to the top dialog only, a full-screen sheet with a top bar (Done) on a coarse pointer. Dimensions, Winding, Report and Import can be dragged by their title bar on a fine pointer and reopen where they were left for the session.
- **Status message and toast** (`Toast.tsx`): the status bar message with an inline Undo (8 s) or an action button; on a coarse pointer a toast of two lines; errors flagged with `setMessage(text, { error: true })` stay as a banner on the phone.
- **Progress** (`Progress.tsx`): a 3 px determinate bar with "done of total, best" for the three workers, indeterminate until the first report; never a spinner over the chart.
- **Empty state** (`EmptyState.tsx`): a title, one line, up to three steps and one action (two where both are needed): the empty ladder (Auto match; left out while the start guide shows), Response and Optimize band without a usable sweep ("Use 0.5 to 2 f", one named step), S-Plot without files (Open and Add the network; files dropped on the view load as Open does), Tolerance without parts (three steps), the datapoints table with only the load.
- **Stale note** (`StaleNote.tsx`): a result that no longer matches the design (Broadband, Tolerance) gets a note row with a quiet Run again instead of a sentence after the result; it is the panel's only Run again while it shows, and the focus moves to the panel's first control when the run starts. A stale Tolerance cloud is dimmed with "stale" written over it.
- **Mode banner** (`components/ModeBanner.tsx`, `layout/ChartModeBar.tsx`, `lib/bannerPlace.ts`): an armed part or datapoint input, placed in the first free corner of the chart margin clear of the disc, its rim labels and the toolbar, or over the status bar; the sheet's peek header on the phone.
- **Ladder card**: header row (grip on a fine pointer, badge, name, summary, overflow button on a coarse one), fields, tune row (slider, value, Reset), secondary lines (node impedance, stress, realized value, note). Reorder by dragging the grip (a long press on touch) with the lifted card in a portal and a placeholder in its slot; dragging it out of the panel that holds the list removes the part with an Undo message (`lib/ladderDrag.ts`).
- **Start guide** (`components/StartGuide.tsx`): a card at the head of the ladder with the three steps of a match that tick off, on a new design only, closed for good in the browser and brought back from Help.
- **Tables**: mono, tabular, sticky header; rows 24 px on a fine pointer and 36 px on a coarse one; the datapoints table on the phone shows #, Z, VSWR and RL with a column chooser for |Γ|, ∠Γ and Q.

## Gestures

The arithmetic is pure and tested in node (`chart/gestures.ts`); `chart/SmithChart.tsx` runs pointer events with capture in a `Map<pointerId, point>`, handles `pointercancel`, cancels Safari's gesture events and sets `touch-action: none`, `-webkit-touch-callout: none` and `user-select: none` on the SVG. The table for users is in `docs/06-user-guide.md` section 3.

| Gesture | Pointer | Touch |
|---|---|---|
| Pan | drag on empty chart | one-finger drag on empty chart |
| Zoom | wheel about the cursor | pinch about the midpoint; two fingers pan; the half side from 0.05 to 4 disc radii |
| Fit | Fit button | Fit in the grid sheet (phone), the toolbar's Fit (tablet) |
| Readout | pointer move | the band at the top of the chart (phone), the status bar (tablet) |
| Drag a point | drag the marker | nearest centre within a 22 px halo, the selected point winning a tie, the finger offset kept; no step without movement |
| Place an armed part | click, the ghost follows | tap, or press, aim and release; unreachable aims show a dashed red ghost and add nothing |
| Suggestions | double-click a point or empty chart | double tap a marker; "Suggest a match to here" in the long press menu on empty chart |
| Context menu | right-click | long press 400 ms with 10 px slop, the marker pulsing 1.2x; a chooser row for markers within 12 px |

Drags follow their element by id: a Delete or Undo during a drag moves it with its element, or ends it without a change when the element is gone. Every drag, placement and reorder is one step named for its message and for Undo ("Moved TP4: Shunt L 2 to 16.8 nH", "Added Shunt L 2: 16 nH", "Moved Series C 2 to position 4").

## Motion

Only chrome moves; nothing that is data animates. Loci, points, tables and readouts update in the same frame as the input.

| What | Duration | How |
|---|---|---|
| Hover, pressed, toggles, menu rows | `--dur-fast` 120 ms | background, border and text colour |
| Segmented thumb, switch knob, popover entry | `--dur-base` 160 ms | the thumb's transform; the knob's transform; a popover fades in and travels 4 px away from its anchor |
| Sheet detents, dialog entry | `--dur-slow` 280 ms | the sheet's height or translate with `--ease-out`; the backdrop fades in and the dialog scales from 0.98 to 1 (the independent `scale` property, so a moved dialog keeps its transform) |
| Fit | 200 ms | the chart view's cx, cy and half interpolated with the ease-out (`fitViewAt` in `chart/gestures.ts`); a pan or zoom takes over; the chart's only animation |
| Theme switch | `--dur-base` on the chrome | the chart and the plots change at once |
| Toast | `--dur-base` | fades in |

`prefers-reduced-motion: reduce` sets every duration token to 0: sheets still change detent, without easing time; Fit jumps home; the long press pulse holds at 1.2x and the indeterminate progress bar stands still. A test checks that every transition in `index.css` runs on a duration token.

## Keyboard

Ctrl+N new, Ctrl+O open, Ctrl+S save `.json`, Ctrl+E the File menu at Export (key repeats ignored; the key's place, `KeyS`, on a non-Latin layout), Alt+1 to 3 the views (Chrome on Windows keeps Ctrl+1 to 8 for tabs; Ctrl+Alt is AltGr and does nothing) (`lib/shortcuts.ts`; the File menu shows them with `<kbd>`, hidden in the phone's File sheet on a coarse pointer), Ctrl+Z and Ctrl+Y (or Shift+Ctrl+Z) undo and redo, Delete removes the selected part, F1 or ? help. None of them acts while an overlay or the help is open or a text field has the focus; the browser's own save, open and search do not come up over the app for these keys. Escape walks one stack (`lib/overlay.ts`): a ladder drag, then the top overlay, then an armed part or datapoint input, then the open tool, then the tour.

## Accessibility

Every control is reachable by keyboard with a visible focus ring; sliders are native range inputs, switches are checkboxes with `role="switch"`, tables are real tables, segmented controls are tablists; icon buttons carry an accessible name; the status message is a live region; dialogs trap the focus and give it back; 44 px targets on a coarse pointer.

## Out of scope

- Drag and drop from the palette onto the chart (arm and place covers it).
- Multi-design tabs and collaborative editing.
- An offline mode (a service worker); the manifest only lets the app be installed to a home screen.
