import { AgentStatusSchema } from "../../shared/contracts.js";
import type { Paseo, PaseoHolder } from "../paseo-holder.js";
import type { CleanupPorts } from "./cleanup.js";
import type { MachinePorts } from "./machine.js";
import type { KnownAgent } from "./reading.js";

// FetchAgentsRequestMessageSchema caps a page at 200.
const PAGE_LIMIT = 200;
const LIVE_STATUSES = ["initializing", "idle", "running", "error"] as const;

/** The fields read from an agent snapshot (AgentSnapshotPayload satisfies it). */
interface AgentInput {
  id: string;
  title: string | null;
  status: string;
  updatedAt: string;
  archivedAt?: string | null;
  persistence?: object | null;
}

/** An archived agent has no runtime to come back to, whatever state it was archived in. */
function statusOf(agent: AgentInput): KnownAgent["status"] | null {
  if (agent.archivedAt) return "closed";
  const parsed = AgentStatusSchema.safeParse(agent.status);
  return parsed.success ? parsed.data : null;
}

function known(agent: AgentInput): KnownAgent | null {
  const status = statusOf(agent);
  if (status === null) return null;
  return { id: agent.id, title: agent.title, status, updatedAt: agent.updatedAt };
}

/** Every agent with a runtime, background ones included: they hold memory like any other. */
async function liveAgents(paseo: Paseo): Promise<KnownAgent[]> {
  const live: KnownAgent[] = [];
  let cursor: string | undefined;
  do {
    const page = await paseo.agents.list({
      includeBackground: true,
      filter: { statuses: [...LIVE_STATUSES], includeBackground: true },
      page: { limit: PAGE_LIMIT, cursor },
    });
    for (const { agent } of page.entries) {
      const entry = known(agent);
      if (entry !== null && entry.status !== "closed") live.push(entry);
    }
    cursor =
      page.pageInfo.hasMore && page.pageInfo.nextCursor !== null
        ? page.pageInfo.nextCursor
        : undefined;
  } while (cursor !== undefined);
  return live;
}

/** What the machine reader needs beside /proc; the holder is set before the first attach. */
export function liveMachinePorts(
  holder: PaseoHolder,
  now: () => number,
): Pick<MachinePorts, "now" | "liveAgents" | "agent"> {
  return {
    now,
    liveAgents: () => liveAgents(holder.require()),
    async agent(id) {
      const result = await holder.require().agents.ref(id).refresh();
      return result === null ? null : known(result.agent);
    },
  };
}

export function liveCleanupPorts(
  holder: PaseoHolder,
): Pick<CleanupPorts, "agent" | "closeRuntime"> {
  return {
    async agent(agentId) {
      const result = await holder.require().agents.ref(agentId).refresh();
      if (result === null) return null;
      const status = statusOf(result.agent);
      return status === null ? null : { status, resumable: result.agent.persistence != null };
    },
    closeRuntime: (agentId) => holder.require().agents.ref(agentId).closeRuntime(),
  };
}
