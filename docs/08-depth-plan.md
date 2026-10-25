# Depth plan: from a Smith chart tool to a matching workbench

Status: plan, 2026-10-25. Follows the assessment of what a senior RF design engineer would do with this app that the owner did not ask for: deeper, not bigger. Every phase ends with a QA round (qa-validator, adversary, ui-expert) and its fixes, like the interaction redesign.

## Principles

- The measured load is the central object, not a single R + jX: a design is judged over the band, against data.
- Results are proven by something other than the authors: physics invariants, an independent simulator, published answers, and in the end a built board on a VNA.
- Real parts and the real board belong in the network: part numbers with measured behaviour, pads, vias and the traces between parts.
- Depth before breadth: each phase deepens what exists (the load, the realization, the optimizer, the broadband search) rather than adding a new view.

## Phases

### D1. Verification foundation

Proves the core right before anything is built on it.

- Physics invariants as property tests over random networks of every element kind: reciprocity (S12 = S21), lossless networks keep S†S = I, passive networks keep |S11| ≤ 1 and the eigenvalues of I - S†S non-negative, ABCD determinant 1 for reciprocal two-ports, cascading in either grouping gives the same result, conversions S, Z, Y, H, ABCD round trip.
- Published answers as golden tests, each with its source in the test: worked examples from Pozar (Microwave Engineering), HP AN 95-1 (in `original/`), Bowick (RF Circuit Design), the Bode-Fano example in Pozar, and the numbers printed in `original/Examples V4.1.pdf` for the 22 example projects.
- An independent simulator as an oracle in CI: a GitHub Actions job installs Python with scikit-rf and ngspice, a node script exports a set of reference networks (every element kind, lossy and lossless, lines and stubs, realized and packaged) with the app's computed S-parameters, and a Python script recomputes them with scikit-rf and with ngspice from the app's own SPICE export, failing above 1e-9 relative error (1e-6 for ngspice). Locally the invariant and golden tests run in Vitest; the oracle runs in CI only, because no Python is installed here.
- Done means: invariants hold on 10 000 random networks; every golden case matches its source to the printed precision; the oracle job is green in CI.

Status, 2026-10-25: implemented, the oracle green in CI since run 40178095887; the QA round's fixes are in (below).

- Invariants: `packages/core/test/invariants.test.ts`, 10 000 seeded random networks (6 000 ladders, 2 000 lossless; 2 000 conversion round trips; 2 000 closed-form matches) plus eight broadband searches against the exact Bode-Fano floor of single-reactance loads. They found one defect: `ladderSParameters` took S12 as 2 det(ABCD) / Delta, and the determinant of a ladder with a very lossy line is the difference of two products that grow as exp(2 alpha l), so beyond about 160 dB of line loss S12 had no correct digit (in a cascade it came out above 1, breaking passivity). S12 is now S21, exact for every ladder; a regression test keeps it. The Bode-Fano comparison is on the dense grid every broadband result is now scored on (see the QA round), not on the 21 band points.
- Golden cases: `packages/core/test/golden.test.ts`, 26 cases with their sources (Pozar 4th ed. chapter 5 and tables 8.3, 8.4; Matthaei, Young and Jones; HP AN 95-1; Smith V4.1 Examples 5, 6, 12 to 14, 16 to 18; Bowick's procedures). Values a book computed from a rounded intermediate are checked against that intermediate and say so. Left out because they cannot be reproduced to the printed precision: the ADS simulation results printed for Example 13 (ADS uses its own device and part models; the app's cascade gives S21 12.009 dB against 12.005, S22 impedance 49.65 + j1.29 against 49.22 + j1.31 ohm, NF 3.8526 against 3.852 dB), Pozar's Chebyshev Gamma_0, Gamma_1, Z1 and Z3 (rounded sec theta_m; Z1, Z3 not confirmed), and every number of the Examples PDF that exists only in its screenshots (the text layer has no images and drops the plus and minus glyphs).
- Oracle: `tools/oracle/export.mjs` (27 reference networks, 23 with a netlist, four of them through the app's own export code), `tools/oracle/check.py` (scikit-rf 1e-9, the `.s2p` text round trip 1e-8, ngspice 1e-6, `--self-test`), CI job `oracle` with the report as an artifact, Python packages pinned to the green run (scikit-rf 2.2.0, numpy 2.5.4). The JSON semantics were checked locally against a JavaScript port of `check.py`'s element models (agreement 1e-15, the round trip 8e-10) and every netlist against the repository's nodal solver (1e-9, the open stubs' 1 Tohm far end); the Python could not be run locally (no Python installed). What the oracle checks independently (scikit-rf cascading, renormalization and S conversion; ngspice's nodal solution) and what it shares with the app (the element formulas: Q, ESR, Cp, ESL, pads, the lossy line's attenuation scaling, the transformer closed form) is listed in `tools/oracle/README.md`.
- QA round (qa-validator, adversary): broadband results were scored at the band points only (as few as 5), so with many parts the optimizer fitted the points and the response swung between them (reported 3.67, true worst 992). Every candidate is now scored on a dense grid inside the band (at least max(201, 25 per part) points, the band points included, the same load model as the search); the search itself uses at least 4 points per part plus 1, and the panel's band at least as many. A result below Fano's exact floor of a single-reactance load is never listed. The Bode-Fano floor is not shown for fewer than 9 band points (the panel says why: a five-point slope window could put it above the physical bound), and where the load is a single reactance with a resistance (series RL or RC, parallel RC or RL) it is Fano's exact bound with the band edges, labelled exact; elsewhere the Yaghjian-Best estimate, labelled as an estimate (it can be off either way for low-Q loads). D2's floor from the fitted load model supersedes both. K, mu and mu prime within 1e-9 of 1 are 1, so a lossless network reads MAG = MSG = 0 dB without the unstable style (the S-Plot network entry keeps 15 digits, the download 9). S12 from an ABCD matrix is S21 when the determinant is 1 within its rounding (`abcdMatrixToS`, `abcdToS`), and `ladderSParameters` refuses an element kind not marked reciprocal. Golden: Example 14's part values to 3 digits, Example 16 renamed (the PDF names no series), Pozar 5.6's bandwidth annotated (the ln approximation for A; exact A gives 0.713).

