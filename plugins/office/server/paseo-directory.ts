import type { OfficeAgent, OfficeWorkspace } from "../shared/contracts.js";
import {
  agentsFromSnapshot,
  applyAgentUpdate,
  applyWorkspaceUpdate,
  sortAgents,
  sortWorkspaces,
  workspacesFromSnapshot,
} from "./directory.js";
import { errorMessage } from "./errors.js";
import type { DirectoryView } from "./hub.js";
import type { Paseo } from "./paseo-holder.js";

// FetchAgentsRequestMessageSchema and FetchWorkspacesRequestMessageSchema cap a page at 200.
const PAGE_LIMIT = 200;

/**
 * The office shows at most one page of agents. The page caps the snapshot only; updates can add
 * more, so the view keeps the newest by creation, in the directory's order.
 */
export function newestAgents(agents: Iterable<OfficeAgent>): OfficeAgent[] {
  return sortAgents(agents).slice(-PAGE_LIMIT);
}

/**
 * Subscribed agent and workspace lists. Each subscription delivers its snapshot to a new observer
 * at once, then every update in order (packages/client/src/connection/owned.ts), and again after a
 * reconnect. When a re-request after a reconnect fails, the client drops the subscription and
 * calls only the observer's error; onEnd tells the caller this directory is dead.
 */
export async function openPaseoDirectory(
  paseo: Paseo,
  onChange: (view: DirectoryView) => void,
  log: (message: string) => void,
  onEnd?: () => void,
): Promise<() => Promise<void>> {
  let ended = false;
  function end(list: string, error: unknown): void {
    log(`[office] directory ended: ${list}: ${errorMessage(error)}`);
    if (ended) return;
    ended = true;
    try {
      onEnd?.();
    } catch (failure) {
      log(`[office] directory end failed: ${errorMessage(failure)}`);
    }
  }
  let agents = new Map<string, OfficeAgent>();
  let workspaces = new Map<string, OfficeWorkspace>();
  function emit(): void {
    try {
      onChange({
        agents: newestAgents(agents.values()),
        workspaces: sortWorkspaces(workspaces.values()),
      });
    } catch (error) {
      log(`[office] directory change failed: ${errorMessage(error)}`);
    }
  }
  const agentList = await paseo.agents.list({
    subscribe: {},
    filter: { statuses: ["initializing", "idle", "running", "error"] },
    page: { limit: PAGE_LIMIT },
  });
  const workspaceList = await paseo.workspaces
    .list({ subscribe: {}, page: { limit: PAGE_LIMIT } })
    .catch(async (error: unknown) => {
      await agentList.subscription.release();
      throw error;
    });
  const stopAgents = agentList.subscription.subscribe({
    snapshot: (snapshot) => {
      agents = agentsFromSnapshot(snapshot.entries.map((entry) => entry.agent));
      emit();
    },
    update: (message) => {
      if (message.type !== "agent_update") return;
      agents = applyAgentUpdate(agents, message.payload);
      emit();
    },
    error: (error) => end("agents", error),
  });
  const stopWorkspaces = workspaceList.subscription.subscribe({
    snapshot: (snapshot) => {
      workspaces = workspacesFromSnapshot(snapshot.entries);
      emit();
    },
    update: (message) => {
      if (message.type !== "workspace_update") return;
      workspaces = applyWorkspaceUpdate(workspaces, message.payload);
      emit();
    },
    error: (error) => end("workspaces", error),
  });
  return async () => {
    ended = true;
    stopAgents();
    stopWorkspaces();
    await Promise.all([agentList.subscription.release(), workspaceList.subscription.release()]);
  };
}
