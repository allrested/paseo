import { describe, expect, test } from "vitest";
import { filterPrompts, findPrompt, nameTaken, preview } from "./prompts.js";

const PROMPTS = [
  { name: "review", text: "Review the diff and list the risks first." },
  { name: "release notes", text: "Write release notes from the commits since the last tag." },
  { name: "Rebase", text: "Rebase this branch on main and fix what conflicts." },
  { name: "tests", text: "Write the missing tests.\nThen review them yourself." },
];

describe("findPrompt", () => {
  test("an exact name wins over longer names that start the same, whatever the case", () => {
    const prompts = [...PROMPTS, { name: "re", text: "short" }];
    expect(findPrompt(prompts, "RE")).toEqual({ status: "found", prompt: prompts.at(-1) });
    expect(findPrompt(PROMPTS, "rebase")).toEqual({ status: "found", prompt: PROMPTS[2] });
  });

  test("the start of one name is enough", () => {
    expect(findPrompt(PROMPTS, "rel")).toEqual({ status: "found", prompt: PROMPTS[1] });
    expect(findPrompt(PROMPTS, " t ")).toEqual({ status: "found", prompt: PROMPTS[3] });
  });

  test("the start of several names names them", () => {
    expect(findPrompt(PROMPTS, "re")).toEqual({
      status: "several",
      names: ["review", "release notes", "Rebase"],
    });
  });

  test("nothing typed, or a name nothing starts with, finds none", () => {
    expect(findPrompt(PROMPTS, "")).toEqual({ status: "none" });
    expect(findPrompt(PROMPTS, "deploy")).toEqual({ status: "none" });
    expect(findPrompt(PROMPTS, "view")).toEqual({ status: "none" });
  });
});

describe("filterPrompts", () => {
  test("no query lists every prompt in the saved order", () => {
    expect(filterPrompts(PROMPTS, "  ")).toEqual(PROMPTS);
  });

  test("a match in the name comes before a match in the text only", () => {
    expect(filterPrompts(PROMPTS, "REVIEW").map((p) => p.name)).toEqual(["review", "tests"]);
    expect(filterPrompts(PROMPTS, "tag").map((p) => p.name)).toEqual(["release notes"]);
    expect(filterPrompts(PROMPTS, "deploy")).toEqual([]);
  });
});

test("nameTaken ignores case and outer spaces", () => {
  expect(nameTaken(PROMPTS, " REBASE ")).toBe(true);
  expect(nameTaken(PROMPTS, "rebas")).toBe(false);
});

describe("preview", () => {
  test("is the first line that has text", () => {
    expect(preview("\n\n  Write the tests.  \nThen run them.")).toBe("Write the tests.");
  });

  test("cuts a long line and says so", () => {
    const line = preview("x".repeat(200));
    expect(line).toHaveLength(80);
    expect(line.endsWith("…")).toBe(true);
  });
});
