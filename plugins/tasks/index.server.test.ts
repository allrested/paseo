import type { PluginServerContext } from "@getpaseo/plugin/server";
import { expect, test } from "vitest";
import { createTasksPlugin } from "./index.server.js";
import type { TokenStore } from "./server/token-store.js";

type Handler = (input: object, context?: object) => unknown;

/** The parts of the daemon's plugin API that the plugin calls. */
function setup(read: () => Promise<object>) {
  const handlers = new Map<string, Handler>();
  const settingsIds: string[] = [];
  const server = {
    registerSettings(definition: { id: string }) {
      settingsIds.push(definition.id);
      return { read, subscribe: () => () => {} };
    },
    handle(contract: { name: string }, handler: Handler) {
      handlers.set(contract.name, handler);
    },
  } as unknown as PluginServerContext;
  const tokens: TokenStore = {
    read: async () => ({ gitlab: "gitlab-token" }),
    write: async () => {},
  };
  const asked: string[] = [];
  const request: typeof fetch = async (input) => {
    asked.push(String(input));
    return new Response("[]");
  };
  const dispose = createTasksPlugin(server, { tokens, request, log: () => {} });
  return { handlers, settingsIds, asked, dispose };
}

const READY = {
  status: "ready",
  revision: "r1",
  values: { jiraSite: "", jiraEmail: "", gitlabUrl: "https://git.team.test" },
};

test("registers the connection settings and one handler per RPC", () => {
  const { handlers, settingsIds, dispose } = setup(async () => READY);
  expect(settingsIds).toEqual(["connections"]);
  expect([...handlers.keys()].sort()).toEqual([
    "tasks.assign",
    "tasks.attachments.search",
    "tasks.comments.add",
    "tasks.connections.test",
    "tasks.create",
    "tasks.detail",
    "tasks.images.read",
    "tasks.kinds.list",
    "tasks.list",
    "tasks.places.list",
    "tasks.prompt.fill",
    "tasks.search",
    "tasks.sources.list",
    "tasks.status.change",
    "tasks.tokens.read",
    "tasks.tokens.write",
    "tasks.workspaces.linked",
  ]);
  expect(() => dispose()).not.toThrow();
});

test("a search reads the saved address and asks that tracker", async () => {
  const { handlers, asked } = setup(async () => READY);
  expect(await handlers.get("tasks.search")?.({ query: "" })).toEqual({
    configured: true,
    tasks: [],
  });
  expect(asked).toHaveLength(1);
  expect(asked[0]).toMatch(/^https:\/\/git\.team\.test\/api\/v4\/issues\?/);
});

test("settings that cannot be read fail the search in words", async () => {
  const { handlers, asked } = setup(async () => ({
    status: "invalid",
    revision: "r1",
    error: "Unsupported version 9",
  }));
  await expect(handlers.get("tasks.search")?.({ query: "" })).rejects.toThrow(
    "The task connections cannot be read: Unsupported version 9",
  );
  expect(asked).toEqual([]);
});

test("the linked workspaces come from the host's own list, by way of the handler's Paseo API", async () => {
  const { handlers, asked } = setup(async () => READY);
  const listed: object[] = [];
  const paseo = {
    workspaces: {
      list: async (request: object) => {
        listed.push(request);
        return {
          entries: [
            { id: "wks_1", name: "main" },
            {
              id: "wks_2",
              name: "7-rate-limit",
              metadata: {
                "tasks.id": "gitlab:issue:42:7",
                "tasks.key": "shop/web#7",
                "tasks.url": "https://git.team.test/shop/web/-/issues/7",
              },
            },
          ],
          pageInfo: { hasMore: false, nextCursor: null },
        };
      },
    },
  };
  // The stand-in tracker answers "[]", which is no issue: the link stays, with no status.
  expect(await handlers.get("tasks.workspaces.linked")?.({}, { paseo })).toEqual({
    workspaceIds: ["wks_1", "wks_2"],
    linked: [
      {
        workspaceId: "wks_2",
        name: "7-rate-limit",
        key: "shop/web#7",
        url: "https://git.team.test/shop/web/-/issues/7",
        taskId: "gitlab:issue:42:7",
      },
    ],
  });
  expect(listed).toEqual([{ page: { limit: 200 } }]);
  expect(asked).toEqual(["https://git.team.test/api/v4/projects/42/issues/7"]);
});
