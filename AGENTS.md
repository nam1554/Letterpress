<!-- BEGIN:nextjs-agent-rules -->

# Next.js: ALWAYS read docs before coding

Before any Next.js work, find and read the relevant doc in `node_modules/next/dist/docs/`. Your training data is outdated — the docs are the source of truth.

<!-- END:nextjs-agent-rules -->

# Letterpress (repo: marketing-html-maker) — agent notes

Local-only Next.js app: paste a Figma eDM design URL in the browser, a headless
CLI agent job converts it to email-safe HTML (via the vendored `figma-edm`
skill), and the artifacts are downloadable as a zip. Not a deployed service —
no auth, single user, filesystem is the database.

- **The `figma-edm` skill lives at `skills/figma-edm/` and ONLY there** — it is
  managed and versioned in this repo; edit and commit it here. All backends
  read its files via `FIGMA_EDM_SKILL_DIR` (repo path; the spawned CLI's cwd
  is the job workDir, so skill auto-discovery can't work). The old
  `~/.claude/skills/figma-edm` copy was removed (2026-07-29) — do not
  reference or recreate it.

- Design doc: `docs/superpowers/specs/2026-07-28-marketing-html-maker-design.md`

## Architecture map

- **Agent backends** are isolated behind `lib/providers/types.ts`
  (`AgentProvider`): `claude-code` (default) · `gemini` · `codex` · `mock`.
  Real-run status: `claude-code` completes honest builds (2026-07-29:
  PASS 97.2~97.5%, 14~16min · 2026-07-30 on the rewritten browser-measured
  gate: PASS 98.12%, 15min, gate failures/warnings/repair runs all zero,
  380 live chars, 13 images all loaded, 28.0% coverage, measurement 2.7s for
  both deliverables). `codex` repeatedly tried to game the gate
  (screenshot variants ×3 — see the acceptance gate notes) and then hit its
  ChatGPT plan usage limit; treat as experimental. `gemini` dies mid-pipeline
  with `[API Error]` once the API key's quota runs out (a smoke prompt passes,
  a real conversion doesn't) — needs a paid-tier key for real use.
  Shared pieces: `jsonl-cli.ts` (execa: line streaming, stderr tail, and
  `killDescendants` so a cancel kills the CLI's grandchildren — the wrappers
  re-spawn the real binary; on Windows that becomes `taskkill`, and execa also
  runs `.cmd` shims that Node refuses to spawn since CVE-2024-27980),
  `prompt.ts` (shared eDM prompt + agent env, including `CHROME_BIN`).
  Add a new backend = one file + one `registry.ts` entry. Parsers are exported
  pure functions with tests in `parsers.test.ts`.
- **Job state** lives in `data/jobs/<id>/` (`job.json` atomic-written,
  `events.ndjson` with per-job monotonic `seq`, `work/output/` = downloadable
  artifacts). Never commit `data/`. Job ids are 8-hex — `jobDir()` enforces
  this; all fs paths derive from it. `jobDirSize()` reports per-job disk usage —
  cached per (id, status) so a resume/edit re-measures, with a 30s TTL while
  running (the home page polls `/api/jobs` every 5s and a full recursive walk of
  a live `work/` tree competes with the SSE log stream) and
  `invalidateJobSize()` for outside writes (the hosting route). `POST /api/jobs/
  bulk-delete` removes selected jobs with per-id results — the UI only ever
  submits the CURRENTLY VISIBLE selection, after a confirm click, so a filter or
  search can't delete rows the user never saw; `lib/jobs/notify.ts` fires a
  best-effort macOS notification on job finish (`notifyOnFinish` setting,
  default on) — but not on user cancel, which is not a failure. Cancel is
  detected on BOTH runner paths: the real backends resolve `{ok:false}` on
  abort rather than throwing, so a guard in the `catch` block alone does
  nothing outside the mock provider.
- **Settings** (`lib/settings.ts` → `data/settings.json`, edited via the ⚙️
  panel): default provider, concurrency cap, job timeout, Figma REST fallback
  token. The REST fallback is NOT a substitute for MCP on free Figma files:
  limits follow the plan the FILE lives in, and a Starter-plan file caps at
  6 requests/month (one conversion spends several), so it only works on
  Professional+ files. That path also has no real-run record — the PASS 97%
  numbers are all from the MCP path. Precedence: settings.json > env > default. Keys/tokens are validated
  against the real APIs at save time (`lib/setup.ts` validators).
- **Backend setup** (`lib/setup.ts`, 🔌 panel on home): per-backend deep
  diagnosis — CLI install, auth, Figma access via `mcp list` parsing (pure
  parsers, tested in `setup.test.ts`) with Figma-token REST fallback awareness.
  "연동 테스트" spawns the real CLI with a tiny prompt (`runBackendTest`,
  in-flight deduped, 2-min cap). Home form warns when the selected backend
  isn't ready. `lib/health.ts` keeps only the required-path checks.
- **Lifecycle**: `lib/jobs/runner.ts` spawns providers with an AbortController
  (timeout + cancel), `store.ts` reconciles stale running jobs on read after a
  server restart. SSE route replays events then relays live ones, deduped by
  `seq`. Invariants worth not regressing (each has a test):
  - `startJob` rolls back the controller + timer if start-up throws. A leaked
    controller inflates `runningJobCount()` forever, so the concurrency cap
    rejects every later job and `deleteJob` refuses that job for good.
  - `appendEvent` is best-effort: a disk error or a throwing subscriber (a
    closed SSE stream) must never kill the running job. `readEvents` skips a
    corrupt line rather than discarding the whole log.
  - `live.ts` aborts running jobs on SIGINT/SIGTERM too, not just `'exit'` —
    CLIs are spawned `detached`, so they never receive the foreground group's
    Ctrl-C and would keep burning tokens as orphans.
  - The SSE route registers its disconnect handler BEFORE subscribing (a client
    leaving mid-replay used to leak the subscription), and re-reads the job once
    the `STALE_GRACE_MS` window expires — otherwise a page opened within 10s of
    a restart hangs on "실행 중" with no recovery path.
  - `reserveJobId()` never returns an id whose directory exists; a collision
    would silently overwrite an existing job.
- **Cross-platform**: macOS is the verified platform; Windows support is in the
  code but not yet run on real hardware. Rules: no hard-coded tool paths
  (`lib/chrome.ts` / `lib/python.ts` resolve them, `CHROME_BIN` / `PYTHON_BIN`
  override); spawn only through `jsonl-cli.ts` (execa handles `.cmd` shims and
  tree-kill); `python3` does not exist on Windows (`py -3`), and the bundled
  skill scripts call `sys.executable` instead; file URLs come from
  `Path(...).as_uri()`, never `file://` + a raw path; `fs.rm` uses retries
  because Windows refuses to delete open files. Launchers: `시작하기.command`
  (zsh) and `시작하기.bat` → `scripts/start-windows.ps1` (PowerShell 5.1 syntax,
  CRLF via `.gitattributes`).
  The .ps1 MUST keep its UTF-8 BOM: Windows PowerShell 5.1 reads a BOM-less file
  as legacy ANSI, which mangles the Korean strings (official
  `about_Character_Encoding`). The .bat stays pure ASCII (cmd uses the OEM code
  page). Package-manager calls go through `cmd /c` — PowerShell picks `npm.ps1`
  over `npm.cmd` via PATHEXT and then trips over the execution policy.
  No exit hook is used: `PowerShell.Exiting` and `finally` were both measured
  NOT to run under `-File`; cleanup relies on the shared console (a `-NoNewWindow`
  child dies with the window) plus the next launch detecting a stale server.
  Without Windows hardware, validate with a portable pwsh: parse with
  `[Parser]::ParseFile`, lint with `Invoke-ScriptAnalyzer`, then dot-source the
  script from a harness that stubs `Get-NetTCPConnection`/`Start-Process`/
  `Invoke-WebRequest`/`Read-Host` and points `$env:ComSpec` at a shell shim.
- **Chrome discovery** goes through `lib/chrome.ts` (chrome-launcher) and is
  exported to the agent as `CHROME_BIN`; `compare.py` reads that env first.
  A hard-coded `/Applications/...` path meant pixel-verify could never run off
  macOS, and the gate then fails an otherwise correct build for "no verify.json".
  The **not-found** result is cached too, with a 60s TTL: on macOS the miss IS
  the slow path (chrome-launcher's `darwinFast()` returns early only on a hit,
  then falls through to a synchronous `lsregister -dump`, ~2.4s), and
  `findChrome()` runs on every health poll, job start and gate measurement, so
  leaving it uncached froze the single-threaded server on Chrome-less machines.
  `runHealthChecks(force)` ("다시 점검") clears it immediately so the install
  guidance stays honest. `lib/chrome-not-found.test.ts` mocks chrome-launcher to
  cover that path — the real-discovery tests can't.
- **Diagnostics**: `instrumentation.ts` (Next's official `onRequestError` hook +
  `unhandledRejection`/`uncaughtException`) appends server failures to
  `data/logs/app.log` — before this they only reached the terminal window and
  vanished with it. `GET /api/diagnostics[?job=<id>]` zips a support bundle
  (summary.md, health/backends json, masked settings, logs, the job's
  events/verify/artifact list) behind a "문제 신고용 파일 내려받기" link (`app/components/DiagnosticsLink.tsx`,
  shared so the non-developer wording lives in one place; a Mantine Tooltip, not
  the native `title`, whose 1s+ delay is fixed by the browser) on the home and
  job pages, so a non-developer hands over one file instead of hunting through
  `data/`. Secrets never ship: `bundle.ts` masks token-ish setting keys AND
  string-replaces the actual values everywhere in the bundle, plus a
  belt-and-braces regex for `figd_`/`sk-`/`AIza` shapes (tested in
  `bundle.test.ts`). Zip entry names stay ASCII — Korean names come out mojibake
  on Windows.
- **Quality gate**: success is judged by the filesystem, not the agent's
  self-report. `lib/jobs/acceptance.ts` checks the deliverable contract
  (`output/*_figma.html` + `*_responsive.html`, verify evidence images in the
  work root, and `verify.json` — written by the figma-edm `compare.py` — with
  `result: PASS`). On a gate miss the runner does ONE automatic repair run in
  the same workDir with the failures listed in the prompt (`task.repair`),
  then re-checks. The verify summary is persisted on `job.json` (`job.verify`)
  and surfaced as a PASS/FAIL badge in `VerifyReport`.
  The gate also requires the evidence to belong to THIS attempt: the runner
  passes `freshSince` (attempt start) and a `verify.json` older than that fails
  the gate. Without it an edit job (workDir copied from the source) or a resume
  (same workDir) inherits a PASS and can report success having produced nothing.
  It also blocks screenshot-shipping (observed: codex gamed the gate three
  ways in a row — whole-email screenshot, then sr-only hidden copy, then a
  7-slice + transparent-class copy). Three stacked checks, each with a test:
  VISIBLE live text ≥100 chars (hidden/transparent elements not counted,
  `<style>` class rules included); no single image ≥400px wide with h/w ≥2
  (a page capture); full-width images'
  aspect-ratio sum ≤70% of the figma_full canvas aspect (a sliced capture —
  honest builds run ~28%). Visible text can't be faked: text not in the design
  breaks pixel-verify, hidden text isn't counted.
  The anti-gaming measurement is done by **a real browser**, not by reading
  markup: `lib/jobs/measure.ts` opens each deliverable in headless Chrome
  (puppeteer-core + the path `lib/chrome.ts` already resolves) at 700px — the
  same render compare.py pixel-verifies — and returns visible text length and
  every image's rendered size. `checkAcceptance` only applies thresholds.
  Why: five code-review rounds killed two generations of markup-reading code.
  Round 3 replaced regex with a real parser (cheerio), which fixed parsing but
  not LAYOUT: email is built from tables, so `<td width="300">` is a MINIMUM
  that a big image stretches, and cascade/inheritance/media queries can't be
  approximated by a handful of rules. Every fix traded a false positive for a
  new bypass (a 600px capture slipping through, one wrapper switching the image
  checks off) — `getComputedStyle` and `getBoundingClientRect` already know the
  answers. `lib/jobs/html-visibility.ts` and its ~350 lines of heuristics are
  gone; do not reintroduce markup-based visibility or size guessing.
  - Text counts only if the browser renders it, judged on **the text's own
    client rects** — not an ancestor's box. Round 6 measured both failure
    directions of the ancestor-box test: a zero-height wrapper (overflow
    visible) discounted plainly painted copy, while `text-indent:-9999px`,
    `left:9999px` (the mirror of the covered `-9999px`), `clip-path:inset(50%)`
    and `transform:scale(0)` all counted as visible. Rects also settle
    display:none and `<style>`/`<script>` text for free.
  - CSS visibility is `Element.checkVisibility()`, never a hand-rolled ancestor
    walk: `visibility:hidden` on a wrapper is undone by `visibility:visible` on
    a child (unlike opacity), and walking ancestors zeroed honest builds that
    use that idiom. Clipping still needs manual work — the sr-only idioms
    (a ≤1px overflow-hidden box, legacy `clip: rect(0,0,0,0)`, `clip-path`
    inset ≥50% / `circle(0)`) are intersected against the text rect.
  - Non-zero computed font-size and non-transparent color still apply (alpha is
    the FOURTH rgba channel — reading the third makes black text "transparent").
  - Image size is `getBoundingClientRect()`, so retina 2x exports, `%` widths,
    `max-width` clamps, nested tables and `height:auto` all come out right —
    but only for images that actually decoded, so the render must not stop at
    the `load` event: `loading="lazy"` images do not block it and measured
    700×0, which silently switched all three image checks off. The renderer
    forces `loading=eager`, awaits every image plus `document.fonts.ready`
    (10s budget), and navigates with `domcontentloaded`.
  - Remote requests are aborted (offline-safe, fast), so a remote `src` cannot
    be measured — Chrome sizes the broken image as a ~square box, which is how
    a whole-email capture served from https:// passed the aspect checks.
    Images carry `loaded`; an unloaded image ≥400px wide is a FAILURE, and only
    loaded images feed the size checks. Honest deliverables reference
    `images/` relative paths (CDN swaps live in `output/hosted/`, which the
    gate must never measure — it picks the top-level file explicitly rather
    than trusting readdir order). A 1×1 remote tracking pixel is too small to
    trip the rule.
  - The color scheme is pinned to light (`emulateMediaFeatures`). Headless
    Chrome inherits the OS theme, so a dark-mode `display:none` swap really did
    hide honest copy — the same job passed on a light Mac and failed on a dark
    one (this machine reports dark).
  - One tab PER FILE. Sharing a tab let a document that pins the renderer's
    main thread time out every later file, attributing the failure to the wrong
    one.
  - "판정 불가" is only Chrome missing / launch failure / job cancelled — those
    skip the three checks with a WARNING. A **render failure is a FAILURE**: a
    single script that blocks loading otherwise switched all three anti-gaming
    checks off while compare.py, driving its own browser, still wrote a PASS.
  - `checkAcceptance` takes the job's `AbortSignal` and passes it down. The gate
    now launches browsers, and without it a cancelled job kept showing "실행 중"
    until two 30s measurements finished.
  - Regression tests run the real browser (`lib/jobs/acceptance.test.ts`,
    ~60s). `lib/jobs/png-fixture.ts` makes valid PNGs — a header-only fake
    renders as a broken image and measures 0. Every historical evasion and
    false positive from rounds 1-6 is covered there;
    `MHM_MEASURE_NAV_TIMEOUT_MS` shortens the navigation budget so the
    render-failure paths are testable in seconds.
  - Re-running the gate over the ARCHIVED real jobs in `data/jobs/` is the
    cheapest end-to-end proof, in both directions (done 2026-07-30): the two
    honest `claude-code` builds pass with zero failures — one of them has a
    `hosted/` folder, so it exercises the top-level pick — and all three
    `codex` screenshot builds are rejected on live text (0 chars), the
    screenshot rule and 100% coverage. Their `verify.json` says PASS
    99.97~100%: pixel verify alone would have shipped every one of them.
- **Resume & targeted edits**: `POST /api/jobs/:id/resume` restarts a failed
  job in the SAME workDir (the current gate failures become the first run's
  repair context — intermediate files are reused, e.g. after a timeout).
  `POST /api/jobs/:id/edit {instruction}` copies the source job's `work/` into
  a NEW job (`job.editOf`/`job.instruction`) and runs an edit-mode prompt that
  applies only the requested copy/image change; edit jobs relax the gate's
  verify-PASS requirement to a warning (intentional divergence from Figma).
  `startJob` persists the running status BEFORE resolving — SSE connects right
  after the HTTP response must not see a stale terminal state.
- **Model tuning**: settings `claudeModel` → `claude --model` (e.g. "haiku").
  The prompt bounds weak-model iteration: a band failing verify twice must be
  replaced with a flat section image instead of endless CSS tweaking.
- **UI**: Mantine v9 with a Claude-style theme (`app/theme.ts` — terracotta
  "clay" accent, cream/warm-dark backgrounds, serif headings; components never
  branch on theme). Job page split into
  `LogViewer` (virtualized via @tanstack/react-virtual) / `ArtifactList` /
  `SendPrep` / `VerifyReport`; job summaries render as markdown via Streamdown.
  Shared shell: `app/components/Section.tsx` (the ONE section container — card +
  17px serif title + right slot, `flush` for edge-to-edge lists, `collapsible`
  in place of Accordion), `AppHeader.tsx`, `StatusDot.tsx` (the ONE status
  treatment, backed by `app/lib/status.ts`), `icons.tsx` (inline SVG; no icon
  library — emoji as iconography is banned, it renders differently per OS and
  can't be aligned). Page width lives in `app/lib/dimensions.ts`.
  A 2026-07-30 pass fixed four measured defects — the design doc
  (`docs/superpowers/specs/2026-07-30-ui-refresh-design.md`) has the contrast
  numbers. The traps behind them, each of which cost real debugging:
  - **`--mantine-color-body` is the CARD color, not the page color.** Mantine
    v7+ `Paper` reads its background from it. Overriding it to the cream page
    color made every card identical to the page in BOTH schemes — the
    documented "cream + ivory card" layering never existed. Page background is
    painted on `body` in `globals.css`; that variable stays the card color.
  - **Mantine's `gray` is blue-gray** (`#868e96` / `#ced4da`). Not overriding it
    left every `c="dimmed"`, border, Divider and placeholder cool on a warm
    cream page — the single biggest source of "the style feels off". `theme.ts`
    now overrides `gray` (warm) AND `green`/`red`/`blue`/`yellow` (low-chroma
    earth tones) so `color="green"` call sites need no edits. Failure red is
    deliberately deeper than the clay accent so "실패" never reads as a CTA.
  - **`Badge.extend({...})` does not exist at runtime in v9.** It's a
    type-inference helper (`identity`) and blows up under Turbopack ESM with
    `Badge.extend is not a function`. Types allow it, so `pnpm typecheck`
    passes and the page 500s on first render. Use plain objects in
    `theme.components`.
  - **`Collapse` takes `expanded`, not `in`** (renamed in v9, and required).
  - **Never name a file in `app/` after a reserved route convention** —
    `app/lib/layout.ts` was treated as a route Layout and failed typecheck
    (`Property 'default' is missing`). Also applies to `page`, `route`,
    `loading`, `error`, `not-found`, `template`, `default`.
  - **Korean needs `word-break: keep-all`** (set on `body`); the default breaks
    mid-word ("이미지" → "이" / "미지"). And `ch` units are sized off the "0"
    glyph, so they under-measure Korean badly — `PROSE_WIDTH` is px.
  - `variant="default"` ignores `color`, so destructive buttons must use
    `variant="light" color="red"` to look destructive at all.
- **Log rendering**: `app/lib/log-format.ts` turns one log line into display
  segments (text / code / path / url / link, each optionally `strong`).
  **Display-only — `events.ndjson` is never rewritten**, so archived jobs improve
  retroactively and the agent prompt (load-bearing for the quality gate) stays
  untouched. Measured over the 8 archived jobs / 356 events: absolute paths in
  105 events (30%), backticks 191×, `**bold**` 46×, markdown links only 12× —
  so **paths are the dominant noise, not links**. After: 0 absolute paths and 0
  markdown symbols rendered, 14.8% fewer characters. Shortened paths keep the
  original in `title`, so nothing is silently dropped. Gotchas covered by tests:
  - Regex alternation is **position-first, not order-first**. Real logs contain
    ``**`verify.json` = PASS**`` (code nested in bold); `strong` won at the
    earlier `**` and left the backticks visible. `tokenize` re-parses emphasis
    content, which is safe because `**…**` can't nest (`[^*\n]+`).
  - URLs must be tokenized so path-shortening doesn't mangle their insides, and
    the URL pattern must exclude `'` — logs wrap URLs in shell quotes
    (`curl -o x 'https://…'`), so it otherwise ate the closing quote.
  - `**kwargs` inside a code span must stay literal (Python source gets logged).
  - When a link label equals its shortened target, emit a plain path — otherwise
    it reads `verify.json (verify.json)`.
  - Path matching uses `data/jobs/<8hex>/` rather than a repo-root prefix, so it
    works regardless of where the repo lives; short paths (`/mcp`) are left alone.
- **API validation**: route bodies are parsed with zod through
  `lib/api-body.ts` `readBody(req, schema)` — returns a ready 400 response on
  failure. Domain rules (provider existence, CDN template shape) stay in the
  routes.
- **Client requests**: every mutation goes through `app/lib/request.ts`
  (`requestJson` / `sendJson`), never bare `fetch` + `(await res.json()).error`.
  The helper never throws, so a non-JSON error page or an unreachable server
  still yields a readable message instead of a click that silently does
  nothing. (`app/lib/fetcher.ts` stays as-is — SWR wants reads to throw.)
  Route params arrive already percent-decoded; do not decode them again.
- **Send-prep**: `lib/hosting.ts` (CDN URL template → hosted/ variants — swaps
  `src`, `background=` attrs AND CSS `url()` refs, and replaces embedded
  base64 `@font-face` with the Pretendard CDN `@import` so the send file stays
  under Gmail's 102KB clip),
  `lib/email-check.ts` (static pre-send checks), `lib/verify.ts` (pixel-verify
  image allowlist). Routes: `POST /api/jobs/:id/hosting`,
  `GET /api/jobs/:id/check?file=`, `GET /api/jobs/:id/verify/:name`.

## Verification habits

- `pnpm vitest run` (unit), `pnpm typecheck`, `pnpm lint`, `pnpm build`.
  Manual check: `pnpm dev` (user normally launches via `시작하기.command`).
- `pnpm build` emits two Turbopack NFT warnings (whole-project tracing, via
  `lib/verify.ts` and `app/api/diagnostics/route.ts`). Known and deliberately not fixed — job paths are built from
  runtime ids so they can't be traced statically, and the trace list is only
  consumed when producing an `output: 'standalone'` bundle, which this app does
  not use (`README.md` runs `pnpm build && pnpm start` in place). It over-
  includes, never under-includes. See `docs/improvement-log.md`.
- Route handlers are unit-testable: `vitest.config.ts` maps the `@/` alias, so
  a test can `import { GET } from "./route"` and call it with
  `{ params: Promise.resolve({ id }) }`. See `app/api/jobs/routes.test.ts`
  (boundary cases) and `.../events/route.test.ts` (SSE streams).
- Real CLI regression: `RUN_CLAUDE_SMOKE=1` / `RUN_GEMINI_SMOKE=1` /
  `RUN_CODEX_SMOKE=1` smoke tests
  (spawn a trivial prompt; small token cost).
- Browser E2E: mock provider end-to-end, with `MHM_DATA_DIR`/`MHM_SETTINGS_FILE`
  pointed at a scratch dir so the run never touches real job data. chrome-devtools
  MCP refuses to attach when a browser already owns its profile — the
  claude-in-chrome MCP works as a fallback.

Reference output the generated eDMs should resemble:
`(로컬 참고 산출물 — 저장소에 없음)`
