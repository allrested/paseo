import { expect, test } from "vitest";
import { fieldItems } from "./picker.js";

const TASK = {
  id: "jira:BWLT-12",
  label: "BWLT-12 Add the webhook",
  description: "Jira · In Progress",
  key: "BWLT-12",
  url: "https://team.atlassian.net/browse/BWLT-12",
  branch: "BWLT-12-add-the-webhook",
};

test("with no tracker connected the list offers to connect one", () => {
  expect(fieldItems({ configured: false, tasks: [], query: "", chosen: false })).toEqual([
    {
      kind: "setup",
      id: "tasks:setup",
      label: "Connect Jira or GitLab",
      description: "Opens the task connections",
    },
  ]);
});

test("the tasks list as they came", () => {
  expect(fieldItems({ configured: true, tasks: [TASK], query: "", chosen: false })).toEqual([
    { kind: "task", ...TASK },
  ]);
});

test("once a task is picked, the unfiltered list starts with a way back", () => {
  const items = fieldItems({ configured: true, tasks: [TASK], query: " ", chosen: true });
  expect(items.map((item) => item.kind)).toEqual(["none", "task"]);
  expect(items[0]).toMatchObject({ label: "No task", description: "Paseo names the branch" });
});

test("a search lists matches only", () => {
  const items = fieldItems({ configured: true, tasks: [TASK], query: "web", chosen: true });
  expect(items.map((item) => item.kind)).toEqual(["task"]);
});

test("connected with nothing assigned is an empty list", () => {
  expect(fieldItems({ configured: true, tasks: [], query: "", chosen: false })).toEqual([]);
});
