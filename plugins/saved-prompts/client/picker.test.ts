import { describe, expect, test } from "vitest";
import { pickerItems } from "./picker.js";

const PROMPTS = [
  { name: "review", text: "Review the diff and list the risks first." },
  { name: "tests", text: "Write the missing tests.\nThen review them yourself." },
];

describe("the composer's prompt list", () => {
  test("lists each prompt by name with its first line", () => {
    expect(pickerItems({ prompts: PROMPTS, query: "", draft: "" })).toEqual([
      {
        id: "prompt:review",
        kind: "prompt",
        label: "review",
        description: "Review the diff and list the risks first.",
        text: PROMPTS[0]?.text,
      },
      {
        id: "prompt:tests",
        kind: "prompt",
        label: "tests",
        description: "Write the missing tests.",
        text: PROMPTS[1]?.text,
      },
    ]);
  });

  test("the search narrows it, names before texts", () => {
    const labels = pickerItems({ prompts: PROMPTS, query: "review", draft: "" }).map(
      (item) => item.label,
    );
    expect(labels).toEqual(["review", "tests"]);
    expect(pickerItems({ prompts: PROMPTS, query: "deploy", draft: "" })).toEqual([]);
  });

  test("a new name offers to keep what the composer holds, after the matches", () => {
    const items = pickerItems({
      prompts: PROMPTS,
      query: " Test ",
      draft: "\nPlan the tests before writing them.\nOne case per rule.",
    });
    expect(items.map((item) => item.kind)).toEqual(["prompt", "save"]);
    expect(items.at(-1)).toEqual({
      id: "save",
      kind: "save",
      label: 'Save as "Test"',
      description: "Plan the tests before writing them.",
      name: "Test",
    });
  });

  test("no offer to save under a taken name, without a name, or with an empty composer", () => {
    const kinds = (query: string, draft: string) =>
      pickerItems({ prompts: PROMPTS, query, draft }).map((item) => item.kind);
    expect(kinds("REVIEW", "some text")).toEqual(["prompt", "prompt"]);
    expect(kinds("", "some text")).toEqual(["prompt", "prompt"]);
    expect(kinds("fresh", "  \n ")).toEqual([]);
  });

  test("an empty list says how the first prompt is made", () => {
    expect(pickerItems({ prompts: [], query: "", draft: "" })).toEqual([
      {
        id: "write",
        kind: "write",
        label: "No saved prompts yet",
        description: "Write one in the composer, then name it here to keep it",
      },
    ]);
    expect(pickerItems({ prompts: [], query: "", draft: "Review the diff." })).toEqual([
      {
        id: "write",
        kind: "write",
        label: "No saved prompts yet",
        description: "Type a name here to keep the composer's text",
      },
    ]);
    expect(
      pickerItems({ prompts: [], query: "review", draft: "Review the diff." }).map(
        (item) => item.kind,
      ),
    ).toEqual(["save"]);
  });
});
