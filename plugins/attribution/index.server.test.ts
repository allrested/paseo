// The plugin as the daemon loads it: hooks in, RPC answers out, against a real repository.
import type { PluginHookAgent, PluginServerContext } from "@getpaseo/plugin/server";
import { afterEach, expect, test } from "vitest";
import { createAttributionPlugin } from "./index.server.js";
import { makeRepo, type TestRepo } from "./server/testing.js";

type Handler = (input: object, context: object) => unknown;

let repos: TestRepo[] = [];
afterEach(() => {
  for (const repo of repos) repo.remove();
  repos = [];
});

function setup(files: Record<string, string>) {
  const repo = makeRepo(files);
  repos.push(repo);
  const hooks = new Map<string, Handler>();
  const handlers = new Map<string, Handler>();
  const logs: string[] = [];
  const server = {
    handle: (contract: { name: string }, handler: Handler) =>
      void handlers.set(contract.name, handler),
    addHook: (name: string, hook: Handler) => {
      hooks.set(name, hook);
      return () => void hooks.delete(name);
    },
  } as unknown as PluginServerContext;
  const dispose = createAttributionPlugin(server, {
    root: repo.root,
    now: () => Date.parse("2026-11-15T10:00:00Z"),
    log: (message) => logs.push(message),
  });
  /** The host knows one workspace, "w1", in the repository; "w2" is in no checkout. */
  const paseo = {
    workspaces: {
      ref: (id: string) => ({
        refresh: async () =>
          id === "w1" ? { workspaceDirectory: repo.top } : { workspaceDirectory: repo.root },
      }),
    },
  };
  const agent = (overrides: Partial<PluginHookAgent> = {}): PluginHookAgent => ({
    id: "a1",
    workspaceId: "w1",
    parentAgentId: null,
    provider: "claude",
    cwd: repo.top,
    title: "Checkout total",
    background: false,
    metadata: {},
    ...overrides,
  });
  return {
    repo,
    hooks,
    logs,
    dispose,
    agent,
    hook: (name: string, payload: object) => hooks.get(name)?.(payload, {}),
    call: (name: string, input: object) => handlers.get(name)?.(input, { paseo }),
    subscribe: (subscriber: object) => handlers.get("attribution.changes")?.({}, subscriber),
  };
}

test("a turn's lines reach the panel's two calls, and its subscribers are told", async () => {
  const { repo, hook, call, subscribe, agent, logs } = setup({ "src/total.ts": "one\ntwo\n" });
  const events: object[] = [];
  const leave = new AbortController();
  const attached = subscribe({
    push: async (event: object) => void events.push(event),
    signal: leave.signal,
  });

  await hook("agent.turn.before", { agent: agent(), turnId: "t1" });
  repo.write("src/total.ts", "one\ntwo\nthree\n");
  await hook("agent.turn.after", { agent: agent(), turnId: "t1", outcome: { kind: "completed" } });

  const author = { id: "a1", title: "Checkout total", provider: "claude" };
  const at = Date.parse("2026-11-15T10:00:00Z");
  expect(await call("attribution.files.read.request", { workspaceId: "w1" })).toEqual({
    status: "ready",
    files: [{ path: "src/total.ts", at, agents: [author] }],
  });
  expect(
    await call("attribution.file.read.request", { workspaceId: "w1", path: "src/total.ts" }),
  ).toEqual({
    status: "ready",
    lines: ["one", "two", "three"],
    marks: [{ start: 3, count: 1, turn: 0 }],
    turns: [{ at, agents: [author] }],
  });
  expect(events).toEqual([{ type: "changed", workspaceIds: ["w1"] }]);
  expect(logs).toEqual([]);
  leave.abort();
  await attached;
});

test("a checkout nobody worked in answers with no files, and a folder outside one says so", async () => {
  const { call } = setup({ "a.txt": "one\n" });

  expect(await call("attribution.files.read.request", { workspaceId: "w1" })).toEqual({
    status: "ready",
    files: [],
  });
  expect(await call("attribution.file.read.request", { workspaceId: "w1", path: "a.txt" })).toEqual(
    {
      status: "untracked",
    },
  );
  expect(await call("attribution.files.read.request", { workspaceId: "w2" })).toEqual({
    status: "no_checkout",
  });
  expect(await call("attribution.file.read.request", { workspaceId: "w2", path: "a.txt" })).toEqual(
    {
      status: "untracked",
    },
  );
});

test("an agent that is closed during its turn keeps what it wrote until then", async () => {
  const { repo, hook, call, agent } = setup({ "a.txt": "one\n" });
  await hook("agent.turn.before", { agent: agent(), turnId: "t1" });
  repo.write("a.txt", "one\ntwo\n");
  await hook("agent.close.after", { agent: agent() });

  expect(
    await call("attribution.file.read.request", { workspaceId: "w1", path: "a.txt" }),
  ).toMatchObject({
    marks: [{ start: 2, count: 1, turn: 0 }],
  });
});

test("the hooks are removed when the plugin stops", () => {
  const { hooks, dispose } = setup({ "a.txt": "one\n" });
  expect(Array.from(hooks.keys()).sort()).toEqual([
    "agent.archive.after",
    "agent.close.after",
    "agent.turn.after",
    "agent.turn.before",
  ]);

  dispose();

  expect(hooks.size).toBe(0);
});
