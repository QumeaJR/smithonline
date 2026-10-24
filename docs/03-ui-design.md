# UI design concept

A clickable static mockup is in `docs/mockup/index.html` (open it in any browser, no build needed). It already draws a real Smith chart grid in SVG and evaluates Example 5 from the original with the same formulas the core library will use, so it doubles as a proof of concept for the rendering approach.

## Design goals

1. **The chart is the hero.** It gets the largest area, always centered, square, crisp at any zoom, printable.
2. **Everything is live.** Changing a value, dragging a slider or dragging a datapoint on the chart updates the chart, the table and the schematic in the same frame. No "calculate" button.
3. **Three panels, one screen.** Build on the left, see in the middle, read numbers on the right. No modal dialogs for everyday work. On narrow screens the side panels become drawers below the chart.
4. **Keyboard friendly.** Element values accept engineering notation (`3n9`, `2.2p`, `0.25` wavelengths, `50`), Tab moves through the ladder, Ctrl+Z undoes.
5. **Teaching friendly.** Z grid, Y grid and both grids as toggles; the locus of each element is drawn as an arc along its constant r or g circle in a color per element; points keep the original's vocabulary so old examples, the examples PDF and the slides still make sense: `DPn` for user datapoints (1-based), `TPm` for transformed points, `SPp` for sweep points.
7. **Tuning like the original, but adjustable.** Sliders default to the original's 80 to 120 percent window with a "recenter" button, and the window can be widened or switched to a log scale.
6. **Light and dark** via CSS variables; colors and line widths user-adjustable like the original.

## Layout (desktop, 1280 px and wider)

```
+--------------------------------------------------------------------------+
| Smith Online  [Smith chart | S-Plot]   Design  f   Z0        undo redo    |
|                                                  Open Save Export Share   |
+------------------+---------------------------------------+---------------+
| ADD ELEMENT      |                                       | DATAPOINTS    |
| [L][C][R][L][C]  |                                       | # Z |Γ| ∠ VSWR|
| [R][RLC][RLC]    |            Smith chart                | 0 ...         |
| [Line][Stub][..] |            (SVG, zoom, pan)           | 1 ...         |
|                  |                                       |               |
| NETWORK          |   toolbar: Z grid, Y grid, fine, fit  | CIRCLES       |
| 0 Load  20-j12   |                                       | [x] Q 0.6     |
| 1 Shunt L 16 nH  |                                       | [x] VSWR 1.5  |
|   ----o------    |                                       | [ ] Stability |
| 2 Series C 21 pF |                                       | [ ] Noise     |
|   ------o----    |                                       | [ ] Gain      |
| ...              |                                       | SELECTED DP   |
+------------------+---------------------------------------+---------------+
| cursor: z = ... y = ... Γ = ...                 status                   |
+--------------------------------------------------------------------------+
```

### Left panel: build
- **Element palette**: 12 buttons with schematic icons. Click appends to the source side of the ladder; drag onto the chart is a later nicety.
- **Network list** (the "ladder"): one card per element with name, editable value with unit, delete, and a slider underneath (the tuning cockpit from the original, inline instead of a separate window). Slider range defaults to 0.2x to 5x of the value, log scale, adjustable. Cards can be reordered by drag.
- **Load card**: the starting impedance, entered as R + jX, |Γ|∠θ, or picked from an imported S-parameter file at the design frequency.

### Realize mode (optional, see `04-realization-features.md`)
- A "Realize" switch in the network panel header. When on, each ladder card shows a second value line: "E24: 16 nH (-0.2 %)" with a lock icon to keep an element exact, and the panel header gets the series selector (E6 to E96 or "my stock") and the scope selector (all, L, C, R, L-C pairs).
- The chart draws the realized locus dashed next to the ideal one; the datapoints table gets an ideal / realized toggle; a one-line summary under the table shows the realized VSWR and return loss at f0.
- A "Losses" switch next to it enables Q and ESR defaults with per-card override.
- "BOM" appears in the Export menu when Realize is on.

