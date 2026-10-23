# Third-party notices

Smith Online is licensed under the MIT license (see `LICENSE`). It includes or
derives from the following third-party material.

## QuickSmith-Web

Portions derived from QuickSmith-Web, copyright 2017 Nathan Iyer.

- Source: https://github.com/niyeradori/QuickSmith-Web, branch `modernize`,
  commit `ca1b69e612f3e7c753591e2a09c38e19110136ef`.
- Reference copy: `third_party/quicksmith-web/`.
- Ported modules carry a header comment naming the source file and commit.
- `packages/core/src/line.ts`: from `line.js` (microstrip, coax, synthesis by bisection).
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

## Smith V4.1 example files

The `.xmlsc` files in `packages/core/test/fixtures/xmlsc/` are the example
projects distributed with Smith V4.1 by Fritz Dellsperger. They are used as test
fixtures with attribution and are not covered by this project's MIT license.
See the `ATTRIBUTION.md` in that folder.
