# Oracle: an independent check of the network evaluation

Phase D1 of `docs/08-depth-plan.md`. Two programs that did not come from this repository recompute the networks the app evaluates:

- **scikit-rf** rebuilds every reference ladder from its element values with its own media and `Network` primitives (series and shunt impedances, transmission lines and stubs with the same characteristic impedance and propagation, cascading, renormalization) and compares the S-parameters with the app's. A relative error above 1e-9 fails; a case may carry its own `tolerance` (the `.s2p` text round trip is compared at its 9 significant digits, 1e-8).
- **ngspice** runs the SPICE netlist the app writes for each network (`.ac` analysis, batch mode); the input impedance comes from the node voltages and is compared with the app's. A relative error above 1e-6 fails.

Green in CI since run 40178095887 (scikit-rf 2.2.0, numpy 2.5.4, ngspice 42, Python 3.12). The workflow pins those Python packages.

## What is independent, and what is not

Independent of the app's code:

- scikit-rf's cascading of two-ports, its renormalization of a line of another characteristic impedance to the port impedance, its conversion to S-parameters, and its line and stub networks (open and short terminations included);
- ngspice's nodal solution of the netlist the app wrote.

Copied from the app's element formulas in `check.py`, so an error in one of them would be repeated by the oracle, not caught:

