import { describe, expect, it } from "vitest";
import type { GroupKind } from "../../shared/rpc.js";
import { attribute, type AttributionContext } from "./attribution.js";
import type { ProcessInfo } from "./process-table.js";

interface Row {
  pid: number;
  ppid: number;
  agentId?: string;
  heavyGate?: boolean;
  gateShim?: boolean;
}

function table(rows: readonly Row[]): ProcessInfo[] {
  return rows.map((row) => ({
    pid: row.pid,
    ppid: row.ppid,
    startTime: 1000,
    cpuTicks: 0,
    rssBytes: 0,
    agentId: row.agentId ?? null,
    heavyGate: row.heavyGate ?? false,
    gateShim: row.gateShim ?? false,
  }));
}

const CONTEXT: AttributionContext = {
  daemonPid: 164,
  supervisorPid: 6,
  sharedMcpPids: new Set([400, 401]),
  liveAgentIds: new Set(["agent-a", "agent-c"]),
};

// The process tree this container had on 2026-11-06, plus one of each case.
const TREE = table([
  { pid: 1, ppid: 0 },
  { pid: 6, ppid: 1 },
  { pid: 164, ppid: 6 },
  { pid: 300, ppid: 164, agentId: "agent-a" },
  { pid: 301, ppid: 300 },
  { pid: 302, ppid: 301, agentId: "agent-a" },
  { pid: 309, ppid: 300, agentId: "agent-a", gateShim: true },
  { pid: 310, ppid: 309, agentId: "agent-a", heavyGate: true },
  { pid: 311, ppid: 310, agentId: "agent-a", heavyGate: true },
  { pid: 312, ppid: 311 },
  { pid: 400, ppid: 164 },
  { pid: 401, ppid: 400 },
  { pid: 500, ppid: 164, agentId: "agent-gone" },
  { pid: 501, ppid: 500 },
  { pid: 600, ppid: 164 },
  { pid: 700, ppid: 164, agentId: "agent-c" },
  { pid: 900, ppid: 901 },
  { pid: 901, ppid: 900 },
]);

function sorted(map: Map<string, number[]>): Record<string, number[]> {
  const entries = [...map.entries()].map(([key, pids]): [string, number[]] => [
    key,
    [...pids].sort((a, b) => a - b),
  ]);
  return Object.fromEntries(entries);
}

describe("attribute", () => {
  it("partitions every process between agents and the four groups", () => {
    const result = attribute(TREE, CONTEXT);

    expect(sorted(result.agents)).toEqual({ "agent-a": [300, 301, 302, 309], "agent-c": [700] });
    const groups: Record<GroupKind, number[]> = {
      daemon: [6, 164, 600],
      sharedMcp: [400, 401],
      heavyGate: [310, 311, 312],
      other: [1, 500, 501, 900, 901],
    };
    expect(sorted(result.groups)).toEqual(groups);
  });

  it("puts a shared MCP server under its group even when it names an agent", () => {
    const rows = table([
      { pid: 164, ppid: 1 },
      { pid: 400, ppid: 164, agentId: "agent-a" },
    ]);
    const result = attribute(rows, CONTEXT);

    expect(result.groups.get("sharedMcp")).toEqual([400]);
    expect(result.agents.size).toBe(0);
  });

  it("counts everything under 'other' when no agent is live", () => {
    const result = attribute(TREE, { ...CONTEXT, liveAgentIds: new Set() });

    expect(result.agents.size).toBe(0);
    expect(result.groups.get("other")).toEqual(
      expect.arrayContaining([300, 301, 302, 309, 700, 500, 501]),
    );
    expect(result.groups.get("heavyGate")).toEqual([310, 311, 312]);
  });

  it("without a supervisor, its process falls to its parent's owner", () => {
    const result = attribute(TREE, { ...CONTEXT, supervisorPid: null });

    expect(result.groups.get("other")).toEqual(expect.arrayContaining([1, 6]));
    expect(result.groups.get("daemon")).toEqual(expect.arrayContaining([164, 600]));
    expect(result.groups.get("daemon")).not.toContain(6);
  });

  it("counts a marked process that outlived its gate shim under its agent", () => {
    // A daemon a held command started, reparented to pid 1 once the command and its shim ended.
    const rows = table([
      { pid: 1, ppid: 0 },
      { pid: 320, ppid: 1, agentId: "agent-a", heavyGate: true },
      { pid: 321, ppid: 320, agentId: "agent-a", heavyGate: true },
    ]);
    const result = attribute(rows, CONTEXT);

    expect(sorted(result.agents)).toEqual({ "agent-a": [320, 321] });
    expect(result.groups.has("heavyGate")).toBe(false);
  });

  it("counts a command the gate ran after failing open under its agent", () => {
    // Failing open, the shim replaces itself with the command, so no shim is its parent.
    const rows = table([
      { pid: 164, ppid: 1 },
      { pid: 300, ppid: 164, agentId: "agent-a" },
      { pid: 330, ppid: 300, agentId: "agent-a", heavyGate: true },
      { pid: 331, ppid: 330, agentId: "agent-a", heavyGate: true },
    ]);
    const result = attribute(rows, CONTEXT);

    expect(sorted(result.agents)).toEqual({ "agent-a": [300, 330, 331] });
    expect(result.groups.has("heavyGate")).toBe(false);
  });

  it("ends on a flagged process whose parent is missing and on a flagged cycle", () => {
    const rows = table([
      { pid: 340, ppid: 999, agentId: "agent-a", heavyGate: true },
      { pid: 350, ppid: 351, agentId: "agent-a", heavyGate: true },
      { pid: 351, ppid: 350, agentId: "agent-a", heavyGate: true },
    ]);
    const result = attribute(rows, CONTEXT);

    expect(sorted(result.agents)).toEqual({ "agent-a": [340, 350, 351] });
    expect(result.groups.has("heavyGate")).toBe(false);
  });
});
