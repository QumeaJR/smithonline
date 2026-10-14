# ADR-001: Technology stack for Smith Online

**Status:** Accepted (Jonas Reber, 2026-10-14, including the QuickSmith-Web addendum)
**Date:** 2026-10-14
**Deciders:** Jonas Reber (project owner)

## Context

Smith Online is a browser rebuild of the Windows tool Smith V4.1 (see `01-original-analysis.md`). Constraints and forces:

- One developer, part time, RF engineering background rather than web development background, working with AI assistance. The stack must be mainstream so that documentation, examples and AI help are abundant.
- Hosting available: a domain plus a shared server that runs PHP and MySQL. Static files are always possible there.
- Workload: all computation is a few hundred complex multiplications per redraw (ladder with up to tens of elements, sweeps with up to a few thousand points, S-parameter files with a few thousand rows). Any language is fast enough. The hard part is the interactive UI, not the math.
- Must work offline-capable and without accounts in the first version; accounts, sharing and a design library are nice-to-have later.
- Must read and write the original `.xmlsc` project files and Touchstone files, client side.
- Must render a precise, printable, zoomable chart. Vector output (SVG, PDF via print) matters for lab reports and teaching.
- Long-term maintainability matters more than peak performance. The original became unmaintainable because it depended on one person and a desktop toolchain.

## Decision

Build a **TypeScript single-page application**, split into:

1. `packages/core`: a pure TypeScript library with no DOM dependency. Complex math, elements, ladder evaluation, sweeps, circles, parameter conversions, file parsers and writers. 100 percent unit tested against hand-computed values and the original example files.
2. `packages/app`: the UI, built with **React 19 + Vite**, state in **Zustand** (with an undo/redo middleware), chart drawn as **SVG** in React, S-Plot graphs with **uPlot** (small, supports log axes). Styling with **Tailwind CSS** and **Radix UI** primitives for accessible dialogs, sliders and menus.
3. Hosting as **static files** on the existing server, served over HTTPS, installable as a PWA. No backend in version 1. Designs are saved to the browser, downloaded as `.xmlsc` or JSON, and shared as compressed URL fragments.
4. **Optional phase 3 backend** in PHP 8 + MySQL on the same server for accounts, a saved-design library and short share links. The frontend talks to it through a small JSON API, so the backend can later be swapped (for example to a Rust or Node service) without touching the app.

## Options considered

### Option A: Rust compiled to WebAssembly (Yew, Leptos or Dioxus for the UI)
| Dimension | Assessment |
|---|---|
| Complexity | High. Rust toolchain, wasm-bindgen, DOM interop, large compile times. UI frameworks are young and APIs still change. |
| Cost | Free tooling, but significantly more developer hours. |
| Scalability | Irrelevant here; the workload is tiny. |
| Team familiarity | Low. Neither Rust nor WASM are installed on the development machine today. |

**Pros:** Strong typing, excellent numerics, single language for math and UI, no garbage collector.
**Cons:** No performance need justifies it. Printing, text layout, accessibility and SVG interaction are all easier from JavaScript. Fewer examples and less AI assistance for the UI frameworks. Bundle sizes are larger. Debugging in the browser is harder.

**Where Rust still fits:** if a future feature needs heavy computation (for example optimizer-based broadband matching or Monte Carlo tolerance analysis), that module can be written in Rust and compiled to WASM and called from the core library. The architecture keeps that door open by isolating math in `packages/core`.

### Option B: PHP + MySQL + JavaScript on the shared host
| Dimension | Assessment |
|---|---|
| Complexity | Medium. Two languages, server-side rendering adds round trips, every interaction still needs JavaScript. |
| Cost | Hosting already paid. |
| Scalability | Fine for the expected load. |
| Team familiarity | Medium. |

**Pros:** Uses existing hosting as-is, easy accounts and persistence.
**Cons:** The tool is inherently interactive: dragging a slider must redraw the chart within a frame. A PHP backend cannot help with that, so the math would be written twice (JavaScript for live updates, PHP for persistence or validation). Server dependence breaks offline use. A database adds backups, GDPR duties and attack surface for a feature that version 1 does not need.

### Option C: TypeScript SPA with static hosting (chosen)
| Dimension | Assessment |
|---|---|
| Complexity | Low to medium. One language, standard tooling (Node, Vite, Vitest, Playwright). |
| Cost | Free tooling, deploys as files to the existing server or to any static host. |
| Scalability | Static files scale trivially; CDN optional. |
| Team familiarity | Medium, and the ecosystem has the most documentation and AI support of the three options. |

**Pros:** Fastest path to a usable tool. Math library is reusable (Node scripts, tests, future CLI). SVG gives crisp printing and export. PWA gives offline use. Backend can be added later without rewriting.
**Cons:** JavaScript number formatting and complex arithmetic need a small helper library (write it, do not depend on math.js for speed and bundle size). TypeScript does not prevent numeric mistakes, so tests against known values are mandatory.

## Trade-off analysis

- **Performance**: all three options exceed requirements. Rust/WASM wins on paper but the bottleneck is SVG DOM updates, which are the same in every option.
- **Developer velocity and help available**: C clearly wins. React, Vite and Zustand have the largest body of examples.
- **Maintainability by others**: C wins. Any web developer can contribute; Rust UI frameworks narrow the pool.
- **Offline and install-free use**: A and C tie (both are static). B loses.
- **Persistence and accounts**: B wins out of the box, but C plus a later PHP API reaches the same point with less coupling.
- **Vector-quality chart**: C and B (SVG) win over canvas-only WASM UIs.

## Consequences

- Easier: fast iteration, printing and SVG export, unit testing the math in isolation, running the same core in Node for batch scripts, hosting anywhere.
- Harder: nothing on the server to enforce licensing; the project is open source by design, which is also the intent.
- Revisit: when a feature needs real compute (optimizers, tolerance analysis), evaluate a Rust/WASM module behind the `core` API. When users ask for cloud saving, implement the PHP API in phase 3.

## Rejected alternatives inside option C

- Svelte 5 or SolidJS: smaller and arguably nicer for reactive sliders, but fewer examples and fewer UI component libraries. React is the safer default for a solo developer with AI support. Revisit only before the first line of UI code.
- Plotly or ECharts for S-Plot: larger bundles (hundreds of kB) for features not needed. uPlot is 50 kB and handles log axes and cursors.
- Canvas for the Smith chart: faster for tens of thousands of points but loses crisp text, hit testing and SVG export. Use SVG; switch the sweep locus to a canvas layer only if profiling shows a need.

## Addendum 2026-10-14: QuickSmith-Web

QuickSmith-Web (MIT, https://github.com/niyeradori/QuickSmith-Web, branch `modernize`) has a pure-function solver, matching, band optimizer, microstrip synthesis and Touchstone modules in plain JavaScript with headless tests. Forking it was considered and rejected because of its fixed 12-slot ladder, untyped ES5 code and active upstream development. Decision: keep this ADR and port those modules into `packages/core` in TypeScript with MIT attribution. Details in `05-quicksmith-web-reuse.md`.

## Action items

1. [ ] Accept this ADR (Jonas).
2. [ ] Install Node LTS and pnpm on the development machine.
3. [ ] Scaffold the monorepo (`pnpm` workspaces, Vite, Vitest, ESLint, Prettier, Playwright).
4. [ ] Implement `packages/core` complex math and verify against the example `.xmlsc` files.
