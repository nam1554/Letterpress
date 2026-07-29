<!-- BEGIN:nextjs-agent-rules -->

# Next.js: ALWAYS read docs before coding

Before any Next.js work, find and read the relevant doc in `node_modules/next/dist/docs/`. Your training data is outdated — the docs are the source of truth.

<!-- END:nextjs-agent-rules -->

# Letterpress (repo: marketing-html-maker) — agent notes

Local-only Next.js app: paste a Figma eDM design URL in the browser, a headless
CLI agent job converts it to email-safe HTML (via the user's `figma-edm`
skill), and the artifacts are downloadable as a zip. Not a deployed service —
no auth, single user, filesystem is the database.

- Design doc: `docs/superpowers/specs/2026-07-28-marketing-html-maker-design.md`

## Architecture map

- **Agent backends** are isolated behind `lib/providers/types.ts`
  (`AgentProvider`): `claude-code` (default) · `gemini` · `codex` · `mock`.
  Shared pieces: `jsonl-cli.ts` (spawn + JSONL stream handling — partial lines,
  stderr tail, abort/close race), `prompt.ts` (shared eDM prompt + agent env).
  Add a new backend = one file + one `registry.ts` entry. Parsers are exported
  pure functions with tests in `parsers.test.ts`.
- **Job state** lives in `data/jobs/<id>/` (`job.json` atomic-written,
  `events.ndjson` with per-job monotonic `seq`, `work/output/` = downloadable
  artifacts). Never commit `data/`. Job ids are 8-hex — `jobDir()` enforces
  this; all fs paths derive from it.
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
  `seq`.
- **Quality gate**: success is judged by the filesystem, not the agent's
  self-report. `lib/jobs/acceptance.ts` checks the deliverable contract
  (`output/*_figma.html` + `*_responsive.html`, verify evidence images in the
  work root, and `verify.json` — written by the figma-edm `compare.py` — with
  `result: PASS`). On a gate miss the runner does ONE automatic repair run in
  the same workDir with the failures listed in the prompt (`task.repair`),
  then re-checks. The verify summary is persisted on `job.json` (`job.verify`)
  and surfaced as a PASS/FAIL badge in `VerifyReport`.
- **UI**: Mantine v9 with a Claude-style theme (`app/theme.ts` — terracotta
  "clay" accent, cream/warm-dark backgrounds, serif headings; components never
  branch on theme). Job page split into
  `LogViewer` (virtualized via @tanstack/react-virtual) / `ArtifactList` /
  `SendPrep` / `VerifyReport`; job summaries render as markdown via Streamdown.
- **API validation**: route bodies are parsed with zod through
  `lib/api-body.ts` `readBody(req, schema)` — returns a ready 400 response on
  failure. Domain rules (provider existence, CDN template shape) stay in the
  routes.
- **Send-prep**: `lib/hosting.ts` (CDN URL template → hosted/ variants),
  `lib/email-check.ts` (static pre-send checks), `lib/verify.ts` (pixel-verify
  image allowlist). Routes: `POST /api/jobs/:id/hosting`,
  `GET /api/jobs/:id/check?file=`, `GET /api/jobs/:id/verify/:name`.

## Verification habits

- `pnpm vitest run` (unit), `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build`.
- Real CLI regression: `RUN_CLAUDE_SMOKE=1` / `RUN_GEMINI_SMOKE=1` /
  `RUN_CODEX_SMOKE=1` smoke tests
  (spawn a trivial prompt; small token cost).
- Browser E2E: mock provider end-to-end via chrome-devtools MCP.

Reference output the generated eDMs should resemble:
`(로컬 참고 산출물 — 저장소에 없음)`
