# Sample S-parameter, CITI and EZNEC files

All files in this folder are synthetic: the numbers come from simple closed
formulas chosen to look like a small-signal amplifier, a dipole, a splitter
and a coupler. They are not measurements and not vendor data, and they are
only here to exercise the readers.

| File | Format |
|---|---|
| `amp-synthetic.s2p` | Touchstone v1, GHz, MA, 12 points plus a four-point noise block |
| `dipole-synthetic.s1p` | Touchstone v1, MHz, RI, one port |
| `splitter-synthetic.s3p` | Touchstone v1, GHz, DB, three ports, one matrix row per line |
| `coupler-synthetic.s4p` | Touchstone v1, MHz, RI, four ports |
| `twoport-synthetic.citi` | CITIfile with two packages: a two-port in MAGANGLE with a VAR_LIST and a one-port in RI with a SEG_LIST |
| `Lastz.txt` | EZNEC frequency sweep table with CRLF line endings |
