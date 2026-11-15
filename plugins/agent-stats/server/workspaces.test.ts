import { expect, test } from "vitest";
import { listWorkspaces, type ListWorkspaces } from "./workspaces.js";

test("the workspaces are read page by page, without the ones being archived", async () => {
  const requests: unknown[] = [];
  const list: ListWorkspaces = async (request) => {
    requests.push(request);
    return request.page.cursor === undefined
      ? {
          entries: [
            { id: "w1", name: "Checkout" },
            { id: "w2", name: "Going", archivingAt: "2026-11-15T09:00:00.000Z" },
          ],
          pageInfo: { hasMore: true, nextCursor: "next" },
        }
      : {
          entries: [{ id: "w3", name: "Search", archivingAt: null }],
          pageInfo: { hasMore: false, nextCursor: null },
        };
  };

  expect(await listWorkspaces(list)).toEqual([
    { id: "w1", name: "Checkout" },
    { id: "w3", name: "Search" },
  ]);
  expect(requests).toEqual([{ page: { limit: 200 } }, { page: { limit: 200, cursor: "next" } }]);
});
