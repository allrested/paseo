import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import { MAIN_PROVIDER } from "../shared/settings.js";
import type { AccountsApi, AgentInfo, AgentSnapshot, ProviderEntry, ProviderState } from "./api.js";
import { errorMessage } from "./errors.js";

type PaseoApi = PluginHandlerContext["paseo"];

const PAGE_LIMIT = 200;

// Entries this plugin did not write are free-form: one it cannot read counts as an entry that does
// not launch Claude.
const ProviderEntrySchema = z.object({
  extends: z.string().optional(),
  enabled: z.boolean().optional(),
  env: z.record(z.string(), z.string()).optional(),
});
const UNREADABLE_ENTRY: ProviderEntry = { extends: null, enabled: true, configDirectory: null };

/** AccountsApi over the PaseoApi that a handler or a hook receives. */
export function accountsApi(paseo: PaseoApi): AccountsApi {
  return {
    async listAgents() {
      const agents: AgentInfo[] = [];
      let cursor: string | null = null;
      do {
        const page: Awaited<ReturnType<PaseoApi["agents"]["list"]>> = await paseo.agents.list({
          page: cursor === null ? { limit: PAGE_LIMIT } : { limit: PAGE_LIMIT, cursor },
        });
        for (const entry of page.entries) agents.push(toAgentInfo(entry.agent));
        cursor = page.pageInfo.hasMore ? page.pageInfo.nextCursor : null;
      } while (cursor !== null);
      return agents;
    },
    async getAgent(agentId) {
      const result = await paseo.agents.ref(agentId).refresh();
      return result === null || result.agent.archivedAt ? null : toAgentInfo(result.agent);
    },
    async moveAgent(agentId, provider) {
      const moved = await paseo.agents.ref(agentId).move({ to: provider, continueWork: false });
      return { agentId: moved.agentId, strategy: moved.strategy };
    },
    async listUsage(provider) {
      try {
        const usage = await paseo.providers.listUsageForProvider(provider);
        return { reports: usage.reports, tightest: usage.tightest, error: usage.error };
      } catch (error) {
        return { reports: [], tightest: null, error: errorMessage(error) };
      }
    },
    async providerEntries() {
      const { config } = await paseo.config.get();
      const entries = new Map<string, ProviderEntry>();
      for (const [provider, raw] of Object.entries(config.providers)) {
        const parsed = ProviderEntrySchema.safeParse(raw);
        entries.set(provider, parsed.success ? toProviderEntry(parsed.data) : UNREADABLE_ENTRY);
      }
      return entries;
    },
    async providerStates() {
      const { entries } = await paseo.providers.snapshot();
      const states = new Map<string, ProviderState>();
      for (const entry of entries) {
        states.set(entry.provider, { status: entry.status, error: entry.error ?? null });
      }
      return states;
    },
    async addProvider(provider, entry) {
      await paseo.config.patch({
        providers: {
          [provider]: {
            extends: MAIN_PROVIDER,
            label: entry.label,
            env: { CLAUDE_CONFIG_DIR: entry.configDirectory },
          },
        },
      });
    },
    async removeProvider(provider) {
      // A patch merges, so only `removeProviders` deletes an entry.
      await paseo.config.patch({ removeProviders: [provider] });
    },
    async latestWorkspaceId() {
      const { entries } = await paseo.workspaces.list({
        sort: [{ key: "activity_at", direction: "desc" }],
        page: { limit: 1 },
      });
      return entries[0]?.id ?? null;
    },
    async openTerminal(workspaceId, command) {
      await paseo.terminals.create({
        workspaceId,
        name: command.name,
        command: command.command,
        args: command.args,
      });
    },
  };
}

function toAgentInfo(agent: AgentSnapshot): AgentInfo {
  return {
    id: agent.id,
    provider: agent.provider,
    cwd: agent.cwd,
    status: agent.status,
    inTurn: (agent.activeTurn ?? null) !== null || agent.pendingPermissions.length > 0,
  };
}

function toProviderEntry(entry: z.output<typeof ProviderEntrySchema>): ProviderEntry {
  return {
    extends: entry.extends ?? null,
    enabled: entry.enabled !== false,
    configDirectory: entry.env?.CLAUDE_CONFIG_DIR ?? null,
  };
}
