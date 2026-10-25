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
