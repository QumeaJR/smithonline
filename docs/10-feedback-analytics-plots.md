# Analytics, feedback, response plots and tool heads

Status: implemented on branch `docs10` 2026-10-27, with the fixes of QA round 1 (section 8: what was built, the deviations, the verified Cloudflare facts with their pages, the QA fixes in 8.4 and the open legal review); written as an implementable spec, 2026-10-27, in the style of `docs/09`; fits `docs/07` (tokens, Dialog, Sheet, Escape stack, slots). Read from master at dc9603d (0.6.0 plus D6); no browser session was used. Decisions already taken with the owner are kept as given. Statements about Cloudflare products that must be checked against the current docs before building are marked **verify**. Privacy and GDPR wording is a draft that needs human review before release.

## 0. Decisions

1. **Analytics are counts of feature use, not tracking.**
   - **Visitor counts:** Cloudflare Web Analytics.
   - **Feature events:** about 20 types, each field a closed enum. The app batches them per page load and sends them same-origin to `/api/e`. A Worker validates every value against the same schema and writes one Analytics Engine data point per event.
   - **What is never sent:** no id, cookie or IP stored; no design data, number, text or file name.
   - **When nothing is sent:** the Settings switch is off, Global Privacy Control is on, or Do Not Track is on. In those cases the Web Analytics beacon is not loaded either.
2. **Feedback** opens from Help as a short dialog and posts to `/api/feedback`. It is checked by Turnstile and stored in D1. Feedback is deleted after 12 months, email addresses after 90 days, and on request by reference number. The open design is attached only when the user ticks a box, and never with library part data.
3. **Response plots get zoom, enlarge and export.**
   - **Zoom:** frequency zoom is shared across the plots; a box zoom also sets this plot's y range; double-click resets.
   - **Enlarge:** one plot fills the plot area of the Response view (not a new view); Escape returns.
   - **Export:** PNG, SVG and CSV per plot.
   - **Phone:** an enlarged plot is full screen with pinch zoom on frequency.
   - The same `Plot` component serves S-Plot and the measured-board plot, so they get this too.
4. **Tool heads:** the "Numbers | Auto match" strip goes. An open tool shows its title, its ? link and X; X returns to Numbers. A running search keeps running after X, and its progress shows in a one-line job row at the head of Numbers and on the header button. Desktop, tablet and phone follow one rule.

## 1. Analytics

### 1.1 What is counted, and what is not

- **Counted:** page loads ("starts"), and the use of features per start.
- **Not counted:** unique users. Without an identifier the app cannot tell a returning user from a new one, and the privacy note says so. Web Analytics "visits" (a page view from another site or a direct entry) are the closest proxy.
- **Never sent:** values, impedances, frequencies, names, file names, design content, free text, the IP (the Worker uses it only in memory for the rate limit), the user agent string, the screen size in pixels, the referrer.

### 1.2 Context sent with every batch

