import type { PluginHandlerContext } from "@getpaseo/plugin/server";

/** The agent's title as the app shows it; null when it has none or the daemon does not know it. */
export async function fetchAgentTitle(
  paseo: PluginHandlerContext["paseo"],
  agentId: string,
): Promise<string | null> {
  const result = await paseo.agents.ref(agentId).refresh();
  return result?.agent.title ?? null;
}
