import { expect, test } from "vitest";
import type { Machine, MachineAgent } from "./contracts.js";
import {
  agentLine,
  agentRowLabel,
  cleanupFailure,
  formatBytes,
  formatDuration,
  hostNote,
  machineTitle,
  memoryPercent,
  memoryText,
  memoryTone,
} from "./machine-text.js";

const NOW = Date.parse("2026-11-16T12:00:00.000Z");
const MIN = 60_000;
const GB = 1024 ** 3;

function agent(patch: Partial<MachineAgent> = {}): MachineAgent {
  return {
    agentId: "0c7c901a-157f",
    title: "Rate limiter",
    status: "running",
    rssBytes: 640 * 1024 ** 2,
    processCount: 3,
    ports: [],
    idleSince: null,
    forgotten: false,
    ...patch,
  };
}

function machine(usedGb: number | null, agents: MachineAgent[] = []): Machine {
  return {
    readAt: new Date(NOW).toISOString(),
    memory: usedGb === null ? null : { usedBytes: usedGb * GB, totalBytes: 16 * GB },
    cpuPercent: 12,
    agents,
  };
}

test("bytes and durations read as on the Resources screen", () => {
  expect(formatBytes(900)).toBe("900 B");
  expect(formatBytes(1536)).toBe("1.5 KB");
  expect(formatBytes(640 * 1024 ** 2)).toBe("640 MB");
  expect(formatBytes(1.25 * GB)).toBe("1.3 GB");
  expect(formatDuration(20_000)).toBe("under a minute");
  expect(formatDuration(45 * MIN)).toBe("45 min");
  expect(formatDuration(125 * MIN)).toBe("2 h 5 min");
  expect(formatDuration(26 * 60 * MIN)).toBe("1 d 2 h");
});

test("an agent without a title is named by the start of its id", () => {
  expect(machineTitle(agent())).toBe("Rate limiter");
  expect(machineTitle(agent({ title: "  " }))).toBe("Agent 0c7c901a");
  expect(machineTitle(agent({ title: null }))).toBe("Agent 0c7c901a");
});

test("the line under an agent says its state, its processes and its ports", () => {
  expect(agentLine(agent(), NOW)).toBe("Running · 3 processes");
  expect(
    agentLine(
      agent({
        status: "idle",
        idleSince: new Date(NOW - 125 * MIN).toISOString(),
        processCount: 1,
        ports: [5173],
      }),
      NOW,
    ),
  ).toBe("Idle for 2 h 5 min · 1 process · port 5173");
  expect(agentLine(agent({ status: "closed", ports: [3000, 8000] }), NOW)).toBe(
    "Closed · 3 processes · ports 3000, 8000",
  );
  expect(agentLine(agent({ status: "idle" }), NOW)).toBe("Idle · 3 processes");
  expect(agentLine(agent({ status: "error" }), NOW)).toBe("Stopped with an error · 3 processes");
  expect(agentLine(agent({ status: "initializing" }), NOW)).toBe("Starting · 3 processes");
  expect(agentRowLabel(agent(), NOW)).toBe("Rate limiter: 640 MB, Running · 3 processes");
});

test("memory is a whole percent with a tone at 80 and at 90", () => {
  expect(memoryPercent(machine(9.8))).toBe(61);
  expect(memoryPercent(machine(null))).toBe(null);
  expect(memoryText(machine(9.8))).toBe("9.8 GB of 16 GB");
  expect(memoryText(machine(null))).toBe("Not read on this host");
  expect([79, 80, 89, 90, null].map(memoryTone)).toEqual([
    "muted",
    "warning",
    "warning",
    "danger",
    "muted",
  ]);
});

test("the header note names what was left running before the memory", () => {
  expect(hostNote(machine(9.8))).toEqual({ text: "Memory 61%", tone: "muted" });
  expect(hostNote(machine(13.6))).toEqual({ text: "Memory 85%", tone: "warning" });
  expect(hostNote(machine(15.2))).toEqual({ text: "Memory 95%", tone: "danger" });
  expect(hostNote(machine(null))).toEqual({ text: "Memory not read", tone: "muted" });
  expect(hostNote(machine(9.8, [agent({ forgotten: true }), agent()]))).toEqual({
    text: "1 agent left something running",
    tone: "warning",
  });
  expect(hostNote(machine(15.2, [agent({ forgotten: true }), agent({ forgotten: true })]))).toEqual(
    { text: "2 agents left something running", tone: "danger" },
  );
});

test("a cleanup that left something says how much and why", () => {
  const ok = { agentId: "a", ok: true, error: null };
  const busy = { agentId: "b", ok: false, error: "The agent is not idle" };
  expect(cleanupFailure([ok])).toBe(null);
  expect(cleanupFailure([busy])).toBe("The agent is not idle");
  expect(cleanupFailure([ok, busy, { agentId: "c", ok: false, error: null }])).toBe(
    "Unable to clean up 2 of 3. The first reason: The agent is not idle",
  );
  expect(cleanupFailure([{ agentId: "c", ok: false, error: null }])).toBe("no reason given");
});
