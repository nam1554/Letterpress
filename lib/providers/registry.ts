import { claudeCodeProvider } from "./claude-code";
import { codexProvider } from "./codex";
import { geminiProvider } from "./gemini";
import { mockProvider } from "./mock";
import type { AgentProvider } from "./types";

const providers: Record<string, AgentProvider> = {
  [claudeCodeProvider.id]: claudeCodeProvider,
  [geminiProvider.id]: geminiProvider,
  [codexProvider.id]: codexProvider,
  [mockProvider.id]: mockProvider,
};

export const DEFAULT_PROVIDER_ID = process.env.AGENT_PROVIDER ?? "claude-code";

export function getProvider(id?: string): AgentProvider {
  const provider = providers[id ?? DEFAULT_PROVIDER_ID];
  if (!provider) {
    throw new Error(
      `Unknown provider "${id ?? DEFAULT_PROVIDER_ID}". Available: ${Object.keys(providers).join(", ")}`,
    );
  }
  return provider;
}

export function listProviders(): Array<Pick<AgentProvider, "id" | "label">> {
  return Object.values(providers).map(({ id, label }) => ({ id, label }));
}
