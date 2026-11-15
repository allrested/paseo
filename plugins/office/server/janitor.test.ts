import { expect, test } from "vitest";
import { tidyAgent, type JanitorPorts } from "./janitor.js";

function ports(overrides: Partial<JanitorPorts> = {}): JanitorPorts & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    status: async () => "idle",
    commands: async () => ["help", "compact", "clear"],
    send: async (agentId, text) => void sent.push(`${agentId} ${text}`),
    ...overrides,
  };
}

test("cleaning sends the provider's compact command to an idle agent", async () => {
  const office = ports();
  expect(await tidyAgent(office, "a1", "clean")).toEqual({ ok: true, error: null });
  expect(office.sent).toEqual(["a1 /compact"]);
});

test("a reset sends the first command the session has for a new conversation", async () => {
  const claude = ports();
  expect(await tidyAgent(claude, "a1", "reset")).toEqual({ ok: true, error: null });
  expect(claude.sent).toEqual(["a1 /clear"]);

  const other = ports({ commands: async () => ["reset", "new"] });
  await tidyAgent(other, "a2", "reset");
  expect(other.sent).toEqual(["a2 /new"]);
});

test("an agent at work is left alone, and its session is not asked", async () => {
  let asked = 0;
  const office = ports({
    status: async () => "running",
    commands: async () => {
      asked += 1;
      return ["compact"];
    },
  });
  expect(await tidyAgent(office, "a1", "clean")).toEqual({
    ok: false,
    error: "The agent is at work; clean its context once its turn has ended",
  });
  expect(await tidyAgent(office, "a1", "reset")).toEqual({
    ok: false,
    error: "The agent is at work; reset it once its turn has ended",
  });
  expect(asked).toBe(0);
  expect(office.sent).toEqual([]);
});

test("an agent that stopped on an error is tidied like an idle one", async () => {
  const office = ports({ status: async () => "error" });
  expect(await tidyAgent(office, "a1", "clean")).toEqual({ ok: true, error: null });
  expect(office.sent).toEqual(["a1 /compact"]);
});

test("an agent this host does not know is refused", async () => {
  const office = ports({ status: async () => null });
  expect(await tidyAgent(office, "ghost", "reset")).toEqual({
    ok: false,
    error: "This host does not know the agent",
  });
  expect(office.sent).toEqual([]);
});

test("a provider without the command says so, and nothing is sent", async () => {
  const office = ports({ commands: async () => ["help"] });
  expect(await tidyAgent(office, "a1", "clean")).toEqual({
    ok: false,
    error: "This agent's provider has no command that compacts a conversation",
  });
  expect(await tidyAgent(office, "a1", "reset")).toEqual({
    ok: false,
    error: "This agent's provider has no command that starts a new conversation",
  });
  expect(office.sent).toEqual([]);
});

test("a failure of the host is the answer's reason", async () => {
  const office = ports({
    send: async () => {
      throw new Error("the provider is not signed in");
    },
  });
  expect(await tidyAgent(office, "a1", "clean")).toEqual({
    ok: false,
    error: "the provider is not signed in",
  });
});
