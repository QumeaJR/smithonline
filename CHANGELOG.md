# Changelog

All notable changes to Smith Online. Versions follow semantic versioning; before 1.0 a minor version may change behaviour.

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
