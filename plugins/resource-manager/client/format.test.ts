import { describe, expect, it } from "vitest";
import type { AgentUsage, GroupUsage, HostSummary, RemoteSnapshot } from "../shared/rpc.js";
import {
  agentLabel,
  describeAgent,
  describeGroup,
  formatBytes,
  formatClock,
  formatCpu,
  formatDuration,
  formatLoad,
  formatShare,
  groupLabel,
  hostRows,
  mountRow,
  processRow,
  serverRows,
} from "./format.js";

const KIB = 1024;
const GIB = 1024 ** 3;

const AGENT: AgentUsage = {
  agentId: "agent-a",
  title: "Fix login",
  provider: "claude",
  status: "idle",
  rssBytes: 512000 * KIB,
  cpuPercent: 200,
  idleSince: "2026-11-06T08:50:00.000Z",
  processCount: 2,
};

const HOST: HostSummary = {
  memoryUsedBytes: 3 * GIB,
  memoryLimitBytes: 8 * GIB,
  swapUsedBytes: 0,
  swapTotalBytes: 12 * GIB,
  hostAvailableBytes: 7 * GIB,
  hostTotalBytes: 15 * GIB,
  load1: 1.54,
  load5: 1.88,
  load15: 2.22,
  cores: 2,
};

const NO_HOST: HostSummary = {
  memoryUsedBytes: null,
  memoryLimitBytes: null,
  swapUsedBytes: null,
  swapTotalBytes: null,
  hostAvailableBytes: null,
  hostTotalBytes: null,
  load1: null,
  load5: null,
  load15: null,
  cores: 2,
};

const SNAPSHOT: RemoteSnapshot = {
  memTotalBytes: 16042308 * KIB,
  memAvailableBytes: 7923328 * KIB,
  swapTotalBytes: 12582908 * KIB,
  swapFreeBytes: 6615380 * KIB,
  load1: 3.08,
  load5: 2.5,
  load15: 2.53,
  cores: 2,
  mounts: [],
  processes: [],
};

describe("formatBytes", () => {
  it("uses 1024 steps and one decimal under 10", () => {
    expect([512, 1536, 812 * 1024 ** 2, 15 * GIB, 3 * GIB].map(formatBytes)).toEqual([
      "512 B",
      "1.5 KB",
      "812 MB",
      "15 GB",
      "3.0 GB",
    ]);
  });
});

describe("small formatters", () => {
  it("formats shares, CPU, durations, clock times and load", () => {
    expect(formatShare(3 * GIB, 8 * GIB)).toBe("3.0 GB of 8.0 GB (38%)");
    expect(formatCpu(12.25)).toBe("12.3% CPU");
    expect(formatCpu(null)).toBe("CPU unknown");
    expect([30_000, 601_000, 3_900_000, 90_000_000].map(formatDuration)).toEqual([
      "under a minute",
      "10 min",
      "1 h 5 min",
      "1 d 1 h",
    ]);
    expect(formatClock(new Date(2026, 10, 6, 9, 5, 3).toISOString())).toBe("09:05:03");
    expect(formatLoad(1.54, 1.88, 2.22, 2)).toBe("1.54, 1.88, 2.22 on 2 cores");
    expect(formatLoad(0.5, 0.25, 0, 1)).toBe("0.50, 0.25, 0.00 on 1 core");
  });
});

describe("agent and group text", () => {
  it("labels agents and groups", () => {
    expect(agentLabel(AGENT)).toBe("Fix login");
    expect(agentLabel({ ...AGENT, title: null })).toBe("Untitled agent");
    expect(
      (["daemon", "sharedMcp", "heavyGate", "other"] as const).map((kind) => groupLabel(kind)),
    ).toEqual(["Paseo daemon", "Shared MCP servers", "Heavy commands", "Everything else"]);
  });

  it("describes an idle agent with its idle time, and a running one without", () => {
    const now = Date.parse("2026-11-06T09:00:01.000Z");

    expect(describeAgent(AGENT, now)).toBe(
      "claude, 2 processes, 500 MB, 200.0% CPU, idle for 10 min",
    );
    expect(
      describeAgent({ ...AGENT, status: "running", idleSince: null, processCount: 1 }, now),
    ).toBe("claude, 1 process, 500 MB, 200.0% CPU, running");
  });

  it("describes a group", () => {
    const group: GroupUsage = {
      kind: "daemon",
      rssBytes: 285872 * KIB,
      cpuPercent: 0,
      processCount: 3,
    };

    expect(describeGroup(group)).toBe("3 processes, 279 MB, 0.0% CPU");
  });
});

describe("host rows", () => {
  it("shows the container against its cap, swap, host memory and load", () => {
    expect(hostRows(HOST).map((row) => [row.label, row.value])).toEqual([
      ["Container memory", "3.0 GB of 8.0 GB (38%)"],
      ["Swap", "0 B of 12 GB (0%)"],
      ["Available host memory", "7.0 GB of 15 GB"],
      ["Load", "1.54, 1.88, 2.22 on 2 cores"],
    ]);
  });

  it("says what is missing: no cgroup, no cap, no swap", () => {
    expect(hostRows(NO_HOST).map((row) => row.value)).toEqual([
      "Not available",
      "Not available",
      "Not available",
      "Not available",
    ]);
    const uncapped: HostSummary = { ...HOST, memoryLimitBytes: null, swapTotalBytes: 0 };
    expect(
      hostRows(uncapped)
        .map((row) => row.value)
        .slice(0, 2),
    ).toEqual(["3.0 GB used, no cap", "No swap"]);
  });
});

describe("server rows", () => {
  it("shows memory, swap and load, then one row per mount and process", () => {
    expect(serverRows(SNAPSHOT).map((row) => [row.label, row.value])).toEqual([
      ["Memory", "7.7 GB of 15 GB (51%)"],
      ["Swap", "5.7 GB of 12 GB (47%)"],
      ["Load", "3.08, 2.50, 2.53 on 2 cores"],
    ]);
    expect(
      mountRow({
        mount: "/",
        totalBytes: 151263856 * KIB,
        usedBytes: 107824412 * KIB,
        availableBytes: 43423060 * KIB,
      }),
    ).toEqual({ key: "/", label: "/", value: "103 GB of 144 GB (71%)" });
    expect(processRow({ pid: 164, rssBytes: 285872 * KIB, command: "Paseo Daemon" })).toEqual({
      key: "164",
      label: "Paseo Daemon",
      value: "279 MB, pid 164",
    });
  });
});
