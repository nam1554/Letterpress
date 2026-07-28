import { spawn } from "node:child_process";

/**
 * Shared subprocess runner for JSONL-streaming agent CLIs (claude/codex/gemini).
 * Owns the fragile parts once: partial-line buffering, stdin closing (codex and
 * gemini block waiting for stdin EOF on a pipe), stderr tail capture, and the
 * error/close/abort race (first settlement wins).
 */
export interface JsonlCliResult {
  kind: "closed" | "aborted" | "spawn-error";
  /** Exit code (kind === "closed"). */
  code?: number | null;
  /** Spawn failure (kind === "spawn-error"). */
  error?: Error;
  /** Last ~2KB of stderr — usually the actionable CLI error. */
  stderrTail: string;
}

export function runJsonlCli(opts: {
  bin: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  /** Called per parsed JSON line, in stream order. */
  onJson: (obj: unknown) => void;
  /** Called for a non-empty stdout line that is not valid JSON. */
  onText: (raw: string) => void;
}): Promise<JsonlCliResult> {
  return new Promise((resolve) => {
    const child = spawn(opts.bin, opts.args, {
      cwd: opts.cwd,
      env: opts.env,
      signal: opts.signal,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderrTail = "";
    let buffer = "";
    let settled = false;
    const settle = (result: JsonlCliResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const raw of lines) {
        if (!raw.trim()) continue;
        try {
          opts.onJson(JSON.parse(raw));
        } catch {
          opts.onText(raw);
        }
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderrTail = (stderrTail + chunk).slice(-2000);
    });

    child.on("error", (error) => {
      if (opts.signal.aborted) settle({ kind: "aborted", stderrTail });
      else settle({ kind: "spawn-error", error, stderrTail });
    });

    child.on("close", (code) => {
      // A trailing line without \n is still a line.
      if (buffer.trim()) {
        try {
          opts.onJson(JSON.parse(buffer));
        } catch {
          opts.onText(buffer);
        }
        buffer = "";
      }
      if (opts.signal.aborted) settle({ kind: "aborted", stderrTail });
      else settle({ kind: "closed", code, stderrTail });
    });
  });
}
