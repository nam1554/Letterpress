<!-- BEGIN:nextjs-agent-rules -->

# Next.js: ALWAYS read docs before coding

Before any Next.js work, find and read the relevant doc in `node_modules/next/dist/docs/`. Your training data is outdated — the docs are the source of truth.

<!-- END:nextjs-agent-rules -->

# Marketing HTML Maker — agent notes

Local-only Next.js app: paste a Figma eDM design URL in the browser, a headless
Claude Code job converts it to email-safe HTML (via the user's `figma-edm`
skill), and the artifacts are downloadable as a zip. Not a deployed service —
no auth, single user, filesystem is the database.

- Design doc: `docs/superpowers/specs/2026-07-28-marketing-html-maker-design.md`
- Agent backends are isolated behind `lib/providers/types.ts` (`AgentProvider`).
  Add a new backend = one file in `lib/providers/` + one registry entry.
  Select with env `AGENT_PROVIDER` (`claude-code` | `mock`).
- Job state lives in `data/jobs/<id>/` (`job.json`, `events.ndjson`,
  `work/output/` = downloadable artifacts). Never commit `data/`.
- Reference output the generated eDMs should resemble:
  `(로컬 참고 산출물 — 저장소에 없음)`
