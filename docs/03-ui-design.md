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
- Layers, bottom to top: background disc, Y grid, Z grid, labels, circles and contours, sweep locus, element arcs, datapoints, cursor crosshair.
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
- Touch: sliders and the datapoint drag handles get 32 px targets.

## Visual language
- Neutral grays, one accent blue for interactive state, the datapoint path in a strong magenta, circles in distinct hues (green VSWR, orange Q, violet stability, gray noise and gain until configured). All colors are tokens, editable in settings.
- System font stack, monospace for numbers. No icon font; inline SVG for element symbols, a few Unicode glyphs for header buttons (settings, theme, lock).

## Accessibility
- All controls reachable by keyboard; sliders are native range inputs; tables are real tables; chart elements get `aria-label` with the readout text.

## Out of scope for version 1
- Drag-and-drop from palette onto the chart.
- Multi-design tabs.
- Collaborative editing.

## Implemented layout (2026-10-23)

The header carries, in order: view tabs (Smith chart, Response, S-Plot), design name, f, Z0, source power, File menu (New, Open, Save, Export), Undo, Redo, Auto match, Optimize band, Tolerance, Examples, Settings, Share link, theme. The left panel holds the palette, the Realize and Losses switches, the ladder from DP1 to the target card. The right panel holds datapoints, the selected point, usable bandwidth, sweep, circles and the two-port device. `docs/06-user-guide.md` is the authoritative description of the behaviour.