### Center: chart
- SVG with `viewBox` in Gamma coordinates (-1.15 to 1.15). Zoom with wheel, pan with drag on empty area, Fit button to reset; double-click a point asks for match suggestions towards it.
- Layers, bottom to top: background disc, Y grid, Z grid, labels, circles and contours, sweep locus, element arcs, datapoints, cursor crosshair. A datapoint sweep draws a marker per point but thins the SPn labels to at most 12 (first, last, the design point and evenly spread points, minus any label that would overlap another), and each marker carries a tooltip with its number, frequency and VSWR; see `chart/sweepLabels.ts`.
- Hover anywhere shows z, y and Gamma in the status bar. Hover a datapoint shows a tooltip with all its values.
- Dragging a datapoint re-solves the element that produced it (constrained to that element's arc), which is the original's "edit by dragging" behavior.
- Schematic view toggle: a horizontal ladder drawn under the chart for printing and export.

### Right panel: read
- **Datapoints table**: index, Z, Y (toggle), |Γ|, angle, VSWR, return loss, Q. Click selects and highlights on the chart. Export as CSV.
- **Circles and contours**: checkbox list with color swatch and parameters; inputs for VSWR value, Q value; stability, noise and gain circles enabled once a two-port file with the needed parameters is loaded.
- **Selected datapoint**: full detail.

### S-Plot view (second tab)
- Left: file list (loaded Touchstone, CITI, EZNEC files), frequency range, which traces to show.
- Center: up to four stacked uPlot graphs (magnitude dB, phase, k and mu, MAG and MSG) with shared cursor; or a Smith chart showing s11 and s22 loci.
- Right: cursor readout table at the selected frequency, conversion and export (Z, Y, H, ABCD, normalized or not), "send s11 to Smith chart" button.

## Responsive behavior
- Below 1000 px: chart on top, build panel and datapoints below; between 1250 and 1000 px the side panels narrow. The header wraps to two rows below about 1500 px.
- Touch: sliders and the datapoint drag handles get 32 px targets. Superseded by the control heights below: 44 px controls and 36 px small buttons on a coarse pointer.

## Visual language
- Neutral grays, one accent blue for interactive state, the datapoint path in a strong magenta, circles in distinct hues (green VSWR, orange Q, violet stability, gray noise and gain until configured). All colors are tokens, editable in settings.
- System font stack, monospace for numbers. No icon font; inline SVG for element symbols and for every icon button (`components/ui/icons.tsx`: undo, redo, settings, help, theme, lock, close, move, overflow, grip). The Unicode glyph buttons and the lock emoji are gone.

## Accessibility
- All controls reachable by keyboard; sliders are native range inputs; tables are real tables; chart elements get `aria-label` with the readout text.

## Out of scope for version 1
- Drag-and-drop from palette onto the chart.
- Multi-design tabs.
- Collaborative editing.

## Implemented layout (2026-10-23)

The header carries, in order: view tabs (Smith chart, Response, S-Plot), design name, f, Z0, source power, File menu (New, Open, Save, Export), Undo, Redo, Auto match, Optimize band, Tolerance, Examples, Settings, Share link, theme. The left panel holds the palette, the Realize and Losses switches, the ladder from DP1 to the target card. The right panel holds datapoints, the selected point, usable bandwidth, sweep, circles and the two-port device. `docs/06-user-guide.md` is the authoritative description of the behaviour.

## Tokens and controls (2026-10-24)

Phases 1 and 2 of `docs/07-interaction-redesign.md`. The tokens are CSS custom properties at the top of `packages/app/src/index.css`; the controls are components under `packages/app/src/components/ui/` with their classes at the end of the same file.

### Tokens

| Group | Tokens | Fine pointer, light | Dark or coarse pointer |
|---|---|---|---|
| Surfaces | `--canvas`, `--surface`, `--inset`, `--raised` | #f2f3f5, #ffffff, #f6f7f9, #ffffff | #0e1217, #161b22, #11161c, #1c232c |
| Borders | `--border-subtle`, `--border-strong` | #e6e9ed, #cfd5dc | #232c38, #36414f |
| Text | `--text-primary`, `--text-secondary`, `--text-tertiary` | #1b1f24, #5a6472, #8a94a1 | #e6edf3, #9aa7b5, #6b7786 |
| Accent | `--accent`, `--accent-hover`, `--accent-soft`, `--on-accent` | #0b6bcb, #0959a8, #e3f0fd, #ffffff | #58a6ff, #79b8ff, #15283d, #0b1220 |
| State | `--danger`, `--danger-soft`, `--warning`, `--success` | #c92a2a, #fdeaea, #e8590c, #2f9e44 | #ff6b6b, #3a1d1d, #ffa94d, #51cf66 |
| Focus | `--focus-ring` | the accent, 2 px ring 2 px off the control (`:focus-visible`) | same |
| Monte Carlo cloud | `--mc-cloud` | #ae3ec9 (grape), split from `--danger` and outside the element colours | #da77f2 |
| Chart (names fixed) | `--grid-z`, `--grid-y`, `--marker`, `--dp-user`, `--sweep`, `--vswr`, `--q`, `--stab`, `--gain`, `--noise` | unchanged; Settings writes and reads them by name | unchanged |
| Aliases | `--bg`, `--panel`, `--border`, `--text`, `--muted`, `--font`, `--mono` | `--canvas`, `--surface`, `--border-strong`, `--text-primary`, `--text-secondary`, `--font-ui`, `--font-mono` | kept until phase 7 |
| Type | `--font-ui`, `--font-mono`; `--type-caption` 11/14 500, `--type-small` 12/16, `--type-body` 13/18, `--type-emph` 13/18 600, `--type-title` 15/20 600, `--type-display` 20/24 600; `--type-mono-table` 11.5/16, `--type-mono-field` 12/16, `--type-mono-readout` 13/18 500, `--type-mono-big` 15/20 600; `--field-font-size` | as listed | field 16/20 on a coarse pointer, so iOS does not zoom on focus |
| Spacing | `--space-0` to `--space-8`: 2, 4, 8, 12, 16, 20, 24, 32, 40 px; `--gutter-phone` 16, `--gutter-panel` 12 | | |
| Control heights | `--control-h`, `--control-h-sm`, `--control-h-lg` | 28, 22, 36 px | 44, 36, 50 px under `(pointer: coarse)` |
| Radii | `--radius-xs` to `--radius-xl`, `--radius-full` | 4, 6, 8, 12, 16 px, 999 px | |
| Elevation | `--shadow-1` (segmented thumb), `--shadow-2` (menus, tool panels), `--shadow-3` (dialogs), `--backdrop` | backdrop rgba(0,0,0,.25) | backdrop .5 in dark |
| Motion | `--dur-fast` 120 ms, `--dur-base` 160 ms, `--dur-slow` 280 ms; `--ease-out`, `--ease-std` | | all durations 0 with `prefers-reduced-motion` |

Foundations: `font-variant-numeric: tabular-nums` on `.mono`, tables, readouts, the status bar and value inputs; `100dvh` everywhere the layout used `100vh`; `env(safe-area-inset-*)` on the top bar, the status bar and the narrow-layout tour panel; `viewport-fit=cover` and two `theme-color` metas in `index.html` (the theme toggle rewrites them when the theme is forced); no `outline: none` on fields; `touch-action: pan-y` on the chart under a coarse pointer until the chart gestures land (phase 5), with `pointercancel` ending a drag the browser takes over.

### Controls

- **Button** (`ui/Button.tsx`): `variant` primary, secondary (default), quiet, icon, destructive; `size="sm"` (the old `.btn.tiny` stays as an alias); `pressed` makes it a toggle with `aria-pressed`. `IconButton` takes an icon and a label, the label being the accessible name and the tooltip.
- **Field** (`ui/Field.tsx`): label, value and unit in one box. The input is `ValueInput` (engineering notation, Enter commits, Escape reverts, the invalid flash and `aria-invalid`); the unit sits after the number inside the box (`16.03 n` and `H`); `suffix` shows a unit for plain values (`dB/m`, `%`, `°`); the width follows `digits`. Enter commits and keeps the focus; only text the user typed is committed, so a tab through a field never changes the design; a refused entry also names the field and the reason in the status bar. Inputs carry `inputMode="text"` (the iOS decimal keypad has no minus sign and no letters, which engineering notation such as `-3n9` needs), `enterKeyHint="done"` and autocomplete, autocorrect and autocapitalize off.
- **Segmented** (`ui/Segmented.tsx`): role tablist, arrow keys, Home and End move the choice and the focus, one tab stop, a thumb that slides in 160 ms; `wrap` lets it take two rows. Used for the view tabs, Ideal or Realized, the Dimensions medium, the Response frequency axis and the Auto match methods on a fine pointer.
- **Switch** (`ui/Switch.tsx`): `<input type="checkbox" role="switch">`, 28 x 16 px on a fine pointer and 44 x 26 px on a coarse one, with a 44 px hit area. Used for the modes: Realize, Losses, the sweep, judge over the band (Tolerance), keep the design frequency (import) and datapoint input. Lists keep checkboxes (free parts, report options, circles, broadband options).
- **Slider** (`ui/Slider.tsx`): 4 px track, 16 px knob (28 px on a coarse pointer), as tall as a control, `touch-action: pan-y`. Every move is a transient change; one drag is one undo step, keyboard steps within 500 ms of each other are one step, and a second slider closes the first one's run before it starts. Realize mode draws a tick per series value.
- **Badge** (`ui/Badge.tsx`): element numbers and counts, neutral, accent, danger, success, warning or an element colour.
- **Icons** (`ui/icons.tsx`): inline SVG on a 16 unit grid in the current text colour.
- **Overflow menu** (`ui/OverflowMenu.tsx`): on a coarse pointer the small buttons of a ladder card become one button with Move up, Move down, Dimensions (lines and stubs), Winding (inductors) and Delete; Up, Down and Escape work, and the focus returns to the button.
- **Pointer kind** (`lib/pointer.ts`): `useCoarsePointer()` reads `(pointer: coarse)`; false where there is no window. On a coarse pointer the Auto match methods become a chooser row ("Method: Add parts") that opens the methods grouped as the guide groups them, each with a one-line description.
- **Help link**: the help icon after a heading, 16 px on a fine pointer and a 28 px hit area on a coarse one.

Component tests run in jsdom: `packages/app/test/ui-*.test.tsx` (Field, Segmented, Switch, Slider, the ladder card and the Auto match chooser).
