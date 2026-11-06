import type { Command } from "commander";
import { connectToDaemon, resolveAgentId } from "../../utils/client.js";
import { fetchAllAgents } from "../../utils/agent-directory.js";
import type {
  CommandError,
  CommandOptions,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";

interface AgentMoveResult {
  fromAgentId: string;
  agentId: string;
  strategy: string;
  /** A Claude-to-Claude move that could not share the transcript and fell back to a handoff. */
  fellBackFromNative: boolean;
}

const moveSchema: OutputSchema<AgentMoveResult> = {
  idField: "agentId",
  columns: [
    { header: "FROM", field: "fromAgentId" },
    { header: "AGENT ID", field: "agentId" },
    { header: "STRATEGY", field: "strategy" },
    { header: "FALLBACK", field: "fellBackFromNative" },
  ],
};

export interface AgentMoveOptions extends CommandOptions {
  to?: string;
  model?: string;
  continue?: boolean;
}

export interface AgentMoveBackOptions extends CommandOptions {
  to?: string;
  continue?: boolean;
}

export function addMoveOptions(cmd: Command): Command {
  return cmd
    .description("Move an agent to another provider or account without calling its model")
    .argument("<id>", "Agent ID, prefix, or name")
    .requiredOption("--to <provider>", "Target provider id, e.g. codex or claude-work")
    .option("--model <model>", "Target model")
    .option("--no-continue", "Wait for your next message instead of continuing automatically");
}

export function addMoveBackOptions(cmd: Command): Command {
  return cmd
    .description("Move a moved agent back to its original agent")
    .argument("<id>", "Agent ID, prefix, or name")
    .option(
      "--to <agentId>",
      "An earlier agent in the move chain to return to (default: the agent it was moved from)",
    )
    .option("--no-continue", "Wait for your next message instead of continuing automatically");
}

type DaemonConnection = Awaited<ReturnType<typeof connectToDaemon>>;
type MoveOutcome = Awaited<ReturnType<DaemonConnection["moveAgent"]>>;

async function resolve(client: DaemonConnection, idArg: string) {
  const agents = await fetchAllAgents(client, { filter: { includeArchived: true } });
  const agentId = resolveAgentId(idArg, agents);
  if (!agentId) {
    throw {
      code: "AGENT_NOT_FOUND",
      message: `Agent not found: ${idArg}`,
      details: 'Use "paseo ls" to list agents',
    } as CommandError;
  }
  return agentId;
}

/** Connects, resolves the agent, runs the move and maps failures to MOVE_FAILED. */
async function runMove(
  idArg: string,
  options: CommandOptions,
  failurePrefix: string,
  move: (client: DaemonConnection, agentId: string) => Promise<MoveOutcome>,
): Promise<SingleResult<AgentMoveResult>> {
  const client = await connectToDaemon({ target: options.daemonTarget });
  try {
    const agentId = await resolve(client, idArg);
    const result = await move(client, agentId);
    await client.close();
    return {
      type: "single",
      data: {
        fromAgentId: agentId,
        agentId: result.agentId,
        strategy: result.strategy,
        fellBackFromNative: result.fellBackFromNative,
      },
      schema: moveSchema,
    };
  } catch (err) {
    await client.close().catch(() => {});
    if (err && typeof err === "object" && "code" in err) throw err;
    throw {
      code: "MOVE_FAILED",
      message: `${failurePrefix}: ${err instanceof Error ? err.message : String(err)}`,
    } as CommandError;
  }
}

export async function runMoveCommand(
  idArg: string,
  options: AgentMoveOptions,
  _command: Command,
): Promise<SingleResult<AgentMoveResult>> {
  const provider = options.to?.trim();
  if (!provider) {
    throw {
      code: "MISSING_PROVIDER",
      message: "Target provider is required",
      details: "Usage: paseo agent move <id> --to <provider>",
    } satisfies CommandError;
  }
  return runMove(idArg, options, "Failed to move agent", (client, agentId) =>
    client.moveAgent(
      agentId,
      { provider, ...(options.model ? { model: options.model } : {}) },
      { continueWork: options.continue !== false },
    ),
  );
}

export async function runMoveBackCommand(
  idArg: string,
  options: AgentMoveBackOptions,
  _command: Command,
): Promise<SingleResult<AgentMoveResult>> {
  return runMove(idArg, options, "Failed to move agent back", async (client, agentId) => {
    const toAgentId = options.to !== undefined ? await resolve(client, options.to) : undefined;
    return client.moveAgentBack(agentId, {
      continueWork: options.continue !== false,
      ...(toAgentId ? { toAgentId } : {}),
    });
  });
}
