import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  RUNTIME_EXIT_CHECKS,
  cleanUpAgent,
  type CleanupAgent,
  type CleanupPorts,
} from "./cleanup.js";
import { fakeHost, type FakeProcess } from "./fake-proc.js";

interface Harness {
  ports: CleanupPorts;
  closed: string[];
  stopped: number[];
  sleeps: number[];
}

async function harness(
  processes: FakeProcess[],
  agents: Record<string, CleanupAgent>,
  patch: Partial<CleanupPorts> = {},
): Promise<Harness> {
  const { procRoot } = await fakeHost({ processes });
  const closed: string[] = [];
  const stopped: number[] = [];
  const sleeps: number[] = [];
  const ports: CleanupPorts = {
    procRoot,
    selfPid: 40,
    agent: async (agentId) => agents[agentId] ?? null,
    closeRuntime: async (agentId) => void closed.push(agentId),
    stop: (pid) => void stopped.push(pid),
    sleep: async (ms) => void sleeps.push(ms),
    ...patch,
  };
  return { ports, closed, stopped, sleeps };
}

const DAEMON: FakeProcess[] = [
  { pid: 1, ppid: 0, name: "init" },
  { pid: 40, ppid: 1, name: "paseo" },
];

test("an idle agent's runtime is closed, then what outlived it is asked to end", async () => {
  const { ports, closed, stopped, sleeps } = await harness(
    [...DAEMON, { pid: 50, ppid: 40, agentId: "a" }, { pid: 51, ppid: 1, agentId: "a" }],
    { a: { status: "idle", resumable: true } },
  );
  expect(await cleanUpAgent(ports, "a")).toEqual({ agentId: "a", ok: true, error: null });
  expect(closed).toEqual(["a"]);
  // The fake processes never end, so every check waited.
  expect(sleeps.length).toBe(RUNTIME_EXIT_CHECKS);
  expect(stopped).toEqual([50, 51]);
});

test("a runtime that takes its processes with it needs no wait and no signal", async () => {
  const { ports, closed, stopped, sleeps } = await harness(DAEMON, {
    a: { status: "idle", resumable: true },
  });
  expect((await cleanUpAgent(ports, "a")).ok).toBe(true);
  expect(closed).toEqual(["a"]);
  expect(sleeps).toEqual([]);
  expect(stopped).toEqual([]);
});

test("a closed agent's leftovers are asked to end, and nobody else's processes", async () => {
  const { ports, closed, stopped } = await harness(
    [
      ...DAEMON,
      { pid: 60, ppid: 1, agentId: "gone" },
      { pid: 61, ppid: 1, agentId: "other" },
      { pid: 62, ppid: 1 },
    ],
    { gone: { status: "closed", resumable: true } },
  );
  expect((await cleanUpAgent(ports, "gone")).ok).toBe(true);
  expect(closed).toEqual([]);
  expect(stopped).toEqual([60]);
});

test("an agent at work, one that cannot resume and an unknown id are left alone", async () => {
  const { ports, closed, stopped } = await harness(
    [
      ...DAEMON,
      { pid: 70, agentId: "busy" },
      { pid: 71, agentId: "stuck" },
      { pid: 72, agentId: "x" },
    ],
    {
      busy: { status: "running", resumable: true },
      stuck: { status: "idle", resumable: false },
    },
  );
  expect(await cleanUpAgent(ports, "busy")).toEqual({
    agentId: "busy",
    ok: false,
    error: "The agent is not idle; clean up once its turn has ended",
  });
  expect((await cleanUpAgent(ports, "stuck")).error).toBe(
    "This agent has no saved session to resume, so it stays open",
  );
  expect((await cleanUpAgent(ports, "x")).error).toBe("This host does not know the agent");
  expect(closed).toEqual([]);
  expect(stopped).toEqual([]);
});

const DAEMON_OWN_ID =
  "This agent's id is the daemon's own: its processes cannot be told from the daemon's";