- the branch impedance of each lumped part: the loss resistor from Q, a package's ESR and Cp on an inductor and ESL on a capacitor, the pad capacitance split half to each end of a series part;
- the RLC block formulas (series and parallel connection);
- the lossy line's attenuation scaling: alpha in dB/m at the reference frequency, times sqrt(f / fref), over the physical length from er;
- the ideal transformer, whose S-parameters come from its closed-form ABCD matrix (scikit-rf's renormalized thru uses a different reference convention).

Those formulas are textbook expressions, pinned to closed forms in `packages/core/test/qa-d1-model-pins.test.ts`; the oracle checks everything built on top of them.

## Fitted loads (phase D2)

`export.mjs` also writes four measured loads the app fitted (`fits`): the input impedance of a ladder of L and C on a resistor, sampled at 41 or 201 frequencies (two cases with noise of 1e-3 in Γ), fitted by core's `interpolatedLoad`. One of them is a lossless series LC (on a short), whose noise puts the raw fit above |Γ| = 1, so the app's passivity enforcement has to act (the exporter refuses the case if it did not). Each case carries the element values, the data, the fitted poles, residues, d and e, the residuals the app reports, the app's model on 1001 points (as Γ and as the impedance the band tools read) and, for the series RL load, the app's Bode-Fano floor. `check.py` then:

- recomputes the true load from the element values with scikit-rf (independent of the app);
- evaluates the rational model from the poles and residues with numpy (independent of the app's evaluator) and compares it with the app's evaluation (1e-9);
- compares the model and the impedance the band tools read with the truth (1e-8 for clean data, 1e-3 for the noisy cases);
- recomputes the RMS and largest residual against the data (1e-6 relative);
- checks every pole in the left half plane and |Γ| ≤ 1 + 1e-9 on 20 001 points from 0.9 times the lowest to 1.1 times the highest frequency, and for a case whose raw fit was not passive that the app reports the enforcement (perturbation or scaling);
- compares the series RL floor with Fano's closed form, π R / (L (w2 - w1)) (1 percent).

What it shares with the app: the data the fit starts from is the app's own ladder evaluation (the truth it is compared against is not). It does not fit the data itself: the oracle checks the app's model, not another fitter's.

## Sensitivity and yield (phase D3)

`export.mjs` writes a `d3` section and `d3_check.py` (numpy, called by `check.py`) checks it:

- **Derivatives**: three ladders (lumped parts with Q and package parasitics; RLC blocks in both connections and orientations; a lossy line, open and shorted stubs and a transformer), 23 parameters at three frequencies, with the app's analytic dΓ/dp of the input reflection coefficient. `check.py` recomputes Γ of the scikit-rf ladder with each parameter moved by ±1e-5 of its value and compares the central difference with the app's derivative (1e-6 relative). Independent: the difference and scikit-rf's cascade; shared: the element formulas (above).
- **Yield**: an L match of 100 - j50 Ω to 50 Ω with 5 % uniform parts, judged at f0 (VSWR 1.02) and over 900 MHz to 1.1 GHz (VSWR 1.26), with the app's pass count of 20 000 Monte Carlo runs. numpy integrates the yield by brute force over the tolerance box (801 x 801 midpoints, its own ABCD cascade of the ideal parts); the app's estimate must lie within 4 standard errors plus the grid resolution.
- **Worst corner and worst case**: the app's worst corner against numpy's evaluation of all four corners (1e-9), and its worst case (the largest of the nominal network and the corners; for these monotonic networks the corner) against the largest VSWR on the grid (not beaten).
- **Spread shares**: over the band, the app's shares of the variance of the smooth band VSWR (the power mean of order 32 over f0 and the band, from its analytic derivative) against numpy's: central differences of the same power mean of its own cascade (relative step 1e-6), b_i = dS/dp_i p_i, shares b_i^2 / sum b^2 (1e-6). Independent: the cascade and the difference; shared: the definition of the ranked quantity.
- **Wilson interval**: five pass counts against the closed form (1e-12).
- **Correlated draws**: 10 000 draws per distribution (uniform, normal) of two L, two C and one R with correlations 0.7 (L) and 0.3 (C): the sample correlations within 4 standard errors of the asked ones, the other pairs near 0, the marginal variance 1/3 or 1/9 within 0.01, uniform draws inside [-1, 1].

The numpy checks were run locally against the exported cases (the derivatives with a numpy port of `check.py`'s element models); the scikit-rf derivative check runs in CI.

## The board in the network (phase D4)

`export.mjs` writes three more ladders and a `d4` section; `check.py` and `d4_check.py` check them:

- **Ladders**: microstrip elements on two stackups between lumped parts (25 frequencies from 0.2 to 2.5 times f0); a packaged ladder with the board through core's `withBoard` (pads from the land size and the stackup, two vias under every shunt part, 2.5 mm traces of the 50 ohm width); and Realize, packages and the board through the app's `builtNetwork`. `check.py` rebuilds each microstrip and each trace from scikit-rf's own `MLine` and puts the via in series with the shunt branch; compared at 1e-9 like every ladder. No netlist: the SPICE export writes a microstrip as an ideal line and leaves the board out.
- **Microstrips**: Z0 (complex), eeff (complex), alpha_c, alpha_d and beta of 20 microstrips (the four presets at W/h 0.25, 1, 2 and 6; FR-4 without copper thickness, with a lossless dielectric and with smooth copper; alumina) at 15 frequencies from 1 MHz to 40 GHz, against `MLine` with model='hammerstadjensen', disp='kirschningjansen', diel='djordjevicsvensson' and no compatibility mode (1e-9).
- **Vias**: 12 Goldfarb-Pucel inductances recomputed with numpy (1e-12).
- **Lands**: 16 land capacitances, C'(W) L + C'(L) W - eps0 er W L / h with C' = sqrt(eeff) / (c Z0) from scikit-rf's static solution (MLine at 1 Hz, lossless), and for a land whose equal-area side is below h the larger of that and the isolated-disc estimate with the ground image, recomputed with numpy (1e-9).

What this shows: the app's microstrip model (`packages/core/src/line.ts`) is a line-by-line port of scikit-rf 2.2.0's `skrf/media/mline.py`, so the agreement of the microstrips and of the ladders' line sections shows that the port is faithful, not that the formulas are right. Independent of the app's own code: scikit-rf's arithmetic, its line networks and its cascading. Shared with the app: the formulas themselves and their transcription (Hammerstad-Jensen, Kirschning-Jansen, Jansen-Kirschning at the thickness-corrected width, Djordjevic-Svensson, the losses), the via formula, the way a land's capacitance is composed, and how the board parasitics attach to the parts (via in series with a shunt branch, trace on the load side of the part). The checks of the model that do not go through scikit-rf's code are the review of each formula against its published form and Keysight ADS's MLIN data in `packages/core/test/qa-d4-ads.test.ts` (within 0.014 dB and 0.26 degrees in S21, 0.56 dB and 2.0 degrees in S11, 0.2 to 20 GHz).

Run locally for this phase (Python 3.12, scikit-rf 2.2.0, numpy 2.5.4; no ngspice): the three ladders 1.6e-12, 3.7e-13 and 2.8e-13, the microstrips at worst 1.0e-10, the lands 4.6e-13, the vias 8e-16.

## Real parts (phase D5)

`d5_check.py`, run by `check.py`, checks library parts: parts read from two-port S-parameter files and placed in the ladder (`packages/core/src/parts.ts`). The files are the synthetic examples in `packages/core/test/fixtures/parts` (`SYNTH-*.s2p`, made from equivalent circuits by `scripts/synth-parts.mjs`; the repository holds no manufacturer data, see `docs/08-depth-plan.md`, D5). `export.mjs` reads them with the app's readers and writes a `d5` section: four cascades (series and shunt parts in and across the fixture they were measured in, at the files' own frequencies and between them; shunt parts with a via; an L match realized from the library), the nominal value and self-resonance the app extracts per file, and a frequency outside the data where the app must give no value. `d5_check.py` reads the same files with scikit-rf's Touchstone reader, interpolates them with `Network.interpolate` (linear, cartesian), takes the chain matrix with `s2a` (the part impedance is B for a series-through file and 1 / C for a shunt-through file), rebuilds each cascade from scikit-rf networks (the measured network for a series part from a series-through file, `media.resistor` and `media.shunt` with the via in series otherwise) and compares S and the terminated input reflection (1e-9). The self-resonance is found by bisection on a numpy interpolation of the file (1e-9 against the app) and compared with the generating circuit's (5e-4).

Independent: the Touchstone reading, the interpolation, the S to ABCD conversion and the cascading. Shared with the app: which placement uses the measured two-port and which the derived impedance, and the averaging of S12 and S21 (a passive part is reciprocal; measured data differs by noise).

Run locally for this phase (Python 3.12, scikit-rf 2.2.0, numpy 2.5.4; no ngspice): the four cascades 1.3e-15 to 1.9e-15 in S and Gamma_in, the nominal values 4e-16, the self-resonances 3e-14 to 3e-13 against the bisection and 1.0e-4 to 1.4e-4 against the circuits; every earlier scikit-rf, D3 and D4 check still passes (only the ngspice comparisons failed, ngspice is not installed here).

## Measure, compare, retune (phase D6)

`d6_check.py`, run by `check.py`, checks the closed loop of `packages/core/src/closedloop.ts` on the synthetic measurement `packages/core/test/fixtures/sparams/board-1g-synthetic.s1p` (written by `scripts/synth-board.mjs`: the buildable board with +8 % on the shunt L, +0.3 pF on the pads of the series C and noise 0.001 in Gamma). `export.mjs` fits the file with the app's code, suggests the E24 retune for VSWR 1.38 over 900 MHz to 1.1 GHz, and writes a `d6` section: the network as built (packages and board resolved) with no drift, with the fitted drifts, and with the retune under the fitted and under the true drifts, the app's Gamma for each, its residual, its drifts with their uncertainties and its predicted worst VSWR. `d6_check.py` reads the file with scikit-rf's Touchstone reader, rebuilds every network with `check.py`'s ladder builder (1e-9), recomputes the fit residual from the scikit-rf model and the file (relative 1e-6) and checks that it sits at the noise floor (0.7 to 1.3 times 0.001 sqrt 2), refits the parameters the app fitted with `scipy.optimize.least_squares` (trf, bounded so no pad goes below zero and no value below 5 %, the region where the model is flat) on the scikit-rf model from no drift and asks agreement within 1e-3 of each prior width, checks the fitted drifts within three of their sigma of the truth and the via not resolved, and checks the retune's worst VSWR inside the limit under the fitted and the true drifts and equal to the app's prediction (1e-9).

Independent: the Touchstone reading, the cascade and its reflection, the least squares solver. Shared with the app: the element models (`check.py`'s port), how a drift is applied (a value scaled by 1 + x, a pad capacitance added, a via scaled) and the snapped candidates (E24 from the app).

Run locally for this phase (Python 3.12, scikit-rf 2.2.0, numpy 2.5.4, scipy 1.18.1; no ngspice): the networks 1.0e-15 to 1.2e-15 in Gamma_in, the residual 0.00132 (relative 1.6e-14 against the app) against the floor 0.00141, the scipy refit 6.4e-9 of the prior width from the app's drifts, value:0 0.0802 +- 0.0005 and pad:1 0.298 pF +- 0.0011 pF against the truth 0.08 and 0.3 pF, the retune 1.36206 (fitted drifts) and 1.36175 (true drifts) inside 1.38, the prediction to 1.6e-16.

## Files

| File         | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `export.mjs` | Writes `oracle-cases.json`: 30 reference networks (every element kind, lossless and lossy, lines and stubs, a line on a substrate, microstrip elements, synthesized, realized with and without Q, packaged and board ladders, Smith V4.1 example projects), 13 to 30 frequencies each, with the app's S-parameters, input impedance and SPICE netlist. Five "app path" cases go through the app's own export code (loaded with Vite's module runner): the default-Q loss model, Realize and packages together, Realize to a target with a locked part, Realize with packages and the board, and the `.s2p` text the user downloads read back with the Touchstone reader. Also the fitted loads (D2), the D3, D4 and D5 sections and the D6 closed loop (it imports `scripts/synth-board.mjs`). |
| `check.py`   | Reads the cases, recomputes them with scikit-rf and ngspice, checks the fitted loads, the D3 cases (`d3_check.py`), the D4 cases (`d4_check.py`), the D5 part cascades (`d5_check.py`) and the D6 closed loop (`d6_check.py`), prints a report and writes it to `oracle-report.txt`. Exit status 1 on any mismatch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## What the SPICE comparison compares

The netlist states two approximations of its own (see `packages/core/src/io/spice-model.ts`): the load is a series R with an L or C valued at the design frequency, and a part's Q becomes a fixed loss resistor valued at the design frequency. The reference impedance for ngspice is therefore the app's ladder evaluation of the network as netlisted. It equals the design's own input impedance at the design frequency, which `export.mjs` checks before writing. Three kinds of case carry no netlist: an ideal transformer (not written), a lossy line (the ideal `T` element has no attenuation) and a line without a reference frequency (a fixed electrical length is not a delay). Package parasitics are not in the SPICE export by design, so a packaged case compares its netlist with the ladder without them.

`check.py` adds three lines to each netlist before running it: `.options rshunt=1e12` (1 Tohm from every node to ground, so a node that only capacitors reach still has a DC operating point; its effect on the input impedance is below 1e-8) and a `.control` block that runs the analysis and writes the input node voltage to an ASCII rawfile. The circuit lines are the app's, unchanged.

## Running it locally

It runs in CI (job `oracle` in `.github/workflows/ci.yml`). On a machine with Python 3.10 or later and ngspice:

```sh
pip install scikit-rf==2.2.0 numpy==2.5.4   # a virtual environment is a good idea
# ngspice: apt install ngspice, brew install ngspice, or the Windows build from ngspice.sourceforge.io
pnpm install
pnpm --filter @smithonline/core build
python tools/oracle/check.py --self-test
node tools/oracle/export.mjs oracle-cases.json
python tools/oracle/check.py oracle-cases.json --report oracle-report.txt
```

`--self-test` checks the harness on cases with closed-form answers (a series resistor through scikit-rf and ngspice, a shunt resistor behind a matched line, an ideal transformer, an open stub, a case with its own tolerance, the rational model evaluator, a fit case's true load and the passivity check on an active and a passive model), so a broken installation shows up before the real comparison.

## When it fails

A failure is a finding about the app or about the harness, never a tolerance to widen. The report names the case and the error; `oracle-cases.json` (uploaded with the report as a CI artifact) holds the exact element values and the app's numbers to reproduce it.
