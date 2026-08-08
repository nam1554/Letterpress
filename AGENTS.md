<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

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
  (`AgentProvider`): `claude-code` (default) · `codex` · `antigravity` · `mock`.
  A `verification` axis on each provider (`verified` / `unverified` / `sample`,
  `verificationNote` carries the evidence) is independent of `ready` (runtime
  diagnosis in `lib/setup.ts`) — `ready` says the CLI/auth/Figma access look
  fine right now, `verification` says a real Figma job has actually cleared
  the gate. The rule, enforced by `lib/providers/verification.test.ts`: never
  write `verified` before a real-run gate PASS, and the evidence must carry a
  measurement date (`\d{4}-\d{2}-\d{2}` shape) — a provider can look ready and
  still be `unverified` if no one has run it end-to-end yet.
  Real-run status: `claude-code` completes honest builds (2026-07-29:
  PASS 97.2~97.5%, 14~16min · 2026-07-30 on the rewritten browser-measured
  gate: PASS 98.12%, 15min, gate failures/warnings/repair runs all zero,
  380 live chars, 13 images all loaded, 28.0% coverage, measurement 2.7s for
  both deliverables · 2026-08-07 re-measured through the refactored path —
  concludeJsonlRun, atomic cap in startJob, serialized updateJob — job
  `0c12f6ac`: PASS 97.64%, 13.9min, height Δ 0, failures/warnings/repairs
  all zero). `codex` gamed the gate three times historically
  (screenshot variants ×3 — see the acceptance gate notes), but all three of
  those runs predate the anti-gaming commits; they are kept as evidence of
  *why* the gate exists, not as the current verdict. Re-run against the
  current prompt + gate (2026-07-31, job `d1febcc0`): PASS 93.51%, 3.3min,
  530 live chars, 9 images, zero gate failures/errors — `codex` is verified,
  not experimental. Re-measured 2026-08-07 through the refactored provider
  path (job `779fb47c`): PASS 93.88%, 4.5min, warnings/repairs zero.
  `antigravity` (Google's `agy` CLI) was added and verified the same day
  (job `cf09c7e0`, run through the app end-to-end: provider → jsonl-cli →
  parser → gate): PASS 93.5%, 3.7min, 351 live chars, 13 images, zero gate
  failures. Re-measured 2026-08-07 through the refactored path (job
  `4925a733`): PASS 97.66%, 3.3min, height Δ 0, warnings/repairs zero. Three things only real measurement revealed, all load-bearing for
  `lib/providers/antigravity.ts` and `lib/setup.ts`:
  - **No Figma MCP.** `agy`'s `init.tools` lists 56 tools and none of them are
    Figma-specific — the REST token (`FIGMA_TOKEN`, from the settings Figma
    token) is the *only* access path for this backend. Without it, the run
    ends in 47s with a `FATAL:` response instead of erroring cleanly, so
    `lib/setup.ts`'s `figmaTokenStep` diagnoses token presence directly rather
    than pointing at MCP (there's nothing to point at).
  - **`--add-dir <workDir>` is required.** Without it `agy` runs its
    sub-agent tasks from its own scratch dir
    (`~/.gemini/antigravity-cli/scratch/`) instead of the job's `workDir`, so
    artifacts land outside the job and the gate fails on an empty directory
    even when the run itself "succeeded".
  - **`stream-json` doesn't match the documented schema.** The envelope key
    is `event`, not `type`, and the payload nests under a key named after the
    event; `status` comes back upper-case `SUCCESS`. `result.response` also
    carries `<SYSTEM_MESSAGE>`/`<notification>` noise from `agy`'s own task
    system, stripped by `stripAgySystemNoise`. A `FATAL:` response still
    reports `status: SUCCESS`, so success is judged by the `FATAL:` prefix,
    same as the other providers — never by `status` alone.
  `agy` has no `mcp` subcommand and no way to query login state, so
  `antigravitySetup()` diagnoses only the Figma-token setting and leaves the
  login step `ok: null`, pointing teammates at "연동 테스트" to confirm login
  by actually running the CLI.
  `gemini` was removed (2026-07-31) — it was API-key auth (orthogonal to the
  "whatever subscription a teammate has" goal) and had zero completed real
  runs, so keeping it in the backend list was a trap rather than an option.
  Shared pieces: `jsonl-cli.ts` (execa: line streaming, stderr tail, and
  `killDescendants` so a cancel kills the CLI's grandchildren — the wrappers
  re-spawn the real binary; on Windows that becomes `taskkill`, and execa also
  runs `.cmd` shims that Node refuses to spawn since CVE-2024-27980),
  `prompt.ts` (shared eDM prompt + agent env, including `CHROME_BIN`).
  Adding `antigravity` needed more than "one file + one `registry.ts` entry" —
  that claim was wrong and cost a diagnosis-less backend once (fixed
  2026-07-31). The real list, so the next backend doesn't skip any of it:
  `lib/providers/<id>.ts` (the `AgentProvider` impl) · a `registry.ts` entry ·
  `lib/setup/backends.ts` (`<id>Setup()` implemented AND registered in
  `getBackendSetup`'s roster — skip this and the backend ships with no
  install/auth/Figma-access diagnosis; `lib/setup.ts` is only the re-export
  façade) · `app/components/BackendSetup.tsx`'s
  `SHORT_NAME` (notification text falls back to the raw id without it) ·
  `app/lib/first-run.ts` — BOTH `STEPS` and `SUBSCRIPTION_PICKS`; tests fail
  if either is missed, because a teammate holding that subscription would
  otherwise find neither an option nor a procedure · `figmaActions()` in
  `lib/jobs/failure.ts` when the backend's Figma path differs from the others ·
  a `<id>.smoke.test.ts` · the README backend list, install steps, env-var
  table, structure map and smoke-test section. Parsers are exported pure
  functions with tests in `parsers.test.ts`.
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
- **Onboarding & failure guidance** — the two places a teammate gets stuck, both
  backed by pure modules with tests so a new backend can't ship without them:
  - `app/lib/first-run.ts` (`firstRunSteps`, `SUBSCRIPTION_PICKS`) →
    `app/components/FirstRun.tsx`. The guide is **per backend**, because the
    Figma path genuinely differs (connector OAuth vs. REST token). The previous
    version was three hard-coded Claude-Code lines, which showed a ChatGPT- or
    Google-subscription teammate the wrong procedure. `first-run.test.ts`
    cross-checks both exports against `listProviders()` in either direction —
    a missing entry means that subscription has no visible option at all.
    Picks are labelled by **subscription** ("ChatGPT"), not CLI ("Codex CLI");
    that is what a teammate knows they pay for, and a test enforces it.
  - `lib/jobs/failure.ts` (`diagnoseFailure`) → `app/jobs/[id]/FailureHelp.tsx`.
    Classifies a failed job's summary into quota / auth / figma / timeout /
    gate / cancelled / cli-missing / unknown and offers the next action —
    including a one-click retry on a *different* backend, which is where the
    three-subscription design actually pays off (quota is the most common
    failure and switching fixes it outright). Only two patterns are measured
    (codex quota, antigravity Figma — both fixed as string constants in
    `failure.test.ts`); the rest are defensive and fall through to `unknown`,
    which points at the diagnostics bundle rather than inventing a cause.
  Traps found by measuring, each now covered:
  - **Never match a bare `figma`**: the deliverable is named `*_figma.html`,
    so `EACCES … aisurfer_figma.html` classified as "Figma 접근 실패". The
    pattern requires an adjacent keyword (`access|token|mcp|auth|login`).
  - **Figma beats auth** when a summary matches both ("Figma authentication
    failed") — the actionable answer is that backend's Figma path, not
    "log into the CLI".
  - **Mantine's global reset sets `list-style: none`.** A plain `<ul>` renders
    with no bullets at all; set `listStyle` explicitly. (Measured:
    `ulListStyle="none"`, `liDisplay="list-item"` — the display was never the
    problem.)
  - **The first-run guide must not be gated on the *selected* backend's
    readiness.** It was, and picking a ready subscription inside the guide made
    the whole guide vanish — the interaction that the section invites destroyed
    it. Gate on "any non-mock backend still needs setup" instead.
  - Copy in these modules is rendered as **plain text, not markdown** — a
    backtick shows up literally. Tests assert no backticks; commands belong in
    the `command` field, which renders via `app/components/CommandChip.tsx`
    (shared with the 🔌 panel so the two never drift apart).
- **Lifecycle**: `lib/jobs/runner.ts` spawns providers with an AbortController
  (timeout + cancel), `store.ts` reconciles stale running jobs on read after a
  server restart. SSE route replays events then relays live ones, deduped by
  `seq`. Invariants worth not regressing (each has a test):
  - `startJob` rolls back the controller + timer if start-up throws. A leaked
    controller inflates `runningJobCount()` forever, so the concurrency cap
    rejects every later job and `deleteJob` refuses that job for good.
  - `startJob` throws if the job already has a live controller (2026-08-07) —
    a resume double-click otherwise runs two CLIs in one workDir, and the
    second controller overwrites the first's map entry so whichever run
    finishes first deletes the survivor's entry: a running job with no
    controller, which reconcile then misreports as failed while the CLI keeps
    burning tokens. The resume route turns that throw into a 409.
  - The concurrency cap is judged ONLY inside `startJob` (2026-08-07), in the
    same synchronous section that registers the controller — route-level
    pre-checks had an await window that let concurrent requests exceed the
    cap by one. Rejections are typed (`AlreadyRunningError` → 409,
    `ConcurrencyLimitError` → 429); the create/edit routes delete the job
    they failed to start so no ghost `queued` row is left behind.
  - `updateJob` serializes per job and accepts a functional patch
    (`updateJob(id, job => patch)`) — it is read-merge-write, so without
    this, concurrent callers overwrite each other's fields (lost update).
    Any patch derived from current job state (`manualEdits` …) MUST be
    functional; computing it from a job read outside the call reintroduces
    the race. The artifact route's own lock now guards only the file-level
    backup TOCTOU.
  - The three JSONL providers end through `concludeJsonlRun` in
    `jsonl-cli.ts` (cancel/spawn-failure wording, FATAL-prefix check, the
    errorText → finalText → stderrTail → exitReason fallback chain). Don't
    reintroduce per-provider copies — they drift, which is why this exists.
  - Client components import API payload types from lib with `import type`
    (erased at build; server runtime code never enters the bundle) instead
    of re-declaring them — a local copy silently goes stale when the server
    type grows a field.
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
  No exit hook is registered: `PowerShell.Exiting` and `finally` were both
  measured NOT to run when the **window is force-closed** under `-File`, so that
  path relies on the shared console (a `-NoNewWindow` child dies with the
  window) plus the next launch detecting a stale server. The script still keeps
  a `try/finally { StopServer }` around `Wait-Process` because Ctrl-C and normal
  exit DO run it — that block is live code covering a different path, not a
  leftover; deleting it leaves `next-server` holding the port on Ctrl-C.
  (2026-08-08: the code comment claimed `finally` was unused while the block sat
  ten lines below it — exactly the kind of note that gets "cleaned up" wrongly.)
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
  A **hit** is never trusted blindly: the cached path is `existsSync`-checked on
  every call (one stat, free next to the discovery it replaces) and the
  `CHROME_BIN`/`CHROME_PATH` override is part of the cache key. The server lives
  for hours; a path that dies mid-session used to be returned forever, and
  `measure.ts`'s launch then fails with ENOENT — which the gate downgrades to
  "판정 불가" (WARNING), silently switching all three anti-gaming checks off.
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
    inset / `circle()`) are intersected against the text rect.
    `clip-path` values are **resolved numerically** (percent against the
    element's border box, CSS 1-4 value shorthand, `round <radius>` ignored),
    never matched by counting digits: the old `/inset\(\s*(?:[5-9]\d|100)%/`
    missed `inset(50.5%)` and any axis-only collapse like `inset(0% 60%)`.
    Zero-area reference box + ANY `clip-path` really is hidden — pixel-measured
    in Chrome, text and a 600×300 image both paint 0 dark pixels, while the same
    wrapper without `clip-path` paints normally. Don't "fix" that as a false
    positive (a review round claimed it; the screenshot said otherwise).
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
    cheapest end-to-end proof, in both directions. First done 2026-07-30 over
    the jobs that existed then: two honest `claude-code` builds passed with
    zero failures — one of them has a `hosted/` folder, so it exercises the
    top-level pick — and three `codex` screenshot builds were rejected on
    live text (0 chars), the screenshot rule and 100% coverage. Their
    `verify.json` said PASS 99.97~100%: pixel verify alone would have shipped
    every one of them. Re-run again 2026-07-31 across all 11 archived jobs
    (multi-backend-parity, roster now `claude-code`/`codex`/`antigravity`/
    `mock`): PASS — `098b0847` `73423ff3` `b23de8f2` (`claude-code`),
    `d1febcc0` (`codex`), `cf09c7e0` (`antigravity`), `3ea35917` (`mock`).
    FAIL — `00ae9d9a` `492f5aa4` `ec4b0db9` (the same three `codex`
    screenshot builds, still rejected on 0 live chars) and `94949582` (a
    `codex` quota failure that produced no artifacts at all — correctly
    rejected, not a regression). `652e66ca` also shows FAIL but is **not** a
    regression either: it was created 2026-07-29 10:10, three hours before
    the gate itself landed (commit `174ef38`, 13:11), from the
    `compare_edm.py` era — it never had a `verify.json` to begin with, so
    there is nothing for the gate to have broken. Roster changes (gemini
    removed, codex/antigravity `verification` flipped to `verified`) moved
    zero gate verdicts — the gate only reads filesystem evidence, not the
    provider list. Re-run again 2026-08-07 after the stability/structure
    refactor passes (startJob atomic cap, updateJob serialization,
    withKeyedLock extraction, setup split): all 11 verdicts identical, 21s.
  - **Known flake:** `lib/jobs/acceptance.test.ts` can fail intermittently
    when the full `vitest run` suite executes concurrently with other test
    files — it launches real headless Chrome instances, which compete for
    resources with whatever else is running at the same time. Run in
    isolation it is reliable: 29/29 passing in 73.44s (confirmed 2026-07-31,
    reproduced across all three tasks of this branch). If the full suite
    shows a failure here, re-run this file alone before treating it as a
    real regression.
    The cause is **suite-wide CPU/memory pressure, not concurrent Chrome
    launches** — measured 2026-08-01 while adding `runExclusive`: this is the
    only test file that launches a browser, and its cases run sequentially,
    so there was never more than one Chrome at a time inside it. Serializing
    launches therefore does not fix this flake; don't "fix" it again by that
    route.
- **Browser launches are serialized at runtime** (`runExclusive` in
  `measure.ts`). Nothing serialized the callers before: the concurrency cap
  lets several jobs run, and when they finish around the same time — plus the
  gate's automatic repair re-measure — Chrome instances stack up. That matters
  beyond speed, because a launch that fails under contention comes back as
  "판정 불가", which the gate downgrades to a WARNING and **skips all three
  anti-gaming checks**: a busy machine could pass a screenshot build. The queue
  is per-process, which is enough (the app is one server process).
  A failed launch is now `launch-failed`, not `no-chrome` — reaching that catch
  means `findChrome()` already returned a path, so "Chrome을 찾지 못함" was a
  lie that sends whoever reads the diagnostics bundle off to reinstall Chrome
  instead of looking at resources or a locked profile. `runExclusive` is
  exported and unit-tested in `measure-serialize.test.ts` (ordering, overlap,
  and that a rejected job does not poison the queue for later ones) — testing
  it through real browsers would mean causing the very contention being fixed.
- **Resume & targeted edits**: first real edit run recorded 2026-08-07 (job
  `35605870`, editOf `0c12f6ac`, claude-code): a one-phrase copy change
  ("고객님"→"회원님") landed in BOTH deliverables with every other phrase
  byte-identical (26/26), the font subset was regenerated for the new glyph
  set, and verify re-ran to PASS 97.63% (Δ0) in 1.7min — the copied-workDir
  edit prompt path works end-to-end, not just under mock.
  `POST /api/jobs/:id/resume` restarts a failed
  job in the SAME workDir (the current gate failures become the first run's
  repair context — intermediate files are reused, e.g. after a timeout).
  `POST /api/jobs/:id/edit {instruction}` copies the source job's `work/` into
  a NEW job (`job.editOf`/`job.instruction`) and runs an edit-mode prompt that
  applies only the requested copy/image change; edit jobs relax the gate's
  verify-PASS requirement to a warning (intentional divergence from Figma).
  `startJob` persists the running status BEFORE resolving — SSE connects right
  after the HTTP response must not see a stale terminal state.
  Inline edit: the viewer (`/jobs/[id]/view`) can contentEditable-edit the
  top-level HTML deliverables in place (`PUT /api/jobs/:id/artifact`) — first
  save backs the original up to `work/edit-backup/` (outside output/, so it
  never shows in artifact lists or zips), `job.manualEdits` marks the file and
  relaxes nothing in the gate: verify badges show pre-edit results. Style ops
  are element-level inline styles, not selection-range execCommand (panel
  clicks steal iframe focus and make range commands unreliable).
  Saves/restores are serialized per job (in-process queue on globalThis):
  without it the existsSync→copyFile backup step is a TOCTOU that can snapshot
  edited content as the "original", and concurrent saves compute manualEdits
  from stale job reads and lose each other's entries. The backup is
  attempt-scoped, not workDir-scoped: `createEditJob` strips the copied
  `edit-backup/` and resume clears `manualEdits` + `edit-backup/` — leaving
  either behind lets a restore overwrite freshly generated deliverables with
  another attempt's "original".
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
- **Shared helpers — check here before writing a new one.** This repo keeps one
  implementation per concern on purpose (a review caught two byte-identical
  copies of the keyed queue on 2026-08-07), so a second copy is a defect, not a
  style choice:
  - `lib/api-body.ts` `readBody(req, schema)` — zod body parsing → ready 400.
    Its `issueMessage` also guarantees the error text is Korean: schema
    messages pass through, zod's English defaults are replaced while keeping
    the *reason* (min/max bounds, inclusive vs exclusive) and the field path.
    Three review rounds shaped it; prefer simplifying it over adding branches.
  - `lib/api-job.ts` `requireJob(id)` — job existence + the one 404 body, same
    `{ok} | {res}` shape as `readBody`.
  - `lib/serialize.ts` `withKeyedLock(map, key, fn)` — the per-key promise
    queue behind `updateJob` (lost-update) and the artifact route (backup
    TOCTOU). Callers own the Map, so the two lock domains can't deadlock.
  - `lib/hmr-global.ts` `hmrGlobal(key, init)` — process-global containers that
    must survive dev HMR. In-place-mutated Maps/objects only: reassigned
    snapshot caches (health/setup) and shape-migrated flags keep raw access.
  - `lib/mime.ts` `contentTypeFor(file)` — Content-Type for artifact serving;
    download and preview drifted apart before this existed.
  - `app/lib/use-armed-confirm.ts` — two-step confirm with a 4s auto-disarm,
    keyed so a confirm armed for one target can't approve another.
  - `app/jobs/[id]/use-job-stream.ts` — the SSE wiring (replay dedup, terminal
    close, silent refresh on error) kept out of the page component.
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
  **CDN upload check** (`lib/hosting-check.ts`, `GET /api/jobs/:id/hosting/
  check`): uploads stay MANUAL by decision (2026-08-07 — no storage
  credentials on teammates' laptops; the real store is MinIO behind a
  read-only IIIF server). The app only verifies. The hosting POST writes
  `hosted/manifest.json` (template/folder/files — the same mapping the
  substitution used, so swap and check can't drift); the check route probes
  each URL server-side (HEAD with GET fallback on 405/501, 3s timeout,
  concurrency 5) and classifies `live`/`missing`/`unreachable`.
  All-unreachable is reported as a NETWORK problem ("사내망/VPN"), never as
  미업로드 — misdiagnosis sends people to re-upload files that are fine.
  `missing` rows carry the MinIO object key (`{folder}__{file}`, computed
  only when the template actually uses that rule — inventing keys for other
  template shapes would teach wrong upload names) as a copyable CommandChip.

## Next.js 16.3 (2026-08-07 업그레이드 결정)

- `cacheComponents: true` + `partialPrefetching: true`를 켰다 — 다음 메이저의
  기본값을 미리 채택(16.3 블로그). 이 모델에서는:
  - 라우트 세그먼트 설정 `export const dynamic`이 **비호환**(빌드 에러) —
    19개 라우트의 `force-dynamic`을 제거했다. 핸들러는 이 모델에서 기본이
    동적이며, 실측으로 확인함(잡 생성 직후 GET /api/jobs에 즉시 반영 =
    숨은 캐시 없음, SSE·게이트 파이프라인 정상).
  - 클라이언트 페이지의 `useParams()`/`useSearchParams()`는 **Suspense 경계
    안**에 있어야 프리렌더가 통과한다 — 두 잡 페이지 모두 `<Suspense>`로
    감싼 구조다. 새 페이지를 추가할 때 같은 규칙이 적용된다.
- TypeScript 7은 **보류**: `pnpm exec tsc --noEmit`이 0.56초로 통과하지만
  typescript-eslint가 TS 7.0을 지원하지 않아 eslint가 로드조차 실패한다
  (typescript-eslint#10940). 별칭 이중 설치 우회는 온보딩 함정이라 채택하지
  않았다 — 지원되면 재시도.
- 나머지 16.3 항목: dev 메모리 축출·빌드 디스크 캐시·SSR 노드 스트림·
  prefetch 인라이닝은 기본 적용(설정 불필요), AGENTS.md 상단의 버전 문서
  블록은 `next dev`가 관리한다. offline/root params/glob/`catchError`/
  Playwright `instant()`는 이 앱에 해당 없음, React Compiler(Rust)는
  실험 플래그라 보류.

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
- Real CLI regression: `RUN_CLAUDE_SMOKE=1` / `RUN_CODEX_SMOKE=1` smoke tests
  (spawn a trivial prompt; small token cost).
- Browser E2E: mock provider end-to-end, with `MHM_DATA_DIR`/`MHM_SETTINGS_FILE`
  pointed at a scratch dir so the run never touches real job data. chrome-devtools
  MCP refuses to attach when a browser already owns its profile — the
  claude-in-chrome MCP works as a fallback.
- **Anything rAF-driven cannot be verified by script in a backgrounded tab.**
  Chrome pauses `requestAnimationFrame` when `document.visibilityState ===
  "hidden"`, which is the normal state of an MCP-driven tab. Mantine's `Collapse`
  advances its open/close state machine inside rAF (`useCollapse` →
  `useDidUpdate` → `requestAnimationFrame`), so a scripted `.click()` flips
  `aria-expanded` while the body stays `display: none !important` (React 19
  `Activity`, which `keepMounted` uses). That looks exactly like a broken
  component and cost a full false-positive investigation on 2026-07-30.
  Before concluding a rAF/animation/transition bug from scripted measurement,
  check `document.visibilityState` and whether rAF actually fires; verify with a
  real `computer` click plus a screenshot (which forces frames), not
  `javascript_tool` alone.

Reference output the generated eDMs should resemble: the `aisurfer_edm_production`
bundle, kept locally by the maintainer — it is **not** in this repo (it contains
unreleased campaign artwork). Ask for it if you need it; the pixel-verify report
on any archived PASS job shows the same target quality.