| Field | Values |
|---|---|
| `ver` | app version from package.json, e.g. `0.6.0` (checked against a regex `^\d+\.\d+\.\d+$`) |
| `lay` | `phone`, `tablet`, `desktop`, `wide` (the app's own breakpoints, `lib/layout.ts`) |
| `ptr` | `fine`, `coarse` |
| `thm` | `light`, `dark` (the theme in use) |
| `pwa` | `app` (installed, display-mode standalone), `browser` |

The country is not sent by the app. Whether the Worker adds Cloudflare's two-letter country from `request.cf.country` is an open question (section 7).

### 1.3 Events

Fields `a`, `b` and `c` are per-event enums. The Worker drops any event or value not in the schema.

| Event | a | b | c | Question it answers |
|---|---|---|---|---|
| `start` | entry: `new`, `autosave`, `link`, `file`, `example` | | | How many starts, on which devices; how many come from share links |
| `view` | `chart`, `response`, `splot` | | | Are Response and S-Plot used at all |
| `tool` | `match`, `optimize`, `montecarlo`, `build` | `open`, `close` | | Which tools matter |
| `match_method` | `add`, `tune`, `broadband`, `transformer`, `stubfilter` | | | Which Auto match methods are used |
| `job` | `broadband`, `optimize`, `montecarlo`, `centre`, `fit`, `retune`, `rft` (D7) | `done`, `stopped`, `error` | | Do searches finish or get stopped (too slow?) |
| `workflow` | id (7 ids from `workflows.ts`) | `start`, `complete`, `close` | step `1` to `12` (on close) | Which workflows start, finish, and where people drop out |
| `lesson` | id (10 ids from `tours.ts`) | `start`, `complete`, `close` | | Are the lessons still used |
| `sample` | `antenna`, `amplifier`, `parts`, `board` | | | Do newcomers use the samples |
| `example` | `Example1` to `Example18` (22 file ids) | | | Which V4.1 examples are opened |
| `import` | `s1p`, `s2p`, `s3p`, `s4p`, `citi`, `eznec`, `csv`, `txt`, `xmlsc`, `json`, `other` | `load`, `rows`, `device`, `splot`, `measurement`, `parts` | `ok`, `refused` | Which formats and VNAs to support better |
| `refused` | reader: `touchstone`, `citi`, `csv`, `eznec`, `xmlsc`, `json`, `link`, `part` | reason: `no_frequency`, `no_sparams`, `too_large`, `too_few_rows`, `bad_option_line`, `parse`, `unsupported` | | Which files fail and why |
| `export` | `svg`, `png`, `report`, `print`, `copy_chart`, `copy_dp`, `csv`, `ckt`, `spice`, `ltspice`, `s2p`, `splot_add`, `ascii`, `bom`, `json`, `xmlsc`, `share_link`, `plot_png`, `plot_svg`, `plot_csv` | | | Which simulators people verify with; is the BOM used |
| `build` | section: `realization`, `losses`, `packages`, `board`, `measured`, `ratings` | `open`, `change` | | Which parts of the build are set |
| `realize` | series: `E6`, `E12`, `E24`, `E48`, `E96`, `stock`, `library` | | | Standard values versus stock versus real parts |
| `library` | `open`, `load_files`, `load_samples`, `remove`, `use` | count bucket: `1`, `2-5`, `6-20`, `21+` | | Is D5 used with real vendor files |
| `retune` (D6) | `import`, `compare`, `fit`, `suggest`, `apply` | `ok`, `refused` | | Does anyone close the loop with a VNA |
| `rft` (D7) | `run`, `apply` | `lowpass`, `highpass`, `bandpass` (the prototype of the ladder found) | | Is the real frequency ladder used, and which prototype wins |
| `next_step` | rule id (from `nextSteps.ts`) | `shown`, `taken`, `dismissed` | | Which suggestions help, which annoy |
| `guide` | `shown`, `step1`, `step2`, `step3`, `matched`, `closed` | | | Do newcomers get to a first match |
| `help` | `open`, `try_link` | | | Is the guide read |
| `plot` | `zoom`, `enlarge`, `reset` | `response`, `splot`, `measured` | | Are the new plot features used |
| `feedback` | `open`, `sent`, `failed` | | | Feedback funnel |
| `project` (docs/11) | `open`, `save`, `duplicate`, `delete`, `rename`, `import`, `export`, `export_all`, `migrate` | count bucket: `1`, `2-5`, `6-20`, `21+` (delete, import, export all) | | Are local projects used, and backed up |
| `error` | `boundary`, `worker`, `autosave`, `projects` (docs/11: a write the browser refused) | | | Crashes and failed workers in the field |

Limits:
- **`job` and `plot` events:** at most one per value per start.
- **Every other event:** at most 5 identical events (same event and fields) per start.
- **Per page load:** at most 60 events, then the queue drops new ones quietly.
- **The Worker** applies the same caps to each batch (one `start`, `job` and `plot` once per value, any other event 5 times), since it cannot trust the client (QA round 1).

### 1.4 Client (`packages/app/src/lib/analytics/`)

- `schema.ts`: the event and field enums as `as const` arrays. The app imports it, and so does the Worker (one source of truth).
- `track(event, a?, b?, c?)`: a typed function that checks the enums at compile time. It is a no-op when analytics are off. Callers sit next to the existing step names (`store.step`, `setMessage` callers, the tool open, the job hooks, the readers' refusal paths, `exportSim`, `workflowKit`, `nextSteps`).
- **Allowed** when all of these hold: the Settings switch is on (default on); `navigator.globalPrivacyControl !== true`; `navigator.doNotTrack !== '1'`; the origin is the production host (no events from localhost or previews unless `VITE_ANALYTICS_DEV=1`).
- **Batching:** an in-memory queue. It flushes with `navigator.sendBeacon('/api/e', blob)` on `visibilitychange` to hidden and on `pagehide`, and with `fetch(..., { keepalive: true })` every 60 s while there is something queued. The body is `{"v":1,"ctx":{...},"ev":[["tool","match","open"],...]}` and stays under 8 KB.
- **Failure is silent:** no retry, no queue kept across page loads, nothing written to storage.
- **Beacon:** the Web Analytics script is added by `analytics/beacon.ts` only when allowed, with the token from `VITE_CF_BEACON_TOKEN` and `"spa": false` (it does not follow later changes of the address), and never on a page load that opens a share link (`#d=`, the design in the address); switching analytics off removes it from the next page load (a loaded script cannot be taken back, and Help says so).
- **A host without the Worker:** the first send of a page load is a `fetch`; a 404 or 405 stops all sending for that page, so previews and `vite preview` stay quiet in the console. Beacons are used for the page hide only once `/api/e` has answered.

### 1.5 Owner's queries

The owner runs these with the Analytics Engine SQL API (`POST /client/v4/accounts/{id}/analytics_engine/sql`, token with Account Analytics Read), from a saved curl script or a Grafana dashboard. Columns: `blob1` event, `blob2` a, `blob3` b, `blob4` c, `blob5` ver, `blob6` lay, `blob7` ptr, `blob8` thm, `blob9` pwa, `double1` = 1. Analytics Engine samples at high volume, so counts use `SUM(_sample_interval)`.

```sql
-- Starts per day by device class (last 30 days)
SELECT toStartOfDay(timestamp) AS day, blob6 AS layout, SUM(_sample_interval) AS starts
FROM smithonline_events WHERE blob1 = 'start' AND timestamp > NOW() - INTERVAL '30' DAY
GROUP BY day, layout ORDER BY day;

-- Tool opens by tool (last 30 days); divide by starts for a share
SELECT blob2 AS tool, SUM(_sample_interval) AS opens
FROM smithonline_events WHERE blob1 = 'tool' AND blob3 = 'open' AND timestamp > NOW() - INTERVAL '30' DAY
GROUP BY tool ORDER BY opens DESC;

-- Workflow funnel: started, completed, and the step at close
SELECT blob2 AS workflow, blob3 AS action, blob4 AS step, SUM(_sample_interval) AS n
FROM smithonline_events WHERE blob1 = 'workflow' AND timestamp > NOW() - INTERVAL '90' DAY
GROUP BY workflow, action, step ORDER BY workflow, action, step;

-- Import formats and refusals
SELECT blob2 AS format, blob4 AS outcome, SUM(_sample_interval) AS n
FROM smithonline_events WHERE blob1 = 'import' GROUP BY format, outcome ORDER BY n DESC;

-- Exports by type, and version adoption
SELECT blob2 AS type, SUM(_sample_interval) AS n FROM smithonline_events WHERE blob1 = 'export' GROUP BY type ORDER BY n DESC;
SELECT blob5 AS version, SUM(_sample_interval) AS starts FROM smithonline_events WHERE blob1 = 'start' GROUP BY version;
```

Dashboards:
- **Visitors and visits:** Web Analytics, with page views per country, browser and referrer as Cloudflare shows them.
- **Weekly:** starts by device, the tool share, the workflow funnel, import refusals by reason, exports by type, and `next_step` taken against dismissed.

## 2. The Worker

### 2.1 Layout and serving

- **New workspace package `packages/worker`** (TypeScript): `src/index.ts`, `src/events.ts`, `src/feedback.ts`, `migrations/0001_feedback.sql`, and tests with `@cloudflare/vitest-pool-workers`.
- **Serving:** static assets are served without running the Worker for every path except `/api/*`. `run_worker_first: ["/api/*"]` is required: without it, `not_found_handling: "single-page-application"` would answer `/api/e` with `index.html` (**verify** that the array form is supported by the wrangler version in use). The Worker answers only `/api/e` and `/api/feedback`; any other `/api/*` path returns 404. Its `fetch` never serves the app, so a Worker error cannot take the app down.
- **`wrangler.jsonc`** (repository root):

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "smithonline",
  "main": "./packages/worker/src/index.ts",
  "compatibility_date": "2026-10-01",
  "assets": {
    "directory": "./packages/app/dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*"]
  },
  "analytics_engine_datasets": [{ "binding": "EVENTS", "dataset": "smithonline_events" }],
  // No database_id: wrangler provisions the database on the first deploy (then pin the id here).
  "d1_databases": [
    { "binding": "DB", "database_name": "smithonline-feedback", "migrations_dir": "./packages/worker/migrations" }
  ],
  // Rate limiting binding, keyed per client in memory; nothing is stored (verify key names).
  "ratelimits": [
    { "name": "EVENTS_LIMIT", "namespace_id": "1001", "simple": { "limit": 30, "period": 60 } },
    { "name": "FEEDBACK_LIMIT", "namespace_id": "1002", "simple": { "limit": 3, "period": 60 } }
  ],
  "triggers": { "crons": ["17 3 * * *"] },
  // Request logs would hold IPs and paths: off.
  "observability": { "enabled": false }
}
```

### 2.2 `POST /api/e`

- **Request checks:**
  - Only POST: anything else gets 405.
  - The `Origin` header (or, when a beacon omits it, `Sec-Fetch-Site: same-origin`) must be `https://smithchart.online`; otherwise 403.
  - No CORS headers are sent, so other sites cannot read the responses.
  - Body at most 8 KB, else 413.
  - The rate limit is keyed by `CF-Connecting-IP`, used in memory only and never logged or written: over the limit gets 429.
