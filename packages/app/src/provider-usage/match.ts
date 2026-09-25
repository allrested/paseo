import type { ProviderUsage } from "./types";

function find(providers: ProviderUsage[], id: string): ProviderUsage | null {
  const target = id.toLowerCase();
  return providers.find((usage) => usage.providerId.toLowerCase() === target) ?? null;
}

/**
 * Resolves the usage entry to show for an agent.
 *
 * The agent's provider is the CLI running it, which is not always who bills the
 * tokens: an agent on `opencode` with model `bddevlab/claude-opus-5` spends a
 * BDDevLab balance. Model ids carry the gateway as the segment before the slash,
 * so it is the fallback when the CLI itself has no usage entry.
 */
export function matchProviderUsage(
  providers: ProviderUsage[],
  activeProviderId: string | null | undefined,
  activeModel: string | null | undefined,
): ProviderUsage | null {
  const byProvider = activeProviderId ? find(providers, activeProviderId) : null;
  if (byProvider) return byProvider;

  const slash = activeModel?.indexOf("/") ?? -1;
  if (slash <= 0 || !activeModel) return null;
  return find(providers, activeModel.slice(0, slash));
}
