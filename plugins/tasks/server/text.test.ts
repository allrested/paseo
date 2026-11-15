import { expect, test } from "vitest";
import type { Issue } from "./issue.js";
import { issueText } from "./text.js";

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
