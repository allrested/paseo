import { expect, test } from "vitest";
import { liveAgentPorts } from "./live-ports.js";
import type { PaseoHolder } from "./paseo-holder.js";

interface FakeAgent {
  id: string;
  status: string;
  archivedAt: string | null;
  pendingPermissions: unknown[];
}

function agent(id: string, overrides: Partial<FakeAgent> = {}): FakeAgent {
  return { id, status: "idle", archivedAt: null, pendingPermissions: [], ...overrides };
}

/** The daemon finds an agent by its id or by a start of it, archived agents too. */
const KNOWN = new Map([
  ["b-full-id", agent("b-full-id")],
  ["b-fu", agent("b-full-id")],
  ["run", agent("run", { status: "running" })],
  ["old", agent("old", { archivedAt: "2026-11-10T08:00:00.000Z" })],
  ["shut", agent("shut", { status: "closed" })],
]);

interface Sent {
  agentId: string;
  text: string;
  options: unknown;
}

/** The daemon's API as the office holds it: the agents of KNOWN, and a record of every send. */
function fakeHolder(sent: Sent[]): PaseoHolder {
  const paseo = {
    agents: {
      ref: (agentId: string) => ({
        refresh: async () => {
          const found = KNOWN.get(agentId);
          return found ? { agent: found, project: null } : null;
        },
        send: async (text: string, options?: unknown) => {
          sent.push({ agentId, text, options });
        },
      }),
    },
  };
  return { remember: () => undefined, require: () => paseo };
}

function setup() {
  const sent: Sent[] = [];
  return { ports: liveAgentPorts(fakeHolder(sent)), sent };
}

test("an agent's wake state is read from the daemon; one it does not know is gone", async () => {
  const { ports } = setup();
  expect(await ports.status("b-full-id")).toBe("wakeable");
  expect(await ports.status("run")).toBe("busy");
  expect(await ports.status("old")).toBe("gone");
  expect(await ports.status("nobody")).toBe("gone");
});

test("a start of an id resolves to the full id; an agent that can get no post resolves to none", async () => {
  const { ports } = setup();
  expect(await ports.resolve("b-fu")).toBe("b-full-id");
  expect(await ports.resolve("run")).toBe("run");
  expect(await ports.resolve("nobody")).toBeNull();
  // The queue drops posts for archived and closed agents unsent, so a post may not name one.
  expect(await ports.resolve("old")).toBeNull();
  expect(await ports.resolve("shut")).toBeNull();
});

test("a wake names its source agent; a wake as from the user names none and never cuts a turn", async () => {
  const { ports, sent } = setup();
  await ports.send("b-full-id", "Office board: 1 post(s) for you.", "a");
  await ports.send("b-full-id", "Office board: 2 post(s) for you.", null);
  expect(sent).toEqual([
    {
      agentId: "b-full-id",
      text: "Office board: 1 post(s) for you.",
      options: { sourceAgentId: "a" },
    },
    {
      agentId: "b-full-id",
      text: "Office board: 2 post(s) for you.",
      options: { activeTurnBehavior: "steer" },
    },
  ]);
});
