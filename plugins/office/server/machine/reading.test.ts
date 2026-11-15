import { expect, test } from "vitest";
import { FORGOTTEN_AFTER_MS } from "../../shared/contracts.js";
import type { AgentProcess } from "./proc.js";
import { buildMachine, type KnownAgent } from "./reading.js";

const NOW = Date.parse("2026-11-16T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function process(pid: number, agentId: string, rssBytes: number): AgentProcess {
  return { pid, ppid: 1, startTime: pid, agentId, name: "node", rssBytes };
}

function known(id: string, status: KnownAgent["status"], updatedAt = ago(0)): KnownAgent {
  return { id, title: `Agent ${id}`, status, updatedAt };
}

function machine(
  agents: KnownAgent[],
  processes: AgentProcess[],
  listeners: [number, number[]][] = [],
) {
  return buildMachine({
    now: NOW,
    memory: { usedBytes: 6, totalBytes: 16 },
    cpuPercent: 12,
    processes,
    listeners: new Map(listeners),
    agents,
  });
}

test("an agent's memory is the sum over its processes, and its ports are theirs, once each", () => {
  const reading = machine(
    [known("a", "running")],
    [process(10, "a", 300), process(11, "a", 200), process(12, "a", 50)],
    [
      [11, [5173, 3000]],
      [12, [5173]],
    ],
  );
  expect(reading).toEqual({
    readAt: "2026-11-16T12:00:00.000Z",
    memory: { usedBytes: 6, totalBytes: 16 },
    cpuPercent: 12,
    agents: [
      {
        agentId: "a",
        title: "Agent a",
        status: "running",
        rssBytes: 550,
        processCount: 3,
        ports: [3000, 5173],
        idleSince: null,
        forgotten: false,
      },
    ],
  });
});

test("an idle agent has forgotten its server once the port has been open long enough", () => {
  const reading = machine(
    [
      known("fresh", "idle", ago(FORGOTTEN_AFTER_MS - 1)),
      known("old", "idle", ago(FORGOTTEN_AFTER_MS)),
      known("quiet", "idle", ago(FORGOTTEN_AFTER_MS * 4)),
      known("busy", "running", ago(FORGOTTEN_AFTER_MS * 4)),
    ],
    [process(1, "fresh", 1), process(2, "old", 1), process(3, "quiet", 1), process(4, "busy", 1)],
    [
      [1, [3000]],
      [2, [3001]],
      [4, [3002]],
    ],
  );
  expect(reading.agents.map((agent) => [agent.agentId, agent.forgotten, agent.idleSince])).toEqual([
    ["old", true, ago(FORGOTTEN_AFTER_MS)],
    ["busy", false, null],
    ["fresh", false, ago(FORGOTTEN_AFTER_MS - 1)],
    ["quiet", false, ago(FORGOTTEN_AFTER_MS * 4)],
  ]);
});

test("a closed agent is listed only for what it left behind, port or not", () => {
  const reading = machine(
    [known("gone", "closed"), known("clean", "closed"), known("live", "idle")],
    [process(1, "gone", 40), process(2, "live", 900)],
  );
  expect(reading.agents.map((agent) => [agent.agentId, agent.status, agent.forgotten])).toEqual([
    ["gone", "closed", true],
    ["live", "idle", false],
  ]);
});

test("a process of an agent this daemon does not know is not this host's to show", () => {
  const reading = machine([known("a", "idle")], [process(1, "a", 10), process(2, "stranger", 999)]);
  expect(reading.agents.map((agent) => agent.agentId)).toEqual(["a"]);
});

test("the forgotten come first, then the largest", () => {
  const reading = machine(
    [known("small", "running"), known("big", "running"), known("left", "closed")],
    [process(1, "small", 10), process(2, "big", 500), process(3, "left", 20)],
  );
  expect(reading.agents.map((agent) => agent.agentId)).toEqual(["left", "big", "small"]);
});
