# Third-party notices

Smith Online is licensed under the MIT license (see `LICENSE`). It includes or
derives from the following third-party material.

## QuickSmith-Web

Portions derived from QuickSmith-Web, copyright 2017 Nathan Iyer.

- Source: https://github.com/niyeradori/QuickSmith-Web, branch `modernize`,
  commit `ca1b69e612f3e7c753591e2a09c38e19110136ef`.
- Reference copy: `third_party/quicksmith-web/`.
- Ported modules carry a header comment naming the source file and commit.
- `packages/core/src/line.ts`: from `line.js` (coax, synthesis of a width by bisection; its
  microstrip formulas were replaced by the scikit-rf port below in phase D4).
- `packages/core/src/bandwidth.ts`: from `engine.js` bandwidth and edge (usable bandwidth).

```
MIT license

Copyright (c) 2017 Nathan Iyer

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.
```

## scikit-rf

Portions derived from scikit-rf 2.2.0, copyright (c) 2010 Alexander Arsenovic and
copyright (c) 2020 scikit-rf Developers, BSD 3-clause license.

- Source: https://github.com/scikit-rf/scikit-rf, release 2.2.0.
- `packages/core/src/line.ts`: the microstrip model (static solution, dispersion, losses and
  the complex permittivity carried through them) is a line-by-line port of
  `skrf/media/mline.py` (class `MLine`, model 'hammerstadjensen', disp 'kirschningjansen',
  diel 'djordjevicsvensson'); the file header says so.
- `packages/core/test/fixtures/ads/mlin-djordjevicsvensson-kirschning.s2p`: a copy of the
  Keysight ADS regression data `skrf/media/tests/ads/mlin,djordjevicsvensson,kirschning.s2p`,
  used by `packages/core/test/qa-d4-ads.test.ts` (README in that folder).
- The oracle (`tools/oracle`) runs scikit-rf in CI; it is not distributed with the app.

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

## Smith V4.1 example files

The `.xmlsc` files in `packages/core/test/fixtures/xmlsc/` are the example
projects distributed with Smith V4.1 by Fritz Dellsperger. They are used as test
fixtures with attribution and are not covered by this project's MIT license.
See the `ATTRIBUTION.md` in that folder.
