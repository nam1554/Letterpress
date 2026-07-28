import os from "node:os";
import path from "node:path";
import { getSettings } from "../settings";
import type { AgentTask } from "./types";

/** Extra env for spawned agent CLIs (Figma REST fallback token, if set). */
export function agentEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const token = getSettings().figmaToken;
  if (token) env.FIGMA_TOKEN = token;
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
${figmaAccessClause()}
- Print short progress lines as you complete each pipeline step.
- Finish with a one-paragraph summary of what was produced and the verify result.`;
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
