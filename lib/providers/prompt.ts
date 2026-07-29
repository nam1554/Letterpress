import os from "node:os";
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

export const FIGMA_EDM_SKILL_DIR = path.join(os.homedir(), ".claude", "skills", "figma-edm");

/**
 * The conversion instructions shared by every backend.
 * `skillAccess` differs: Claude Code loads "figma-edm" via its skill system;
 * other CLIs must read the same skill's files from disk.
 */
export function buildEdmPrompt(
  task: AgentTask,
  skillAccess: "claude-skill" | "files",
): string {
  const skillIntro =
    skillAccess === "claude-skill"
      ? `Use the "figma-edm" skill and follow its full pipeline`
      : `Read ${FIGMA_EDM_SKILL_DIR}/SKILL.md and ${FIGMA_EDM_SKILL_DIR}/references/workflow.md, then follow that pipeline exactly (the bundled scripts are in ${FIGMA_EDM_SKILL_DIR}/scripts/)`;

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
${figmaAccessClause()}
- Print short progress lines as you complete each pipeline step.
- Finish with a one-paragraph summary of what was produced and the verify result.${repairClause(task)}`;
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
