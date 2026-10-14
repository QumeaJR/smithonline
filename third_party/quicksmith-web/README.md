# QuickSmith-Web reference copy

Read-only reference material. Nothing in this folder is built, bundled, linted or
tested as part of Smith Online. It exists so that the TypeScript ports in
`packages/core` can be reviewed against their source line by line.

| Item | Value |
|---|---|
| Repository | https://github.com/niyeradori/QuickSmith-Web |
| Branch | `modernize` |
| Commit | `ca1b69e612f3e7c753591e2a09c38e19110136ef` (2026-10-05) |
| Author | Nathan Iyer (KJ6FOJ) |
| License | MIT, see `LICENSE.md` in this folder |
| Fetched | 2026-10-14 |

Files copied unchanged:

- `engine.js`: complex arithmetic, ABCD ladder cascade, element models with finite Q, lines and stubs, L/Pi/T matching, bandwidth search, interpolation, sweep values.
- `match.js`: band optimizer (Nelder-Mead, reactance bounds, Bode-Fano check).
- `line.js`: microstrip (Hammerstad) and coax analysis and synthesis.
- `touchstone.js`: Touchstone v1 reader and writer with noise block.
- `permalink.js`: design-in-URL encoding.
- `tests/cases.js`: worked-example expected values, reused as a validation set.
- `LICENSE.md`: the MIT license text.

Fetch command used, once per file:

```bash
gh api "repos/niyeradori/QuickSmith-Web/contents/<path>?ref=ca1b69e612f3e7c753591e2a09c38e19110136ef" -H "Accept: application/vnd.github.raw"
```

Porting rules are in `docs/05-quicksmith-web-reuse.md`. Every ported file in
`packages/core` carries a header naming the source file and this commit.
