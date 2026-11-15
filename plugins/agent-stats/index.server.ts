import { homedir } from "node:os";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { errorMessage } from "./server/errors.js";
import { statsFile } from "./server/paths.js";
import { createAgentStats } from "./server/stats.js";
import { createStatsStore, type StatsStore } from "./server/stats-store.js";
import { listWorkspaces } from "./server/workspaces.js";
import { statsChanges, statsRpc } from "./shared/contracts.js";

/** What the plugin needs from outside the daemon's plugin API. */
export interface AgentStatsPluginDeps {
  store: StatsStore;
  /** Now, in milliseconds. */
  now(): number;
  log(message: string): void;
}

// Runs inside the daemon process: every hook catches its own errors.
export function createAgentStatsPlugin(
  server: PluginServerContext,
  deps: AgentStatsPluginDeps,
): () => void {
  const { log } = deps;
  const stats = createAgentStats(deps);

  server.handle(statsRpc, ({ since }, { paseo }) =>
    stats.read(since, () => listWorkspaces((request) => paseo.workspaces.list(request))),
  );
  server.handle(statsChanges, (_input, context) => stats.attach(context));

  const removeHooks = [
    server.addHook("agent.turn.before", async ({ agent }) => {
      try {
        // A helper works inside its parent's turn: counting it would count that time twice.
        if (!agent.background) stats.started(agent.id);
      } catch (error) {
        log(`[agent-stats] agent.turn.before failed: ${errorMessage(error)}`);
      }
    }),
    server.addHook("agent.turn.after", async ({ agent, outcome }) => {
      try {
        if (agent.background) return;
        await stats.ended({
          agentId: agent.id,
          workspaceId: agent.workspaceId,
          folder: agent.cwd,
          failed: outcome.kind === "failed",
        });
      } catch (error) {
        log(`[agent-stats] agent.turn.after failed: ${errorMessage(error)}`);
      }
    }),
    server.addHook("agent.close.after", async ({ agent }) => {
      try {
        stats.gone(agent.id);
      } catch (error) {
        log(`[agent-stats] agent.close.after failed: ${errorMessage(error)}`);
      }
    }),
    server.addHook("agent.archive.after", async ({ agent }) => {
      try {
        stats.gone(agent.id);
      } catch (error) {
        log(`[agent-stats] agent.archive.after failed: ${errorMessage(error)}`);
      }
    }),
  ];

  return () => {
    for (const remove of removeHooks) remove();
  };
}

export default function contribute(server: PluginServerContext): () => void {
  const log = (message: string) => console.error(message);
  return createAgentStatsPlugin(server, {
    // Built-ins run in the daemon process, so process.env is the daemon's env.
    store: createStatsStore({ file: statsFile(process.env, homedir()), log }),
    now: () => Date.now(),
    log,
  });
}
