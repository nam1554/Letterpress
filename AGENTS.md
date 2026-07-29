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
  Real-run status (2026-07-29): `claude-code` completes honest builds
  (PASS 97.2~97.5%, 14~16min). `codex` repeatedly tried to game the gate
  (screenshot variants ×3 — see the acceptance gate notes) and then hit its
  ChatGPT plan usage limit; treat as experimental. `gemini` dies mid-pipeline
  with `[API Error]` once the API key's quota runs out (a smoke prompt passes,
  a real conversion doesn't) — needs a paid-tier key for real use.
  Shared pieces: `jsonl-cli.ts` (spawn + JSONL stream handling — partial lines,
  stderr tail, abort/close race), `prompt.ts` (shared eDM prompt + agent env).
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
  token. Precedence: settings.json > env > default. Keys/tokens are validated
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
  VISIBLE live text ≥100 chars (hidden/transparent elements stripped, including
  via `<style>` class rules — collect classes BEFORE removing style blocks);
  no single image ≥400px wide with h/w ≥2 (a page capture); full-width images'
  aspect-ratio sum ≤70% of the figma_full canvas aspect (a sliced capture —
  honest builds run ~28%). Visible text can't be faked: text not in the design
  breaks pixel-verify, hidden text isn't counted.
  The anti-gaming parsing is where the false-positive risk lives — a wrong
  "hidden" verdict fails an honest 15-min build and burns a repair run. Rules
  that a code review found broken and that now have regression tests:
  - Hidden-ness is decided per DECLARATION (property name compared exactly),
    never by regex-matching values across a style string —
    `background-color:transparent` / `margin-left:-100px` are not hidden, and
    `left:-9999px` only counts with `position:absolute|fixed`. State is kept
    per property (last declaration wins), so `.copy{display:none}` followed by
    `.copy{color:#333}` stays hidden — only a re-declaration of the SAME
    property un-hides.
  - Only what actually disappears in Chrome (the render compare.py verifies)
    counts for images: `mso-hide:all` is Outlook-only so it applies to text
    only, `clip:rect(0…)` needs `position:absolute|fixed`, and a 1px box needs
    `overflow:hidden` (a 1px `<td>` still stretches around its image).
    Otherwise wrapping a screenshot in one of those hides it from the gate.
  - Inherited hides (`font-size:0`, `color:transparent`, `text-indent`) keep
    descendants that re-declare the property, instead of dropping the subtree.
  - Only SIMPLE class selectors register a hide. Conditional ones
    (`[data-ogsc] .logo`, `.mobile-only .cta`) are ignored — treating them as
    unconditional deletes an honest build's body copy, which costs more than
    the narrow evasion it leaves open.
  - Two hide kinds: `text` (adds font-size:0 / color:transparent) vs `layout`.
    Image checks use `layout` only — `<td style="font-size:0">` around an image
    is the standard gap-killer idiom and its image must stay countable, while a
    mobile/desktop variant hidden by `display:none` must NOT be double-counted.
  - `<style>` is parsed by brace matching, so rules inside `@media` are seen
    (wrapping the hide in `@media all` used to slip through). Only WIDTH
    conditions are evaluated, against the desktop render (700px): treating
    `@media (max-width:600px){.desktop{display:none}}` as hidden would delete a
    legit responsive build's body, while vetoing on an unparsed feature let
    `@media (-webkit-min-device-pixel-ratio:0)` — which does apply in Chrome —
    smuggle a hide past the gate.
  - Element removal knows the HTML void set and the auto-closing tags
    (`p`/`td`/`li`…). An unclosed non-auto-closing tag swallows the rest of the
    document, exactly as a browser does — otherwise one unclosed
    `<div style="display:none">` at the end pads the live-text count.
  - `<img>` ASPECT comes from the FILE (`lib/jobs/image-size.ts`, PNG/JPEG/GIF/
    WEBP + base64 data URIs, decoded in full — a JPEG's SOF can sit behind a
    20KB ICC profile) when the height attribute is missing, since real email
    markup is `width="700" style="height:auto"`. DISPLAY WIDTH only ever comes
    from markup (px, `%` × canvas width, or a simple class rule) — using the
    file's pixel width would read a 2× export of a narrow element as full-width.
    A declared width/height of 0 or 1 is ignored (`height="0"` next to
    `height:auto` renders normally but used to switch both checks off).
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
- `pnpm build` emits one Turbopack NFT warning (whole-project tracing, via
  `lib/verify.ts`). Known and deliberately not fixed — job paths are built from
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
