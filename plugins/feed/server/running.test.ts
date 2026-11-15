import { expect, test } from "vitest";
import { listRunning, type ListAgents } from "./running.js";

const listed = (id: string) => ({ agent: { id, title: `Agent ${id}`, cwd: `/work/${id}` } });

test("the running agents are read page by page, and none has a start", async () => {
  const requests: unknown[] = [];
  const list: ListAgents = async (request) => {
    requests.push(request);
    return request.page.cursor === undefined
      ? { entries: [listed("a")], pageInfo: { hasMore: true, nextCursor: "next" } }
      : { entries: [listed("b")], pageInfo: { hasMore: false, nextCursor: null } };
  };

  expect(await listRunning(list)).toEqual([
    { agentId: "a", title: "Agent a", folder: "/work/a", since: null },
    { agentId: "b", title: "Agent b", folder: "/work/b", since: null },
  ]);
  expect(requests).toEqual([
    { filter: { statuses: ["running"] }, page: { limit: 200, cursor: undefined } },
    { filter: { statuses: ["running"] }, page: { limit: 200, cursor: "next" } },
  ]);
});

test("a list that fails rejects", async () => {
  await expect(listRunning(() => Promise.reject(new Error("no list")))).rejects.toThrow("no list");
});
