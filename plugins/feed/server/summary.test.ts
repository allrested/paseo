import { expect, test } from "vitest";
import { TEXT_MAX } from "../shared/contracts.js";
import { lastMessage, oneLine, type TimelineEntry } from "./summary.js";

const said = (text: string, turnId = "t2"): TimelineEntry => ({
  turnId,
  item: { type: "assistant_message", text },
});
const tool = (turnId = "t2"): TimelineEntry => ({ turnId, item: { type: "tool_call" } });

test("the last message of a turn is its newest run of assistant items, joined", () => {
  const entries = [
    said("An earlier answer.", "t1"),
    said("First."),
    tool(),
    said("Done "),
    said("now."),
  ];
  expect(lastMessage(entries, "t2")).toBe("Done now.");
});

test("a turn that ended on a tool call is summed up by what the agent said before it", () => {
  expect(lastMessage([said("Running the tests."), tool(), tool()], "t2")).toBe(
    "Running the tests.",
  );
});

test("another turn's words are not this turn's", () => {
  // A newer turn started before the read: nothing of the finished one is in the tail.
  expect(lastMessage([said("Old words.", "t1"), said("Newer words.", "t3")], "t2")).toBeNull();
  // The finished turn's message stops at the newer turn's items.
  expect(lastMessage([said("Mine."), said("Newer.", "t3")], "t2")).toBe("Mine.");
  expect(lastMessage([said("No id.")], null)).toBeNull();
  expect(lastMessage([], "t2")).toBeNull();
});

test("an item that is not text is not a message", () => {
  const odd: TimelineEntry = { turnId: "t2", item: { type: "assistant_message", text: 4 } };
  expect(lastMessage([odd], "t2")).toBeNull();
});

test("one line is the first line with words on it, as plain words", () => {
  expect(oneLine("\n\n## Done\n\nAll tests pass.")).toBe("Done");
  expect(oneLine("```ts\nconst a = 1;\n```")).toBe("const a = 1;");
  expect(oneLine("---\n- **Pushed** `main` to [origin](https://example.com/x)")).toBe(
    "Pushed main to origin",
  );
  expect(oneLine("> 1. quoted")).toBe("1. quoted");
  expect(oneLine("  spaced    out\twords  ")).toBe("spaced out words");
  expect(oneLine(" \n\t\n")).toBeNull();
});

test("a long line is cut to the row's length with an ellipsis", () => {
  const cut = oneLine(`${"word ".repeat(60)}end`)!;
  expect(cut).toHaveLength(TEXT_MAX);
  expect(cut.endsWith("word…")).toBe(true);
  expect(oneLine("x".repeat(TEXT_MAX))).toBe("x".repeat(TEXT_MAX));
});