test("an id the daemon's own chain carries is refused, and nothing is closed or signalled", async () => {
  // A daemon started from agent a's shell: it and its children inherit a's id.
  const { ports, closed, stopped } = await harness(
    [
      { pid: 1, ppid: 0, name: "init" },
      { pid: 30, ppid: 1, agentId: "a", name: "claude" },
      { pid: 40, ppid: 30, agentId: "a", name: "paseo" },
      { pid: 45, ppid: 40, agentId: "a", name: "other-plugin" },
    ],
    { a: { status: "idle", resumable: true } },
  );
  expect(await cleanUpAgent(ports, "a")).toEqual({ agentId: "a", ok: false, error: DAEMON_OWN_ID });
  expect(closed).toEqual([]);
  expect(stopped).toEqual([]);
});

test("an id the daemon does not carry is cleaned as before, beside a daemon that carries another", async () => {
  const { ports, stopped } = await harness(
    [
      { pid: 1, ppid: 0, name: "init" },
      { pid: 30, ppid: 1, agentId: "a", name: "claude" },
      { pid: 40, ppid: 30, agentId: "a", name: "paseo" },
      { pid: 45, ppid: 40, agentId: "a", name: "other-plugin" },
      { pid: 50, ppid: 1, agentId: "b" },
    ],
    { b: { status: "closed", resumable: true } },
  );
  expect(await cleanUpAgent(ports, "b")).toEqual({ agentId: "b", ok: true, error: null });
  expect(stopped).toEqual([50]);
});

test("a failed close is reported and nothing is signalled", async () => {
  const { ports, stopped } = await harness(
    [...DAEMON, { pid: 50, agentId: "a" }],
    { a: { status: "idle", resumable: true } },
    {
      closeRuntime: async () => {
        throw new Error("the agent is in a foreground run");
      },
    },
  );
  expect(await cleanUpAgent(ports, "a")).toEqual({
    agentId: "a",
    ok: false,
    error: "the agent is in a foreground run",
  });
  expect(stopped).toEqual([]);
});

test("a process that already ended does not fail the cleanup", async () => {
  const { ports } = await harness(
    [...DAEMON, { pid: 60, agentId: "gone" }],
    { gone: { status: "closed", resumable: true } },
    {
      stop: () => {
        throw new Error("kill ESRCH");
      },
    },
  );
  expect((await cleanUpAgent(ports, "gone")).ok).toBe(true);
});

test("a pid that names another process by the time it is its turn is not signalled", async () => {
  const stopped: number[] = [];
  const { ports } = await harness(
    [...DAEMON, { pid: 60, agentId: "gone" }, { pid: 61, agentId: "gone", startTime: 7 }],
    { gone: { status: "closed", resumable: true } },
  );
  ports.stop = (pid) => {
    stopped.push(pid);
    // While 60 ends, 61 ends too and its pid goes to a process that started later.
    const fields = Array.from({ length: 50 }, () => "0");
    fields[19] = "9999";
    writeFileSync(
      join(ports.procRoot, "61", "stat"),
      `61 (postgres) S ${fields.slice(1).join(" ")}\n`,
    );
  };
  expect((await cleanUpAgent(ports, "gone")).ok).toBe(true);
  expect(stopped).toEqual([60]);
});

test("a plugin that inherited the agent's id is not stopped: the walk starts from its own pid", async () => {
  // The office as an installed plugin: pid 60, a subprocess of the daemon (40). readAncestors puts
  // the pid it starts from in its result, so 60's id is read as the daemon's own and refused.
  const { ports, stopped } = await harness(
    [...DAEMON, { pid: 60, ppid: 40, agentId: "a" }, { pid: 61, ppid: 1, agentId: "a" }],
    { a: { status: "closed", resumable: false } },
    { selfPid: 60 },
  );
  expect(await cleanUpAgent(ports, "a")).toEqual({ agentId: "a", ok: false, error: DAEMON_OWN_ID });
  expect(stopped).toEqual([]);
});