### D2. Measured load first

- Vector fitting (Gustavsen and Semlyen, with relaxation) turns a measured S11 or impedance set into a rational model with passivity enforcement; the app uses it for honest interpolation between frequency points (replacing linear interpolation in `interpolatedLoad`) and flags extrapolation outside the measured band.
- A measured load (from Touchstone, CITI, VNA CSV) becomes a first-class load: the design frequency picks the nominal point, the whole band drives Auto match Broadband, Optimize band, usable bandwidth, Monte Carlo over the band and the Response view, with the fitted model's residual shown.
- The Bode-Fano floor computed from the fitted model, not only from a finite-difference Q.
- Done means: fitting recovers a known rational load to 1e-9, a noisy measurement to its noise floor, passivity holds after enforcement, and every band tool uses the fitted load.

### D3. Sensitivity and yield

- Per-part sensitivity of the worst-case VSWR over the band (analytic derivatives through the ABCD cascade, checked against finite differences), shown on each ladder card and as a ranking: which part dominates the error.
- Tolerance analysis with correlated parts (parts from one reel drift together; a correlation setting per kind), worst-case corners, and design centring: move the nominal values to maximize yield within tolerances.
- Auto match ranks solutions by sensitivity and yield as well as by Q, and says why.
- Done means: derivatives agree with finite differences to 1e-6, design centring raises yield on reference cases, and the ranking is explained in the UI.

### D4. The board in the network

- Stackup: εr and loss tangent over frequency (Djordjevic-Sarkar wideband model), copper thickness and roughness (Hammerstad or Groiss), entered once in Settings with presets for common FR-4 and Rogers laminates.
- Microstrip with dispersion (Kirschning-Jansen) and conductor and dielectric loss: `line.ts` uses the static Hammerstad-Jensen model today (no dispersion, no loss), which is fine for dimensions at low frequency and drifts at microwave frequencies.
- Board parasitics: pad capacitance per package and stackup, via inductance for every shunt part to ground (a via model from diameter and board thickness), and the interconnect traces between parts as microstrip segments with lengths.
- The as-built locus includes the board; the BOM and the report list the layout assumptions.
- Done means: models match published values (Kirschning-Jansen tables, via inductance formulas) and the oracle job covers the board elements.

### D5. Real parts

- First a licence check: Murata, Coilcraft, Johanson, Kemet and TDK publish measured S-parameter files per part number; their terms decide whether the app may bundle them or only load files the user downloads. Record the result in this document before building.
- A part library loaded from those files (bundled where allowed, user-loaded otherwise): a part number becomes a two-port from its measured data in the ladder, Realize snaps to the nearest available part in the library, and the BOM lists manufacturer part numbers.
- Done means: a ladder of library parts evaluates from their files, the oracle job checks a cascade of measured parts, and the BOM carries part numbers.

### D6. Closed loop: measure, compare, retune

- Import the measured S11 of the built board, overlay it on the designed response, and fit which parts and parasitics moved (least squares over part values and the board parameters of D4, with the sensitivities of D3 to keep it well conditioned).
- Suggest retune values snapped to the series or the library, and show the expected result.
- Done means: on synthetic data with known drifts the fit recovers them, and the suggestion brings the simulated result back inside the target.

### D7. Broadband matching from data

- The real frequency technique (Carlin, and the simplified form of Yarman and Carlin) computes the best achievable transducer gain shape for the measured load over the band and realizes it as a ladder, compared side by side with the topology search and the Bode-Fano floor.
- Done means: on textbook loads the result matches published RFT examples, and on reference loads it meets or beats the topology search for the same part count.

## Validation outside the code

- A built board: design a match for a real load, build it with real 0402 parts, measure it on a VNA (a NanoVNA is enough for a first check), and compare measured with predicted S11 in the app (D6 makes this a feature). This needs the owner's hardware and is the only check of the whole chain.
- RF engineers who did not build the app, using it on their own loads.

## Order and size

D1 first, because everything else rests on it. Then D2 and D3, which deepen the existing band tools. D4 and D5 bring the board and the parts in. D6 closes the loop and needs D3 to D5. D7 is the largest algorithmic step and comes last. Each phase is a release.
