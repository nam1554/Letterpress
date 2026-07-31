import { getSettings } from "../settings";
import { claudeCodeProvider } from "./claude-code";
import { codexProvider } from "./codex";
import { mockProvider } from "./mock";
import type { AgentProvider } from "./types";

const providers: Record<string, AgentProvider> = {
  [claudeCodeProvider.id]: claudeCodeProvider,
  [codexProvider.id]: codexProvider,
  [mockProvider.id]: mockProvider,
};

export function defaultProviderId(): string {
  return getSettings().defaultProvider;
}

export function getProvider(id?: string): AgentProvider {
  const resolved = id ?? defaultProviderId();
  const provider = providers[resolved];
  if (!provider) {
    throw new Error(
      `Unknown provider "${resolved}". Available: ${Object.keys(providers).join(", ")}`,
    );
  }
  return provider;
}

export function listProviders(): Array<Pick<AgentProvider, "id" | "label">> {
  return Object.values(providers).map(({ id, label }) => ({ id, label }));
}
