import path from "node:path";
import { getSettings } from "../settings";
import type { AgentTask } from "./types";

/** Extra env for spawned agent CLIs (Figma REST fallback / Gemini API key). */
export function agentEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const { figmaToken, geminiApiKey } = getSettings();
  if (figmaToken) env.FIGMA_TOKEN = figmaToken;
  if (geminiApiKey) env.GEMINI_API_KEY = geminiApiKey;
  return env;
}

/**
 * 레포에 벤더링된 figma-edm 스킬 — 이 사본이 앱의 단일 소스다.
 * (~/.claude/skills/figma-edm은 사용자의 대화형 스킬로, 앱과 무관.)
 * 스폰된 CLI는 cwd가 잡 workDir라 프로젝트 스킬 자동 발견이 불가능하므로,
 * 모든 백엔드가 이 경로의 파일을 직접 읽는다.
 */
export const FIGMA_EDM_SKILL_DIR = path.join(process.cwd(), "skills", "figma-edm");

/** The conversion instructions shared by every backend. */
export function buildEdmPrompt(task: AgentTask): string {
  const skillIntro = `Read ${FIGMA_EDM_SKILL_DIR}/SKILL.md and ${FIGMA_EDM_SKILL_DIR}/references/workflow.md, then follow that pipeline exactly (the bundled scripts are in ${FIGMA_EDM_SKILL_DIR}/scripts/)`;

  if (task.edit) return buildEditPrompt(task, skillIntro);

  return `You are converting a Figma eDM design into email HTML.

Figma design URL: ${task.figmaUrl}

${skillIntro} (pull the frame via Figma MCP tools, build email-safe table HTML,
verify pixel fidelity, add the responsive variant). Set EDM_DIR to the current
working directory.

Requirements:
- Write ALL final deliverables into ./output/ (create it):
  - the Figma-identical HTML (*_figma.html)
  - the responsive HTML (*_responsive.html)
  - an images/ folder with every image used, so the HTML can be re-hosted on a CDN
    (like the reference package: relative <img src="images/...">, plus a
    self-contained preview variant if the skill produces one)
- Leave the pixel-verify evidence in the working directory root (EDM_DIR):
  figma_full.png, my_full.png, side_by_side.png, diff_heat.png, verify.json
  (compare.py writes these). The app REJECTS the job if any deliverable or
  verify evidence is missing, or if verify.json's result is not PASS — keep
  iterating build→verify until PASS before finishing.
- If the URL has no node-id, enumerate the file's top-level frames (Figma
  metadata / REST), choose the frame that is the email design (portrait,
  roughly 600–800px wide), and log which frame you chose. If no frame looks
  like an email design, print a single line starting with "FATAL:" listing the
  frames, and exit.
- Iteration budget: if the SAME band still fails verification after 2
  build→verify attempts, stop hand-tuning it — replace that section with a
  flat image of the section's node (screenshot / REST render at native width)
  and re-verify. A flat section image is always acceptable; endless CSS
  tweaking is not.
- Transparency: standalone illustrations/logos/icons must be fetched from the
  ORIGINAL image source (asset export / raw image fills; REST:
  GET /v1/files/:fileKey/images), NEVER via node screenshots — screenshots
  flatten the canvas background into the asset and pixel-verify cannot detect
  it. After downloading, alpha-check each non-flat asset (PIL: % of pixels
  with alpha<255) and re-fetch from the source if an asset that is transparent
  in Figma reports 0%.
${figmaAccessClause()}
- Print short progress lines as you complete each pipeline step.
- Finish with a one-paragraph summary of what was produced and the verify result.${repairClause(task)}`;
}

/**
 * 부분 수정 런 — 이미 빌드·검증된 eDM이 cwd에 있고, 지시된 변경만 적용한다.
 * 의도적으로 원본 Figma와 달라지므로 verify는 실행하되 PASS를 강제하지 않는다
 * (게이트도 edit 잡에서는 verify FAIL을 경고로 강등).
 */
function buildEditPrompt(task: AgentTask, skillIntro: string): string {
  return `You are updating an ALREADY BUILT Figma eDM in the current working
directory. It was produced earlier with the figma-edm pipeline — the build
scripts, assets, fonts, verify evidence, and ./output/ deliverables are all
present. Do NOT rebuild from scratch.

Original Figma design URL: ${task.figmaUrl}

Requested change — apply ONLY this, nothing else:
${task.edit!.instruction}

${skillIntro}, specifically its "Adapting when copy or design changes" flow.
Set EDM_DIR to the current working directory.

Requirements:
- Copy text change: update the strings in the build script AND the font-subset
  TEXT block, re-run the font subsetting, then rebuild.
- Image change: if the instruction refers to the Figma design, re-fetch that
  node's image; otherwise use the referenced asset. Keep exact geometry.
- Re-run the verify step (compare.py) so verify.json and the comparison images
  are refreshed. The change intentionally diverges from the original Figma
  reference, so changed bands may not PASS — that is expected; report which
  bands changed and why.
- Refresh ALL deliverables in ./output/ (*_figma.html, *_responsive.html,
  images/) so they contain the change.
${figmaAccessClause()}
- Print short progress lines as you work.
- Finish with a one-paragraph summary of what changed and the verify result.${repairClause(task)}`;
}

/** 품질 게이트 미충족 후 보수 런에 붙는 부록 — 실패 항목만 고치게 한다. */
function repairClause(task: AgentTask): string {
  if (!task.repair) return "";
  const list = task.repair.failures.map((f) => `- ${f}`).join("\n");
  return `

IMPORTANT — THIS IS A REPAIR RUN. A previous attempt ran in this same working
directory and was rejected by the quality gate for these reasons:
${list}
The intermediate files from that attempt are still present — reuse them instead
of starting over. Fix only what is listed above, re-run the verify step until
RESULT: PASS, and complete the full deliverable set.`;
}

/**
 * Hedge for machines without Figma MCP (e.g. free Figma seats): when the app
 * is started with FIGMA_TOKEN set, the agent may fall back to the Figma REST
 * API, which personal access tokens can use on any plan.
 */
function figmaAccessClause(): string {
  if (!getSettings().figmaToken) {
    return `- If Figma access (MCP tools or API) is NOT available in this session, do not
  improvise: print a single line starting with "FATAL:" explaining what is
  missing, and exit.`;
  }
  return `- Prefer Figma MCP tools if available. If they are NOT available, fall back to
  the Figma REST API using the FIGMA_TOKEN environment variable
  (header "X-Figma-Token: $FIGMA_TOKEN"):
  - node structure/text/colors: GET https://api.figma.com/v1/files/:fileKey/nodes?ids=:nodeId
  - rendered images: GET https://api.figma.com/v1/images/:fileKey?ids=:nodeId&format=png&scale=2
  Use the rendered node image as the pixel-verify reference (figma_full.png).
- If neither MCP nor the REST API works, print a single line starting with
  "FATAL:" explaining what is missing, and exit.`;
}
