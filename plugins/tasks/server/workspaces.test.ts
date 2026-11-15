import { expect, test } from "vitest";
import { linkedWorkspaces, type WorkspaceListPage } from "./workspaces.js";

type Entry = WorkspaceListPage["entries"][number];

function pages(...list: Entry[][]) {
  const asked: Array<string | undefined> = [];
  const listWorkspaces = async ({ page }: { page: { limit: number; cursor?: string } }) => {
    asked.push(page.cursor);
    const index = page.cursor === undefined ? 0 : Number(page.cursor);
    const more = index + 1 < list.length;
    return {
      entries: list[index] ?? [],
      pageInfo: { hasMore: more, nextCursor: more ? String(index + 1) : null },
    };
  };
  return { asked, listWorkspaces };
}

const JIRA = {
  id: "wks_1",
  name: "BWLT-12-add-the-webhook",
  metadata: {
    "tasks.id": "jira:BWLT-12",
    "tasks.key": "BWLT-12",
    "tasks.url": "https://team.atlassian.net/browse/BWLT-12",
  },
};
const PLAIN = { id: "wks_2", name: "main" };

test("a workspace started on a task is linked to it; one that was not is only counted", async () => {
  const { listWorkspaces } = pages([JIRA, PLAIN]);
  expect(await linkedWorkspaces(listWorkspaces)).toEqual({
    workspaceIds: ["wks_1", "wks_2"],
    linked: [
      {
        workspaceId: "wks_1",
        name: "BWLT-12-add-the-webhook",
        key: "BWLT-12",
        url: "https://team.atlassian.net/browse/BWLT-12",
        taskId: "jira:BWLT-12",
      },
    ],
  });
});

test("every page of workspaces is read", async () => {
  const { asked, listWorkspaces } = pages([PLAIN], [JIRA]);
  const found = await linkedWorkspaces(listWorkspaces);
  expect(asked).toEqual([undefined, "1"]);
  expect(found.workspaceIds).toEqual(["wks_2", "wks_1"]);
  expect(found.linked.map((each) => each.workspaceId)).toEqual(["wks_1"]);
});

test("a workspace from before the task's id was kept is told by a Jira key", async () => {
  const { listWorkspaces } = pages([
    {
      id: "wks_3",
      name: "old",
      metadata: {
        "tasks.key": "shop-41",
        "tasks.url": "https://team.atlassian.net/browse/SHOP-41",
      },
    },
    {
      id: "wks_4",
      name: "older",
      metadata: {
        "tasks.key": "shop/web#7",
        "tasks.url": "https://git.team.test/shop/web/-/issues/7",
      },
    },
  ]);
  const { linked } = await linkedWorkspaces(listWorkspaces);
  expect(linked.map((each) => [each.key, each.taskId])).toEqual([
    ["shop-41", "jira:SHOP-41"],
    // GitLab's key holds the project's path, and its API is asked by the project's number.
    ["shop/web#7", undefined],
  ]);
});

test("a workspace being archived, or whose metadata is another plugin's, is not linked", async () => {
  const { listWorkspaces } = pages([
    { ...JIRA, id: "wks_5", archivingAt: "2026-11-15T10:00:00.000Z" },
    { id: "wks_6", name: "other", metadata: { "tasks.key": 12, "linear.issue": { id: "ENG-1" } } },
    { id: "wks_7", name: "no link", metadata: { "tasks.key": "BWLT-9" } },
  ]);
  const found = await linkedWorkspaces(listWorkspaces);
  expect(found.workspaceIds).toEqual(["wks_5", "wks_6", "wks_7"]);
  expect(found.linked).toEqual([
    { workspaceId: "wks_7", name: "no link", key: "BWLT-9", url: "", taskId: "jira:BWLT-9" },
  ]);
});
