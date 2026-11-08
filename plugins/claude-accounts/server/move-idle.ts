import type { MoveJob } from "../shared/rpc.js";
import { MAIN_PROVIDER } from "../shared/settings.js";
import type { AccountsApi, AgentInfo } from "./api.js";
import { errorMessage } from "./errors.js";

/** The part of AccountsApi a move job uses. */
export type MoveApi = Pick<AccountsApi, "listAgents" | "getAgent" | "moveAgent">;

export type MoveStart = { ok: true; job: MoveJob } | { ok: false; error: string };

const IDLE_STATUSES: ReadonlySet<string> = new Set(["idle", "error", "closed"]);
const BUSY_MESSAGE = "Agents are still moving. Wait for that move to finish.";

/** Not starting or running, with no turn in flight and no permission request waiting. */
export function isIdle(agent: AgentInfo): boolean {
  return IDLE_STATUSES.has(agent.status) && !agent.inTurn;
}

/** Moves one account's idle agents one at a time in the background; one job per daemon. */
export class MoveIdleRunner {
  private job: MoveJob | null = null;
  private active = false;
  private stopped = false;
  private mainMoveCwd: string | null = null;
  private running: Promise<void> = Promise.resolve();

  constructor(private readonly onError: (error: unknown) => void) {}

  /**
   * Lists the agents on `from`, starts moving the idle ones and counts the ones in a turn, which
   * stay. Resolves with the job at once.
   */
  async start(api: MoveApi, from: string, to: string): Promise<MoveStart> {
    if (this.active) return { ok: false, error: BUSY_MESSAGE };
    this.active = true;
    let agentIds: string[];
    let busy: number;
    try {
      const listed = (await api.listAgents()).filter((agent) => agent.provider === from);
      agentIds = listed.filter((agent) => isIdle(agent)).map((agent) => agent.id);
      busy = listed.length - agentIds.length;
    } catch (error) {
      this.active = false;
      throw error;
    }
    const job: MoveJob = {
      from,
      to,
      total: agentIds.length,
      busy,
      moved: 0,
      handedOff: 0,
      skipped: 0,
      failed: [],
      done: false,
    };
    this.job = job;
    // run() catches every move's failure; this catch only keeps the daemon alive.
    this.running = this.run(api, job, agentIds).catch((error: unknown) => this.onError(error));
    return { ok: true, job: copyJob(job) };
  }

  current(): MoveJob | null {
    return this.job === null ? null : copyJob(this.job);
  }

  /** This runner is moving an agent in `cwd` to plain `claude` right now. */
  movingToMain(cwd: string): boolean {
    return this.mainMoveCwd === cwd;
  }

  /** The move in flight finishes on its own; no further move starts. */
  stop(): void {
    this.stopped = true;
  }

  settled(): Promise<void> {
    return this.running;
  }

  private async run(api: MoveApi, job: MoveJob, agentIds: readonly string[]): Promise<void> {
    try {
      for (const agentId of agentIds) {
        if (this.stopped) break;
        await this.moveOne(api, job, agentId);
      }
    } finally {
      job.done = true;
      this.active = false;
    }
  }

  private async moveOne(api: MoveApi, job: MoveJob, agentId: string): Promise<void> {
    try {
      // An agent that started a turn since the list is left alone, never interrupted.
      const agent = await api.getAgent(agentId);
      if (agent === null || agent.provider !== job.from || !isIdle(agent)) {
        job.skipped += 1;
        return;
      }
      this.mainMoveCwd = job.to === MAIN_PROVIDER ? agent.cwd : null;
      const outcome = await api.moveAgent(agentId, job.to);
      job.moved += 1;
      if (outcome.strategy === "handoff") job.handedOff += 1;
    } catch (error) {
      job.failed.push({ agentId, error: errorMessage(error) });
    } finally {
      this.mainMoveCwd = null;
    }
  }
}

function copyJob(job: MoveJob): MoveJob {
  return { ...job, failed: [...job.failed] };
}