- **Content checks:** parse JSON with `v === 1`. The context fields must match their enums, and `ver` its regex. At most 60 events per request. Each event must be a known name with known values: unknown events are dropped one by one, and a malformed body is answered 400. The caps of section 1.3 hold per batch: further copies are dropped.
- **Daily budget:** each Worker instance writes at most 20 000 data points a day (`DAILY_POINTS_PER_INSTANCE`, in memory) and drops the rest of the day's counts, answering 204, so a flood from one place cannot spend the account's allowance. Each Cloudflare location runs its own instances: it is a guard, not an exact global limit.
- **Write:** `env.EVENTS.writeDataPoint({ indexes: [event], blobs: [event, a, b, c, ver, lay, ptr, thm, pwa], doubles: [1] })`, with empty strings for absent fields. Respond 204. The free plan writes 100 000 data points a day; at 60 events per start that is at least 1 600 starts a day, more in practice, since a typical start sends far fewer.
- **Retention:** Analytics Engine keeps data for three months (**verify**). Nothing else is stored.

### 2.3 `POST /api/feedback`

- **Request checks:** the same method, origin and CORS rules as `/api/e`; body at most 288 KiB (`MAX_FEEDBACK_BYTES`, else 413 `too_large`); rate limit 3 per minute per client, counted only after the size and field checks, so a body refused for its size or a field does not spend a send (QA round 1). The limits live in `packages/app/src/lib/feedbackLimits.ts`, shared by the dialog and the Worker.
- **Fields:**
  - `category`: one of `bug`, `idea`, `question`, `other`.
  - `message`: 10 to 4000 characters after trimming.
  - `email`: optional, at most 254 characters, a basic address check.
  - `design`: optional, a share-link payload (base64url, at most 256 KiB, `MAX_DESIGN_CHARS`; a design keeps at most 2001 measured rows, about 150 KB, so every design the app makes fits), decoded with the app's own `decodeDesign` checks (the shared code is imported from `packages/app/src/lib/share.ts` or moved to core), and rejected if it carries part data.
  - `ver`, `lay`: the enums.
  - `turnstile`: the token.
- **Turnstile:** POST to `https://challenges.cloudflare.com/turnstile/v0/siteverify` with `secret` and `response` (the IP is not passed). Failure gets 400 with `{"error":"check"}`.
- **Store:** insert one row; respond 201 `{"ref":"FB-7K3Q2M"}`.
- **Schema** (`migrations/0001_feedback.sql`):

```sql
CREATE TABLE feedback (
  id          TEXT PRIMARY KEY,            -- reference shown to the user, FB- plus 6 base32 chars
  created_at  TEXT NOT NULL,               -- ISO 8601 UTC
  category    TEXT NOT NULL CHECK (category IN ('bug','idea','question','other')),
  message     TEXT NOT NULL,
  email       TEXT,                        -- optional, cleared after 90 days
  design      TEXT,                        -- optional share-link payload, no part data
  app_version TEXT NOT NULL,
  layout      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','read','done'))
);
CREATE INDEX feedback_created ON feedback (created_at);
```

- **Retention:** the daily cron runs `UPDATE feedback SET email = NULL WHERE created_at < datetime('now','-90 days')` and `DELETE FROM feedback WHERE created_at < datetime('now','-365 days')`.
- **Deletion on request:** the user writes to the privacy address with the reference, and the owner runs `npx wrangler d1 execute smithonline-feedback --remote --command "DELETE FROM feedback WHERE id = 'FB-7K3Q2M'"`. The privacy note says the request is handled within 30 days.
- **Reading feedback:** `wrangler d1 execute ... --command "SELECT id, created_at, category, message, email FROM feedback WHERE status = 'new'"`, or the D1 console in the dashboard.
- **Migrations:** the Cloudflare build's deploy command becomes `npx wrangler deploy && npx wrangler d1 migrations apply smithonline-feedback --remote`. A first deploy runs before the table exists, so `/api/feedback` answers 503 "Feedback is not available right now" until the migration has run, and the app then offers the GitHub link.

### 2.4 Owner's steps in the Cloudflare dashboard

1. **Web Analytics:** Analytics & Logs, Web Analytics, Add a site, hostname `smithchart.online`. Choose the JS snippet, not the automatic setup, so the app can leave the beacon out when analytics are off or GPC or DNT is set. Copy the token.
2. **Turnstile:** Turnstile, Add widget. Name "Smith Online feedback", hostnames `smithchart.online` (and the preview host if previews should send feedback), mode Managed. Copy the site key and the secret.
3. **Build variables** (Workers & Pages, smithonline, Settings, Build, Variables): `VITE_CF_BEACON_TOKEN` = the Web Analytics token, `VITE_TURNSTILE_SITEKEY` = the site key. Both are public values, read at build time.
4. **Worker secret** (Settings, Variables and Secrets, Add, type Secret): `TURNSTILE_SECRET`. It survives Git deploys.
5. **Deploy command** (Settings, Build): as in 2.3. Push to master.
6. **After the first deploy:**
   - Storage & Databases, D1: check that `smithonline-feedback` exists, copy its id into `wrangler.jsonc` (`database_id`) and commit it, so a rename never provisions a second database.
   - If the dashboard asks to enable Analytics Engine for the account, enable it (**verify**).
7. **Query token:** My Profile, API Tokens, Create Token, Custom, permission Account, Account Analytics, Read. Keep it outside the repository; the owner uses it for the queries in 1.5.

## 3. Feedback UI, Settings switch, privacy note

### 3.1 Where Feedback is found

- **Desktop and tablet:**
  - The Help dialog gets a **Send feedback** button in its title bar, next to the close button.
  - The status bar gets a quiet link **Feedback**, before **Licences**.
- **Phone:** More, Help group, a row **Feedback** described as "A bug, an idea or a question".
- **Help guide:** a closing section "Feedback and privacy" with a `feedback:` link (added to `helpActions.parseTarget`).

