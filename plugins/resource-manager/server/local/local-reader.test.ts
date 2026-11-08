import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentUsage, GroupUsage, HostSummary } from "../../shared/rpc.js";
import type { LiveAgent } from "../paseo-ports.js";
import type { PidRecord } from "../pid-files.js";
import { writeFakeProc, type FakePidSpace, type FakeProcess } from "./fake-proc.js";
import { LocalReader } from "./local-reader.js";

const SPACE: FakePidSpace = { pidNamespace: "pid:[4026531836]", bootId: "boot-1" };
const T0 = Date.parse("2026-11-06T09:00:00.000Z");
const KIB = 1024;
const GATE_BIN = "/srv/paseo/heavy-command-gate/bin";

// The container's tree on 2026-11-06 (tini, supervisor, daemon), plus one of each kind. Each
// round adds CPU ticks to three processes: agent-a +150 and +50, the heavy command +100.
function processes(round: number): FakeProcess[] {
  return [
    { pid: 1, ppid: 0, startTime: 10, rssKb: 512, comm: "tini" },
    { pid: 2, ppid: 0, startTime: 11, rssKb: null, comm: "kthreadd", env: null },
    { pid: 6, ppid: 1, startTime: 100, rssKb: 47316, cmdline: ["Paseo Supervisor", "", ""] },
    { pid: 164, ppid: 6, startTime: 200, rssKb: 286020, cmdline: ["Paseo Daemon"] },
    {
      pid: 300,
      ppid: 164,
      startTime: 3000,
      rssKb: 307200,
      utime: 1000 + 150 * round,
      env: { PASEO_AGENT_ID: "agent-a" },
    },
    {
      pid: 301,
      ppid: 300,
      startTime: 3010,
      rssKb: 204800,
      utime: 500 + 50 * round,
      env: { PASEO_AGENT_ID: "agent-a" },
    },
    {
      pid: 309,
      ppid: 300,
      startTime: 3090,
      rssKb: 40960,
      cmdline: ["/usr/bin/node", `${GATE_BIN}/npm`, "test"],
      env: { PASEO_AGENT_ID: "agent-a" },
    },
    {
      pid: 310,
      ppid: 309,
      startTime: 3100,
      rssKb: 1048576,
      utime: 2000 + 100 * round,
      env: { PASEO_AGENT_ID: "agent-a", PASEO_HEAVY_GATE_HELD: "1" },
    },
    { pid: 311, ppid: 310, startTime: 3110, rssKb: 20480 },
    { pid: 400, ppid: 164, startTime: 4000, rssKb: 102400 },
    { pid: 401, ppid: 400, pgrp: 401, startTime: 4001, rssKb: 51200 },
    { pid: 500, ppid: 164, startTime: 5000, rssKb: 10240, env: { PASEO_AGENT_ID: "agent-gone" } },
    { pid: 600, ppid: 164, startTime: 6000, rssKb: 4096 },
    { pid: 700, ppid: 164, startTime: 7000, rssKb: 409600, env: { PASEO_AGENT_ID: "agent-c" } },
  ];
}

const AGENTS: LiveAgent[] = [
  {
    id: "agent-a",
    title: "Fix login",
    provider: "claude",
    status: "idle",
    updatedAt: "2026-11-06T08:50:00.000Z",
  },
  {
    id: "agent-b",
    title: null,
    provider: "codex",
    status: "idle",
    updatedAt: "2026-11-06T08:00:00.000Z",
  },
  {
    id: "agent-c",
    title: "Refactor",
    provider: "codex",
    status: "running",
    updatedAt: "2026-11-06T08:59:00.000Z",
  },
];

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

let root: string;
let procRoot: string;
let runDir: string;

interface Harness {
  reader: LocalReader;
  sleeps: number[];
  /** Moves the clock and the fake /proc forward by one round. */
  advance(ms: number): void;
}

function harness(): Harness {
  let now = T0;
  let round = 0;
  const sleeps: number[] = [];
  const advance = (ms: number): void => {
    now += ms;
    round += 1;
    writeFakeProc(procRoot, processes(round));
  };
  const reader = new LocalReader({
    procRoot,
    cgroupRoot: join(root, "no-cgroup"),
    sharedMcpRunDir: runDir,
    heavyGateBinDir: GATE_BIN,
    daemonPid: 164,
    cores: 2,
    now: () => now,
    sleep: (ms) => {
      sleeps.push(ms);
      advance(ms);
      return Promise.resolve();
    },
  });
  return { reader, sleeps, advance };
}

