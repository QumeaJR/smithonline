# Smith Online

A browser-based Smith chart and S-parameter tool, rebuilt from scratch and inspired by **Smith V4.1** by Prof. Fritz Dellsperger (http://www.fritz.dellsperger.net/smith.html). The goal is the same workflow RF students and engineers know from the original, with a modern interface, no installation, compatibility with existing `.xmlsc` project files, and the extras needed to actually build the circuit.

Status: feature complete against the original and the planned extensions, in QA. See `docs/06-user-guide.md` for what the app does, `PLAN.md` for the roadmap and `docs/` for the analysis of the original, the architecture decision, the UI concept and the design notes.

## What it does

The app works on phones, tablets and desktops: the same features everywhere, with touch gestures on the chart, a bottom sheet on the phone and a tool column beside the chart on wider screens. It can be added to a phone's home screen.

- Smith chart with Z and Y grids, a free ladder of twelve element types evaluated live, datapoints you can drag, element loci, VSWR circles, Q contours, stability, gain and noise circles from a two-port device.
- Matching: closed-form L, Pi and T networks, tuning of the parts you already have, broadband topology search with an element cap, a band optimizer with limit areas, usable bandwidth readout.
- Distributed synthesis: binomial and Chebyshev multi-section quarter-wave transformers and a stub filter designer (Richards' transform and the Kuroda identities).
- Response plots (gain, return loss, VSWR, impedance, phase, group delay) with markers, limit areas and stored overlays; an S-Plot viewer for s-parameter files with gain table, conversions and hand-over to the chart, and Add network to S-Plot for the design's own network as a live entry with a freeze for before and after.
- Realize mode: standard values (E6 to E96) or your own stock, locks, losses, component packages with parasitics, bill of materials, voltage and current stress, Monte Carlo yield, inductor winding helper, microstrip and coax dimensions.
- Files: Smith V4.1 `.xmlsc` read and write, Touchstone (1 to 4 ports, noise block), CITI, EZNEC and VNA CSV exports (Keysight and Agilent, generic tables, NanoVNA-Saver and LibreVNA); exports to SVG, PNG, CSV, CKT netlist, ASCII, SPICE, LTspice, `.s2p` and a printable report; share links.
- Learning: a start guide with the three steps of a match on a new design, ten guided tours with narration computed from the design, the 22 Smith V4.1 example projects and the user guide in the app.

## Repository layout

```
packages/core/   pure TypeScript library: complex math, elements, ladder, matching, file formats (no DOM)
packages/app/    React 19 + Vite single-page application
third_party/     read-only reference copies of ported third-party code (not built)
docs/            analysis of the original, ADRs, UI design, feature notes, user guide, mockup
.claude/         project agents (qa-validator, adversary, ui-expert) and the qa-round skill
original/        reference material from the author's site (local only, not in git)
tools/oracle/    independent oracle: scikit-rf and ngspice recompute the app's networks in CI
PLAN.md          phased implementation plan and status
```

## Getting started

Requires Node.js 22 or newer (24 LTS recommended) and pnpm 12 (the version is pinned in the `packageManager` field).

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

## Verification

The core's numbers are checked by three things that do not depend on the code agreeing with itself (phase D1 of `docs/08-depth-plan.md`):

- **Physics invariants** (`packages/core/test/invariants.test.ts`): 10 000 random networks from a seeded generator, built from every element kind (R, L, C with and without Q and package parasitics, series and parallel RLC blocks in both orientations, transformers, lossless and lossy lines, open and shorted stubs) between random loads and reference impedances at random frequencies. Checked: reciprocity (det ABCD = 1, S12 = S21), S^H S = I to 1e-9 for lossless networks, passivity (|S11|, |S22| <= 1, no negative eigenvalue of I - S^H S), the same cascade in either grouping, the S, Z, Y, H and ABCD conversions round trip, Zin from the cascade equal to Zin from S11 and the load, closed-form L, Pi and T matches landing on their target to 1e-9, and no broadband search result below the exact Bode-Fano floor of its load.
- **Golden cases** (`packages/core/test/golden.test.ts`): published answers at their printed precision, each with its source in the test. Pozar, Microwave Engineering, 4th ed. (Example 5.1 L-section, 5.2 single shorted stub, 5.5 quarter-wave transformer, 5.6 binomial and 5.7 Chebyshev multisection transformers, section 5.9 Bode-Fano, tables 8.3 and 8.4 prototypes); Matthaei, Young and Jones, table 4.05-2(a); HP AN 95-1 (300 MHz and broadband amplifier parts, G2max, the 200 ohm load); Smith V4.1 Examples (Examples 5, 6, 12, 13, 14, 16, 17 and 18 against their project files); Bowick's L and Pi procedures.
- **Independent oracle in CI** (`tools/oracle/`, job `oracle`): scikit-rf rebuilds 21 reference networks and compares S-parameters to 1e-9, and ngspice runs the app's own SPICE netlists and compares the input impedance to 1e-6. It runs only in CI; `tools/oracle/README.md` explains how to run it with Python and ngspice installed.

## Deployment

The app is static files only, so any static host works. The project is set up for Cloudflare, which is free for a static site, builds on every push and takes a custom domain from the same account. Cloudflare offers two flows; both read the same repository.

**Workers with static assets** (the "Create an application" flow under Workers & Pages, the current default):

1. Push the repository to GitHub, then in the Cloudflare dashboard open Workers & Pages, Create, and connect the repository.
2. Project name `smithonline`, build command `pnpm build`, deploy command `npx wrangler deploy`, preview command `npx wrangler versions upload`, path `/`. Leave "Enable Preview builds" on so every branch and pull request gets a preview URL; create the API token the form asks for.
3. `wrangler.jsonc` at the repository root tells Wrangler to upload `packages/app/dist` as static assets and the Worker in `packages/worker`, which runs only for `/api/*` (usage counts and feedback, below). Node 24 is pinned by `.node-version`, pnpm by the `packageManager` field and Wrangler by the root `package.json`.
4. Custom domain: on the Worker open Settings, Domains & Routes, and add the domain; when the zone is on Cloudflare the DNS record is created for you and HTTPS is automatic.

**Usage counts and feedback** (docs/10): the same Worker answers `/api/e` and `/api/feedback`; every other path is served as a static asset without running it (`run_worker_first: ["/api/*"]` in `wrangler.jsonc`). The app works the same when `/api` cannot be reached. The owner's steps in the Cloudflare dashboard, once:

1. **Web Analytics**: Analytics & Logs, Web Analytics, Add a site, hostname `smithchart.online`. Choose the JS snippet (manual setup), not the automatic setup, and make sure the automatic setup stays off for the zone: the app adds the beacon itself only when the visitor allows it (Settings switch on, no Global Privacy Control, no Do Not Track). Copy the token from the snippet.
2. **Turnstile**: Turnstile, Add widget. Name "Smith Online feedback", hostname `smithchart.online` (add the preview host only if previews should take feedback), widget mode Managed. Copy the site key and the secret key.
3. **D1**: Storage & Databases, D1, Create, name `smithonline-feedback`. Copy its id into `wrangler.jsonc` as `"database_id"` in the `d1_databases` entry and commit it. (Without an id the first deploy provisions the database itself, but the id is then only in the dashboard; pinning it keeps one database whatever happens to the name.)
4. **Build variables** (Workers & Pages, smithonline, Settings, Build, Variables and secrets): `VITE_CF_BEACON_TOKEN` = the Web Analytics token, `VITE_TURNSTILE_SITEKEY` = the Turnstile site key. Both are public values, read when the app is built.
5. **Worker secret**: on the Worker, Settings, **Runtime variables and secrets** (not the Build section, whose variables only the build sees), Add variable, type **Secret**, name exactly `TURNSTILE_SECRET`, value the Turnstile secret key. It survives deploys and is never in the repository. Before the first deploy with the Worker this section says the Worker has only static assets: add the secret after that deploy (reload the page), or with `npx wrangler secret put TURNSTILE_SECRET`. Without it, Send feedback answers "feedback is not available right now".
6. **Deploy command** (Settings, Build): `npx wrangler deploy && npx wrangler d1 migrations apply smithonline-feedback --remote`. Push to `master`. If the migration step fails for lack of permission, give the build's API token D1 Edit. Until the migration has run, `/api/feedback` answers 503 and the dialog offers the GitHub link.
7. **Analytics Engine**: enable it for the account before the first deploy (Workers & Pages, Analytics Engine); otherwise the deploy stops with "You need to enable Analytics Engine [code: 10089]". The dataset is created on the first write (or create it there as `smithonline_events` with binding `EVENTS`). Check that `https://smithchart.online/` loads, and send one test message with Help, Send feedback.
8. **Query token**: My Profile, API Tokens, Create Token, Custom token, permission Account, Account Analytics, Read. Keep it outside the repository; the SQL queries are in `docs/10-feedback-analytics-plots.md` section 1.5:

```sh
curl "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/analytics_engine/sql" \
  -H "Authorization: Bearer $ANALYTICS_TOKEN" \
  --data "SELECT blob2 AS tool, SUM(_sample_interval) AS opens FROM smithonline_events WHERE blob1 = 'tool' AND blob3 = 'open' AND timestamp > NOW() - INTERVAL '30' DAY GROUP BY tool ORDER BY opens DESC"
```

Reading feedback: `npx wrangler d1 execute smithonline-feedback --remote --command "SELECT id, created_at, category, message, email FROM feedback WHERE status = 'new'"` (or the D1 console in the dashboard). Deleting one on request (the issue names its reference): `npx wrangler d1 execute smithonline-feedback --remote --command "DELETE FROM feedback WHERE id = 'FB-7K3Q2M'"`, within 30 days. A daily cron clears email addresses after 90 days and deletes messages after 12 months.

Locally: `pnpm build`, then `npx wrangler d1 migrations apply smithonline-feedback --local` once, put `TURNSTILE_SECRET=1x0000000000000000000000000000000AA` (Cloudflare's test secret) in `.dev.vars` (ignored by git), and run `npx wrangler dev --var ALLOWED_ORIGIN:http://localhost:8787`. On `localhost` the app uses Turnstile's test site key; usage counts are sent only from `smithchart.online`, or from any host when the app is built with `VITE_ANALYTICS_DEV=1`.

**Pages** (Workers & Pages, Create, Pages, Connect to Git):

1. Framework preset None, build command `pnpm build`, build output directory `packages/app/dist`, root directory left empty; no environment variables are needed.
2. Every push to `master` deploys to the production URL; every other branch and pull request gets a preview URL. Custom domains are added on the Pages project under Custom domains. Pages serves the static app only: without the Worker there are no usage counts and Send feedback offers the GitHub link.

`packages/app/public/_headers` sets the security headers and one-year caching for the hashed files under `assets/`; Vite copies it into `dist/` and both flows honour it. The app routes through the URL fragment only (share links are `#d=...`), so no redirect rules are needed.

GitHub Actions (`.github/workflows/ci.yml`) runs lint, format check, typecheck, tests and the build on every push and pull request, and keeps the built site as an artifact; its `oracle` job runs the independent check described under Verification.

## Credits

The original Smith program, its examples and documentation are the work of Fritz Dellsperger. This project does not contain or derive from his source code; it reimplements the published functionality using standard RF engineering references (for example HP Application Note 95-1). His example projects are used as test fixtures with attribution, see `packages/core/test/fixtures/xmlsc/ATTRIBUTION.md`.

Parts of the core library are ported from **QuickSmith-Web** by Nathan Iyer (MIT license). See `THIRD_PARTY_NOTICES.md` and `third_party/quicksmith-web/README.md`.

Touchstone is a trademark of its respective owner.

## License

MIT, see `LICENSE`. Third-party material is listed in `THIRD_PARTY_NOTICES.md`.