### 3.2 The dialog (`components/FeedbackDialog.tsx`, on `ui/Dialog`, full-screen sheet on the phone)

Title: **Send feedback**. Fields, top to bottom:
- **What is it about?** A radio group with Bug, Idea, Question, Other, drawn as segments; on the phone two rows of two, each 44 px tall.
- **Message:** a textarea, 6 rows. Placeholder "What happened, or what would help? For a bug: what you did and what you expected." A counter "0 of 4000".
- **Email, optional:** placeholder "only if you want an answer". Note under it: "Used only to answer this message. Deleted after 90 days, or earlier on request."
- **Checkbox** "Attach the open design". Its note: "Sent as a share link: the network and the load, including the rows read from your files and their file names. The files themselves and library part data are not attached." Under the checkbox, when ticked: "Adds about 3 KB." A design above the cap shows "This design is about N KB, more than the 256 KB that can be attached" with **Send without the design**, and Send waits.
- **Turnstile widget:** its script loads only when the user presses Send (QA round 1; before, it loaded when the dialog opened), and the post follows its token; it is usually invisible. A line in the dialog says so.
- **Footer:** **Cancel** and **Send** (primary, disabled until the message has 10 characters and the email, if any, looks like one; an invalid email says why under the field). On the phone the footer stays at the bottom of the sheet. A quiet link "Prefer GitHub? Open an issue" goes to `https://github.com/<owner>/smithonline/issues/new` in a new tab and sends no design.

After a send:
- **Success:** the body becomes "Thank you. Reference **FB-7K3Q2M**. To have this message deleted, write to {privacy address} with the reference." with **Done**. The message is also kept in the status line, with **Copy reference**.
- **Failure (offline, 429, 503, check failed):** the text stays. The reason names the cause: the design too large, a field refused (design, message or email), more than 3 messages in a minute, the robot check, or not available. Copy: "Could not send ({reason}). Your text is still here; try again, or open a GitHub issue." The dialog keeps the draft for the session if it is closed.

Settings, Behaviour gets the switch **Share anonymous usage counts**. Its line: "Counts which tools and workflows are used, never your designs, values or files." A link **What is sent** opens Help at "Feedback and privacy". With GPC or DNT on, the switch shows off and disabled, with "Off: your browser asks sites not to track."

### 3.3 Help section "Feedback and privacy" (final copy after QA round 1, to review)

The copy in `docs/06-user-guide.md` section 12, which the app shows as its Help. Each statement about Cloudflare is checked against the page cited in section 8.3; the legal review in section 8 is still open.

