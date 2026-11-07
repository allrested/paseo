import { describe, expect, it } from "vitest";
import type { GateStatus, RunningCommand, WaitingCommand } from "../shared/rpc.js";
import {
  agentLabel,
  describeGate,
  describeRunning,
  describeWaiting,
  formatDuration,
  formatGb,
} from "./format.js";

const GIB = 1024 ** 3;

const RUNNING: RunningCommand = {
  id: "1",
  agentId: "0f3a9c2e-1111-2222-3333-444455556666",
  agentTitle: "Fix the parser",
  command: "npm run typecheck",
  pid: 4242,
  elapsedMs: 125_000,
  rssBytes: 2.5 * GIB,
  estimateBytes: 3 * GIB,
  forced: false,
};

const WAITING: WaitingCommand = {
  id: "2",
  agentId: null,
  agentTitle: null,
  command: "vitest run",
  pid: 4343,
  position: 2,
  waitedMs: 40_000,
  estimateBytes: 2 * GIB,
  waitingOn: "memory",
};

const STATUS: GateStatus = {
  state: "on",
  error: null,
  slots: 1,
  reserveBytes: GIB,
  freeBytes: 6.25 * GIB,
  running: [],
  waiting: [],
};

describe("format", () => {
  it("formats bytes as GB with one decimal", () => {
    expect(formatGb(1.5 * GIB)).toBe("1.5 GB");
    expect(formatGb(0)).toBe("0.0 GB");
    expect(formatGb(-5)).toBe("0.0 GB");
  });

  it("formats durations in their two largest units", () => {
    expect(formatDuration(42_900)).toBe("42 s");
    expect(formatDuration(125_000)).toBe("2 min 5 s");
    expect(formatDuration(3_725_000)).toBe("1 h 2 min");
    expect(formatDuration(-1)).toBe("0 s");
  });

  it("labels an agent by title, then by the start of its id, then as no agent", () => {
    expect(agentLabel(RUNNING)).toBe("Fix the parser");
    expect(agentLabel({ agentId: "0f3a9c2e-1111", agentTitle: null })).toBe("Agent 0f3a9c2e");
    expect(agentLabel({ agentId: null, agentTitle: null })).toBe("No agent");
  });

  it("describes a running command, with the starvation note when it was forced", () => {
    expect(describeRunning(RUNNING)).toBe(
      "Fix the parser, running 2 min 5 s, 2.5 GB in use, estimate 3.0 GB",
    );
    expect(describeRunning({ ...RUNNING, rssBytes: null, forced: true })).toBe(
      "Fix the parser, running 2 min 5 s, memory unknown, estimate 3.0 GB, started without enough free memory",
    );
  });

  it("describes a waiting command with its place and what it waits for", () => {
    expect(describeWaiting(WAITING)).toBe("#2, No agent, waiting 40 s for memory, estimate 2.0 GB");
    expect(describeWaiting({ ...WAITING, waitingOn: "slot" })).toBe(
      "#2, No agent, waiting 40 s for a slot, estimate 2.0 GB",
    );
  });

  it("describes the gate in each state", () => {
    expect(describeGate(STATUS)).toBe("6.3 GB free, 1.0 GB reserve, 1 slot");
    expect(describeGate({ ...STATUS, slots: 2, freeBytes: null })).toBe(
      "Free memory unknown, 1.0 GB reserve, 2 slots",
    );
    expect(describeGate({ ...STATUS, state: "off" })).toBe(
      "Heavy commands run at once, without waiting",
    );
    expect(
      describeGate({ ...STATUS, state: "unavailable", error: "PATH shims need a POSIX system" }),
    ).toBe("PATH shims need a POSIX system");
    expect(describeGate({ ...STATUS, state: "unavailable" })).toBe("The gate is not running");
  });
});
