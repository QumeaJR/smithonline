# Smith Online

A browser-based Smith chart and S-parameter tool, rebuilt from scratch and inspired by **Smith V4.1** by Prof. Fritz Dellsperger (http://www.fritz.dellsperger.net/smith.html). The goal is the same workflow RF students and engineers know from the original, with a modern interface, no installation, and compatibility with existing `.xmlsc` project files.

Status: preview (phase 1 core math and the first phase 2 application). The app draws the Smith chart with Z and Y grids, evaluates a free ladder of twelve element types live, shows datapoints, VSWR circles, Q contours and a frequency sweep, opens the original `.xmlsc` example projects, saves and shares designs by link. See `PLAN.md` for the roadmap and `docs/` for the analysis, the architecture decision and the UI concept.

## Repository layout

```
packages/core/   pure TypeScript library: complex math, elements, ladder, file formats (no DOM)
packages/app/    React 19 + Vite single-page application
third_party/     read-only reference copies of ported third-party code (not built)
docs/            analysis of the original, ADRs, UI design, mockup
original/        reference material from the author's site (local only, not in git)
PLAN.md          phased implementation plan
```

## Getting started

Requires Node.js 24 (LTS) and pnpm 12 (the version is pinned in the `packageManager` field).

```bash
pnpm install
pnpm test        # unit tests (Vitest)
pnpm lint        # ESLint
pnpm typecheck   # builds core, then tsc in every package
pnpm build       # builds packages/core, then packages/app into packages/app/dist
pnpm dev         # Vite dev server for the app
```

`packages/app/dist` is a static site. Copy it to any web server.

## Credits

The original Smith program, its examples and documentation are the work of Fritz Dellsperger. This project does not contain or derive from his source code; it reimplements the published functionality using standard RF engineering references (for example HP Application Note 95-1). His example projects are used as test fixtures with attribution, see `packages/core/test/fixtures/xmlsc/ATTRIBUTION.md`.

Parts of the core library are ported from **QuickSmith-Web** by Nathan Iyer (MIT license). See `THIRD_PARTY_NOTICES.md` and `third_party/quicksmith-web/README.md`.

Touchstone is a trademark of its respective owner.

## License

MIT, see `LICENSE`. Third-party material is listed in `THIRD_PARTY_NOTICES.md`.
