import {
  GroupKindSchema,
  type AgentUsage,
  type GroupKind,
  type GroupUsage,
  type LocalReading,
} from "../../shared/rpc.js";
import type { LiveAgent } from "../paseo-ports.js";
import { attribute } from "./attribution.js";
import { readHostSummary } from "./host-summary.js";
import { findSupervisorPid, readProcessTable, type ProcessInfo } from "./process-table.js";
import { readSharedMcpPids } from "./shared-mcp-groups.js";

// sysconf(_SC_CLK_TCK): /proc/<pid>/stat counts CPU time in these ticks, 100 on every mainstream
// Linux architecture.
export const USER_HZ = 100;
const REUSE_MS = 1_000;
const BASELINE_MAX_AGE_MS = 15_000;
const BASELINE_GAP_MS = 1_000;

export interface LocalReaderOptions {
  procRoot: string;
  cgroupRoot: string;
  sharedMcpRunDir: string;
  /** The heavy-command gate's shim directory (heavyGateBinDir in server/paths.ts). */
  heavyGateBinDir: string;
  /** The daemon worker, which is the process this plugin runs in. */
  daemonPid: number;
  cores: number;
  now(): number;
  sleep(ms: number): Promise<void>;
}

export type AgentLister = () => Promise<LiveAgent[]>;

interface Sample {
  at: number;
  table: ProcessInfo[];
  /** cpuTicks by "pid:startTime", so a reused pid starts from zero. */
  ticks: Map<string, number>;
}

interface SamplePair {
  current: Sample;
  base: Sample;
}

interface AgentsOutcome {
  agents: LiveAgent[];
  error: string | null;
}

interface Totals {
  rssBytes: number;
  cpuPercent: number | null;
  processCount: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function settleAgents(listAgents: AgentLister): Promise<AgentsOutcome> {
  try {
    return { agents: await listAgents(), error: null };
  } catch (error) {
    return { agents: [], error: errorMessage(error) };
  }
}

function processKey(info: ProcessInfo): string {
  return `${info.pid}:${info.startTime}`;
}

function totals(
  pids: readonly number[],
  pair: SamplePair,
  byPid: Map<number, ProcessInfo>,
): Totals {
  const seconds = (pair.current.at - pair.base.at) / 1000;
  let rssBytes = 0;
  let ticks = 0;
  for (const pid of pids) {
    const info = byPid.get(pid);
    if (info === undefined) continue;
    rssBytes += info.rssBytes;
    // A process that started after the base sample has no base entry: all its ticks fall inside
    // the window.
    ticks += Math.max(0, info.cpuTicks - (pair.base.ticks.get(processKey(info)) ?? 0));
  }
  const cpuPercent = seconds > 0 ? Math.round((ticks / USER_HZ / seconds) * 1000) / 10 : null;
  return { rssBytes, cpuPercent, processCount: pids.length };
}

function groupUsage(
  kind: GroupKind,
  pids: readonly number[],
  pair: SamplePair,
  byPid: Map<number, ProcessInfo>,
): GroupUsage {
  const total = totals(pids, pair, byPid);
  return {
    kind,
    rssBytes: total.rssBytes,
    cpuPercent: total.cpuPercent,
    processCount: total.processCount,
  };
}

export class LocalReader {
  private readonly options: LocalReaderOptions;
  private previous: Sample | null = null;
  private last: { at: number; reading: LocalReading } | null = null;
  private inFlight: Promise<LocalReading> | null = null;

  constructor(options: LocalReaderOptions) {
    this.options = options;
  }

  // Two screens polling every 5 s, or a refetch right after a Close, share a reading made less
  // than 1 s ago, and concurrent callers share one read.
  read(listAgents: AgentLister): Promise<LocalReading> {
    const { last } = this;
    const age = last === null ? -1 : this.options.now() - last.at;
    // A clock stepped back would keep serving this reading; a negative age reads afresh.
    if (last !== null && age >= 0 && age < REUSE_MS) return Promise.resolve(last.reading);
    if (this.inFlight === null) {
      this.inFlight = this.readFresh(listAgents).finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async readFresh(listAgents: AgentLister): Promise<LocalReading> {
    // Started first and settled into a value, so a rejection while the baseline sleeps is never
    // unhandled.
    const agentsOutcome = settleAgents(listAgents);
    const pair = await this.samplePair();
    const outcome = await agentsOutcome;
    const reading = this.build(pair, outcome);
    this.last = { at: pair.current.at, reading };
    return reading;
  }

  // CPU % needs two samples. The previous reading's sample serves when it is under 15 s old;
  // otherwise this one takes a base, waits 1 s, and samples again.
  private async samplePair(): Promise<SamplePair> {
    let base = this.previous;
    if (base === null || this.options.now() - base.at > BASELINE_MAX_AGE_MS) {
      base = this.takeSample();
      await this.options.sleep(BASELINE_GAP_MS);
    }
    const current = this.takeSample();
    this.previous = current;
    return { current, base };
  }

  private takeSample(): Sample {
    const table = readProcessTable(this.options.procRoot, this.options.heavyGateBinDir);
    const ticks = new Map(table.map((info): [string, number] => [processKey(info), info.cpuTicks]));
    return { at: this.options.now(), table, ticks };
  }

  private build(pair: SamplePair, outcome: AgentsOutcome): LocalReading {
    const { options } = this;
    const table = pair.current.table;
    const byPid = new Map(table.map((info): [number, ProcessInfo] => [info.pid, info]));
    const attribution = attribute(table, {
      daemonPid: options.daemonPid,
      supervisorPid: findSupervisorPid(options.daemonPid, options.procRoot),
      sharedMcpPids: readSharedMcpPids(options.sharedMcpRunDir, options.procRoot),
      liveAgentIds: new Set(outcome.agents.map((agent) => agent.id)),
    });
    const agents: AgentUsage[] = [];
    for (const agent of outcome.agents) {
      const pids = attribution.agents.get(agent.id);
      if (pids === undefined) continue;
      const total = totals(pids, pair, byPid);
      agents.push({
        agentId: agent.id,
        title: agent.title,
        provider: agent.provider,
        status: agent.status,
        rssBytes: total.rssBytes,
        cpuPercent: total.cpuPercent,
        idleSince: agent.status === "idle" ? agent.updatedAt : null,
        processCount: total.processCount,
      });
    }
    agents.sort((a, b) => b.rssBytes - a.rssBytes || a.agentId.localeCompare(b.agentId));
    const groups = GroupKindSchema.options.map((kind) =>
      groupUsage(kind, attribution.groups.get(kind) ?? [], pair, byPid),
    );
    return {
      readAt: new Date(pair.current.at).toISOString(),
      host: readHostSummary({
        procRoot: options.procRoot,
        cgroupRoot: options.cgroupRoot,
        cores: options.cores,
      }),
      agents,
      groups,
      agentsError: outcome.error,
    };
  }
}
