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
- **Worst corner**: the app's worst corner against numpy's evaluation of all four corners (1e-9) and against the largest VSWR on the grid (not beaten).
- **Wilson interval**: five pass counts against the closed form (1e-12).
- **Correlated draws**: 10 000 draws per distribution (uniform, normal) of two L, two C and one R with correlations 0.7 (L) and 0.3 (C): the sample correlations within 4 standard errors of the asked ones, the other pairs near 0, the marginal variance 1/3 or 1/9 within 0.01, uniform draws inside [-1, 1].

The numpy checks were run locally against the exported cases (the derivatives with a numpy port of `check.py`'s element models); the scikit-rf derivative check runs in CI.

## Files

| File         | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `export.mjs` | Writes `oracle-cases.json`: 27 reference networks (every element kind, lossless and lossy, lines and stubs, a line on a substrate, synthesized, realized with and without Q and packaged ladders, Smith V4.1 example projects), 13 to 30 frequencies each, with the app's S-parameters, input impedance and SPICE netlist. Four "app path" cases go through the app's own export code (loaded with Vite's module runner): the default-Q loss model, Realize and packages together, Realize to a target with a locked part, and the `.s2p` text the user downloads read back with the Touchstone reader. |
| `check.py`   | Reads the cases, recomputes them with scikit-rf and ngspice, checks the fitted loads and the D3 cases (above), prints a report and writes it to `oracle-report.txt`. Exit status 1 on any mismatch.                                                                                                                                                                                                                                                                                                                                                                                                     |

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