function counting(agents: LiveAgent[]): { list: () => Promise<LiveAgent[]>; calls: () => number } {
  let calls = 0;
  return {
    list: () => {
      calls += 1;
      return Promise.resolve(agents);
    },
    calls: () => calls,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rm-local-"));
  procRoot = join(root, "proc");
  runDir = join(root, "shared-mcp-run");
  mkdirSync(runDir);
  writeFakeProc(procRoot, processes(0), SPACE);
  const record: PidRecord = {
    pgid: 400,
    startTime: 4000,
    ownerPid: 164,
    ownerStartTime: 200,
    pidNamespace: SPACE.pidNamespace,
    bootId: SPACE.bootId,
    initStartTime: 10,
  };
  writeFileSync(join(runDir, "context7.pid"), `${JSON.stringify(record)}\n`);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("LocalReader", () => {
  it("totals RSS and CPU per live agent and per group over a 1 s baseline", async () => {
    const { reader, sleeps } = harness();

    const reading = await reader.read(() => Promise.resolve(AGENTS));

    expect(sleeps).toEqual([1000]);
    const agents: AgentUsage[] = [
      {
        agentId: "agent-a",
        title: "Fix login",
        provider: "claude",
        status: "idle",
        rssBytes: (307200 + 204800 + 40960) * KIB,
        cpuPercent: 200,
        idleSince: "2026-11-06T08:50:00.000Z",
        processCount: 3,
      },
      {
        agentId: "agent-c",
        title: "Refactor",
        provider: "codex",
        status: "running",
        rssBytes: 409600 * KIB,
        cpuPercent: 0,
        idleSince: null,
        processCount: 1,
      },
    ];
    const groups: GroupUsage[] = [
      { kind: "daemon", rssBytes: (47316 + 286020 + 4096) * KIB, cpuPercent: 0, processCount: 3 },
      { kind: "sharedMcp", rssBytes: (102400 + 51200) * KIB, cpuPercent: 0, processCount: 2 },
      { kind: "heavyGate", rssBytes: (1048576 + 20480) * KIB, cpuPercent: 100, processCount: 2 },
      { kind: "other", rssBytes: (512 + 10240) * KIB, cpuPercent: 0, processCount: 3 },
    ];
    expect(reading).toEqual({
      readAt: "2026-11-06T09:00:01.000Z",
      host: NO_HOST,
      agents,
      groups,
      agentsError: null,
    });
  });

  it("reuses a reading within 1 s, measures over the poll gap, and re-baselines after 15 s", async () => {
    const { reader, sleeps, advance } = harness();
    const agents = counting(AGENTS);

    const first = await reader.read(agents.list);
    await expect(reader.read(agents.list)).resolves.toBe(first);
    expect(agents.calls()).toBe(1);

    advance(5_000);
    const second = await reader.read(agents.list);
    expect(sleeps).toEqual([1000]);
    // 200 ticks over 5 s.
    expect(second.agents[0].cpuPercent).toBe(40);

    advance(16_000);
    await reader.read(agents.list);
    expect(sleeps).toEqual([1000, 1000]);
    expect(agents.calls()).toBe(3);
  });

  it("reads afresh instead of reusing a reading after the clock steps back", async () => {
    const { reader, advance } = harness();
    const agents = counting(AGENTS);

    await reader.read(agents.list);
    advance(-60_000);
    await reader.read(agents.list);

    expect(agents.calls()).toBe(2);
  });

  it("shares one read between concurrent callers", async () => {
    const { reader } = harness();
    const agents = counting(AGENTS);

    const [a, b] = await Promise.all([reader.read(agents.list), reader.read(agents.list)]);

    expect(a).toBe(b);
    expect(agents.calls()).toBe(1);
  });

  it("reports a failed agent list and counts agent processes under 'other'", async () => {
    const { reader } = harness();

    const reading = await reader.read(() => Promise.reject(new Error("daemon unavailable")));

    expect(reading.agentsError).toBe("daemon unavailable");
    expect(reading.agents).toEqual([]);
    expect(reading.groups.find((group) => group.kind === "other")?.processCount).toBe(7);
    expect(reading.groups.find((group) => group.kind === "heavyGate")?.processCount).toBe(2);
  });
});
