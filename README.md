# Smith Online

A browser-based Smith chart and S-parameter tool, rebuilt from scratch and inspired by **Smith V4.1** by Prof. Fritz Dellsperger (http://www.fritz.dellsperger.net/smith.html). The goal is the same workflow RF students and engineers know from the original, with a modern interface, no installation, compatibility with existing `.xmlsc` project files, and the extras needed to actually build the circuit.

Status: feature complete against the original and the planned extensions, in QA. See `docs/06-user-guide.md` for what the app does, `PLAN.md` for the roadmap and `docs/` for the analysis of the original, the architecture decision, the UI concept and the design notes.

## What it does

- Smith chart with Z and Y grids, a free ladder of twelve element types evaluated live, datapoints you can drag, element loci, VSWR circles, Q contours, stability, gain and noise circles from a two-port device.
- Matching: closed-form L, Pi and T networks, tuning of the parts you already have, broadband topology search with an element cap, a band optimizer with limit areas, usable bandwidth readout.
- Response plots (gain, return loss, VSWR, impedance, phase, group delay) with markers, limit areas and stored overlays; an S-Plot viewer for s-parameter files with gain table, conversions and hand-over to the chart.
- Realize mode: standard values (E6 to E96) or your own stock, locks, losses, component packages with parasitics, bill of materials, voltage and current stress, Monte Carlo yield, inductor winding helper, microstrip and coax dimensions.
- Files: Smith V4.1 `.xmlsc` read and write, Touchstone (1 to 4 ports, noise block), CITI, EZNEC; exports to SVG, PNG, CSV, CKT netlist, ASCII, SPICE, LTspice, `.s2p` and a printable report; share links.

## Repository layout

```
packages/core/   pure TypeScript library: complex math, elements, ladder, matching, file formats (no DOM)
packages/app/    React 19 + Vite single-page application
third_party/     read-only reference copies of ported third-party code (not built)
docs/            analysis of the original, ADRs, UI design, feature notes, user guide, mockup
.claude/         project agents (qa-validator, adversary, ui-expert) and the qa-round skill
original/        reference material from the author's site (local only, not in git)
PLAN.md          phased implementation plan and status
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

The Help dialog shows the user guide. There is one source, `docs/06-user-guide.md`: `packages/app/src/lib/guide.ts` imports it with Vite's `?raw` import, so the guide is compiled into the bundle at build time and there is no copy to keep in sync. Edit the Markdown file, rebuild, done. The in-app reader (`packages/app/src/lib/markdown.ts`) supports headings, paragraphs, bullet and numbered lists, bold, italic, inline code and links; no Markdown library is used. Instead of static screenshots, which go stale, the guide carries working links: `[text](tour:l-network)` starts a guided tour, `[text](example:Example16.xmlsc?view=response)` loads an example on a view and `[text](view:splot)` switches view (`packages/app/src/lib/helpActions.ts`). A test checks that every such link names something that exists, and the dialog ends with an index generated from the tour and example lists. In a plain Markdown viewer these links do nothing.

## Deployment

The app is static files only, so any static host works. The project is set up for Cloudflare, which is free for a static site, builds on every push and takes a custom domain from the same account. Cloudflare offers two flows; both read the same repository.

**Workers with static assets** (the "Create an application" flow under Workers & Pages, the current default):

1. Push the repository to GitHub, then in the Cloudflare dashboard open Workers & Pages, Create, and connect the repository.
2. Project name `smithonline`, build command `pnpm build`, deploy command `npx wrangler deploy`, preview command `npx wrangler versions upload`, path `/`. Leave "Enable Preview builds" on so every branch and pull request gets a preview URL; create the API token the form asks for.
3. `wrangler.jsonc` at the repository root tells Wrangler to upload `packages/app/dist` as static assets with no Worker script. Node 24 is pinned by `.node-version` and pnpm by the `packageManager` field.
4. Custom domain: on the Worker open Settings, Domains & Routes, and add the domain; when the zone is on Cloudflare the DNS record is created for you and HTTPS is automatic.

**Pages** (Workers & Pages, Create, Pages, Connect to Git):

1. Framework preset None, build command `pnpm build`, build output directory `packages/app/dist`, root directory left empty; no environment variables are needed.
2. Every push to `master` deploys to the production URL; every other branch and pull request gets a preview URL. Custom domains are added on the Pages project under Custom domains.

`packages/app/public/_headers` sets the security headers and one-year caching for the hashed files under `assets/`; Vite copies it into `dist/` and both flows honour it. The app routes through the URL fragment only (share links are `#d=...`), so no redirect rules are needed.

GitHub Actions (`.github/workflows/ci.yml`) runs lint, format check, typecheck, tests and the build on every push and pull request, and keeps the built site as an artifact.

## Credits

The original Smith program, its examples and documentation are the work of Fritz Dellsperger. This project does not contain or derive from his source code; it reimplements the published functionality using standard RF engineering references (for example HP Application Note 95-1). His example projects are used as test fixtures with attribution, see `packages/core/test/fixtures/xmlsc/ATTRIBUTION.md`.

Parts of the core library are ported from **QuickSmith-Web** by Nathan Iyer (MIT license). See `THIRD_PARTY_NOTICES.md` and `third_party/quicksmith-web/README.md`.

Touchstone is a trademark of its respective owner.

## License

MIT, see `LICENSE`. Third-party material is listed in `THIRD_PARTY_NOTICES.md`.
