# Keysight ADS regression data from scikit-rf

`mlin-djordjevicsvensson-kirschning.s2p` is a copy, unchanged apart from its
name, of `skrf/media/tests/ads/mlin,djordjevicsvensson,kirschning.s2p` from
scikit-rf 2.2.0 (https://github.com/scikit-rf/scikit-rf). Keysight ADS wrote
it on 10 May 2022 (the file's first line): an MLIN microstrip on an MSUB
substrate with Djordjevic-Svensson dielectric and Kirschning-Jansen
dispersion, 100 points from 0.2 to 20 GHz, 50 ohm ports.

The line's parameters are those of the scikit-rf test that reads the file
(`skrf/media/tests/test_mline.py`, `MLineTestCase.setUp`): W 3.00 mm,
H 1.55 mm, T 35 um, er 4.413 and tanD 0.0182 at 1 GHz, rho 1.7e-8 ohm m,
roughness 0.15 um RMS, length 25 mm.

`packages/core/test/qa-d4-ads.test.ts` compares the core's microstrip with it.
It is the one check of the microstrip model that does not go through
scikit-rf's code, of which `packages/core/src/line.ts` is a port.

## Licence

scikit-rf is distributed under the BSD 3-clause license:

```
Copyright (c) 2010, Alexander Arsenovic
All rights reserved.

Copyright (c) 2020, scikit-rf Developers
All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice, this
  list of conditions and the following disclaimer in the documentation and/or
  other materials provided with the distribution.

* Neither the name of the scikit-rf nor the names of its
  contributors may be used to endorse or promote products derived from
  this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
