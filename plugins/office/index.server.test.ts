import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type {
  PluginServerContext,
  PluginSessionOpenRequest,
  PluginSettingsState,
} from "@getpaseo/plugin/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import contribute from "./index.server.js";
import { boardsFile } from "./server/paths.js";
import type { officeHostSettings } from "./shared/settings.js";

type SettingsState = PluginSettingsState<typeof officeHostSettings.schema>;
type Hook = (payload: object, context: object) => Promise<unknown>;

const ON: SettingsState = { status: "ready", revision: "1", values: { agentTools: true } };
const OFF: SettingsState = { status: "ready", revision: "2", values: { agentTools: false } };
const OWN_TOOL = { name: "other_tool", description: "Another plugin's tool", inputSchema: {} };
const HOOK_CONTEXT = { paseo: {}, signal: new AbortController().signal };

let home = "";
let previousHome: string | undefined;

// The entry opens boards.json under PASEO_HOME, so every test gets a home of its own.
beforeEach(() => {
  previousHome = process.env.PASEO_HOME;
  home = mkdtempSync(join(tmpdir(), "office-entry-"));
  process.env.PASEO_HOME = home;
  expect(boardsFile(process.env, homedir())).toBe(join(home, "office", "boards.json"));
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.PASEO_HOME;
  else process.env.PASEO_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function setup(read: () => Promise<SettingsState>) {
  const hooks = new Map<string, Hook>();
  const served: string[] = [];
  let reads = 0;
  const context = {
    registerSettings: () => ({
      read: () => {
        reads += 1;
        return read();
      },
      subscribe: () => () => undefined,
    }),
    handle: (contract: { name: string }) => {
      served.push(contract.name);
    },
    addHook: (name: string, hook: Hook) => {
      hooks.set(name, hook);
      return () => {
        hooks.delete(name);
      };
    },
  } as unknown as PluginServerContext;
  const stop = contribute(context);
  const open = (overrides: Partial<PluginSessionOpenRequest> = {}) =>
    hooks.get("agent.open.before")?.({ request: openRequest(overrides) }, HOOK_CONTEXT);
  return { hooks, served, stop, open, reads: () => reads };
}

function openRequest(overrides: Partial<PluginSessionOpenRequest>): PluginSessionOpenRequest {
  return {
    agentId: "agent-1",
    workspaceId: "w1",
    provider: "claude",
    cwd: "/workspace",
    reason: "create",
    purpose: "interactive",
    title: "Planner",
    background: false,
    labels: {},
    metadata: {},
    tools: [OWN_TOOL],
    env: {},
    mcpServers: {},
    ...overrides,
  } as PluginSessionOpenRequest;
}

function toolNames(result: unknown): string[] | undefined {
  return (result as PluginSessionOpenRequest | undefined)?.tools.map((tool) => tool.name);
}

test("an interactive session keeps its own tools and gets the three office tools", async () => {
  const { open, stop } = setup(async () => ON);
  const result = await open();
  expect(toolNames(result)).toEqual(["other_tool", "office_read", "office_post", "office_update"]);
  expect(result).toMatchObject({ agentId: "agent-1", purpose: "interactive", title: "Planner" });
  await stop();
});

test("a session opened before the setting is known waits for it, and gets no tools when it is off", async () => {
  let answer: (state: SettingsState) => void = () => undefined;
  const pending = new Promise<SettingsState>((resolve) => {
    answer = resolve;
  });
  const { open, stop } = setup(() => pending);
  const opening = open();
  answer(OFF);
  expect(await opening).toBeUndefined();
  await stop();
});

test("the setting is read at each open, so a change holds from the next session on", async () => {
  const states = [ON, OFF, ON];
  const { open, stop, reads } = setup(async () => states[reads() - 1] ?? ON);
  const results = [await open(), await open(), await open()];
  expect(results.map((result) => toolNames(result)?.length)).toEqual([4, undefined, 4]);
  await stop();
});

test("a session opened to read history gets no tools, and the setting is not read for it", async () => {
  const { open, stop, reads } = setup(async () => ON);
  expect(await open({ purpose: "history" })).toBeUndefined();
  expect(reads()).toBe(0);
  await stop();
});

test("a setting that cannot be read leaves the session as it is and is logged", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const { open, stop } = setup(async () => {
    throw new Error("settings store is down");
  });
  expect(await open()).toBeUndefined();
  expect(logged.mock.calls).toEqual([
    ["[office] agent.open.before failed: settings store is down"],
  ]);
  await stop();
});

test("the entry serves the office state, the asset and the four board calls, and stopping removes its hooks", async () => {
  const { hooks, served, stop } = setup(async () => ON);
  expect(served).toEqual([
    "office.state",
    "office.asset.request",
    "office.post.request",
    "office.update.request",
    "office.delete.request",
    "office.set_wakes_paused.request",
  ]);
  expect([...hooks.keys()]).toEqual([
    "agent.open.before",
    "agent.turn.after",
    "agent.close.after",
    "agent.archive.after",
    "workspace.archive.after",
  ]);
  await stop();
  expect(hooks.size).toBe(0);
});
