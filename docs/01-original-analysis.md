# Analysis of the original "Smith V4.1"

Source material: the `original/` folder (installer, example projects, AN 95-1, paper chart, intro slides, and since 2026-10-14 also the help printout, examples PDF, what's new, known issues and readme downloaded from the author's page http://www.fritz.dellsperger.net/smith.html).

## 1. What the original is

| Item | Finding |
|---|---|
| Author | Prof. Fritz Dellsperger with Dipl. Ing. Michel Baud, Bern University of Applied Sciences. First version 1995, complete redesign V3.0 in 2009, last release V4.1.0.0 in January 2018. Former team members are listed in the help. |
| Platform | Windows, .NET Framework 4.6.1, WinForms with DevComponents DotNetBar. Files installed: `Smith V4.1.exe`, `DevComponents.DotNetBar2.dll`, `Help V4.1.chm`, manifest and config. Layout saved to `%AppData%\Smith V4\layout.xml`. |
| Installer | QSetup Installation Suite package with 7z payload. No source code anywhere. |
| Licensing | Demo mode without `smith.key`: max 5 datapoints and 5 elements, no save project, no save netlist. Full license USD 120, USD 80 for students, universities and hams. Author retired, contact address was fritz@dellsperger.net. |

**Legal position of a rebuild (assumption, not legal advice):** the Smith chart, the matching math and the S-parameter relations are textbook material (the help itself cites Gonzalez, Vendelin, Medley, Edwards and Sinsky). The feature list and the project file format are facts needed for interoperability. The binary, help text, icons and screenshots are copyrighted. Therefore: clean-room reimplementation, no decompiling, no copying of help text or graphics. Credit the original author and team in the README and about page. Name the project so it is clearly an independent rebuild.

## 2. Feature inventory (help printout V4.1)

### 2.1 Smith chart mode
- **Datapoints**: input by mouse click on the chart (with frequency prompt), by keyboard as impedance, admittance or reflection coefficient in cartesian or polar form, or imported from Touchstone, CITI or EZNEC files (multi-select rows, s11 or s22). Labels: `DPn` user datapoints (1-based), `TPm` transformed datapoints (numbered after the last DP), `SPp` sweep points. With several datapoints the user selects the one the network starts from.
- **Elements**, twelve in total. Series: capacitor, inductor, resistor, physical transmission line, transformer, R-L-C parallel-connected. Parallel (shunt): capacitor, inductor, resistor, open stub, shorted stub, R-L-C series-connected. All ideal (Q infinite) except the line, which has attenuation. Zero values are not allowed (use 1e-6).
- **Insertion**: pick element, move the cursor along the drawn locus (constant r or g circle) and click to fix the value. RLC elements and lossy lines are entered in a dialog instead. Right click undoes.
- **Edit**: double click an element in the schematic, change values, "Draw" recalculates.
- **Tuning cockpit**: add elements from the schematic, each gets a slider from 80 to 120 percent of its start value, "Reset Min/Max" recenters. Works during an active sweep.
- **Sweeps**: frequency sweep (start, stop, number of points) of the network input impedance, or datapoint sweep (network applied to every user datapoint, each at its own frequency). Sweep points are drawn and listed; editing an element re-sweeps.
- **Circles**: Q contours and VSWR circles (not listed in the circles window), gain circles (available power gain, operating power gain, unilateral; needs S-parameters typed or from file; gain must be below Gmax), stability circles (input and output plane, lists stable inside or outside and K), noise figure circles (NFmin, Gamma_opt, rn normalized or not). A frequency is attached to a circle only if its parameters came from a file. Visible and highlight checkboxes, delete per row.
- **Zoom** in, out, 1:1, always centered on the chart center.
- **Undo and redo** for elements, datapoints and sweeps only.
- **Settings**: line widths and colors, Z0, default datapoint frequency, labels, Z plane and Y plane on or off, schematic horizontal or vertical, default start mode.
- **Windows**: chart, schematic, datapoints, circles, cursor (RL, VSWR, Q, Gamma, Y, Z, Z0, frequency), all dockable.
- **Print** chart, schematic, datapoints, circles. **Copy to clipboard** per window.
- **Save netlist** in Touchstone CKT format (section 4). **Export data** as delimited ASCII (section 5).
- **Shortcuts**: Ctrl+N, O, S, Z, Y, M (toggle mode), T (circles), E (settings), 1, 2, 3 (zoom), F1.

### 2.2 S-Plot mode
- Load Touchstone (.s1p, .s2p), CITI (.citi, .cti), EZNEC (.txt).
- s11 and s22 on a Smith chart, s12 and s21 on a polar plot.
- Gain table: MAG (dB), MSG (dB), K, mu, s12 (dB) per frequency; selecting a row highlights the point in all graphs.
- Gain graph (MAG for K > 1, MSG for K < 1, K, mu), return loss graph (s11, s22 in dB), linear or log frequency axis, cursor readout.
- Export: s-parameters converted to H, Z, Y or A (ABCD), normalized or unnormalized, as Touchstone files; CITI to Touchstone; s11 or s22 rows to the Smith chart.
- Print and clipboard per window.

### 2.3 Not in the original, worth adding
- Sharing a design by URL, no install, works on tablets.
- SVG and PNG export of the chart.
- Keyboard-first entry with unit suffixes (`3n9`, `2.2p`, `0.25l`).
- Everything needed to build the circuit: standard value components, losses, BOM, stress, simulator export. See `04-realization-features.md`.
- Slider ranges wider than 80 to 120 percent, log scale, user adjustable.

## 3. Project file format `.xmlsc`

UTF-8 XML with BOM, single root `CSmithChartDesign`, written by the .NET `XmlSerializer`. Children are flat repeated elements, in this order: `CDatapoint*`, `CComponent*`, `CSweepDatapoint*`, `CSweepDatapointParameters?`, `CStabilityCircles*`, `CNoiseList*`, `CGainCirclesList*`, `QList*`, `VSWRList*`. Numbers are round-trip doubles, frequencies in Hz, impedances in ohms, element values in SI base units (F, H, ohm) or wavelengths. Older `.smc` files (V2.03 and earlier) are out of scope.

### 3.1 `CDatapoint` (one per node of the chain, index 0 is where the chain starts)
| Field | Meaning |
|---|---|
| `IndexOfDP` | 0..n, order in the chain. |
| `IsRealDP` | 1 = user datapoint (`DPn`), 0 = transformed point (`TPm`). |
| `StartDatapoint` | 1 marks the user datapoint from which the network starts when several user datapoints exist (help: "datapoint from which network is starting"). 0 otherwise. |
| `Frequency` | Hz. |
| `R`, `X` | Impedance at this node, ohms. |
| `U`, `V` | Always 0 in all examples. Unused or reserved. Write 0, ignore on read. |

### 3.2 `CComponent` (one per element in chain order; element i maps datapoint i to i+1)
| Field | Meaning |
|---|---|
| `GUID` | Random id. |
| `Typ` | Element type code, table 3.3. |
| `Value` | F, H or ohm; for lines and stubs the electrical length in wavelengths. |
| `Rbegin`, `Xbegin`, `Rend`, `Xend` | Impedance before and after the element (redundant with the datapoints, useful for validation). |
| `LineImp` | Line or stub characteristic impedance, ohms. |
| `Er` | Effective relative permittivity of a line or stub. In all 22 examples the lossless lines and stubs (all with eps_r = 1) store exactly `1`, and the lossy line in Example 15 stores the real value 2.1; lumped elements store 0 (checked 2026-10-15 while writing the reader, an earlier note claiming `1 + Value` was wrong). Reader rule: electrical behavior never depends on `Er` for lossless lines, so read `Er` only for the physical length; treat values below 1 as air. Still to verify by saving a lossless line with eps_r = 2.1 in a licensed copy. |
| `Alpha` | Attenuation in dB per metre of physical length, 0 for lossless. Frequency scaled by sqrt(f / f_DP) in sweeps (help, section "Physical Transmission Line"). |
| `Lambda` | Electrical length in wavelengths, equal to `Value` for every line and stub (lossless and lossy); 0 for lumped elements. |
| `RValueRLC`, `LValueRLC`, `CValueRLC` | Values for the two RLC elements (ohm, H, F). 0 for other elements. |

### 3.3 Element type codes
Verified by recomputing the stored `Rend`/`Xend` from `Rbegin`/`Xbegin`.

| `Typ` | Element | Verification |
|---|---|---|
| 2 | Series capacitor | Example 1: 39.2 pF at 150 MHz gives dX = -27.07 ohm, exact. |
| 3 | Shunt capacitor | Example 16, exact. |
| 4 | Series inductor | Example 13: 2.39 nH at 2 GHz gives +30.03 ohm, exact. |
| 5 | Shunt inductor | Example 1, exact. |
| 8 | Series transmission line | Lossless, Example 8: 0.2081 wavelengths of 50 ohm transforms 30-j40 to 21.4+j24.67, exact. Lossy, Example 15: 23.7-j101 through 2.006 wavelengths of 50 ohm, eps_r 2.1, 2 dB/m gives 50.65-j69.75 for a length of 2.0056 wavelengths against stored 50.69-j69.78; the stored length is rounded to 4 digits, so the loss model (dB/m times physical length = electrical length / sqrt(eps_r), converted to nepers) is confirmed. |
| 9 | Open shunt stub | Example 9: Y = jY0 tan(bl), exact. |
| 30 | Shorted shunt stub | Example 10: Y = -jY0 cot(bl), exact. |
| unknown | Series R, shunt R, transformer, series element "R-L-C parallel-connected", shunt element "R-L-C series-connected" | Not present in the 23 examples. The parser must reject unknown codes with a clear message. **Action for Jonas:** if a licensed copy is still available, create one project containing these five elements and save it; the codes can then be read off in minutes. |

Note: `Typ` is also used inside circle records with a different meaning (1 = input or source plane, 2 = output or load plane).

Element models from the help: capacitor and inductor ideal; resistor ideal; transformer ideal with voltage ratio n (impedance ratio n squared); RLC ideal; line "physical transmission line" with Z0, eps_r effective, electrical length (wavelengths or mm), physical length = electrical length / sqrt(eps_r), attenuation in dB/m; stubs ideal (no loss parameter).

### 3.4 Sweep
- `CSweepDatapointParameters`: `Sweeptype` 1 = datapoint sweep (Example 17 has three user datapoints at 140, 145, 150 MHz), 2 = frequency sweep (Example 16, 10 to 450 MHz); `StartFrequency`, `StopFrequency`, `StepFrequency` in Hz. The UI asks for the number of points, the file stores the step.
- `CSweepDatapoint*`: same fields as `CDatapoint`, one per sweep point (`SPp`), holding the network input impedance at that frequency.

### 3.5 Circles
- `CStabilityCircles`: `Visible`, `Highlight`, `F`, `Typ` (1 input plane, 2 output plane), `K`, `Stable` (1 = stable inside, 2 = stable outside, inferred from the export example "stable outside" for K = 1.17 with both circles outside), s-parameters as `S11Re`, `S11Im`, `S12RE`, `S12IM`, `S21RE`, `S21IM`, `S22RE`, `S22IM` (keep the inconsistent capitalization).
- `CNoiseList`: `ManualCyrcle` (0 = parameters from file, so a frequency is attached; 1 = typed manually), `FreqUnit` (6 in the example, an index into the dialog's unit list, assumed GHz; harmless), `Visible`, `Highlight`, `Normalized` (1 = rn normalized to Z0, as in Touchstone; 0 = Rn in ohm, possible in CITI), `F`, `NF` (circle noise figure dB), `Rnoise`, `RNFminRE`, `RNFminIM` (Gamma_opt), `NFmin` (dB).
- `CGainCirclesList`: `Typ` (plane as above), `ManualCyrcle`, `GainType` (1 = available power gain, which lives in the input plane and matches Example 13's "input plane const. gain circle"; 2 and 3 are expected to be operating power gain and unilateral in the dialog order "Available, Operating, Unilateral"; confirm with a saved file), `Visible`, `Highlight`, `Marked`, s-parameters as `S11re`, `S11im`, ..., `K`, `P` (circle gain dB), `Gmax` (dB), `F`.
- `QList`: one number per Q contour. `VSWRList`: one number per VSWR circle.

## 4. Netlist export (Touchstone CKT format)

From the help. Comments start with `!`. Units set by `DIM`, element lines follow, `DEF2P` closes the block, `FREQ` block gives the analysis frequency.

```
! SMITH-CHART NETLIST GENERATOR VERSION 1.0             TIME=1e-12  COND=1e-0
! INPUT FILE: Example_netlist.xmlsc
! OUTPUT FILE: Example_netlist.ckt
! GLOBAL
DIM FREQ=1e6 RES=1e0 IND=1e-9 CAP=1e-12 LNG=1e-3
!
CKT
SRLC 1 0 R=33 L=22 C=18
TLINP 1 2 0 Z=50 L=37.8 K=1 A=2 F=0
RES 2 3 R=46.08
IND 3 0 L=13.18
CAP 3 4 C=19.4
DEF2P 1 4 A ! A is actual passive Network
!
FREQ
FIXED 500
```

Element statements: `CAP n1 n2 C=pF`, `IND n1 n2 L=nH`, `RES n1 n2 R=ohm`, `TLINP n1 n2 n3 Z=ohm L=electrical_length_mm K=eps_r_eff A=dB_per_m F=0` (series line: n3 = 0 ground; open stub: n2 = 99 floating, n3 = 0; shorted stub: n2 = 0, n3 = 0), `TRF n1 n2 n3 n4 N=ratio R1=0`, `PRLC n1 n2 R= L= C=` (series element), `SRLC n1 n2 R= L= C=` with n2 = 0 (shunt element). Node numbering starts at the load side (node 1) and ends at the last node, shunt elements go to node 0.

## 5. ASCII data export

Delimiter none, semicolon or comma. Datapoints: `Start DP; Point; R[Ohm]; X[Ohm]; Q; Frequency[Hz]` with `true`/`false` in the first column. Circles: one line per circle, `G1;input plane const. gain circle;gain;Gmax;s11 mag;ang;s21 mag;ang;s12 mag;ang;s22 mag;ang;freq;`, `N1;NF;NFmin;Gopt mag;ang;rn;freq;`, `S1;Input plane stability circle;stable outside;K;s-params...;freq;`.

## 6. Math (help "Smith-Chart Basics" and standard references)

All formulas the original documents are standard. References it cites: Medley 1993, Gonzalez 1984, Vendelin 1990, Edwards and Sinsky 1992 (mu factor), ADS 2009 documentation, EZNEC documentation.

- Gamma = (z - 1)/(z + 1) with z = Z/Z0. Constant R and constant X circles, constant G and B circles.
- Line (lossless): rotate Gamma referenced to the line impedance by 2 beta l, renormalize. Lossy: Zin = Zc (ZL + Zc tanh(gl))/(Zc + ZL tanh(gl)), alpha from dB/m times physical length, scaled by sqrt(f/f_DP).
- Stubs: open Y = jY0 tan(bl), shorted Y = -jY0 cot(bl).
- Transformer: Z' = n^2 Z.
- Stability: K (Rollett), Delta, B1 > 0 condition, mu (source) and mu' (load) per Edwards and Sinsky; source and load stability circle centers and radii; stable side rule: inside when the circle encloses the chart center, outside otherwise; unconditionally stable when the circle is entirely outside or entirely encloses the chart.
- Gains: transducer, operating (Gp, load plane circles with gp = Gp/|S21|^2), available (GA, source plane circles with gA), MAG = |S21/S12| (K - sqrt(K^2 - 1)) for K > 1, MSG = |S21/S12| for K < 1, unilateral gain with GS, G0, GL, unilateral figure of merit U and its error bounds, unilateral constant gain circles, simultaneous conjugate match Gamma_MS and Gamma_ML with B1, C1, B2, C2.
- Noise: F = Fmin + 4 rn |Gs - Gopt|^2 / ((1 - |Gs|^2) |1 + Gopt|^2); circles with N_i = (F_i - Fmin) |1 + Gopt|^2 / (4 rn), center Gopt/(1 + N_i), radius sqrt(N_i^2 + N_i (1 - |Gopt|^2))/(1 + N_i).
- Two-port conversions S, Z, Y, H, ABCD, normalized and unnormalized, as tabulated in the help and AN 95-1.
- VSWR, return loss, Q = |X|/R.

## 7. File formats the original reads

- **Touchstone v1**: `!` comments; option line `# <GHz|MHz|kHz|Hz> <S|H|Z|Y> <MA|DB|RI> R <n>`; 2-port rows `f x11 x21 x12 x22` (note the 21 before 12 order); ascending frequencies; optional noise block after the s-parameters with `f NFmin(dB) |Gopt| ang(Gopt) rn(normalized)`; the first noise frequency must not exceed the last s-parameter frequency.
- **CITIfile** (Keysight): `CITIFILE A.01.00`, `NAME`, `VAR FREQ MAG n`, `DATA S[1,1] MAGANGLE` ..., `VAR_LIST_BEGIN ... VAR_LIST_END`, one `BEGIN ... END` block per data array in declaration order; a file can hold several packages.
- **EZNEC** `Lastz.txt`: quoted header lines, then `"Freq MHz","Src #","R","X","SWR (50 ohms)","SWR (alt. Z0)"` and comma-separated rows.

## 8. Remaining open questions

1. `Typ` codes for series R, shunt R, transformer, series PRLC and shunt SRLC, and `GainType` 2 and 3. Needs one saved project from a licensed copy, or a careful guess with a reject-unknown parser.
2. Whether `Er` for a lossless line with eps_r other than 1 is stored as eps_r (as the examples with eps_r = 1 and the lossy line suggest) or in some other form.
3. The exact "number of points" to `StepFrequency` rounding in frequency sweeps.
4. Default colors and chart appearance (only as inspiration).

## 9. Comparable tools found on the web (2026-10-14)

- QuickSmith-Web (Nathan Iyer): free browser port of the old Windows QuickSmith, repository https://github.com/niyeradori/QuickSmith-Web, branch `modernize`, **MIT licensed**, 16 stars, last push 2026-10-05; plain JavaScript and SVG, no build step, share links, Touchstone import, PNG and SVG export, automatic L, Pi and T matching, band optimizer, microstrip synthesis, component Q, headless tests. Closest existing tool and a source of reusable modules, see `05-quicksmith-web-reuse.md`. Review: https://www.everythingrf.com/news/details/4749-QuickSmith-An-Online-Smith-Chart-Based-Linear-Circuit-Simulation-Program
- MATLAB Smith Chart Circles Toolbox: needs MATLAB, stability, gain and noise circles, https://www.mathworks.com/matlabcentral/fileexchange/20960-the-smith-chart-circles-toolbox
- Tonne Software Elsie family (Windows, closed): see `04-realization-features.md`.

Differentiators for this project: project file compatibility with Smith V4.1 designs, the S-Plot viewer with parameter conversions, sweeps versus datapoints, the tuning cockpit, the realization layer, and a modern responsive UI with shareable links.
