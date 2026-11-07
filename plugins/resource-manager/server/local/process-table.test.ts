import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { statLine, writeFakeProc } from "./fake-proc.js";
import {
  findSupervisorPid,
  isGateShim,
  parseCpuTicks,
  parseMarkers,
  readProcessTable,
  type ProcessInfo,
} from "./process-table.js";
import { ProcStatParseError } from "./procfs.js";

// comm "x) R 1 700 (y": fields are counted from the last ")".
const TRICKY_COMM_STAT =
  "4242 (x) R 1 700 (y) S 501 500 500 0 -1 4194304 2283 0 0 0 9 2 0 0 20 0 11 0 5339488 " +
  "1236512768 10960 18446744073709551615 1 1 0 0 0 0 0 16781312 17442 0 0 0 17 3 0 0 0 0 0 0 0 " +
  "0 0 0 0 0 0\n";

const GATE_BIN = "/srv/paseo/heavy-command-gate/bin";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rm-ptable-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("parseCpuTicks", () => {
  it("adds utime and stime, counting from the last parenthesis", () => {
    expect(parseCpuTicks(TRICKY_COMM_STAT)).toBe(11);
    expect(parseCpuTicks(statLine({ pid: 7, ppid: 1, utime: 150, stime: 25 }))).toBe(175);
  });

  it("rejects a line without the tick fields", () => {
    expect(() => parseCpuTicks("7 (node) S 1")).toThrow(ProcStatParseError);
  });
});

describe("parseMarkers", () => {
  it("keeps the agent id and the heavy-gate marker and nothing else", () => {
    const environ = [
      "PATH=/usr/bin",
      "PASEO_PASSWORD=not-a-real-secret",
      "PASEO_AGENT_ID=agent-a",
      "PASEO_HEAVY_GATE_HELD=1",
      "",
    ].join("\0");

    expect(parseMarkers(environ)).toEqual({ agentId: "agent-a", heavyGate: true });
  });

  it("reads no marker from an empty environ or a gate value other than 1", () => {
    expect(parseMarkers("")).toEqual({ agentId: null, heavyGate: false });
    expect(parseMarkers("PASEO_HEAVY_GATE_HELD=0\0PASEO_AGENT_ID=\0")).toEqual({
      agentId: null,
      heavyGate: false,
    });
  });
});

describe("isGateShim", () => {
  it("is true only when argv[1] lies directly in the gate's bin directory", () => {
    const cmdline = (...args: string[]): string => args.map((arg) => `${arg}\0`).join("");

    expect(isGateShim(cmdline("/usr/bin/node", `${GATE_BIN}/npm`, "test"), GATE_BIN)).toBe(true);
    expect(isGateShim(cmdline("/usr/bin/node", `${GATE_BIN}//npx`), GATE_BIN)).toBe(true);
    expect(isGateShim(cmdline("/usr/bin/node", "/usr/bin/npm", "test"), GATE_BIN)).toBe(false);
    expect(isGateShim(cmdline("/usr/bin/node", `${GATE_BIN}/sub/npm`), GATE_BIN)).toBe(false);
    expect(isGateShim(cmdline("node", "bin/npm"), GATE_BIN)).toBe(false);
    expect(isGateShim(cmdline("Paseo Daemon"), GATE_BIN)).toBe(false);
    expect(isGateShim("", GATE_BIN)).toBe(false);
  });
});

describe("readProcessTable", () => {
  it("reads stat, RSS, ticks, markers and gate shims, and skips what it cannot read", () => {
    writeFakeProc(root, [
      { pid: 1, ppid: 0, startTime: 10, rssKb: 512, comm: "tini" },
      {
        pid: 300,
        ppid: 164,
        startTime: 3000,
        utime: 40,
        stime: 2,
        rssKb: 307200,
        env: { PASEO_AGENT_ID: "agent-a", HOME: "/home/u" },
      },
      {
        pid: 305,
        ppid: 300,
        cmdline: ["/usr/bin/node", `${GATE_BIN}/npm`, "test"],
        env: { PASEO_AGENT_ID: "agent-a" },
      },
      { pid: 2, ppid: 0, startTime: 5, rssKb: null, comm: "kthreadd", env: null },
    ]);
    // Pid 9 has an unparseable stat and no status: the table skips it.
    mkdirSync(join(root, "9"));
    writeFileSync(join(root, "9", "stat"), "garbage");

    const expected: ProcessInfo[] = [
      {
        pid: 1,
        ppid: 0,
        startTime: 10,
        cpuTicks: 0,
        rssBytes: 512 * 1024,
        agentId: null,
        heavyGate: false,
        gateShim: false,
      },
      {
        pid: 2,
        ppid: 0,
        startTime: 5,
        cpuTicks: 0,
        rssBytes: 0,
        agentId: null,
        heavyGate: false,
        gateShim: false,
      },
      {
        pid: 300,
        ppid: 164,
        startTime: 3000,
        cpuTicks: 42,
        rssBytes: 307200 * 1024,
        agentId: "agent-a",
        heavyGate: false,
        gateShim: false,
      },
      {
        pid: 305,
        ppid: 300,
        startTime: 1000,
        cpuTicks: 0,
        rssBytes: 1024 * 1024,
        agentId: "agent-a",
        heavyGate: false,
        gateShim: true,
      },
    ];
    expect(readProcessTable(root, GATE_BIN).sort((a, b) => a.pid - b.pid)).toEqual(expected);
  });

  it("returns nothing when /proc is missing", () => {
    expect(readProcessTable(join(root, "missing"), GATE_BIN)).toEqual([]);
  });
});

describe("findSupervisorPid", () => {
  it("names the parent whose title is Paseo Supervisor", () => {
    writeFakeProc(root, [
      { pid: 6, ppid: 1, cmdline: ["Paseo Supervisor", "", ""] },
      { pid: 164, ppid: 6, cmdline: ["Paseo Daemon"] },
    ]);

    expect(findSupervisorPid(164, root)).toBe(6);
  });

  it("is null when the daemon's parent is something else or unreadable", () => {
    writeFakeProc(root, [
      { pid: 50, ppid: 1, cmdline: ["npm", "run", "dev:server:raw"] },
      { pid: 164, ppid: 50, cmdline: ["Paseo Daemon"] },
    ]);

    expect(findSupervisorPid(164, root)).toBeNull();
    expect(findSupervisorPid(999, root)).toBeNull();
  });
});
