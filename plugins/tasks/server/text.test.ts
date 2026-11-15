import { expect, test } from "vitest";
import type { Issue } from "./issue.js";
import { issueText, takeImages } from "./text.js";

const ISSUE: Issue = {
  source: "jira",
  key: "BWLT-12",
  title: "Add the webhook",
  status: "In Progress",
  url: "https://team.atlassian.net/browse/BWLT-12",
  description: "Send it on payment.\n\nRetry three times.",
  details: [
    ["Type", "Story"],
    ["Priority", "High"],
  ],
  branchPrefix: "BWLT-12",
};

test("the text names the task, its link, its state and its description", () => {
  expect(issueText(ISSUE)).toBe(
    [
      "Jira issue BWLT-12: Add the webhook",
      "URL: https://team.atlassian.net/browse/BWLT-12",
      "Status: In Progress",
      "Type: Story",
      "Priority: High",
      "",
      "Send it on payment.",
      "",
      "Retry three times.",
    ].join("\n"),
  );
});

test("a task with no description says so", () => {
  const text = issueText({ ...ISSUE, source: "gitlab", details: [], description: "  " });
  expect(text).toBe(
    [
      "GitLab issue BWLT-12: Add the webhook",
      "URL: https://team.atlassian.net/browse/BWLT-12",
      "Status: In Progress",
      "",
      "No description.",
    ].join("\n"),
  );
});

test("a very long description is cut and says how much is missing", () => {
  const text = issueText({ ...ISSUE, details: [], description: "a".repeat(20_050) });
  const lines = text.split("\n");
  expect(lines.at(-2)).toBe("a".repeat(20_000));
  expect(lines.at(-1)).toBe("[Cut here. 50 more characters are on the task's page.]");
});

test("pictures are taken out of a text once each, and the text names them where they stood", () => {
  const taken = takeImages(
    "a ![one](/f/1) b ![two](/f/2) c ![again](/f/1) d ![far](https://x.test/f/3)",
    /!\[([^\]]*)\]\(\/f\/(\d+)\)/g,
    ([, name, id]) => ({ id, name }),
  );
  expect(taken.images).toEqual([
    { id: "1", name: "one" },
    { id: "2", name: "two" },
  ]);
  expect(taken.text).toBe(
    "a (image: one) b (image: two) c (image: again) d ![far](https://x.test/f/3)",
  );
});

test("a pattern with two shapes hands over only the groups its match filled", () => {
  const seen: string[][] = [];
  takeImages(
    "![a](/f/1) <img src=/f/2>",
    /!\[(\w*)\]\(\/f\/(\d)\)|<img src=\/f\/(\d)>/g,
    (match) => {
      seen.push(match);
      return { id: match.at(-1) ?? "", name: "x" };
    },
  );
  expect(seen).toEqual([
    ["![a](/f/1)", "a", "1"],
    ["<img src=/f/2>", "2"],
  ]);
});

test("a text with no pictures comes back as it was", () => {
  expect(takeImages("plain", /!\[\]\(x\)/g, () => ({ id: "", name: "" }))).toEqual({
    text: "plain",
    images: [],
  });
});
