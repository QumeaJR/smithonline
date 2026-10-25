# Oracle: an independent check of the network evaluation

Phase D1 of `docs/08-depth-plan.md`. Two programs that did not come from this repository recompute the networks the app evaluates:

- **scikit-rf** rebuilds every reference ladder from its element values with its own media and `Network` primitives (series and shunt impedances, transmission lines with the same characteristic impedance, length and loss, an ideal transformer as a renormalized thru) and compares the S-parameters with the app's. A relative error above 1e-9 fails.
- **ngspice** runs the SPICE netlist the app writes for each network (`.ac` analysis, batch mode); the input impedance comes from the node voltages and is compared with the app's. A relative error above 1e-6 fails.

## Files

| File         | What it does                                                                                                                                                                                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `export.mjs` | Writes `oracle-cases.json`: 21 reference networks (every element kind, lossless and lossy, lines and stubs, synthesized, realized and packaged ladders, Smith V4.1 example projects), 13 to 30 frequencies each, with the app's S-parameters, input impedance and SPICE netlist. |
| `check.py`   | Reads the cases, recomputes them with scikit-rf and ngspice, prints a report and writes it to `oracle-report.txt`. Exit status 1 on any mismatch.                                                                                                                                |

## What the SPICE comparison compares

The netlist states two approximations of its own (see `packages/core/src/io/spice-model.ts`): the load is a series R with an L or C valued at the design frequency, and a part's Q becomes a fixed loss resistor valued at the design frequency. The reference impedance for ngspice is therefore the app's ladder evaluation of the network as netlisted. It equals the design's own input impedance at the design frequency, which `export.mjs` checks before writing. Three kinds of case carry no netlist: an ideal transformer (not written), a lossy line (the ideal `T` element has no attenuation) and a line without a reference frequency (a fixed electrical length is not a delay). Package parasitics are not in the SPICE export by design, so the packaged case compares its netlist with the ladder without them.

`check.py` adds three lines to each netlist before running it: `.options rshunt=1e12` (1 Tohm from every node to ground, so a node that only capacitors reach still has a DC operating point; its effect on the input impedance is below 1e-8) and a `.control` block that runs the analysis and writes the input node voltage to an ASCII rawfile. The circuit lines are the app's, unchanged.

## Running it locally

It runs in CI (job `oracle` in `.github/workflows/ci.yml`). On a machine with Python 3.10 or later and ngspice:

```sh
pip install scikit-rf numpy        # a virtual environment is a good idea
# ngspice: apt install ngspice, brew install ngspice, or the Windows build from ngspice.sourceforge.io
pnpm --filter @smithonline/core build
python tools/oracle/check.py --self-test
node tools/oracle/export.mjs oracle-cases.json
python tools/oracle/check.py oracle-cases.json --report oracle-report.txt
```

`--self-test` checks the harness on cases with closed-form answers (a series resistor through scikit-rf and ngspice, a shunt resistor behind a matched line, an ideal transformer, an open stub), so a broken installation shows up before the real comparison.

## When it fails

A failure is a finding about the app or about the harness, never a tolerance to widen. The report names the case and the error; `oracle-cases.json` (uploaded with the report as a CI artifact) holds the exact element values and the app's numbers to reproduce it.
