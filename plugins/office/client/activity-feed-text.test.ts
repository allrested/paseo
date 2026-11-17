import { expect, test } from "vitest";
import { ACTIVITY_KINDS } from "../shared/names.js";
import { FEED_EMPTY, eventText } from "./activity-feed-text.js";

test("a step's word names only what the office was told, and nothing it was not", () => {
  expect(eventText("read")).toBe("Reading");
  expect(eventText("search")).toBe("Searching");
  expect(eventText("skill")).toBe("Using a skill");
  expect(eventText("edit")).toBe("Editing");
  expect(eventText("write")).toBe("Writing");
  expect(eventText("command")).toBe("Running a command");
  expect(eventText("web")).toBe("Searching the web");
  expect(eventText("tool")).toBe("Using a tool");
  expect(eventText("subagent")).toBe("Starting a sub-agent");
  expect(eventText("plan")).toBe("Updating the plan");
  expect(eventText("test")).toBe("Running tests");
  expect(eventText("commit")).toBe("Committing");
  expect(eventText("push")).toBe("Pushing");
  expect(eventText("deploy")).toBe("Deploying");
});

test("every step kind has a word", () => {
  for (const kind of ACTIVITY_KINDS) expect(eventText(kind)).not.toBe("");
});

test("a step that failed says so", () => {
  expect(eventText("test", { failed: true })).toBe("Running tests failed");
  expect(eventText("deploy", { failed: true })).toBe("Deploying failed");
  expect(eventText("read", { failed: true })).toBe("Reading failed");
});

test("the status words", () => {
  expect(eventText("started")).toBe("Started working");
  expect(eventText("finished")).toBe("Finished");
  expect(eventText("error")).toBe("Stopped on an error");
});

test("a permission is named by its short title, never its detail", () => {
  expect(eventText("permission", { title: "Bash" })).toBe("Needs permission: Bash");
  // No title, as the office sends none for some kinds: the word alone.
  expect(eventText("permission")).toBe("Needs permission");
});

test("a sub-agent's start names the office's name for it", () => {
  expect(eventText("subagent-started", { title: "boss-1" })).toBe("Started boss-1");
  expect(eventText("subagent-started")).toBe("A sub-agent started");
});

test("the empty feed's line", () => {
  expect(FEED_EMPTY).toBe("Nothing yet since the office opened.");
});
