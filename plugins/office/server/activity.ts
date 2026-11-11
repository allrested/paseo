import { errorMessage } from "./errors.js";
import type { Timers } from "./timers.js";

/** At most one read per agent per interval (spec: once per 5 s per agent). */
export const ACTIVITY_INTERVAL_MS = 5000;
/** Timeline items read from the tail of each running agent. */
export const ACTIVITY_TAIL_LIMIT = 10;
// Providers put free text (a command, a path) in a tool name; only identifier-like names are shown.
const TOOL_NAME = /^[A-Za-z0-9_.:-]{1,60}$/;

/** The fields read from a timeline item; every AgentTimelineItem satisfies it. */
export interface ActivityItem {
  type: string;
  name?: unknown;
  status?: unknown;
}

/** One line for the newest item it recognises. Never quotes prompt or tool text. */
export function describeActivity(items: readonly ActivityItem[]): string | null {
  for (const item of items.toReversed()) {
    if (item.type === "tool_call") {
      const verb = item.status === "running" ? "Running" : "Ran";
      const tool =
        typeof item.name === "string" && TOOL_NAME.test(item.name) ? item.name : "a tool";
      return `${verb} ${tool}`;
    }
    if (item.type === "assistant_message") return "Writing a reply";
    if (item.type === "reasoning") return "Thinking";
    if (item.type === "user_message") return "Reading the prompt";
  }
  return null;
}

export interface ActivityPorts {
  /** Ids of the agents running now. */
  running(): readonly string[];
  tail(agentId: string): Promise<readonly ActivityItem[]>;
  timers: Timers;
  log(message: string): void;
  onChange(activity: Readonly<Record<string, string>>): void;
}

export interface ActivityPoller {
  stop(): void;
}

function sameLines(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
) {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
}

/** Reads now, then every interval after the previous read finished, until stopped. */
export function startActivityPoller(ports: ActivityPorts): ActivityPoller {
  let stopped = false;
  let cancel: (() => void) | null = null;
  let previous: Readonly<Record<string, string>> = {};

  async function readOne(agentId: string, next: Record<string, string>): Promise<void> {
    try {
      const line = describeActivity(await ports.tail(agentId));
      if (line !== null) next[agentId] = line;
    } catch (error) {
      if (!stopped) ports.log(`[office] activity of ${agentId}: ${errorMessage(error)}`);
      const kept = previous[agentId];
      if (kept !== undefined) next[agentId] = kept;
    }
  }

  async function tick(): Promise<void> {
    const next: Record<string, string> = {};
    for (const agentId of ports.running()) {
      if (stopped) return;
      await readOne(agentId, next);
    }
    if (stopped || sameLines(previous, next)) return;
    previous = next;
    ports.onChange(next);
  }

  function runLogged(): void {
    run().catch((error: unknown) => ports.log(`[office] activity failed: ${errorMessage(error)}`));
  }

  async function run(): Promise<void> {
    try {
      await tick();
    } catch (error) {
      ports.log(`[office] activity failed: ${errorMessage(error)}`);
    }
    if (!stopped) cancel = ports.timers.setTimeout(runLogged, ACTIVITY_INTERVAL_MS);
  }

  runLogged();
  return {
    stop() {
      stopped = true;
      cancel?.();
      cancel = null;
    },
  };
}
