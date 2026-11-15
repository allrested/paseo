import { expect, test } from "vitest";
import type { TaskRow } from "../shared/contracts.js";
import {
  ago,
  commentMeta,
  descriptionHint,
  earlierComments,
  emptyList,
  kindName,
  morePictures,
  placeName,
  requestsTitle,
  rowLabel,
  rowMeta,
} from "./format.js";

const NOW = Date.parse("2026-11-15T12:00:00.000Z");
const ROW: TaskRow = {
  id: "gitlab:mr:42:12",
  source: "gitlab",
  kind: "mr",
  key: "shop/web!12",
  title: "Add the rate limiter",
  status: "Draft",
  url: "https://git.team.test/shop/web/-/merge_requests/12",
};

test("a time reads as how long ago, and as a date after a month", () => {
  expect(ago("2026-11-15T11:59:30.000Z", NOW)).toBe("just now");
  expect(ago("2026-11-15T11:15:00.000Z", NOW)).toBe("45 min ago");
  expect(ago("2026-11-15T07:00:00.000Z", NOW)).toBe("5 h ago");
  expect(ago("2026-11-12T12:00:00.000Z", NOW)).toBe("3 d ago");
  expect(ago("2026-09-01T12:00:00.000Z", NOW)).toBe("on 2026-09-01");
});

test("a row's second line holds what is known, in one order", () => {
  expect(rowMeta(ROW, NOW)).toBe("Draft · GitLab");
  expect(
    rowMeta({ ...ROW, note: "Assigned to you", updatedAt: "2026-11-15T10:00:00.000Z" }, NOW),
  ).toBe("Draft · Assigned to you · 2 h ago · GitLab");
  // Listed for a reason: that it is open goes without saying.
  expect(rowMeta({ ...ROW, status: "Open", note: "Review requested" }, NOW)).toBe(
    "Review requested · GitLab",
  );
  expect(rowMeta({ ...ROW, status: "Open" }, NOW)).toBe("Open · GitLab");
  expect(rowMeta({ ...ROW, source: "jira", status: "In Progress" }, NOW)).toBe(
    "In Progress · Jira",
  );
});

test("a row is read aloud with what pressing it does", () => {
  expect(rowLabel(ROW)).toBe("shop/web!12 Add the rate limiter. Open the task");
});

test("a task is named by its tracker and kind", () => {
  expect(kindName(ROW)).toBe("GitLab merge request");
  expect(kindName({ source: "jira", kind: "issue" })).toBe("Jira issue");
  expect(kindName({ source: "github", kind: "mr" })).toBe("GitHub pull request");
});

test("the requests section is named for what it holds", () => {
  const gitlab = { source: "gitlab" } as const;
  const github = { source: "github" } as const;
  expect(requestsTitle([gitlab])).toBe("Merge requests");
  expect(requestsTitle([github, github])).toBe("Pull requests");
  expect(requestsTitle([gitlab, github])).toBe("Pull and merge requests");
});

test("a comment says who wrote it, and when if the tracker said", () => {
  expect(commentMeta({ author: "Rina Putri", at: "2026-11-15T11:00:00.000Z" }, NOW)).toBe(
    "Rina Putri · 1 h ago",
  );
  expect(commentMeta({ author: "Someone", at: "" }, NOW)).toBe("Someone");
});

test("the earlier comments are counted in a sentence", () => {
  expect(earlierComments(1, "jira")).toBe("1 earlier comment is on Jira");
  expect(earlierComments(12, "gitlab")).toBe("12 earlier comments are on GitLab");
});

test("an empty list says why it is empty", () => {
  expect(emptyList("  ")).toBe(
    "No open issues, merge requests or pull requests are assigned to you",
  );
  expect(emptyList(" webhook ")).toBe('Nothing matches "webhook"');
});

test("a tracker's place is a project, and GitHub's is a repository", () => {
  expect(placeName("jira")).toEqual({ title: "Project", one: "project", many: "projects" });
  expect(placeName("gitlab").title).toBe("Project");
  expect(placeName("github")).toEqual({
    title: "Repository",
    one: "repository",
    many: "repositories",
  });
});

test("the form says how each tracker reads a description", () => {
  expect(descriptionHint("jira")).toBe("Jira takes this as plain text");
  expect(descriptionHint("gitlab")).toBe("GitLab reads this as Markdown");
  expect(descriptionHint("github")).toBe("GitHub reads this as Markdown");
});

test("the button for the pictures not yet read counts them", () => {
  expect(morePictures(1)).toBe("Show 1 more picture");
  expect(morePictures(5)).toBe("Show 5 more pictures");
});
