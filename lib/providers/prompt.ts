import os from "node:os";
import path from "node:path";
import type { AgentTask } from "./types";

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
- If Figma access (MCP tools or API) is NOT available in this session, do not
  improvise: print a single line starting with "FATAL:" explaining what is
  missing, and exit.
- Print short progress lines as you complete each pipeline step.
- Finish with a one-paragraph summary of what was produced and the verify result.`;
}
