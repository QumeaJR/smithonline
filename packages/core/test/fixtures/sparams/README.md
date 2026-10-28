# Sample S-parameter, CITI and EZNEC files

All files in this folder are synthetic: the numbers come from simple closed
formulas chosen to look like a small-signal amplifier, a dipole, an antenna,
a splitter and a coupler. They are not measurements and not vendor data, and they are
only here to exercise the readers.

| File | Format |
|---|---|
| `antenna-2g4-synthetic.s1p` | Touchstone v1, GHz, RI, one port, 101 rows from 2.2 to 2.7 GHz: a series R, L and C with a shunt C, written by `scripts/synth-antenna.mjs` (the app's sample antenna) |
| `amp-synthetic.s2p` | Touchstone v1, GHz, MA, 12 points plus a four-point noise block |
| `dipole-synthetic.s1p` | Touchstone v1, MHz, RI, one port |
| `splitter-synthetic.s3p` | Touchstone v1, GHz, DB, three ports, one matrix row per line |
| `coupler-synthetic.s4p` | Touchstone v1, MHz, RI, four ports |
| `twoport-synthetic.citi` | CITIfile with two packages: a two-port in MAGANGLE with a VAR_LIST and a one-port in RI with a SEG_LIST |
| `board-1g-offset5mm-synthetic.s1p` | Touchstone v1, GHz, RI, one port: the synthetic measured board (`board-1g-synthetic.s1p` model) seen through a 5 mm reference-plane offset (εeff 3.3, 30.30 ps one way) plus noise 0.001, a QA case for the D6 plane fit |
| `Lastz.txt` | EZNEC frequency sweep table with CRLF line endings |
