# Sample VNA CSV exports

All files in this folder are written by hand for the tests. The layouts
follow the general shape of the instrument and program exports named below;
they are not copies of vendor files and the numbers are made up.

| File | Layout |
|---|---|
| `keysight-ena-synthetic.csv` | Keysight ENA style: `!` header, two `BEGIN CHn_DATA` blocks, S11 re/im and S21 dB/angle in the first, S12 mag/angle and S22 dB/angle in the second |
| `generic-mhz-synthetic.csv` | Comma separated, `Freq [MHz]`, S11 and S21 mag/angle, `#` comments stating 75 ohm, a row at 0 Hz |
| `decimal-comma-synthetic.csv` | Semicolon separated with decimal commas, GHz, S11 dB/angle |
| `impedance-rx-synthetic.txt` | Tab separated R and X in ohm, MHz, one row with a non-finite frequency |
| `nanovna-saver-synthetic.csv` | NanoVNA-Saver style: frequency, re, im with unnamed value columns |
| `librevna-synthetic.csv` | LibreVNA style: a frequency, re, im triple per trace (S11, S21) |
| `malformed-synthetic.csv` | No frequency column; the reader must refuse it |