> Smith Online runs in your browser. Your designs and files stay there; they are not uploaded unless you attach a design to feedback (below).
>
> **Usage counts.** To learn which features help, the app counts how often they are used: for example "Auto match opened", "a Touchstone file was read", "the Build workflow was completed". Each count carries the app version, the layout (phone, tablet, desktop or wide screen), the pointer (touch or mouse), the theme (light or dark) and whether the app runs installed or in a browser tab. Nothing else is sent with them: no design, no value, no file name, no text you typed, no identifier and no cookie, so the counts cannot tell who you are or link one visit to another. They are kept for three months.
>
> **Page views.** Cloudflare Web Analytics counts page views: the page address without its query string, the page you came from, and how fast the page loaded; Cloudflare shows them by country, browser and device type. Its script stores nothing in your browser, and Cloudflare does not keep your network address. Cloudflare keeps the full data for 7 days, then a sample of about a tenth, and shows six months of it. It is not loaded when the page opens a share link, and it does not follow later changes of the address, so a design in a link never reaches it.
>
> **Turning them off.** Settings, Behaviour, **Share anonymous usage counts**. Switched off, the app sends no more counts from that moment; Web Analytics, if it was loaded with the page, stops from the next page load. If your browser sends Global Privacy Control or Do Not Track, neither is sent.
>
> **Feedback.** What you write in Send feedback is stored so it can be read and acted on, with the app version and the layout. The design is attached only if you tick the box; it then includes the rows read from your files and their file names, while the files themselves and library part data are not attached. An email address, if you give one, is used only to answer and is deleted after 90 days. Messages are deleted after 12 months. To have a message deleted earlier, open an issue on GitHub with its reference and no personal details; it is deleted within 30 days.
>
> **The robot check.** Pressing Send first loads Cloudflare Turnstile from challenges.cloudflare.com, which checks that a person is sending. For that check Cloudflare receives your network address and signals from your browser, as its [Turnstile Privacy Addendum](https://www.cloudflare.com/turnstile-privacy-policy/) describes; what its checks may store in the browser is in [Cloudflare's cookie policy](https://www.cloudflare.com/cookie-policy/). Nothing of Turnstile loads before you press Send.
>
> The site is served by Cloudflare, which processes the network address of every request to deliver the page; the app's own counts and feedback do not store it.

The guide's existing claim "nothing leaves the browser" (section 10, Data in this browser) becomes "your designs and files never leave the browser unless you attach a design to feedback".

## 4. Response plots

### 4.1 Today (`response/Plot.tsx`, `ResponseView.tsx`)

- **Layout:** four uPlot panels, each `.response .panel` with an `h3` and a `.plot-host` sized by CSS, plus the measured-board plot (`MeasuredBoardPanel`) and the S-Plot graphs. All of them use `Plot`.
- **Cursor:** the cursor is synced through `SYNC_KEY` (cursor only).
- **Drag:** `cursor.drag` is off, and a click sets a marker.
- **Phone:** a sideways drag scrubs the cursor (`plotTouch.ts`), and `touch-action: pan-y` leaves vertical swipes to the page.
- **Missing:** no zoom, no export per plot, no way to make a plot larger.

### 4.2 Zoom

- **Shared frequency zoom:**
  - A session field `response.xZoom: [f1, f2] | null` in `useDesignStore` drives the x scale of every Response panel through `u.setScale('x', ...)`. Frequency is the axis people zoom on, and markers, limit areas and the readout table stay aligned.
  - Each S-Plot graph and the measured-board plot keep their own x zoom, because their frequency ranges differ.
  - A change of the sweep range, Log f or the measured load clears the zoom.
- **Y range per plot:** while x is zoomed, y fits the visible data of that plot (with the axis `range` rule it already has). A box zoom fixes y for that plot until reset.
- **Mouse:**
  - Drag in the plot area draws a box (uPlot `cursor.drag: { x: true, y: true, uni: 12 }`, `setSelect` hook). Release zooms x for all panels and y for this one.
  - A click (movement under 4 px) still sets a marker.
  - Ctrl or ⌘ + wheel zooms x about the pointer. A plain wheel keeps scrolling the page, since the view scrolls on short windows and a captured wheel would trap it.
  - Shift + drag pans x.
  - A double-click resets this plot's y and the shared x; both of its clicks are taken back, so it neither adds nor removes a marker.
  - A drag stays on the plot it is made on (the sync group passes the cursor, not the drag).
- **Toolbar:** when zoomed, a chip appears in the Response toolbar: "Zoomed to 2.30 to 2.55 GHz · Reset" (Reset clears x and every fixed y). A box of y only shows the chip too. The hint under the toolbar names the gestures: "Drag to zoom, double-click to reset, Ctrl or Cmd wheel, E to enlarge" (on touch: "Enlarge a plot to pinch zoom; double tap resets"); the chip's tooltip says the same. An S-Plot graph and the measured-board plot show the same chip in their own head.
- **Height in place (QA round 1):** each Response plot row is at least 236 px (280 px on a phone), which leaves a plotting area of about 160 px at 1440 x 900, at 1024 x 768 and on a phone; the frequency axis band is 36 px. Four plots do not fit a short window: the view scrolls. S-Plot rows are 236 px, the measured-board plot 210 px (230 px on a phone).
- **Keyboard:** each plot area is focusable (`tabindex=0`, `role="img"`, aria-label "VSWR plot, 225 MHz to 900 MHz").
  - **+ and -:** zoom x about the cursor, or the centre.
  - **Left and Right:** move the cursor one sample; with Shift they pan x by a tenth.
  - **Enter:** sets a marker at the cursor.
  - **0:** resets.
  - **E:** enlarges.
  - **Escape:** leaves the enlarged plot (an Escape layer `plot`, below dialogs).
- **Log f:** the zoom works in log x (uPlot `distr: 3`), with box edges in frequency.

### 4.3 Enlarge

- Each panel head gets two icon buttons at its right end: **Enlarge** (maximize icon, aria-label "Enlarge VSWR") and **Export** (a download icon opening a small Menu: "PNG image", "SVG drawing", "CSV data").
- Enlarged, the chosen panel fills the plot area of the Response view, from the toolbar down to the readout table, at least 420 px high. The other panels are hidden but stay mounted, so their zoom state and cursor sync continue.
- The panel head reads "VSWR" with **Back to all plots** (minimize icon and text). The view does not change and the URL does not change.
- `response.enlarged: panelId | null` is session state, kept when switching views and back.
- Applies to the Response panels, the measured-board plot and each S-Plot graph, each within its own view.

### 4.4 Export of one plot

- **PNG:** an offscreen uPlot drawn at 1600 x 900 px, scale 2, in the light theme on white, the same rule as the chart PNG. It shows the current zoom, the title and a legend row drawn on the canvas, and the design name and date in a footer line. File name `{design}_{panel}.png`, e.g. `antenna_vswr.png`.
- **SVG:** a small writer (`response/plotSvg.ts`) draws the axes with ticks chosen for the drawing's size (about one per 60 units up and per 100 across; QA round 1, the on-screen ticks were too few for 800 x 450), each series as a polyline (dots for measured series, dashes kept), the limit areas, the VSWR band, the markers, the design frequency line and a legend that wraps over up to 6 rows so every curve is named. The title keeps the y unit ("Gain and return loss, dB"). A flat range (the group delay of an empty network) is widened about its value, and control characters are dropped from text, so the document stays well-formed and free of NaN. Light theme, 800 x 450 user units, text as text. File `{design}_{panel}.svg`.
- **CSV:** the plotted data of that panel over its full range, not only the zoom. The first column is frequency in Hz; then one column per visible series with its unit in the header (`|S21| dB`, `VSWR`, `R ohm`, `Group delay s`). Measured dots, which sit on their own frequencies, follow in a second block after an empty line. File `{design}_{panel}.csv`; decimal point, comma separated. A column name that starts like a formula (= + - @, tab, CR) gets a leading apostrophe.
- Each export writes a status message ("Saved antenna_vswr.png") and a `plot`/`export` event.

### 4.5 Phone

- The panel head buttons are 44 px. **Enlarge** opens the plot full screen as a page (the sheet goes to peek). The top bar shows "‹ Plots", the title and **Export**; landscape is used when the device is turned.
- In the enlarged plot:
  - **Pinch:** zooms x about the midpoint.
  - **Two-finger drag:** pans x.
  - **Double tap:** resets.
  - **One-finger sideways drag:** keeps scrubbing the cursor with the readout row under the plot.
  - **Tap:** sets a marker.
  - A vertical swipe does nothing in the enlarged page (no page to scroll), so pinch and pan get the full gesture.
- Outside the enlarged page nothing changes: the plots scroll with the page, and pinch is left to the browser.
- Gesture maths reuse `chart/gestures.ts` (the pinch about the midpoint with limits) on one axis; the zoom limit is 1/1000 of the data span.

### 4.6 Files

- `response/Plot.tsx`: x scale from props, `drag` select, wheel with a modifier, the keyboard, focus, the `setSelect` and `drawAxes` capture.
- New `response/PlotPanel.tsx`: the head with title, legend, Enlarge and Export; used by Response, MeasuredBoardPanel and S-Plot.
- `response/ResponseView.tsx` and `splot/SPlotView.tsx`: render through PlotPanel, the zoom chip, enlarged state.
- New `response/plotExport.ts` (PNG, CSV) and `response/plotSvg.ts`.
- `lib/plotTouch.ts`: pinch in the enlarged page.
- `index.css`: `.plot-panel.enlarged`, head buttons, chip.

## 5. Tool heads

### 5.1 The rule

- When Auto match, Optimize band, Tolerance or Build is open (D6 lives in Build's Measured section, so it follows Build), the column shows the tool's head and nothing else above it: **title**, the existing ? help link and **Show me**, and **X** ("Close Auto match"). The "Numbers | Auto match" segmented control is removed.
- X closes the tool and shows what the column showed before: Numbers on a desktop, and on a tablet the pane last shown (Network or Numbers).
- **A running search keeps running after X.**
  - It shows as a job row at the top of the column: "Broadband search 42 %, best VSWR 1.84 · Show · Stop" (Progress, docs/07).
  - The header tool button keeps its dot; when the job finishes, the row turns into its result line for 8 s ("Broadband search done: best worst-case VSWR 1.31 · Show"), and the dot becomes the check dot until the tool is shown.
  - **Stop** is the only way to stop a job.
  - The panel component stays mounted while its job runs (a `background` set in `useShell`), so the job keeps its worker.
- **Header button:** pressing the button of the open tool closes it; pressing it while the tool is closed but busy shows it again.

### 5.2 Per layout

- **Desktop and wide:** the right column holds Numbers, or the open tool with its head. `SideColumn` renders `ToolHead` in place of `ToolStrip`; `effectivePane` returns `tool` whenever a tool is open.
- **Tablet:** with no tool open, the segmented control Network | Numbers stays (two panes share the column). With a tool open, the tool head replaces it. To edit the network while a tool is open, close it with X, or use the chart and the schematic strip, which stay in view.
- **Phone:** the sheet's segments Network | Numbers | Tools stay (main navigation). Inside Tools, the pushed tool head loses the back chevron "‹ Tools": it shows title and X; X returns to the Tools list and a running job keeps running (its line at peek already exists).

### 5.3 Dependencies and how each changes

| Where | Today | Change |
|---|---|---|
| `layout/ToolStrip.tsx` | segmented strip, progress of a hidden job, check dot | replaced by `layout/ToolHead.tsx` (title, help, Show me, X) and `layout/JobRow.tsx` (progress or result of a closed busy tool) |
| `layout/SideColumn.tsx` | strip with panes `numbers`, `tool` (plus `network` on a tablet) | desktop: no strip; tool head when open. Tablet: Network | Numbers control when no tool, tool head when open |
| `lib/layout.ts effectivePane` | stored pane with a tool fallback | `tool` whenever a tool is open; else stored pane (tablet) or `numbers` |
| `store/useShell.ts` | `pane`, `pushTool`, `popTool`, `toolPushed` | keep `pane` for tablet and phone; desktop ignores it; add `background: ToolId[]`; `pushTool` and `popTool` stay for the phone list |
| `App.tsx toggleTool` | open tool's button brings back its segment (`pushTool`) | open tool's button closes it; a closed busy tool's button shows it |
| `App.tsx setTool(null)` | unmounts the tool; job stops | unmount only when no job runs; else mark it background and hide |
| Close tooltip | "Close X; a running job stops" | "Close Auto match; a running search keeps running (Stop ends it)" |
| `store/useJobs.ts useSeenWhileShown` | dot cleared when the tool's segment shows | cleared when the tool panel shows |
| `lib/tourUi.ts show('numbers')` | sets pane `numbers` beside an open tool | on desktop and tablet with a tool open: close the tool first (job keeps running), then show Numbers |
| Workflow steps at `place: 'numbers'` (`measured-antenna` model; amplifier device, stability, noise, gain circles) | Numbers segment beside the tool | unchanged copy; `show` closes the tool. The "Open Numbers, ... first" fallback (`workflowKit.ts` line 183) keeps its text |
| Workflow steps at `place: 'tool'` | `pushTool` | `openTool` (already does) |
| `lib/nextSteps.ts` line 376 `tourUi.show('numbers')` | | as `show` above |
| `layout/PanelSheet.tsx` pushed head | "‹ Tools", title, X | title, X; X returns to the list |
| Escape stack | Escape closes the open tool | unchanged; focus goes to the header button (desktop) or the Tools list row (phone) |
| Keyboard | arrow keys moved between strip segments | gone; Tab order: header, left column, chart, tool head, tool body |
| `docs/07` sections 2.2, 4 (Progress), 5; `docs/06` sections 1 and 4 | strip described | updated |
| Tests: `ir5-shell-layout.test.tsx` (and its snapshot), `qa-p4-app-layouts`, `qa-p4-shell`, `d2-measured-load`, `ir6-leftovers`, `qa-d2-band-tools`, `qa-p3-fixes` | query the tablist "Numbers or Auto match" and the strip progress | query the tool head (heading and "Close Auto match"), the job row, and that a job survives X; update the snapshot |

## 6. Implementation order and QA

| # | Item | Size | Notes |
|---|---|---|---|
| 1 | Tool head, job row, background tools (section 5) | M | independent; smallest visible win |
| 2 | Plot panel head with Enlarge, PNG and CSV export | M | Response first, then S-Plot and measured board |
| 3 | Zoom: box, modifier wheel, keyboard, shared x, reset chip | M | |
| 4 | Phone enlarged page with pinch | S | needs 2 and 3 |
| 5 | SVG export of a plot | M | |
| 6 | `packages/worker`: routing, `run_worker_first`, `/api/e` validation, rate limits, tests; `wrangler.jsonc` | S | deploy before any client sends |
| 7 | Analytics client: schema, gating (switch, GPC, DNT, host), queue, beacon loader; events at their call sites | M | about 40 call sites |
| 8 | Feedback: dialog, Turnstile loader, `/api/feedback`, D1 migration, cron retention | M | |
| 9 | Settings switch, Help section, guide claims, changelog; owner's dashboard steps (2.4) | S | legal review of 3.3 before release |

Items 1 to 5 and 6 to 9 are independent tracks. Release the analytics and feedback track only with the privacy note in Help and the switch in Settings.

### QA

- **Privacy:** with the app driven through every workflow, record all network requests (Playwright `page.on('request')`).
  - Only `/api/e`, `/api/feedback`, `static.cloudflareinsights.com` and `cloudflareinsights.com` (beacon), and `challenges.cloudflare.com` (only after Send feedback opens) leave the page.
  - Every `/api/e` body parses, and every key and value is in `schema.ts`; no number other than the version, no text from the design.
  - With the switch off, `navigator.globalPrivacyControl = true` or `doNotTrack = '1'`: no `/api/e` request and no beacon script.
  - No cookie is set by the app.
- **Worker:** unknown event or value dropped; wrong Origin 403; GET 405; 9 KB body 413; 31st request a minute 429; a feedback with a failed Turnstile check 400; a design with part data refused; a valid feedback inserted and its reference returned; the cron clears emails older than 90 days and rows older than 365; static paths (`/`, `/assets/...`, a deep link) are served without invoking the Worker; `/api/unknown` 404.
- **Offline:** with `/api/*` blocked or the network off, the app loads and works, no error banner or console error appears, the queue does not grow past 60 or retry, and Feedback says it could not send and keeps the text.
- **Plots:**
  - Box zoom on VSWR zooms all four panels in x and only VSWR in y; a click still sets a marker; double-click resets.
  - Ctrl + wheel zooms and a plain wheel scrolls the page.
  - Keyboard + - 0 E Escape work.
  - Log f zoom works.
  - The enlarged plot keeps cursor sync and markers; Escape returns.
  - PNG, SVG and CSV of a zoomed plot: PNG and SVG show the zoom, CSV the full range; the SVG opens in a browser and in Inkscape.
  - Phone: enlarge, pinch, double tap, scrub, export at 390 px, portrait and landscape.
  - The same in S-Plot and the measured-board plot.
- **Tool heads:**
  - On every layout, opening each of the four tools shows only the title, help, Show me and X; X returns to Numbers (desktop) or the previous pane (tablet), or the Tools list (phone).
  - A Broadband search survives X, shows its job row and finishes with a result line and the check dot; Stop stops it.
  - Workflows that step from a tool to Numbers (measured antenna, amplifier) run end to end at 1440, 1024, 768 and 390 px.
  - Escape order and focus return are correct.
- **Copy:** no em or en dashes; the guide, Help and the Settings line agree with what is sent.

## 7. Owner decisions (2026-10-27)

1. **Usage counts are on by default** (opt-out in Settings), with Global Privacy Control and Do Not Track honoured. The Help privacy note gets a short legal review before the release.
2. **No country** on events; Cloudflare Web Analytics already shows countries.
3. **Contact: GitHub issues only** (https://github.com/QumeaJR/smithonline/issues). No email address is published. Deletion requests go there by reference number, without personal details in the issue; the privacy note says so.
4. **Retention** as proposed: email addresses 90 days, feedback messages 12 months.
5. **Tablet:** the Network | Numbers control is hidden while a tool is open, as on the phone.
6. **Design attachment** may include the measured rows of the user's own files, and the checkbox note says so. Vendor part files are never attached.

## 8. Implementation (2026-10-27, branch `docs10`)

Built in the order of section 6. Status: implemented, not deployed; the analytics and feedback track goes live only after the owner's steps in `README.md`, Deployment, and the legal review below.

**Legal review before release (open):** the Help section "Feedback and privacy" (`docs/06-user-guide.md` section 12, which the app shows as its Help; quoted in section 3.3) is the final wording after QA round 1 and still needs a legal review before release. Deletion requests go to a GitHub issue with the reference and no personal details (section 7, decision 3). What each statement about Cloudflare rests on (pages in section 8.3):
- Web Analytics counts page views with the page address but not its query string, the referrer and load timings, and Cloudflare shows them by country, browser and device type: the RUM beacon page (fields), the Web Analytics FAQ (no query strings) and Dimensions.
- Its script stores nothing in the browser and Cloudflare does not keep the address: the RUM beacon page ("does not store any data in the browser"; the IP is discarded at the nearest data center and not stored in core databases or logs). This replaces the earlier "without cookies", whose source was a 2020 post.
- Full data for 7 days, then about a tenth, six months on show: the Web Analytics FAQ. The app's own counts, three months: Analytics Engine limits.
- Not loaded on a share link page and no tracking of later address changes: the app's own choice (`spa: false`, the Web Analytics SPA page).
- Switching off takes effect for Web Analytics from the next page load: the beacon reports when the page is first hidden (Web Analytics FAQ); a loaded script cannot be unloaded, so Help says "from the next page load".
- Turnstile receives the address and browser signals: the Turnstile Privacy Addendum (IP address, TLS fingerprint, user agent, sitekey and origin). What it may store in the browser is left to Cloudflare's cookie policy, which Help links; it was not checked which storage the widget uses.

### 8.1 What was built

- **Tool heads (section 5):** `layout/ToolHead.tsx` and `layout/JobRow.tsx` replace `layout/ToolStrip.tsx`; `useShell.background` keeps a closed busy tool's panel mounted (hidden) until its job ends without a result or the tool is shown again; Stop reaches the job through `useJobs.stops`. `effectivePane` returns `tool` whenever a tool is open (desktop, wide, tablet). `tourUi.show('numbers')` (and `show('network')` on a tablet) closes an open tool first; a running job keeps running.
- **Plots (section 4):** `response/PlotPanel.tsx` (head, Enlarge, Export menu, Escape layer `plot`), `response/Plot.tsx` (box zoom through uPlot's select, Ctrl or ⌘ wheel, Shift drag pan, double click reset with the first click's marker taken back, keys + - arrows Enter 0 E, two-finger pinch and pan and double tap in the enlarged phone page), `lib/plotZoom.ts` (pure zoom maths, linear and log f, limit 1/1000 of the span), `response/plotSvg.ts`, `response/plotExport.ts`. Response keeps `response.xZoom` (with the sweep it was made on, so a new sweep range, Log f or measured load clears it) and `response.enlarged` in the session store; S-Plot graphs and the measured-board plot keep their own zoom.
- **Worker (section 2):** `packages/worker` (`src/index.ts`, `src/events.ts`, `src/feedback.ts`, `src/http.ts`, `migrations/0001_feedback.sql`), 19 tests with plain request handlers, a SQLite stand-in for D1 (Node's `node:sqlite` running the real migration) and a fake rate limiter; `wrangler.jsonc` as in section 2.1 plus `vars.ALLOWED_ORIGIN`; `wrangler` 4.149.0 pinned as a root dev dependency.
- **Analytics client (section 1.4):** `lib/analytics/schema.ts` (shared with the Worker), `track.ts` (typed `track`, `trackDynamic` for run-time ids checked against the schema, gate, queue, beacon and keepalive flush), `beacon.ts`, `files.ts` (format and refusal names), `index.ts` (start). About 80 call sites. The switch is `settings.shareUsageCounts` (default on; Reset all leaves it as chosen).
- **Feedback (section 3):** `components/FeedbackDialog.tsx`, `lib/feedback.ts` (store with the session draft, body, send, Turnstile loader), `lib/feedbackLimits.ts` (the caps the Worker shares); entry points in Help's title bar, the status bar (also on a tablet), More on a phone and the guide's `feedback:` link (`helpActions.parseTarget`).

### 8.2 Deviations, and why

- **The PNG is the SVG drawn on a canvas** at 1600 x 900 (scale 2 of 800 x 450), not an offscreen uPlot: one drawing for both formats, so PNG and SVG always agree, and the writer is testable without a canvas.
- **The SVG chooses its own ticks** for its 800 x 450 size (1, 2, 5 steps, log decades on Log f), not those of the plot on screen: a short plot on screen had too few for the export (QA round 1). There is no `drawAxes` capture.
- **The Worker checks a design with its own structural check** (base64url, at most 64 KB, JSON with an element list, no `part.data` anywhere), not `decodeDesign`: `lib/share.ts` pulls in React and four zustand stores that read `localStorage` at load. The app's `encodeDesign` leaves part data out, so the check only refuses a hand-made payload.
- **Workflow ids:** the schema lists the 9 workflows of `lib/workflows.ts` today (section 1.3 said 7); a test keeps the lists of workflows, lessons, examples and next-step rules equal to the app's.
- **Turnstile site key:** the build's `VITE_TURNSTILE_SITEKEY`; without one, `localhost` uses Cloudflare's documented test key `1x00000000000000000000BB` (invisible, always passes) and any other host shows "Feedback is not set up on this site" with the GitHub link. Local `wrangler dev` reads `TURNSTILE_SECRET` from `.dev.vars` (ignored by git), for example the test secret `1x0000000000000000000000000000000AA`.
- **Retention cut-offs** are computed in the Worker as ISO 8601 strings and bound as parameters (`created_at < ?`), since `datetime('now','-90 days')` writes a space where the stored ISO strings have a `T` and would shift the boundary by up to a day.
- **The job row** sits at the top of the column (above the tool head or the tablet's segments), not inside Numbers only, so a search started in one tool stays in view while another tool is open.
- **Events not wired:** `retune` with `import` (the measurement is counted as `import ... measurement` and `retune compare`).
- **Tablet:** Network | Numbers is hidden while a tool is open (decision 5); `tourUi.show('network')` closes the tool there as `show('numbers')` does.

### 8.3 The "verify" items, checked 2026-10-27 against developers.cloudflare.com

Pages fetched for the privacy text in QA round 1 (2026-10-27):
- RUM beacon (fields sent, no browser storage, the IP discarded): https://developers.cloudflare.com/speed/observatory/rum-beacon/
- Web Analytics FAQ (7 days unsampled then about 10 %, six months of data, no query strings, the beacon sends on the first hidden state): https://developers.cloudflare.com/web-analytics/faq/
- Web Analytics dimensions (country, device type, browser, path, referer): https://developers.cloudflare.com/web-analytics/data-metrics/dimensions/
- Web Analytics for SPAs (`spa: false` turns off the tracking of address changes): https://developers.cloudflare.com/web-analytics/get-started/web-analytics-spa/
- Analytics Engine limits (data stored for three months, 250 data points per invocation): https://developers.cloudflare.com/analytics/analytics-engine/limits/
- Turnstile Privacy Addendum, last updated 18 June 2025 (the signals Turnstile processes): https://www.cloudflare.com/turnstile-privacy-policy/
- Cloudflare cookie policy (linked from Help for what its checks may store): https://www.cloudflare.com/cookie-policy/

The items of the first check:

- `run_worker_first` as an array of route patterns: supported (boolean or array, `*` globs and `!` exclusions, at most 100 entries). The array form turns off the automatic `Sec-Fetch-Mode: navigate` handling; paths that match no pattern follow asset-first routing, so the Worker runs only for `/api/*`. Checked locally with `wrangler dev` 4.149.0: `/`, `/assets/` and a deep link answered `index.html` (200) and produced no Worker trace; `/api/unknown` 404, GET `/api/e` 405, another origin 403, a 9 KB body 413, a valid batch 204, a feedback with the test keys 201 and a row in the local D1.
- Rate limiting binding: top-level `ratelimits` with `name`, `namespace_id` (a string of a positive integer), `simple.limit` and `simple.period` (10 or 60 only); `env.X.limit({ key })` resolves `{ success }`; counts are per Cloudflare location and eventually consistent; needs wrangler 4.36.0 or later. The docs advise against IP keys (shared addresses); the spec's choice stands, the limit is generous for one person.
- Analytics Engine: data kept three months; per data point up to 20 blobs, 20 doubles, 1 index (96 bytes); up to 250 data points per Worker invocation (the app sends at most 60); Workers Free 100 000 data points written and 10 000 read queries a day; the dataset is created on the first write; SQL API `POST /client/v4/accounts/{account_id}/analytics_engine/sql` with a token with Account Analytics Read. No separate enable step is documented.
- D1 without `database_id`: automatic provisioning (open beta since wrangler 4.45.0) creates the database on the first deploy and keeps it linked; deploys from the dashboard or Git show the id only in the dashboard. `wrangler d1 migrations apply smithonline-feedback --local` worked locally without an id; whether `--remote` resolves the provisioned database by name was not tested (no account access), so README.md asks the owner to pin the id before adding the migration to the deploy command.
- Turnstile siteverify: `POST https://challenges.cloudflare.com/turnstile/v0/siteverify` with `secret` and `response` (`remoteip` optional, not sent), JSON accepted; tokens are valid 300 s and single use; test keys as above.
- Secrets survive deploys (`wrangler deploy` does not delete them); `observability.enabled: false` keeps request logs off.
- Web Analytics: on a site proxied by Cloudflare the automatic setup is on by default and would inject the beacon whatever the app decides; the owner must choose the JS snippet (or switch the automatic setup off) for GPC, DNT and the switch to hold. The beacon reports to `cloudflareinsights.com/cdn-cgi/rum`.

### 8.4 QA round 1 (2026-10-27)

What changed after the first review (one blocker, five majors, minors); the tests are `packages/app/test/qa-d10-fixes.test.tsx`, `qa-d10-fixes-flow.test.ts`, `packages/worker/test/qa-d10-fixes.test.ts` and the reviewers' `adv-d10-*`.
- **Box zoom (blocker):** the `setSelect` hook read `u.select` after clearing it (uPlot writes the cleared box into the same object), so no box ever zoomed. It copies the box first. A drag is no longer passed through the cursor sync group, so a box zooms its own plot (and, on the Response view, the shared x) and fixes y on that plot only.
- **Plots too small and zoom not found (major):** rows of 236 px (phone 280 px) and a 36 px frequency axis: a plotting area of about 160 px in place at 1440 x 900, 1024 x 768 and 375 x 812, the view scrolling. The gesture hint sits under the Response toolbar and in the S-Plot hint, and the zoom chip carries it as its tooltip; S-Plot graphs and the measured-board plot show the chip with Reset in their head. The Response toolbar wraps instead of overflowing on a tablet.
- **Double click or double tap (major):** both clicks of a double click (both taps of a double tap) are taken back; a reset neither adds nor removes a marker. S-Plot takes back its row selection too.
- **Exports (major):** see section 4.4 (wrapping legend, title with unit, ticks for the export size; NaN, control characters, formula cells).
- **Feedback with a measured design (major):** the design cap is 256 KiB and the body cap 288 KiB, both in `lib/feedbackLimits.ts`; the dialog checks the size before Send and offers Send without the design; failures name their cause; the rate limit counts only requests that passed the size and field checks.
- **Privacy text (major):** section 3.3 and the legal review above; Turnstile loads on Send only; the beacon has `spa: false` and stays off share link pages; Settings says when Web Analytics stops.
- **Minors:** server-side caps and a daily write budget (section 2.2); `/api` probed by the first fetch, silent after a 404; Show me and ? in the fixed tool head; Optimize band copy points at the sweep panel under Numbers; the Export menu reads "as zoomed"; the feedback categories are a radio group, the textarea is named Message, an invalid email says why, the phone footer stays at the bottom; Feedback opened from Help returns to Help, and Help opened from Settings returns to Settings; the Settings switch is described by its line; the phone "‹ Plots" button is 44 px.
