import { expect, test } from "vitest";
import { fakeHost } from "./fake-proc.js";
import { createMachineReader, type MachinePorts } from "./machine.js";
import type { KnownAgent } from "./reading.js";

const NOW = Date.parse("2026-11-16T12:00:00.000Z");

function known(id: string, status: KnownAgent["status"]): KnownAgent {
  return { id, title: `Agent ${id}`, status, updatedAt: "2026-11-16T12:00:00.000Z" };
}

async function reader(patch: Partial<MachinePorts> = {}, asked: string[] = []) {
  const roots = await fakeHost({
    processes: [
      { pid: 10, agentId: "live", rssKb: 500, sockets: [501] },
      { pid: 11, agentId: "gone", rssKb: 40 },
      { pid: 12, agentId: "stranger", rssKb: 900 },
      { pid: 13, rssKb: 100 },
    ],
    listening: [{ port: 5173, inode: 501 }],
    cgroup: { max: "16000", current: 6000 },
    cpu: [100, 0, 100, 800, 0, 0, 0, 0],
  });
  const agents: Record<string, KnownAgent> = { gone: known("gone", "closed") };
  return createMachineReader({
    ...roots,
    platform: "linux",
    now: () => NOW,
    liveAgents: async () => [known("live", "running")],
    agent: async (id) => {
      asked.push(id);
      return agents[id] ?? null;
    },
    ...patch,
  });
}

test("a reading has the host and the agents that hold something, a closed one included", async () => {
  const machine = await (await reader()).read();
  expect(machine).toEqual({
    readAt: "2026-11-16T12:00:00.000Z",
    memory: { usedBytes: 6000, totalBytes: 16000 },
    cpuPercent: null,
    agents: [
      {
        agentId: "gone",
        title: "Agent gone",
        status: "closed",
        rssBytes: 40 * 1024,
        processCount: 1,
        ports: [],
        idleSince: null,
        forgotten: true,
      },
      {
        agentId: "live",
        title: "Agent live",
        status: "running",
        rssBytes: 500 * 1024,
        processCount: 1,
        ports: [5173],
        idleSince: null,
        forgotten: false,
      },
    ],
  });
});

test("an id no agent has is asked about once, and a live agent never", async () => {
  const asked: string[] = [];
  const machine = await reader({}, asked);
  await machine.read();
  await machine.read();
  expect(asked).toEqual(["gone", "stranger", "gone"]);
});

test("CPU use needs a reading before it", async () => {
  const machine = await reader();
  expect((await machine.read())?.cpuPercent).toBe(null);
  // The fake /proc/stat does not move, so no time passed between the two.
  expect((await machine.read())?.cpuPercent).toBe(null);
});

test("an agent that got a runtime between the two calls is left for the next reading", async () => {
  const machine = await reader({ agent: async () => known("gone", "idle") });
  expect((await machine.read())?.agents.map((agent) => agent.agentId)).toEqual(["live"]);
});

test("a host that is not Linux has no reading", async () => {
  expect(await (await reader({ platform: "darwin" })).read()).toBe(null);
});

test("a reading says whether this host can close an agent's runtime", async () => {
  expect((await (await reader({ canCloseRuntime: () => true })).read())?.canCloseRuntime).toBe(
    true,
  );
  expect((await (await reader({ canCloseRuntime: () => false })).read())?.canCloseRuntime).toBe(
    false,
  );
});

test("a reader that is not asked leaves the field out, as an older server did", async () => {
  const machine = await (await reader()).read();
  expect(machine).not.toBeNull();
  expect(machine).not.toHaveProperty("canCloseRuntime");
});
